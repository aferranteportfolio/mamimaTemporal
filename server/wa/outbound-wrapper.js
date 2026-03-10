// server/wa/outbound-wrapper.js

import { enqueueText, enqueueMedia } from "./outbox.js";

export async function sendTextMessage(toPhone, text, { runId = null, seq = null, nextAttemptAt = null } = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;

  console.log("[outbound-wrapper] ENQUEUE → TEXT to", toPhone, ":", clean);
  return enqueueText({ to: String(toPhone), text: clean, runId, seq, nextAttemptAt });
}


export async function sendMediaMessage(toPhone, fileInfo) {
    const { filePath, mimeType, originalName, caption, runId = null, seq = null, nextAttemptAt = null } = fileInfo || {};
  if (!filePath) return null;

  console.log("[outbound-wrapper] ENQUEUE → MEDIA to", toPhone, filePath, mimeType);
  return enqueueMedia({
    to: String(toPhone),
    filePath,
    mimeType,
    originalName,
    caption: caption || "",
    runId,
    seq,
    nextAttemptAt,
  });

}
