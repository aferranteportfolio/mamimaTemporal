// server/jobs/dailyQuerryAllStates.mjs
import mongoose from 'mongoose';
import { Product } from '../../dbFunctionality/schemas/schema.js';
import { MessageTask } from '../../dbFunctionality/schemas/messageTask.js';
import { computeSendAt } from '../pm/time-utils.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsAppDB_3';

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB (dailyQuerryAllStates)');
  }
}

// We only care about conversations whose last inbound is within last 24h
const WINDOW_MS      = 24 * 60 * 60 * 1000;
// How long we wait after *your* last message before treating convo as "abandoned"
const INACTIVITY_MS  = 2 * 60 * 60 * 1000; // 2 hours

export async function dailyQuerryAllStates() {
  await connectDB();

  const nowMs = Date.now();
  const minLastInbound = new Date(nowMs - WINDOW_MS);

  // 1) Single Mongo query for all relevant funnel states
  //    Now: funnel_state 0, 2, 3, 4, 5
  const rawProducts = await Product.find({
    lastInboundTs: { $gte: minLastInbound },
    'state.purchase_state': {
      $elemMatch: { funnel_state: { $in: [0, 2, 3, 4, 5] } }
    }
  }).lean();

  const candidates = []; // { state_id, customer_id, sellerId, key, sendAt }

  for (const product of rawProducts) {
    const { customer_id, latestSeller, customer_messages, state, lastInboundTs } = product;
    if (!customer_id || !latestSeller || !state?.length) continue;

    // --- COMMON: latest customer msg & lastInbound ----
    const latestCustomerMsg = customer_messages?.length
      ? customer_messages.reduce((a, b) => (b.timestamp > a.timestamp ? b : a))
      : null;

    const effectiveLastInbound = lastInboundTs || latestCustomerMsg?.timestamp;
    if (!effectiveLastInbound) continue;

    // --- COMMON: latest seller message (any state) ---
    let latestSentMsg = null;
    for (const s of state) {
      if (!s.messagesSentCollection?.length) continue;
      const lastSent = s.messagesSentCollection[s.messagesSentCollection.length - 1];
      if (!latestSentMsg || lastSent.timestamp > latestSentMsg.timestamp) {
        latestSentMsg = lastSent;
      }
    }

    // If there is no seller msg, or customer replied after the last seller msg → nothing is "abandoned" yet.
    if (
      !latestSentMsg ||
      (latestCustomerMsg && latestCustomerMsg.timestamp > latestSentMsg.timestamp)
    ) {
      continue;
    }

    // ⏱️ NEW: require some inactivity since *your* last message
    const idleMs = nowMs - new Date(latestSentMsg.timestamp).getTime();
    if (idleMs < INACTIVITY_MS) {
      // Conversation is still fresh; don't schedule remarketing yet
      continue;
    }

    // --- COMMON: generic remarketing skip ---
    // If ANY state block has remarketing_state set, we skip for this customer entirely.
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

    const keyBase = `${customer_id}-${latestSeller}`;

    // =========================================================
    //  STATE 0 BRANCH → state_id = 1 (your original mapping)
    // =========================================================
    {
      const hasFunnel0 = state.some((s) =>
        s.purchase_state?.some((ps) => ps.funnel_state === 0)
      );

      if (hasFunnel0) {
        const sendAt0 = computeSendAt(new Date(effectiveLastInbound));
        if (sendAt0) {
          candidates.push({
            state_id: 1,
            customer_id,
            sellerId: latestSeller,
            key: `1:${keyBase}`,
            sendAt: sendAt0
          });
        }
      }
    }

    // =========================================================
    //  STATE 2 BRANCH → state_id = 2
    //  (shipping info given, but no progress)
    // =========================================================
    {
      let validState2 = null;

      for (const s of state) {
        const lastShipping = s.shippingStatus?.[s.shippingStatus.length - 1];
        const lastFunnel   = s.purchase_state?.[s.purchase_state.length - 1];

        const funnelOk   = lastFunnel?.funnel_state === 2;
        const shippingOk = !!lastShipping;

        if (funnelOk && shippingOk) {
          validState2 = s;
          break;
        }
      }

      if (validState2) {
        const messages        = validState2.messagesSentCollection || [];
        const lastSentInState = messages[messages.length - 1] || null;
        const sentOk          = !!lastSentInState;

        if (sentOk) {
          const sendAt2 = computeSendAt(new Date(effectiveLastInbound));
          if (sendAt2) {
            candidates.push({
              state_id: 2,
              customer_id,
              sellerId: latestSeller,
              key: `2:${keyBase}`,
              sendAt: sendAt2
            });
          }
        }
      }
    }

    // =========================================================
    //  STATE 3 BRANCH → state_id = 3
    // =========================================================
    {
      const hasFunnel3 = state.some((s) =>
        s.purchase_state?.some((ps) => ps.funnel_state === 3)
      );

      if (hasFunnel3) {
        const sendAt3 = computeSendAt(new Date(effectiveLastInbound));
        if (sendAt3) {
          candidates.push({
            state_id: 3,
            customer_id,
            sellerId: latestSeller,
            key: `3:${keyBase}`,
            sendAt: sendAt3
          });
        }
      }
    }

    // =========================================================
    //  STATE 4 BRANCH → state_id = 4
    // =========================================================
    {
      const hasFunnel4 = state.some((s) =>
        s.purchase_state?.some((ps) => ps.funnel_state === 4)
      );

      if (hasFunnel4) {
        const sendAt4 = computeSendAt(new Date(effectiveLastInbound));
        if (sendAt4) {
          candidates.push({
            state_id: 4,
            customer_id,
            sellerId: latestSeller,
            key: `4:${keyBase}`,
            sendAt: sendAt4
          });
        }
      }
    }

    // =========================================================
    //  STATE 5 BRANCH → state_id = 5
    // =========================================================
    {
      const hasFunnel5 = state.some((s) =>
        s.purchase_state?.some((ps) => ps.funnel_state === 5)
      );

      if (hasFunnel5) {
        const sendAt5 = computeSendAt(new Date(effectiveLastInbound));
        if (sendAt5) {
          candidates.push({
            state_id: 5,
            customer_id,
            sellerId: latestSeller,
            key: `5:${keyBase}`,
            sendAt: sendAt5
          });
        }
      }
    }
  }

  // If no candidates, bail out early
  if (!candidates.length) {
    console.log('[dailyQuerryAllStates] candidates = 0, nothing to do.');
    return [];
  }

  // =========================================================
  // 2) Anti-spam dedupe:
  //    "If this customer_id already exists in message_tasks,
  //     do NOT create ANY new task for them."
  // =========================================================
  const customerIdsToCheck = [...new Set(candidates.map(c => c.customer_id))];

  const existingTasks = await MessageTask.find(
    { customer_id: { $in: customerIdsToCheck } },
    { customer_id: 1 }
  ).lean();

  const existingCustomerSet = new Set(
    existingTasks.map(t => t.customer_id)
  );

  const results = [];
  for (const c of candidates) {
    if (existingCustomerSet.has(c.customer_id)) {
      // This customer already has at least one task in message_tasks → skip
      continue;
    }

    results.push({
      state_id:   c.state_id,
      customer_id: c.customer_id,
      sellerId:    c.sellerId,
      sendAt:      c.sendAt
    });
  }

  console.log('[dailyQuerryAllStates] candidates =', candidates.length);
  console.log('[dailyQuerryAllStates] existing customers =', existingCustomerSet.size);
  console.log('[dailyQuerryAllStates] results to return =', results.length);

  return results;
}

// -----------------------------------------------------------
// CLI test runner: run only when this file is executed directly
// -----------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('dailyQuerryAllStates.js')) {
  (async () => {
    try {
      console.log('[CLI] Running dailyQuerryAllStates once...');
      const results = await dailyQuerryAllStates();

      console.log(
        '[CLI] Finished. Results length =',
        Array.isArray(results) ? results.length : 0
      );

      if (Array.isArray(results) && results.length > 0) {
        console.log('[CLI] First result sample:', results[0]);
      }

      process.exit(0);
    } catch (err) {
      console.error('[CLI] Error running dailyQuerryAllStates:', err);
      process.exit(1);
    }
  })();
}
