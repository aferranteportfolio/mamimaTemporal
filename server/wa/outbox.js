// server/wa/outbox.js
import mongoose from "mongoose";
import { createJsonlLogger, makeRunId } from "./outbox-logger.js";
import { storeAcceptedText } from "./outbox-store.js";
import { initializeCostumerAndStoreMessageHistory } from "../dbFunctionality/functionality.js";

const OUR_NUMBER = String(process.env.OUR_NUMBER || "").trim();


const OutboxSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["text"], default: "text" },

    to: { type: String, required: true, index: true },
    text: { type: String, required: true },
    contextMessageId: { type: String, default: null, index: true },

    state: {
      type: String,
      enum: ["pending", "sending", "accepted", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },

    wamid: { type: String, default: null, index: true },
    lastHttpStatus: { type: Number, default: null },
    lastErrorCode: { type: Number, default: null },
    lastError: { type: Object, default: null },

    // optional debugging
    runId: { type: String, default: null },
    seq: { type: Number, default: null },
  },
  { timestamps: true }
);

OutboxSchema.index({ state: 1, nextAttemptAt: 1 });

export const OutboxMessage =
  mongoose.models.OutboxMessage || mongoose.model("OutboxMessage", OutboxSchema);

export async function enqueueText({
  to,
  text,
  contextMessageId = null,
  runId = null,
  seq = null,
  nextAttemptAt = null,
}) {
  return OutboxMessage.create({
    kind: "text",
    to,
    text,
    contextMessageId: contextMessageId || null,
    runId,
    seq,
    state: "pending",
    attempts: 0,
    nextAttemptAt: nextAttemptAt ?? new Date(),
  });
}


// ---------- helpers ----------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createTokenBucket({ rps = 5, burst = 10 }) {
  let tokens = burst;
  let last = Date.now();

  function refill() {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    tokens = Math.min(burst, tokens + dt * rps);
  }

  return {
    async take(n = 1) {
      while (true) {
        refill();
        if (tokens >= n) {
          tokens -= n;
          return;
        }
        await sleep(30);
      }
    },
  };
}

function createPairLimiter({ minGapMs = 6000 }) {
  const lastSentAt = new Map(); // to -> ms
  return {
    async waitTurn(to) {
      if (!minGapMs) return;
      while (true) {
        const last = lastSentAt.get(to) || 0;
        const wait = last + minGapMs - Date.now();
        if (wait <= 0) return;
        await sleep(Math.min(wait, 250));
      }
    },
    markSent(to) {
      lastSentAt.set(to, Date.now());
    },
  };
}

// ---------- Meta call ----------
async function metaSendText({ token, phoneId, to, text, contextMessageId = null }) {
  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
    ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);
  const wamid = json?.messages?.[0]?.id || null;
  const errCode = json?.error?.code ?? null;

  const ra = res.headers.get("retry-after");
  const retryAfterMs = ra ? Number(ra) * 1000 : 0;

  return { ok: res.ok, status: res.status, json, wamid, errCode, retryAfterMs };
}

function jitter(ms = 250) {
  return Math.floor((Math.random() * 2 - 1) * ms);
}

function computeBackoffMs({ attempt, errCode, retryAfterMs }) {
  const base = Math.max(200, Number(process.env.OUTBOX_RETRY_BASE_MS ?? "1000"));
  const cap = Math.max(1000, Number(process.env.OUTBOX_RETRY_MAX_MS ?? "30000"));
  const pairMin = Math.max(0, Number(process.env.OUTBOX_PAIR_131056_MIN_MS ?? "6000"));

  let wait = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
  if (retryAfterMs && retryAfterMs > wait) wait = retryAfterMs;
  if (errCode === 131056) wait = Math.max(wait, pairMin);

  return Math.max(0, wait + jitter(250));
}

