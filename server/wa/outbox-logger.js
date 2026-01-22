// server/wa/outbox-logger.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function iso() {
  return new Date().toISOString();
}

export function makeRunId() {
  return `${iso().replace(/[:.]/g, "-")}_${crypto.randomBytes(3).toString("hex")}`;
}

export function createJsonlLogger({ dir = "outboxlogs", runId = makeRunId(), enabled = true } = {}) {
  const outDir = path.resolve(process.cwd(), dir);
  if (enabled) fs.mkdirSync(outDir, { recursive: true });

  const file = path.join(outDir, `outbox_${runId}.jsonl`);
  const stream = enabled ? fs.createWriteStream(file, { flags: "a" }) : null;

  function write(obj) {
    if (!enabled || !stream) return;
    try {
      stream.write(JSON.stringify({ ts: iso(), runId, ...obj }) + "\n");
    } catch {}
  }

  function close() {
    try { stream?.end?.(); } catch {}
  }

  // close on exit
  process.on("exit", close);
  process.on("SIGINT", () => { close(); process.exit(0); });
  process.on("SIGTERM", () => { close(); process.exit(0); });

  return { runId, file, write, close };
}
