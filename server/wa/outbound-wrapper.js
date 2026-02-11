// server/wa/outbound-wrapper.js

import fs from "node:fs";
import { sendTextBack, uploadMediaToWhatsApp, sendImageByMediaId } from "./send.js";
import { enqueueText } from "./outbox.js";

export async function sendTextMessage(toPhone, text, { runId = null, seq = null, nextAttemptAt = null } = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;

  console.log("[outbound-wrapper] ENQUEUE → TEXT to", toPhone, ":", clean);
  return enqueueText({ to: String(toPhone), text: clean, runId, seq, nextAttemptAt });
}


export async function sendMediaMessage(toPhone, fileInfo) {
  const { filePath, mimeType, originalName } = fileInfo || {};
  if (!filePath) return null;

  console.log("[outbound-wrapper] DIRECT → MEDIA to", toPhone, filePath, mimeType);

  const fileBuffer = fs.readFileSync(filePath);

  const mediaId = await uploadMediaToWhatsApp({
    buffer: fileBuffer,
    mimeType,
    filename: originalName
  });

  await sendImageByMediaId(String(toPhone), mediaId);
}
