import { emitOutbound } from './wa-events.js';
import fetch from "node-fetch";
import FormData from "form-data";


// server/wa/send.js
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const API_BASE     = `https://graph.facebook.com/v21.0/${PHONE_ID}`;
const API_MESSAGES = `${API_BASE}/messages`;
const API_MEDIA    = `${API_BASE}/media`

if (!TOKEN || !PHONE_ID) {
  console.error("❌ Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID in .env");
}



const API = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;

function getWhatsAppHttpTimeoutMs() {
  return Math.max(5_000, Number(process.env.WHATSAPP_HTTP_TIMEOUT_MS ?? process.env.OUTBOX_PROVIDER_TIMEOUT_MS ?? "30_000"));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = getWhatsAppHttpTimeoutMs()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`WhatsApp request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}


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

  const resp = await fetchWithTimeout(
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

  if (!resp.ok) {
    const text = await resp.text();
    const msg = `Media upload failed: ${resp.status} ${resp.statusText} ${text}`;
    throw new Error(msg);
  }

  const json = await resp.json();
  // expected { id: "<media_id>" }
  return json.id;
}

export async function sendImageByMediaId(to, mediaId, caption = '') {
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const r = await fetchWithTimeout(url, {
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
  if (!r.ok) throw new Error(`sendImageByMediaId failed: ${r.status} ${JSON.stringify(j)}`);
  return j.messages?.[0]?.id; // wamid
}

export async function sendVideoByMediaId(to, mediaId, caption = '') {
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const r = await fetchWithTimeout(url, {
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
  if (!r.ok) throw new Error(`sendVideoByMediaId failed: ${r.status} ${JSON.stringify(j)}`);
  return j.messages?.[0]?.id; // wamid
}



export async function sendDocumentByMediaId(to, mediaId, filename = '', caption = '') {
  const url = `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`;
  const r = await fetchWithTimeout(url, {
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
  if (!r.ok) throw new Error(`sendDocumentByMediaId failed: ${r.status} ${JSON.stringify(j)}`);
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

  const r = await fetchWithTimeout(API, {
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
    throw new Error(`WA sendText failed: ${r.status} ${r.statusText} ${JSON.stringify(json)}`);
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

  const r = await fetchWithTimeout(API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = await r.json();
  if (!r.ok) {
    const msg = `WA sendImage failed: ${r.status} ${r.statusText} ${JSON.stringify(json)}`;
    throw new Error(msg);
  }
  return json?.messages?.[0]?.id || null;
}