// ---------- Worker ----------
export function startOutboxWorker({
  token,
  phoneId,
  incApiAccepted = () => {},
  storeSentMessage = () => {},
  muletillas = () => {},
} = {}) {
  if (!token || !phoneId) {
    console.warn("[OUTBOX] Missing token/phoneId; worker will not send.");
  }

  const rps = Math.max(0.2, Number(process.env.OUTBOX_RPS ?? "8"));
  const burst = Math.max(1, Number(process.env.OUTBOX_BURST ?? "16"));
  const minGap = Math.max(0, Number(process.env.OUTBOX_MIN_GAP_PER_RECIPIENT_MS ?? "6000"));
  const maxRetries = Math.max(0, Number(process.env.OUTBOX_MAX_RETRIES ?? "50"));

  const bucket = createTokenBucket({ rps, burst });
  const pairLimiter = createPairLimiter({ minGapMs: minGap });

  // JSONL logger (stress-test style)
  const JSONL_ENABLED = String(process.env.OUTBOX_JSONL_LOG ?? "0") === "1";
  const LOG_DIR = String(process.env.OUTBOX_LOG_DIR ?? "outboxlogs");
  const LOG_TEXT_MAX = Math.max(50, Number(process.env.OUTBOX_LOG_TEXT_MAX ?? "200"));

  const logger = createJsonlLogger({
    dir: LOG_DIR,
    runId: process.env.OUTBOX_RUN_ID || makeRunId(),
    enabled: JSONL_ENABLED,
  });

  function shortText(s) {
    const t = String(s ?? "");
    return t.length > LOG_TEXT_MAX ? t.slice(0, LOG_TEXT_MAX) + "…" : t;
  }

  console.log("[OUTBOX] worker started", { rps, burst, minGap, maxRetries, jsonl: JSONL_ENABLED, logDir: LOG_DIR });

  logger.write({
    kind: "start",
    cfg: { rps, burst, minGap, maxRetries },
  });

  setInterval(async () => {
    const now = new Date();

    const batch = await OutboxMessage.find({
      state: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: now },
      attempts: { $lt: maxRetries },
    })
      .sort({ nextAttemptAt: 1 })
      .limit(25)
      .lean();

    for (const item of batch) {
      // lock
      const locked = await OutboxMessage.findOneAndUpdate(
        { _id: item._id, state: item.state },
        { $set: { state: "sending" } },
        { new: true }
      ).lean();

      if (!locked) continue;

      // throttles
      await bucket.take(1);
      await pairLimiter.waitTurn(locked.to);

      const attemptNo = (locked.attempts || 0) + 1;
      const msgText = shortText(locked.text);
      const t0 = Date.now();

      try {
        const r = await metaSendText({
          token,
          phoneId,
          to: locked.to,
          text: locked.text,
          contextMessageId: locked.contextMessageId || null,
        });

        // log attempt (stress-test style)
        logger.write({
          kind: "attempt",
          outboxId: String(locked._id),
          i: locked.seq ?? null,
          to: locked.to,
          msgText,
          attempt: attemptNo,
          httpStatus: r.status,
          ok: !!(r.ok && r.wamid),
          wamid: r.wamid,
          ms: Date.now() - t0,
          error: r.ok && r.wamid ? null : r.json,
        });

        if (r.ok && r.wamid) {
  pairLimiter.markSent(locked.to);

  // ✅ accepted side-effects
  incApiAccepted();
  muletillas(locked.text, locked.to);

  const ts = new Date().toISOString();

  // ✅ Persist in your history (DB only) - same style as /api/send-image
  const dbPayload = {
    id: r.wamid,
    from: OUR_NUMBER,
    to: locked.to,
    type: "text",
    message: locked.text,
    timestamp: ts,
    dir: "out",

    // extra fields for your UI / dedupe
    status: "sent",
    outboxId: String(locked._id),
    contextMessageId: locked.contextMessageId || null,
    replyToId: locked.contextMessageId || null,
  };

  try {
    await initializeCostumerAndStoreMessageHistory(dbPayload, 0);
    console.log("[OUTBOX][ACCEPTED][DB] stored", {
      outboxId: String(locked._id),
      to: locked.to,
      wamid: r.wamid
    });
  } catch (e) {
    console.warn("[OUTBOX][ACCEPTED][DB] failed", {
      outboxId: String(locked._id),
      to: locked.to,
      wamid: r.wamid,
      error: String(e?.message || e)
    });
  }

  logger.write({
    kind: "accepted",
    outboxId: String(locked._id),
    i: locked.seq ?? null,
    to: locked.to,
    wamid: r.wamid,
  });

  await OutboxMessage.updateOne(
    { _id: locked._id },
    {
      $set: {
        state: "accepted",
        wamid: r.wamid,
        lastHttpStatus: r.status,
        lastErrorCode: null,
        lastError: null,
        nextAttemptAt: null,
      },
      $inc: { attempts: 1 },
    }
  );

  continue;
}

        // ❌ failed → schedule retry
        const backoffMs = computeBackoffMs({
          attempt: attemptNo,
          errCode: r.errCode,
          retryAfterMs: r.retryAfterMs,
        });

        logger.write({
          kind: "retry_wait",
          outboxId: String(locked._id),
          i: locked.seq ?? null,
          to: locked.to,
          attempt: attemptNo,
          waitMs: backoffMs,
          reason: { httpStatus: r.status, code: r.errCode ?? null },
        });

        await OutboxMessage.updateOne(
          { _id: locked._id },
          {
            $set: {
              state: "failed",
              lastHttpStatus: r.status,
              lastErrorCode: r.errCode,
              lastError: r.json,
              nextAttemptAt: new Date(Date.now() + backoffMs),
            },
            $inc: { attempts: 1 },
          }
        );
      } catch (e) {
        const backoffMs = computeBackoffMs({
          attempt: attemptNo,
          errCode: null,
          retryAfterMs: 0,
        });

        logger.write({
          kind: "attempt",
          outboxId: String(locked._id),
          i: locked.seq ?? null,
          to: locked.to,
          msgText,
          attempt: attemptNo,
          httpStatus: 0,
          ok: false,
          wamid: null,
          ms: Date.now() - t0,
          error: String(e?.stack || e),
        });

        logger.write({
          kind: "retry_wait",
          outboxId: String(locked._id),
          i: locked.seq ?? null,
          to: locked.to,
          attempt: attemptNo,
          waitMs: backoffMs,
          reason: { httpStatus: 0, code: null },
        });

        await OutboxMessage.updateOne(
          { _id: locked._id },
          {
            $set: {
              state: "failed",
              lastHttpStatus: 0,
              lastErrorCode: null,
              lastError: { error: String(e?.stack || e) },
              nextAttemptAt: new Date(Date.now() + backoffMs),
            },
            $inc: { attempts: 1 },
          }
        );
      }
    }
  }, 200);

  return { runId: logger.runId, logFile: logger.file };
}

export async function outboxStats() {
  const [pending, sending, failed, accepted] = await Promise.all([
    OutboxMessage.countDocuments({ state: "pending" }),
    OutboxMessage.countDocuments({ state: "sending" }),
    OutboxMessage.countDocuments({ state: "failed" }),
    OutboxMessage.countDocuments({ state: "accepted" }),
  ]);
  return { pending, sending, failed, accepted };
}
