// server/jobs/dailyQuerryAllStates.mjs
import mongoose from 'mongoose';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import { Product } from '../../dbFunctionality/schemas/schema.js';
import { MessageTask } from '../../dbFunctionality/schemas/messageTask.js';
import { computeSendAt } from '../pm/time-utils.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsAppDB_3';
const BASE_DIR = path.resolve(process.cwd(), 'programmedmsgs');

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
}

// We only care about conversations whose last inbound is within last 24h
const WINDOW_MS      = 24 * 60 * 60 * 1000;
// How long we wait after *your* last message before treating convo as "abandoned"
const INACTIVITY_MS  = 2 * 60 * 60 * 1000; // 2 hours

function activeStateFromMisc(misc = {}) {
  if (misc.funnelLevel1) return 1;
  if (misc.funnelLevel2) return 2;
  if (misc.funnelLevel3) return 3;
  if (misc.funnelLevel4) return 4;
  return null;
}

async function listPrograms() {
  if (!fssync.existsSync(BASE_DIR)) return [];
  const dirs = await fs.readdir(BASE_DIR, { withFileTypes: true });
  const out = [];

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const metaPath = path.join(BASE_DIR, d.name, 'meta.json');
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      const state = activeStateFromMisc(meta?.misc);
      if (state) out.push({ id: meta.id || d.name, state, meta });
    } catch {
      // Ignore malformed programmed-message folders.
    }
  }

  return out;
}

function cleanTags(tags = []) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean))];
}

function productTagsFor(product) {
  const tags = [];
  for (const s of product.state || []) {
    for (const item of s.productObject || []) {
      if (item?.product_info_requested) tags.push(item.product_info_requested);
    }
  }
  for (const profile of product.costumer_profile || []) {
    if (profile?.productOfInterest) tags.push(profile.productOfInterest);
  }
  return cleanTags(tags);
}

function tagsMatch(productTags, selectedTags) {
  const selected = cleanTags(selectedTags);
  if (!selected.length) return true; // backward compatible: no targeting means all products.
  const productSet = new Set(cleanTags(productTags));
  return selected.some((tag) => productSet.has(tag));
}

function hasFunnelState(state = [], funnelState) {
  return state.some((s) => s.purchase_state?.some((ps) => ps.funnel_state === funnelState));
}

function state2IsValid(state = []) {
  return state.some((s) => {
    const lastShipping = s.shippingStatus?.[s.shippingStatus.length - 1];
    const lastFunnel = s.purchase_state?.[s.purchase_state.length - 1];
    const lastSent = s.messagesSentCollection?.[s.messagesSentCollection.length - 1];
    return lastFunnel?.funnel_state === 2 && !!lastShipping && !!lastSent;
  });
}

function productMatchesProgramState(productState = [], programState) {
  if (programState === 1) return hasFunnelState(productState, 0);
  if (programState === 2) return state2IsValid(productState);
  return hasFunnelState(productState, programState);
}

export async function dailyQuerryAllStates() {
  await connectDB();

  const programs = await listPrograms();
  if (!programs.length) return [];

  const nowMs = Date.now();
  const minLastInbound = new Date(nowMs - WINDOW_MS);

  const rawProducts = await Product.find({
    lastInboundTs: { $gte: minLastInbound },
    'state.purchase_state': {
      $elemMatch: { funnel_state: { $in: [0, 2, 3, 4, 5] } }
    }
  }).lean();

  const candidates = []; // { program_id, state_id, customer_id, sellerId, sendAt, productTags, dedupeKey }

  for (const product of rawProducts) {
    const { customer_id, latestSeller, customer_messages, state, lastInboundTs } = product;
    if (!customer_id || !latestSeller || !state?.length) continue;

    const latestCustomerMsg = customer_messages?.length
      ? customer_messages.reduce((a, b) => (b.timestamp > a.timestamp ? b : a))
      : null;

    const effectiveLastInbound = lastInboundTs || latestCustomerMsg?.timestamp;
    if (!effectiveLastInbound) continue;

    const lastInboundDate = new Date(effectiveLastInbound);
    if (Number.isNaN(lastInboundDate.getTime())) continue;
    if (nowMs - lastInboundDate.getTime() > WINDOW_MS) continue;

    let latestSentMsg = null;
    for (const s of state) {
      if (!s.messagesSentCollection?.length) continue;
      const lastSent = s.messagesSentCollection[s.messagesSentCollection.length - 1];
      if (!latestSentMsg || lastSent.timestamp > latestSentMsg.timestamp) {
        latestSentMsg = lastSent;
      }
    }

    // If there is no seller msg, or customer replied after the last seller msg → nothing is "abandoned" yet.
    if (!latestSentMsg || (latestCustomerMsg && latestCustomerMsg.timestamp > latestSentMsg.timestamp)) {
      continue;
    }

    const idleMs = nowMs - new Date(latestSentMsg.timestamp).getTime();
    if (idleMs < INACTIVITY_MS) continue;

    let hasRemarketing = false;
    for (const s of state) {
      const reMarketing = s.reMarketing;
      const lastReMarketing = reMarketing?.[reMarketing.length - 1];
      const remarketing_state = lastReMarketing?.remarketing_state;
      if (remarketing_state !== undefined && remarketing_state !== null) {
        hasRemarketing = true;
        break;
      }
    }
    if (hasRemarketing) continue;

    const productTags = productTagsFor(product);

    for (const program of programs) {
      if (!productMatchesProgramState(state, program.state)) continue;

      const selectedTags = cleanTags(program.meta?.targeting?.productTags);
      if (!tagsMatch(productTags, selectedTags)) continue;

      const sendAt = computeSendAt(lastInboundDate, program.meta?.schedule);
      if (!sendAt) continue;

      const dedupeTags = selectedTags.length ? selectedTags.sort().join('|') : 'all';
      const dedupeKey = `${program.id}:${program.state}:${customer_id}:${latestSeller}:${dedupeTags}`;

      candidates.push({
        program_id: program.id,
        state_id: program.state,
        customer_id,
        sellerId: latestSeller,
        sendAt,
        productTags: selectedTags,
        dedupeKey
      });
    }
  }

  if (!candidates.length) return [];

  const dedupeKeys = candidates.map((c) => c.dedupeKey);
  const existingTasks = await MessageTask.find(
    { dedupeKey: { $in: dedupeKeys } },
    { dedupeKey: 1 }
  ).lean();
  const existingDedupeSet = new Set(existingTasks.map((t) => t.dedupeKey));

  const seenThisRun = new Set();
  return candidates
    .filter((c) => {
      if (existingDedupeSet.has(c.dedupeKey) || seenThisRun.has(c.dedupeKey)) return false;
      seenThisRun.add(c.dedupeKey);
      return true;
    })
    .map((c) => ({
      program_id:  c.program_id,
      state_id:    c.state_id,
      customer_id: c.customer_id,
      sellerId:    c.sellerId,
      sendAt:      c.sendAt,
      productTags: c.productTags,
      dedupeKey:   c.dedupeKey
    }));
}

// -----------------------------------------------------------
// CLI test runner: run only when this file is executed directly
// -----------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('dailyQuerryAllStates.js')) {
  (async () => {
    try {
      const results = await dailyQuerryAllStates();
      void results;

      process.exit(0);
    } catch (err) {
      console.error('[CLI] Error running dailyQuerryAllStates:', err);
      process.exit(1);
    }
  })();
}
