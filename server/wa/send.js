import { emitOutbound } from './wa-events.js';
import fetch from "node-fetch";
import FormData from "form-data";
import { emitObs } from "../utils/observability.js";
import { summarizeGraphError, compactErrorForLog } from "./graph-error.js";


// server/wa/send.js
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const API_BASE     = `https://graph.facebook.com/v21.0/${PHONE_ID}`;
const API_MESSAGES = `${API_BASE}/messages`;
const API_MEDIA    = `${API_BASE}/media`

if (!TOKEN || !PHONE_ID) {
  console.error("[WA][CONFIG] Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID in environment.");
}



const API = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;


function normalizeToE164(raw, defaultCountryCode = '51') {
  const digits = String(raw || '').replace(/\D/g, '');
  // If it already starts with country code (e.g., 51...) keep it.
  if (digits.startsWith(defaultCountryCode)) return digits;
  return defaultCountryCode + digits; // prepend country code
}

export async function uploadMediaToWhatsApp(fileObj) {
  // fileObj: { buffer, mimeType, filename }

  const { buffer, mimeType, filename } = fileObj;

  const form = new FormData();
  form.append("file", buffer, {
    contentType: mimeType,
    filename: filename
  });

  form.append("messaging_product", "whatsapp");

  const resp = await fetch(
    // example:
    // https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>/media
    `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      },
      body: form
    }
  );

  const rawText = await resp.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const graphError = summarizeGraphError(json, resp.status);
    emitObs("wa.media_upload.failed", {
      httpStatus: resp.status,
      graphError,
      filename,
      mimeType,
    });
    throw new Error(`Media upload failed: ${resp.status} ${graphError.message || resp.statusText}`);
  }

  // expected { id: "<media_id>" }
  return json.id;
}

export async function sendImageByMediaId(to, mediaId, caption = '') {
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { id: mediaId, caption }
    })
  });
  const j = await r.json();
  if (!r.ok) {
    const graphError = summarizeGraphError(j, r.status);
    emitObs("wa.send_image.failed", { httpStatus: r.status, to, mediaId, graphError });
    throw new Error(`sendImageByMediaId failed: ${r.status} ${graphError.message || JSON.stringify(compactErrorForLog(j))}`);
  }
  return j.messages?.[0]?.id; // wamid
}

export async function sendVideoByMediaId(to, mediaId, caption = '') {
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'video',
      video: { id: mediaId, caption }
    })
  });
  const j = await r.json();
  if (!r.ok) {
    const graphError = summarizeGraphError(j, r.status);
    emitObs("wa.send_video.failed", { httpStatus: r.status, to, mediaId, graphError });
    throw new Error(`sendVideoByMediaId failed: ${r.status} ${graphError.message || JSON.stringify(compactErrorForLog(j))}`);
  }
  return j.messages?.[0]?.id; // wamid
}



export async function sendDocumentByMediaId(to, mediaId, filename = '', caption = '') {
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { id: mediaId, filename: filename || undefined, caption }
    })
  });
  const j = await r.json();
  if (!r.ok) {
    const graphError = summarizeGraphError(j, r.status);
    emitObs("wa.send_document.failed", { httpStatus: r.status, to, mediaId, filename, graphError });
    throw new Error(`sendDocumentByMediaId failed: ${r.status} ${graphError.message || JSON.stringify(compactErrorForLog(j))}`);
  }
  return j.messages?.[0]?.id; // wamid
}

export async function sendTextBack(to, text) {

  const toNormalized = normalizeToE164(to, '51'); // Peru
  const body = {
    messaging_product: "whatsapp",
    to: toNormalized,
    type: "text",
    text: { body: String(text) }
  };

  const r = await fetch(API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
        body: JSON.stringify(body)
  });
  const json = await r.json();
  emitOutbound({
    from: PHONE_ID,            // your business number / JID if you have it
    to: String(to).replace(/\s+/g, ''),
    text,
    id: json?.messages?.[0]?.id, // wamid
    type: 'text'
  });




  if (!r.ok) {
    const graphError = summarizeGraphError(json, r.status);
    emitObs("wa.send_text.failed", { httpStatus: r.status, to: toNormalized, graphError });
    throw new Error(`WA sendText failed: ${r.status} ${graphError.message || r.statusText}`);
  }
  return json?.messages?.[0]?.id || null;
}


export async function sendImageBack(to, { link, caption } = {}) {
  const body = {
    messaging_product: "whatsapp",
    to: String(to),
    type: "image",
    image: {
      link: link,          // public URL or previously uploaded media id via "id"
      caption: caption || ""
    }
  };

  const r = await fetch(API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = await r.json();
  if (!r.ok) {
    const graphError = summarizeGraphError(json, r.status);
    emitObs("wa.send_image_link.failed", { httpStatus: r.status, to, link, graphError });
    const msg = `WA sendImage failed: ${r.status} ${graphError.message || r.statusText}`;
    throw new Error(msg);
  }
  return json?.messages?.[0]?.id || null;
}
