// server/jobs/programmed-dispatcher.js
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import tz from "dayjs/plugin/timezone.js";
import "dotenv/config";
import mongoose from "mongoose";
import { Product } from "../dbFunctionality/schemas/schema.js"; // for lastInboundTs checks
import { currentPurchaseState, productMatchesProgramState } from "./pm/eligibility.js";

dayjs.extend(utc);
dayjs.extend(tz);

// === config ===
const BASE_DIR = path.resolve(process.cwd(), "programmedmsgs");
const DEFAULT_TZ = process.env.APP_TZ || "America/Lima";
const MINUTE_WINDOW = 6;           // kept for reference (shouldRunNow), but no longer used
const SEND_GAP_MS_IMAGE = 1600;
const SEND_GAP_MS_TEXT  = 500;
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 20; // exclusive: [08:00, 20:00)
const SAME_PROGRAM_COOLDOWN_DAYS = 7;

// === (optional) mongoose connection event logs ===
export function installConnectionEventLogs() {
  const c = mongoose.connection;
  const events = [
    "connecting",
    "connected",
    "open",
    "reconnected",
    "disconnecting",
    "disconnected",
    "close",
    "error",
  ];
  for (const ev of events) c.removeAllListeners(ev);
}

// === queue model ===
const queueSchema = new mongoose.Schema(
  {
    state_id:    Number,
    program_id:  String,
    customer_id: String,
    sellerId:    String,

    // when this row is allowed to be sent
    sendAt:      { type: Date },
    productTags: [String],
    dedupeKey:   String,

    sent:        { type: Boolean, default: false },
    sentAt:      { type: Date },
    processing:  { type: Boolean, default: false },
    processingAt:{ type: Date },
    created_at:  { type: Date, default: Date.now },
  },
  { collection: "message_tasks" }
);

export const Queue =
  mongoose.models.ProgrammedQueue || mongoose.model("ProgrammedQueue", queueSchema);

