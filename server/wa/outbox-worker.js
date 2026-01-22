import { OutboxMessage } from "./outbox-model.js";
import { createTokenBucket, createPairLimiter, sleep } from "./send-limits.js";

const {
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,

  // limits (tune these)
  OUTBOX_RPS = "8",                 // global sends/sec across ALL recipients
  OUTBOX_BURST = "16",
  OUTBOX_MIN_GAP_PER_RECIPIENT_MS = "6000", // key to avoid 131056 for same recipient

  // retry policy
  OUTBOX_MAX_RETRIES = "30",
  OUTBOX_RETRY_BASE_MS = "1000",
  OUTBOX_RETRY_MAX_MS = "30000",
  OUTBOX_PAIR_131056_MIN_MS = "6000",
} = process.env;

if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
  console.warn("[OUTBOX] Missing WHATSAPP_TOKEN/WHATSAPP_PHONE_ID. Worker will fail sends.");
}

const bucket = createTokenBucket({
  ratePerSec: Math.max(0.2, Number(OUTBOX_RPS)),
  burst: Math.max(1, Number(OUTBOX_BURST)),
});

const pairLimiter = createPairLimiter({
  minGapMs: Math.max(0, Number(OUTBOX_MIN_GAP_PER_RECIPIENT_MS)),
});

function getErrCode(json) {
  return json?.error?.code ?? null;
}

function computeBackoffMs(attempt, errCode, retryAfterMs = 0) {
  const base = Math.max(0, Number(OUTBOX_RETRY_BASE_MS));
  const cap = Math.max(1000, Number(OUTBOX_RETRY_MAX_MS));
  const pairMin = Math.max(0, Number(OUTBOX_PAIR_131056_MIN_MS));

  // exponential: base * 2^(attempt-1)
  let ms = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));

  if (retryAfterMs && retryAfterMs > ms) ms = retryAfterMs;
  if (errCode === 131056) ms = Math.max(ms, pairMin);

  // small jitter
  ms = Math.max(0, ms + Math.floor((Math.random() * 2 - 1) * 250));
  return ms;
}

async function metaSend(msg) {
  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: msg.to,
  };

  if (msg.kind === "text") {
    payload.type = "text";
    payload.text = { body: msg.body || "" };
  } else if (msg.kind === "image") {
    payload.type = "image";
    payload.image = msg.media?.id ? { id: msg.media.id } : { link: msg.media?.url };
    if (msg.body) payload.image.caption = msg.body;
  } else {
    // extend as you need
    payload.type = "text";
    payload.text = { body: msg.body || "" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);
  const retryAfter = res.headers.get("retry-after");
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;

  return { ok: res.ok, status: res.status, json, retryAfterMs };
}

export function startOutboxWorker() {
  const maxRetries = Math.max(0, Number(OUTBOX_MAX_RETRIES));
  console.log("[OUTBOX] worker started", {
    rps: OUTBOX_RPS,
    burst: OUTBOX_BURST,
    minGapPerRecipientMs: OUTBOX_MIN_GAP_PER_RECIPIENT_MS,
    maxRetries,
  });

  // simple poll loop
  setInterval(async () => {
    // fetch a small batch
    const now = new Date();

    const batch = await OutboxMessage.find({
      state: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: now },
      attempts: { $lte: maxRetries },
    })
      .sort({ nextAttemptAt: 1 })
      .limit(20)
      .lean();

    for (const item of batch) {
      // lock it (avoid double workers sending same doc)
      const locked = await OutboxMessage.findOneAndUpdate(
        { _id: item._id, state: item.state },
        { $set: { state: "sending" } },
        { new: true }
      ).lean();

      if (!locked) continue;

      // global rate + per-recipient spacing
      await bucket.take(1);
      await pairLimiter.waitTurn(locked.to);

      const attemptNo = (locked.attempts || 0) + 1;

      try {
        const r = await metaSend(locked);
        const errCode = getErrCode(r.json);
        const wamid = r?.json?.messages?.[0]?.id || null;

        if (r.ok && wamid) {
          pairLimiter.markSent(locked.to);

          await OutboxMessage.updateOne(
            { _id: locked._id },
            {
              $set: {
                state: "accepted",
                wamid,
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

        // failed -> schedule retry
        const backoffMs = computeBackoffMs(attemptNo, errCode, r.retryAfterMs);
        await OutboxMessage.updateOne(
          { _id: locked._id },
          {
            $set: {
              state: "failed",
              lastHttpStatus: r.status,
              lastErrorCode: errCode,
              lastError: r.json,
              nextAttemptAt: new Date(Date.now() + backoffMs),
            },
            $inc: { attempts: 1 },
          }
        );
      } catch (e) {
        const backoffMs = computeBackoffMs(attemptNo, null, 0);
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
        // small yield so we don't spin too hard on repeated failures
        await sleep(20);
      }
    }
  }, 200);
}
