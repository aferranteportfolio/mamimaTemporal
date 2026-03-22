// server/wa/outbound-wrapper.js

import { enqueueText, enqueueMedia } from "./outbox.js";
import { emitObs } from "../utils/observability.js";

export async function sendTextMessage(toPhone, text, { runId = null, seq = null, nextAttemptAt = null } = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;

  emitObs("outbox.enqueue.text_requested", { to: String(toPhone), runId, seq, textPreview: clean.slice(0, 120) });
  return enqueueText({ to: String(toPhone), text: clean, runId, seq, nextAttemptAt });
}


export async function sendMediaMessage(toPhone, fileInfo) {
    const { filePath, mimeType, originalName, caption, runId = null, seq = null, nextAttemptAt = null } = fileInfo || {};
  if (!filePath) return null;

  emitObs("outbox.enqueue.media_requested", { to: String(toPhone), runId, seq, filePath, mimeType, originalName });
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
