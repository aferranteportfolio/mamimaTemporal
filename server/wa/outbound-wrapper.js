// server/wa/outbound-wrapper.js

import fs from "node:fs";
import { sendTextBack, uploadMediaToWhatsApp, sendImageByMediaId, sendVideoByMediaId } from "./send.js";
import { enqueueText } from "./outbox.js";
import { initializeCostumerAndStoreMessageHistory } from "../dbFunctionality/functionality.js";

const OUR_NUMBER = String(process.env.OUR_NUMBER || "").trim();

export async function sendTextMessage(toPhone, text, { runId = null, seq = null, nextAttemptAt = null } = {}) {
  const clean = String(text || "").trim();
  if (!clean) return null;

  console.log("[outbound-wrapper] ENQUEUE → TEXT to", toPhone, ":", clean);
  return enqueueText({ to: String(toPhone), text: clean, runId, seq, nextAttemptAt });
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
  const wamid =
    kind === "video"
      ? await sendVideoByMediaId(String(toPhone), mediaId, caption || "")
      : await sendImageByMediaId(String(toPhone), mediaId, caption || "");

  if (!wamid) return null;

  const ts = new Date().toISOString();
  const dbPayload = {
    id: wamid,
    from: OUR_NUMBER,
    to: String(toPhone),
    type: kind,
    mediaId,
    mimeType,
    message: caption || "",
    caption: caption || "",
    timestamp: ts,
    dir: "out",
    media: { id: mediaId, mimeType, timestamp: ts },
  };

  await initializeCostumerAndStoreMessageHistory(dbPayload, 0);
  return wamid;

}