// === helpers ===
async function listPrograms() {
  if (!fssync.existsSync(BASE_DIR)) return [];
  const dirs = await fs.readdir(BASE_DIR, { withFileTypes: true });
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const metaPath = path.join(BASE_DIR, d.name, "meta.json");
    try {
      const raw  = await fs.readFile(metaPath, "utf8");
      const meta = JSON.parse(raw);
      out.push({
        id:  meta.id || d.name,
        dir: path.join(BASE_DIR, d.name),
        meta,
        metaPath,
      });
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

function activeStateFromMisc(misc = {}) {
  if (misc.funnelLevel1) return 1;
  if (misc.funnelLevel2) return 2;
  if (misc.funnelLevel3) return 3;
  if (misc.funnelLevel4) return 4;
  // if you ever add funnelLevel5, map it here
  // if (misc.funnelLevel5) return 5;
  return null;
}

// kept for reference, but NOT used anymore to gate programs
function shouldRunNow(times = [], now = dayjs()) {
  if (!Array.isArray(times) || times.length === 0) return false;
  const localNow = now.tz(DEFAULT_TZ);
  return times.some((hhmm) => {
    const [H, M] = hhmm.split(":").map(Number);
    const target = localNow.clone().hour(H).minute(M).second(0);
    const diff   = Math.abs(localNow.diff(target, "minute"));
    return diff <= MINUTE_WINDOW;
  });
}

function isBusinessTime(now = dayjs()) {
  const localHour = now.tz(DEFAULT_TZ).hour();
  return localHour >= BUSINESS_START_HOUR && localHour < BUSINESS_END_HOUR;
}

function nextBusinessStart(now = dayjs()) {
  const localNow = now.tz(DEFAULT_TZ);
  const nextLocal = localNow.hour() < BUSINESS_START_HOUR
    ? localNow.hour(BUSINESS_START_HOUR).minute(0).second(0).millisecond(0)
    : localNow.add(1, "day").hour(BUSINESS_START_HOUR).minute(0).second(0).millisecond(0);
  return nextLocal.toDate();
}

const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

async function waitForMongoReady({ verbose = true, timeoutMs = 30000 } = {}) {
  const start = Date.now();
  if (mongoose.connection.readyState === 1) return;
  while (mongoose.connection.readyState !== 1) {
    // 0 = disconnected, 2 = connecting, 3 = disconnecting
    await new Promise((r) => setTimeout(r, 250));
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Mongo not connected after ${timeoutMs}ms (readyState=${mongoose.connection.readyState})`
      );
    }
  }
}

/**
 * sendProgramToRow
 * @param {object} program  { meta, metaPath, state }
 * @param {mongoose.Document} row
 * @param {object} opts
 *  - sendText: async (to, text, sellerId) => wamid | {wamid} | {ok,wamid}
 *  - sendMedia?: async (to, {url,mime,caption}, sellerId) => wamid | {wamid} | {ok,wamid}
 *  - onMessageSent?: ({wamid,to,type,content?,url?})=>void
 *  - verbose?: boolean
 */
async function sendProgramToRow(
  program,
  row,
  { sendText, sendMedia, onMessageSent, verbose = true } = {}
) {
  if (typeof sendText !== "function") {
    throw new Error("sendText function is required");
  }

  const { meta, metaPath } = program;
  const msgs = Array.isArray(meta.messages) ? meta.messages : [];

  for (let i = 0; i < msgs.length; i++) {
    const m     = msgs[i] || {};
    const files = Array.isArray(m.files) ? m.files : [];

    const textBody = String(m.text || "");

    // Saved-reply behavior: if a bubble has media, send the bubble text as the
    // caption of the first media item instead of also sending a separate text
    // bubble. This avoids duplicated-looking programmed messages and matches
    // the saved reply composer.
    if (files.length === 0 && textBody.trim()) {
      const t0 = Date.now();

      const r  = await sendText(row.customer_id, textBody, row.sellerId);
      const ms = Date.now() - t0;

      // Normalize return shape
      const wamid =
        (r && (r.wamid || r.id)) || (typeof r === "string" ? r : null);
      const ok = !!wamid;

      if (!ok) throw new Error("text not sent (missing wamid)");

      try {
        onMessageSent?.({
          wamid,
          to: row.customer_id,
          type: "text",
          content: textBody,
          ms,
        });
      } catch {
        // swallow onMessageSent errors
      }

      await sleep(SEND_GAP_MS_TEXT);
    }

    // MEDIA (optional)
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const f = files[fileIndex];
      if (!sendMedia) {
        continue;
      }

      const mediaUrl = f.url || f.absUrl;
      const mediaMime = f.mime || f.mimeType || "";
      const r = await sendMedia(
        row.customer_id,
        {
          url: mediaUrl,
          mime: mediaMime,
          name: f.name || f.storedName,
          caption: fileIndex === 0 ? textBody : "",
        },
        row.sellerId
      );
      const wamid =
        (r && (r.wamid || r.id)) || (typeof r === "string" ? r : null);
      const ok = !!wamid;

      if (!ok) throw new Error("media not sent (missing wamid)");

      const type =
        mediaMime.startsWith("image/")
          ? "image"
          : mediaMime.startsWith("video/")
          ? "video"
          : mediaMime.startsWith("audio/")
          ? "audio"
          : "document";

      try {
        onMessageSent?.({ wamid, to: row.customer_id, type, url: mediaUrl });
      } catch {
        // swallow onMessageSent errors
      }

      await sleep(SEND_GAP_MS_IMAGE);
    }

    const next = msgs[i + 1];
    if (
      next &&
      (!next.files || next.files.length === 0) &&
      files.length > 0
    ) {
      await sleep(2200);
    }
  }

  // only here if all parts succeeded
  row.sent = true;
  row.sentAt = new Date();
  row.processing = false;
  await row.save();

  meta.usageCount = (meta.usageCount || 0) + 1;
  meta.lastUsedAt = new Date().toISOString();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

// === main tick (called from scheduler.js) ===
export async function runProgrammedDispatcher({
  forSellerId = null,
  force = false,          // kept for API compatibility, but we don't use schedule.times anymore
  verbose = true,
  limit = 200,
  sendText,               // required
  sendMedia = null,       // optional
  onMessageSent = null,   // optional
  onlyTaskId = null,      // optional: run exactly one queued task, used by manual tests
} = {}) {
  const t0  = Date.now();
  const now = dayjs();


  await waitForMongoReady({ verbose });

  const programs = await listPrograms();
  if (verbose) {
  }
  if (programs.length === 0) return { ok: 0, fail: 0 };

  // Use programs that have a funnelLevelX. New tasks store program_id so
  // multiple programmed messages can target the same funnel safely; legacy
  // tasks without program_id still fall back to the first matching funnel.
  const mapped = programs
    .map((p) => ({
      ...p,
      state: activeStateFromMisc(p.meta?.misc),
    }))
    .filter((p) => !!p.state);

  if (!mapped.length) {
    if (verbose);
    return { ok: 0, fail: 0 };
  }

  const statesOnly = [...new Set(mapped.map((x) => x.state))];

  if (verbose) {
  }

  const cutoff = now.subtract(24, "hour").toDate();
  const query = onlyTaskId
    ? {
        _id: onlyTaskId,
        sent: false,
        cancelled: { $ne: true },
        state_id: { $in: statesOnly },
      }
    : {
        sent: false,
        cancelled: { $ne: true },
        state_id: { $in: statesOnly },
        created_at: { $gte: cutoff },
      };
  if (forSellerId) query.sellerId = String(forSellerId);

  // Only process rows whose sendAt is reached, or legacy rows without sendAt.
  // When onlyTaskId is present, this prevents a manual test run from flushing
  // every other due programmed-message task in the queue.
  query.$or = [
    { sendAt: { $exists: false } },       // old rows
    { sendAt: { $lte: now.toDate() } },   // due rows
  ];

  const rows = await Queue.find(query).limit(limit).lean(false);

  if (verbose) {
  }
  if (!rows.length) return { ok: 0, fail: 0 };

  let ok = 0;
  let fail = 0;

  for (let row of rows) {
    const staleProcessingCutoff = new Date(Date.now() - 10 * 60 * 1000);
    const claimed = await Queue.findOneAndUpdate(
      {
        _id: row._id,
        sent: false,
        cancelled: { $ne: true },
        $or: [
          { processing: { $ne: true } },
          { processingAt: { $lte: staleProcessingCutoff } },
        ],
      },
      { $set: { processing: true, processingAt: new Date() } },
      { new: true }
    );
    if (!claimed) continue;
    row = claimed;

    if (!isBusinessTime(dayjs())) {
      row.sendAt = nextBusinessStart(dayjs());
      row.processing = false;
      await row.save();
      fail++;
      if (verbose) {
        console.warn("[PD] deferred row outside Lima business hours", row._id, "until", row.sendAt);
      }
      continue;
    }

    // Prefer the exact programmed message captured when the task was created.
    // Legacy rows created before program_id existed fall back by funnel state.
    const program = row.program_id
      ? mapped.find((p) => p.id === row.program_id && p.state === row.state_id)
      : mapped.find((p) => p.state === row.state_id);
    if (!program) {
      if (verbose) {
      }
      continue;
    }

    try {
      // 24h guard based on lastInboundTs (per conversation)
      const product = await Product.findOne({
        customer_id: row.customer_id,
        latestSeller: row.sellerId,
      }).lean();

      // Funnel eligibility can change while a task is waiting for sendAt.
      // Revalidate against the current customer state immediately before send
      // and consume stale work as cancelled rather than reporting it as sent.
      if (!productMatchesProgramState(product?.state, row.state_id)) {
        const current = currentPurchaseState(product?.state);
        row.cancelled = true;
        row.cancelledAt = new Date();
        row.cancelReason = "funnel_state_changed";
        row.expectedState = row.state_id;
        row.actualState = current?.purchaseState?.funnel_state;
        row.processing = false;
        await row.save();
        if (verbose) {
          console.warn(
            "[PD] cancelled stale funnel task",
            row._id,
            "expected",
            row.expectedState,
            "actual",
            row.actualState
          );
        }
        continue;
      }

      let lastInbound = product?.lastInboundTs || null;

      // Fallback: derive from customer_messages if needed
      if (
        !lastInbound &&
        Array.isArray(product?.customer_messages) &&
        product.customer_messages.length > 0
      ) {
        const latestCustomerMsg = product.customer_messages.reduce((a, b) =>
          b.timestamp > a.timestamp ? b : a
        );
        lastInbound = latestCustomerMsg.timestamp;
      }

      if (lastInbound) {
        const ageMs       = Date.now() - new Date(lastInbound).getTime();
        const DEADLINE_MS = 24 * 60 * 60 * 1000;

        if (ageMs > DEADLINE_MS) {
          // Too late → mark as processed so we don't retry
          if (verbose) {
          }
          row.sent = true;
          row.processing = false;
          await row.save();
          fail++;
          continue;
        }
      }

      // If another queued row for the same programmed message/customer has
      // already completed, treat this row as consumed. This protects against
      // older duplicate tasks created before dedupeKey existed (or before it
      // included program_id) being sent again later.
      const sameProgramFilter = {
        $or: [
          { program_id: row.program_id || program.id },
          { program_id: { $exists: false } },
          { program_id: null },
        ],
      };

      // Weekly cooldown: a customer should not receive the same programmed
      // message type more than once within any 7-day window. We mark the
      // current row as consumed instead of retrying it, otherwise it could send
      // as soon as the cooldown expires even though it was created for an older
      // conversation moment. `sentAt` is preferred, while `created_at` keeps the
      // guard effective for older consumed rows that may not have a sentAt.
      const weeklyCooldownCutoff = now.subtract(SAME_PROGRAM_COOLDOWN_DAYS, "day").toDate();
      const recentlySentSameProgram = await Queue.exists({
        _id: { $ne: row._id },
        sent: true,
        state_id: row.state_id,
        ...sameProgramFilter,
        customer_id: row.customer_id,
        sellerId: row.sellerId,
        $or: [
          { sentAt: { $gte: weeklyCooldownCutoff } },
          { sentAt: { $exists: false }, created_at: { $gte: weeklyCooldownCutoff } },
          { sentAt: null, created_at: { $gte: weeklyCooldownCutoff } },
        ],
      });

      if (recentlySentSameProgram) {
        row.sent = true;
        row.sentAt = new Date();
        row.processing = false;
        await row.save();
        if (verbose) {
          console.warn(
            "[PD] skipped row due to weekly same-program cooldown",
            row._id,
            row.customer_id,
            row.program_id || program.id
          );
        }
        continue;
      }

      const alreadySent = !onlyTaskId && await Queue.exists({
        _id: { $ne: row._id },
        sent: true,
        state_id: row.state_id,
        ...sameProgramFilter,
        customer_id: row.customer_id,
        sellerId: row.sellerId,
        created_at: { $gte: cutoff },
      });

      if (alreadySent) {
        row.sent = true;
        row.sentAt = new Date();
        row.processing = false;
        await row.save();
        continue;
      }

      // If still inside 24h (or no timestamp info), send normally
      await sendProgramToRow(program, row, {
        sendText,
        sendMedia,
        onMessageSent,
        verbose,
      });

      // Consume any duplicate pending tasks for the same programmed
      // message/customer cohort so the next dispatcher tick cannot send the
      // same configured message twice.
      await Queue.updateMany(
        {
          _id: { $ne: row._id },
          sent: false,
          state_id: row.state_id,
          ...sameProgramFilter,
          customer_id: row.customer_id,
          sellerId: row.sellerId,
          created_at: { $gte: cutoff },
        },
        {
          $set: {
            sent: true,
            sentAt: new Date(),
            processing: false,
          },
        }
      );
      ok++;
    } catch (err) {
      row.processing = false;
      await row.save().catch(() => {});
      fail++;
      if (verbose) {
        console.error("[PD] error for row", row._id, err?.message || err);
      }
    }
  }

  const ms = Date.now() - t0;
  if (verbose) {

  }

  return { ok, fail };
}
