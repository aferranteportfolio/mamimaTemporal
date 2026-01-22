// funionality/sendMessage.mjs
// Node 18+ (ESM)
// Requires: message-store.mjs in the same folder
import fs from "node:fs/promises";
import path from "node:path";
import { storeSentMessage } from "./message-store.js";

// TODO: move to env vars
let WHATSAPP_TOKEN = "EAAVcInVNCAABPo9GZCayOMJdafmPjWkK2H5a0AeLLMEJpxAwpUgoNyr4QAhwmhPHEwNZAYeiVAHYvHLZAgHpwYm9AQn9DAPPN1TtAejWEbfgk0FcgWZAMj2bVUwxjcQ3jWBMZAILDq4tr1kmRZBOVo3h9hlYNaZASdi0VCKZAJ8wpoBUQPHURRfv234ZB1eXoExKjzQEDoxrSVfwRZBRGCZBCCGmVC0lsb8vKJZCCT6NZA3Hh"
let  WHATSAPP_PHONE_NUMBER_ID = "881145688403993"
const GRAPH_VERSION = "v22.0";

const isLocalPath = (u) => {
  if (!u || typeof u !== "string") return false;
  if (u.startsWith("http://") || u.startsWith("https://")) return false;
  if (u.startsWith("file://")) return true;
  return u.startsWith("./") || u.startsWith("../") || u.startsWith("/") || /^[a-zA-Z]:\\/.test(u);
};

function fileName(p) { return String(p).split(/[\\/]/).pop() || "upload.bin"; }
function guessMime(p) {
  const lower = String(p).toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function uploadLocalAsMedia(localUrlOrPath, token, phoneNumberId) {
  const localPath = localUrlOrPath.startsWith("file://") ? new URL(localUrlOrPath) : path.resolve(localUrlOrPath);
  const buf = await fs.readFile(localPath);
  const mime = guessMime(String(localPath));
  const blob = new Blob([buf], { type: mime });

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", blob, fileName(String(localPath)));

  const mediaEndpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`;
  const res = await fetch(mediaEndpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Media upload failed: ${data?.error?.message || res.statusText}`);
  if (!data?.id) throw new Error("Media upload succeeded but no id returned.");
  return data.id;
}

export async function sendText(to, content = "", imageOptions = undefined) {
  console.log("we using this one? sendMessage.js in wa line 47")
  const token = WHATSAPP_TOKEN;
  const phoneNumberId = WHATSAPP_PHONE_NUMBER_ID;
  if (!token) throw new Error("Missing WHATSAPP_TOKEN.");
  if (!phoneNumberId) throw new Error("Missing WHATSAPP_PHONE_NUMBER_ID.");
  if (!to || typeof to !== "string") throw new Error('Param "to" must be a non-empty string.');

  const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 1) Optional TEXT
  if (typeof content === "string" && content.trim()) {
    const textPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: content, preview_url: false },
    };

    const resText = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(textPayload) });
    const jText = await resText.json().catch(() => ({}));
    if (!resText.ok) throw new Error(`Text send failed: ${jText?.error?.message || resText.statusText}`);

    const textMid = jText?.messages?.[0]?.id;
    if (textMid) storeSentMessage({ id: textMid, to, type: "text", content });
    

    
  }

  // 2) Optional IMAGE
  if (imageOptions && typeof imageOptions === "object") {
    const { url, id, caption } = imageOptions;

    let imagePart;
    if (id) {
      imagePart = { id };
    } else if (url && !isLocalPath(url)) {
      imagePart = { link: url };
    } else if (url && isLocalPath(url)) {
      const mediaId = await uploadLocalAsMedia(url, token, phoneNumberId);
      imagePart = { id: mediaId };
    } else {
      throw new Error('Provide either imageOptions.id or imageOptions.url (local path or https URL).');
    }

    const imgPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: { ...imagePart, ...(caption ? { caption } : {}) },
    };

    const resImg = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(imgPayload) });
    const jImg = await resImg.json().catch(() => ({}));
    if (!resImg.ok) throw new Error(`Image send failed: ${jImg?.error?.message || resImg.statusText}`);

    const imgMid = jImg?.messages?.[0]?.id;
    const contentDesc = imagePart.id
      ? `image(id=${imagePart.id}) caption="${caption || ""}"`
      : `image(link=${imagePart.link}) caption="${caption || ""}"`;
    if (imgMid) storeSentMessage({ id: imgMid, to, type: "image", content: contentDesc });

    return jImg; // return last send result
  }

  if (!content?.trim()) throw new Error("Nothing to send: empty content and no image options provided.");
}
