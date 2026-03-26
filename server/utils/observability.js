import { performance } from "node:perf_hooks";

const OBS_ENABLED = String(process.env.OBS_LOG_ENABLED ?? "1") !== "0";

function safeJson(value) {
  if (value == null) return value ?? null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
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

  //console.log(JSON.stringify(body));
}
