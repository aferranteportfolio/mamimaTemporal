// server/wa/outbound-wrapper.js

import fs from "node:fs";
import { sendTextBack, uploadMediaToWhatsApp, sendImageByMediaId, sendVideoByMediaId } from "./send.js";
import { enqueueText } from "./outbox.js";

export async function sendTextMessage(toPhone, text, { runId = null, seq = null } = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;

  console.log("[outbound-wrapper] ENQUEUE → TEXT to", toPhone, ":", clean);
  return enqueueText({ to: String(toPhone), text: clean, runId, seq });
}

export async function sendMediaMessage(toPhone, fileInfo) {
  const { filePath, mimeType, originalName, caption } = fileInfo || {};
  if (!filePath) return null;

  console.log("[outbound-wrapper] DIRECT → MEDIA to", toPhone, filePath, mimeType);

  const fileBuffer = fs.readFileSync(filePath);

  const mediaId = await uploadMediaToWhatsApp({
    buffer: fileBuffer,
    mimeType,
    filename: originalName
  });

  const kind = String(mimeType || "").toLowerCase().startsWith("video/") ? "video" : "image";
  if (kind === "video") {
    await sendVideoByMediaId(String(toPhone), mediaId, caption || "");
    return;
  }

  await sendImageByMediaId(String(toPhone), mediaId, caption || "");
}
