// server/wa/outbox.js
import mongoose from "mongoose";
import { createJsonlLogger, makeRunId } from "./outbox-logger.js";
import { storeAcceptedText } from "./outbox-store.js";
import { initializeCostumerAndStoreMessageHistory } from "../dbFunctionality/functionality.js";
import fs from "node:fs";
import {
  uploadMediaToWhatsApp,
  sendImageByMediaId,
  sendVideoByMediaId,
  sendDocumentByMediaId,
} from "./send.js";
import { durationMs, emitObs, nowMs } from "../utils/observability.js";

const OUR_NUMBER = String(process.env.OUR_NUMBER || "").trim();


const OutboxSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["text", "image", "video", "document"], default: "text" },

    to: { type: String, required: true, index: true },
    text: {
      type: String,
      default: "",
      required: function requiredTextForTextKind() {
        return this.kind === "text";
      },
    },
    media: {
      filePath: { type: String, default: null },
      mimeType: { type: String, default: null },
      originalName: { type: String, default: null },
      caption: { type: String, default: null },
      mediaId: { type: String, default: null },
    },
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

export async function enqueueMedia({
  to,
  filePath,
  mimeType,
  originalName = null,
  caption = "",
  runId = null,
  seq = null,
  nextAttemptAt = null,
}) {
  const lowMime = String(mimeType || "").toLowerCase();
  const kind = lowMime.startsWith("video/")
    ? "video"
    : lowMime.startsWith("application/")
      ? "document"
      : "image";

  return OutboxMessage.create({
    kind,
    to,
    text: String(caption || ""),
    media: {
      filePath,
      mimeType,
      originalName,
      caption: String(caption || ""),
      mediaId: null,
    },
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

async function metaSendMedia(item) {
  const filePath = item?.media?.filePath;
  if (!filePath) throw new Error("Missing media.filePath in outbox message");

  const mimeType = item?.media?.mimeType || "application/octet-stream";
  const originalName = item?.media?.originalName || "file";
  const caption = item?.media?.caption || item?.text || "";

  const fileBuffer = fs.readFileSync(filePath);
  const mediaId = await uploadMediaToWhatsApp({
    buffer: fileBuffer,
    mimeType,
    filename: originalName,
  });

  let wamid = null;
  if (item.kind === "video") {
    wamid = await sendVideoByMediaId(item.to, mediaId, caption);
  } else if (item.kind === "document") {
    wamid = await sendDocumentByMediaId(item.to, mediaId, originalName, caption);
  } else {
    wamid = await sendImageByMediaId(item.to, mediaId, caption);
  }

  return {
    ok: !!wamid,
    status: wamid ? 200 : 0,
    json: wamid ? { messages: [{ id: wamid }] } : null,
    wamid,
    errCode: null,
    retryAfterMs: 0,
    mediaId,
  };
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

function baseObsFields(item, extra = {}) {
  return {
    outboxId: String(item?._id || ""),
    runId: item?.runId ?? null,
    seq: item?.seq ?? null,
    to: item?.to ?? null,
    kind: item?.kind ?? null,
    state: item?.state ?? null,
    attempts: item?.attempts ?? 0,
    ...extra,
  };
}

function computePrevSeqRetryMs({ prevState, minGapMs }) {
  const configured = Math.max(250, Number(process.env.OUTBOX_PREV_SEQ_RETRY_MS ?? "1500"));
  const halfGap = minGapMs > 0 ? Math.max(1000, Math.floor(minGapMs / 2)) : configured;

  if (prevState === "sending") {
    return Math.max(configured, halfGap);
  }

  if (prevState === "pending") {
    return Math.max(configured * 2, halfGap);
  }

  if (prevState === "failed") {
    return Math.max(configured * 3, minGapMs || configured);
  }

  return configured;
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

  let isTickRunning = false;
  setInterval(async () => {
    if (isTickRunning) return;
    isTickRunning = true;

    try {
    const now = new Date();

    const batch = await OutboxMessage.find({
      state: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: now },
      attempts: { $lt: maxRetries },
    })
      .sort({ nextAttemptAt: 1 })
      .limit(25)
      .lean();

    if (batch.length > 0) {
      emitObs("outbox.worker.batch_loaded", {
        batchSize: batch.length,
        pendingStates: ["pending", "failed"],
      });
    }

    for (const item of batch) {
      // lock
      const lockStartedAt = nowMs();
      const locked = await OutboxMessage.findOneAndUpdate(
        { _id: item._id, state: item.state },
        { $set: { state: "sending" } },
        { new: true }
      ).lean();

      if (!locked) continue;

      emitObs("outbox.worker.lock_acquired", baseObsFields(locked, {
        previousState: item.state,
        lockWaitMs: durationMs(lockStartedAt),
        queueAgeMs: locked?.createdAt ? Math.max(0, Date.now() - new Date(locked.createdAt).getTime()) : null,
        eligibleLagMs: locked?.nextAttemptAt ? Math.max(0, Date.now() - new Date(locked.nextAttemptAt).getTime()) : null,
      }));

      // Strict in-run ordering: if this item belongs to a sequenced run,
      // only send when the immediate predecessor is already accepted.
      const hasSeq = Number.isInteger(locked.seq);
      if (locked.runId && hasSeq && locked.seq > 0) {
        const prevSeqStartedAt = nowMs();
        const prevSeq = locked.seq - 1;
        let prev = await OutboxMessage.findOne({
          runId: locked.runId,
          seq: prevSeq,
        })
          .select({ state: 1 })
          .lean();

        let firstInRun = false;
        if (!prev) {
          const earlier = await OutboxMessage.findOne({
            runId: locked.runId,
            seq: { $lt: locked.seq },
          })
            .sort({ seq: -1 })
            .select({ seq: 1, state: 1 })
            .lean();

          firstInRun = !earlier;
        }

        emitObs("outbox.worker.prev_seq_checked", baseObsFields(locked, {
          prevSeq,
          prevSeqState: prev?.state ?? null,
          firstInRun,
          prevSeqCheckMs: durationMs(prevSeqStartedAt),
        }));

        if (firstInRun) {
          emitObs("outbox.worker.prev_seq_first_item", baseObsFields(locked, {
            prevSeq,
            firstInRun: true,
          }));
          prev = { state: "accepted" };
        }

        if (!prev || prev.state !== "accepted") {
          const blockedRetryMs = computePrevSeqRetryMs({
            prevState: prev?.state ?? null,
            minGapMs: minGap,
          });

          await OutboxMessage.updateOne(
            { _id: locked._id, state: "sending" },
            {
              $set: {
                state: "pending",
                nextAttemptAt: new Date(Date.now() + blockedRetryMs),
              },
            }
          );
          emitObs("outbox.worker.prev_seq_blocked", baseObsFields(locked, {
            prevSeq,
            prevSeqState: prev?.state ?? null,
            state: "pending",
            rescheduledInMs: blockedRetryMs,
          }));
          continue;
        }
      }

      // throttles
      const bucketStartedAt = nowMs();
      await bucket.take(1);
      const bucketWaitMs = durationMs(bucketStartedAt);

      const pairWaitStartedAt = nowMs();
      await pairLimiter.waitTurn(locked.to);
      const pairWaitMs = durationMs(pairWaitStartedAt);

      emitObs("outbox.worker.dispatch_ready", baseObsFields(locked, {
        bucketWaitMs,
        pairWaitMs,
      }));

      const attemptNo = (locked.attempts || 0) + 1;
      const msgText = shortText(locked.text);
      const t0 = Date.now();
      const providerStartedAt = nowMs();

      emitObs("outbox.worker.provider_attempt", baseObsFields(locked, {
        attempt: attemptNo,
        bucketWaitMs,
        pairWaitMs,
        contextMessageId: locked.contextMessageId || null,
      }));

      try {
        const r =
          locked.kind === "text"
            ? await metaSendText({
                token,
                phoneId,
                to: locked.to,
                text: locked.text,
                contextMessageId: locked.contextMessageId || null,
              })
            : await metaSendMedia(locked);
        const providerMs = durationMs(providerStartedAt);

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

        emitObs("outbox.worker.provider_result", baseObsFields(locked, {
          attempt: attemptNo,
          providerMs,
          httpStatus: r.status,
          ok: !!(r.ok && r.wamid),
          wamid: r.wamid,
          errCode: r.errCode ?? null,
          retryAfterMs: r.retryAfterMs ?? 0,
        }));

        if (r.ok && r.wamid) {
  pairLimiter.markSent(locked.to);

  // ✅ accepted side-effects
  incApiAccepted();
          if (locked.kind === "text") {
            muletillas(locked.text, locked.to);
          }

  const ts = new Date().toISOString();

  // ✅ Persist in your history (DB only) - same style as /api/send-image
  const dbPayload = {
    id: r.wamid,
    from: OUR_NUMBER,
    to: locked.to,
            type: locked.kind,
            message: locked.text,
            timestamp: ts,
            dir: "out",

    // extra fields for your UI / dedupe
    status: "sent",
            outboxId: String(locked._id),
            contextMessageId: locked.contextMessageId || null,
            replyToId: locked.contextMessageId || null,
            ...(locked.kind !== "text"
              ? {
                  mediaId: r.mediaId || locked?.media?.mediaId || null,
                  mimeType: locked?.media?.mimeType || null,
                  caption: locked?.media?.caption || locked.text || "",
                  media: {
                    id: r.mediaId || locked?.media?.mediaId || null,
                    mimeType: locked?.media?.mimeType || null,
                    timestamp: ts,
                  },
                }
              : {}),
          };

  try {
    const dbPersistStartedAt = nowMs();
    await initializeCostumerAndStoreMessageHistory(dbPayload, 0);
    const dbPersistMs = durationMs(dbPersistStartedAt);
    emitObs("outbox.worker.db_persisted", baseObsFields(locked, {
      attempt: attemptNo,
      providerMs,
      dbPersistMs,
      wamid: r.wamid,
      historyStatus: "stored",
    }));
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
    emitObs("outbox.worker.db_persisted", baseObsFields(locked, {
      attempt: attemptNo,
      providerMs,
      wamid: r.wamid,
      historyStatus: "failed",
      error: String(e?.message || e),
    }));
  }

  logger.write({
    kind: "accepted",
    outboxId: String(locked._id),
    i: locked.seq ?? null,
    to: locked.to,
    wamid: r.wamid,
  });

  const markAcceptedStartedAt = nowMs();
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
                ...(r.mediaId ? { "media.mediaId": r.mediaId } : {}),
              },
              $inc: { attempts: 1 },
            }
  );

  emitObs("outbox.worker.accepted_marked", baseObsFields(locked, {
    attempt: attemptNo,
    wamid: r.wamid,
    markAcceptedMs: durationMs(markAcceptedStartedAt),
    totalAttemptMs: Date.now() - t0,
  }));

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

        emitObs("outbox.worker.retry_scheduled", baseObsFields(locked, {
          attempt: attemptNo,
          httpStatus: r.status,
          errCode: r.errCode ?? null,
          providerMs,
          backoffMs,
          nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
        }));

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
        const providerMs = durationMs(providerStartedAt);

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

        emitObs("outbox.worker.exception_retry_scheduled", baseObsFields(locked, {
          attempt: attemptNo,
          httpStatus: 0,
          errCode: null,
          providerMs,
          backoffMs,
          error: String(e?.message || e),
          nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
        }));

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
    } finally {
      isTickRunning = false;
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
