// server/tools/stress-send-meta.mjs
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ===== Env =====
const {
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,

  // recipients (use one or a comma-list)
  WA_TO = "",
  WA_TO_LIST = "",

  WA_COUNT = "200",
  WA_RPS = "2",
  WA_TEXT = "E2E_TEST",
  WA_LOG_DIR = "stresslogs",

  // retry behavior
  WA_MAX_RETRIES = "30",           // per message
  WA_RETRY_BASE_MS = "1000",       // base retry delay (your "1 second")
  WA_RETRY_MAX_MS = "30000",       // cap delay
  WA_PAIR_131056_MIN_MS = "6000",  // minimum wait when 131056 occurs
  WA_JITTER_MS = "250",            // add randomness to avoid sync collisions

  // optional: avoid pair limit by forcing a minimum spacing per recipient
  WA_MIN_GAP_PER_RECIPIENT_MS = "0" // set e.g. 6000 if single recipient
} = process.env;

const WA_TOKEN = WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = WHATSAPP_PHONE_ID;

const recipients = (WA_TO_LIST || WA_TO || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!WA_TOKEN || !WA_PHONE_NUMBER_ID || recipients.length === 0) {
  console.error(
    "Missing env. Need WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, and WA_TO or WA_TO_LIST"
  );
  process.exit(1);
}

const count = Math.max(1, Number(WA_COUNT));
const rps = Math.max(0.2, Number(WA_RPS));
const gapMs = Math.floor(1000 / rps);

const maxRetries = Math.max(0, Number(WA_MAX_RETRIES));
const retryBaseMs = Math.max(0, Number(WA_RETRY_BASE_MS));
const retryMaxMs = Math.max(0, Number(WA_RETRY_MAX_MS));
const pair131056MinMs = Math.max(0, Number(WA_PAIR_131056_MIN_MS));
const jitterMs = Math.max(0, Number(WA_JITTER_MS));
const minGapPerRecipientMs = Math.max(0, Number(WA_MIN_GAP_PER_RECIPIENT_MS));

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto
  .randomBytes(3)
  .toString("hex")}`;

const outDir = path.resolve(process.cwd(), WA_LOG_DIR);
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, `send_${runId}.jsonl`);

function log(obj) {
  fs.appendFileSync(
    logFile,
    JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n"
  );
}

function pad(n, w = 6) {
  return String(n).padStart(w, "0");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter() {
  if (!jitterMs) return 0;
  // random [-jitter, +jitter]
  return Math.floor((Math.random() * 2 - 1) * jitterMs);
}

// round-robin recipients + optional per-recipient minimum gap
const lastSentAt = new Map(); // to -> ms
let rr = 0;

async function pickRecipient() {
  for (let tries = 0; tries < recipients.length; tries++) {
    const to = recipients[rr++ % recipients.length];
    if (!minGapPerRecipientMs) return { to, waitMs: 0 };

    const last = lastSentAt.get(to) || 0;
    const wait = last + minGapPerRecipientMs - Date.now();
    if (wait <= 0) return { to, waitMs: 0 };
  }

  // all are "hot" — wait for earliest
  let bestTo = recipients[0];
  let bestWait = Infinity;
  for (const to of recipients) {
    const last = lastSentAt.get(to) || 0;
    const wait = last + minGapPerRecipientMs - Date.now();
    if (wait < bestWait) {
      bestWait = wait;
      bestTo = to;
    }
  }
  return { to: bestTo, waitMs: Math.max(0, bestWait) };
}

async function sendText(to, body) {
  const url = `https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);

  // Retry-After header (if present)
  const retryAfter = res.headers.get("retry-after");
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;

  return { ok: res.ok, status: res.status, json, retryAfterMs };
}

function extractErrorCode(r) {
  return r?.json?.error?.code ?? null;
}

function computeBackoffMs({ attempt, errorCode, httpStatus, retryAfterMs }) {
  // Base exponential backoff: base * 2^(attempt-1), capped
  let ms = Math.min(retryMaxMs, retryBaseMs * Math.pow(2, Math.max(0, attempt - 1)));

  // If Meta suggests Retry-After, honor it (if bigger)
  if (retryAfterMs && retryAfterMs > ms) ms = retryAfterMs;

  // Pair rate limit: force a minimum wait (usually needs several seconds)
  if (errorCode === 131056) {
    ms = Math.max(ms, pair131056MinMs);
  }

  // Add small jitter
  ms = Math.max(0, ms + jitter());
  return ms;
}

async function sendWithRetry({ to, msgText, i }) {
  let attempt = 0;

  while (true) {
    attempt++;
    const t0 = Date.now();

    try {
      const r = await sendText(to, msgText);
      const ms = Date.now() - t0;

      const wamid = r?.json?.messages?.[0]?.id || null;
      const errorCode = extractErrorCode(r);

      log({
        kind: "attempt",
        i,
        attempt,
        to,
        msgText,
        httpStatus: r.status,
        ok: r.ok,
        wamid,
        ms,
        errorCode,
        error: r.ok ? null : r.json,
      });

      if (r.ok) {
        lastSentAt.set(to, Date.now());
        return { ok: true, wamid };
      }

      // Not ok -> retry if we still can
      if (attempt > maxRetries) {
        return { ok: false, final: true, errorCode, httpStatus: r.status };
      }

      const waitMs = computeBackoffMs({
        attempt,
        errorCode,
        httpStatus: r.status,
        retryAfterMs: r.retryAfterMs,
      });

      log({
        kind: "retry_wait",
        i,
        attempt,
        to,
        waitMs,
        reason: { errorCode, httpStatus: r.status },
      });

      await sleep(waitMs);
    } catch (e) {
      const ms = Date.now() - t0;

      log({
        kind: "attempt",
        i,
        attempt,
        to,
        msgText,
        httpStatus: 0,
        ok: false,
        wamid: null,
        ms,
        errorCode: null,
        error: String(e?.stack || e),
      });

      if (attempt > maxRetries) {
        return { ok: false, final: true, errorCode: null, httpStatus: 0 };
      }

      const waitMs = computeBackoffMs({
        attempt,
        errorCode: null,
        httpStatus: 0,
        retryAfterMs: 0,
      });

      log({ kind: "retry_wait", i, attempt, to, waitMs, reason: { errorCode: null, httpStatus: 0 } });
      await sleep(waitMs);
    }
  }
}

(async function main() {
  console.log("[STRESS] runId:", runId);
  console.log("[STRESS] recipients:", recipients);
  console.log("[STRESS] sending:", count, "rps:", rps, "gapMs:", gapMs);
  console.log("[STRESS] retry:", { maxRetries, retryBaseMs, retryMaxMs, pair131056MinMs, minGapPerRecipientMs });
  console.log("[STRESS] logFile:", logFile);

  log({
    kind: "start",
    runId,
    count,
    recipients,
    rps,
    gapMs,
    retry: { maxRetries, retryBaseMs, retryMaxMs, pair131056MinMs, minGapPerRecipientMs },
  });

  let ok = 0;
  let fail = 0;

  for (let i = 1; i <= count; i++) {
    const msgText = `${WA_TEXT} ${runId} #${pad(i)} (/${count})`;

    const pick = await pickRecipient();
    if (pick.waitMs > 0) await sleep(pick.waitMs);

    const to = pick.to;

    const r = await sendWithRetry({ to, msgText, i });
    if (r.ok) ok++;
    else fail++;

    // Global pacing (overall RPS)
    await sleep(gapMs);
  }

  log({ kind: "end", runId, ok, fail });
  console.log("[STRESS] done:", { ok, fail, logFile });
})();
