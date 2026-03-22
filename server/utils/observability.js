import { performance } from "node:perf_hooks";

const OBS_ENABLED = String(process.env.OBS_LOG_ENABLED ?? "1") !== "0";

const REDACT_KEYS = ["authorization", "token", "access_token", "refresh_token"];
const MAX_STRING_LENGTH = Math.max(120, Number(process.env.OBS_MAX_STRING_LENGTH ?? "500"));

function shouldRedact(key) {
  const lower = String(key || "").toLowerCase();
  return REDACT_KEYS.some((needle) => lower.includes(needle));
}

function truncateString(value) {
  const text = String(value);
  return text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH)}…` : text;
}

function safeJson(value, parentKey = "") {
  if (value == null) return value ?? null;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message || ""),
      stack: value.stack ? truncateString(value.stack) : null,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => safeJson(item, parentKey));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = shouldRedact(key) ? "[REDACTED]" : safeJson(nested, key);
    }
    return out;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return truncateString(String(value));
  }
}

export function nowMs() {
  return performance.now();
}

export function durationMs(startMs) {
  return Math.round((performance.now() - startMs) * 1000) / 1000;
}

export function emitObs(event, payload = {}) {
  if (!OBS_ENABLED) return;

  const sanitizedPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    sanitizedPayload[key] = safeJson(value);
  }

  const body = {
    ts: new Date().toISOString(),
    ...sanitizedPayload,
    kind: "obs",
    event,
  };

  console.log(JSON.stringify(body));
}
