import { emitOutbound } from './wa-events.js';
// server/wa/send.js
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
const API_BASE     = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}`;
const API_MESSAGES = `${API_BASE}/messages`;
const API_MEDIA    = `${API_BASE}/media`;
const RETRYABLE_FETCH_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"]);

if (!TOKEN || !PHONE_ID) {
  console.error("❌ Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID in .env");
}



const API = API_MESSAGES;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableFetchError(err) {
  return RETRYABLE_FETCH_CODES.has(err?.code) || /ECONNRESET|socket hang up|network timeout/i.test(String(err?.message || ""));
}

async function fetchWithRetry(url, options = {}, { attempts = 3, baseDelayMs = 500 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isRetryableFetchError(err)) throw err;

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`⚠️ WhatsApp fetch failed (${err?.code || err?.message}); retrying in ${delayMs}ms (${attempt}/${attempts})`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}


function normalizeToE164(raw, defaultCountryCode = '51') {
  const digits = String(raw || '').replace(/\D/g, '');
  // If it already starts with country code (e.g., 51...) keep it.
  if (digits.startsWith(defaultCountryCode)) return digits;
  return defaultCountryCode + digits; // prepend country code
}

export async function uploadMediaToWhatsApp(fileObj) {
  // fileObj: { buffer, mimeType, filename }

  const { buffer, filename } = fileObj;
  const mimeType = fileObj.mimeType || fileObj.mimetype || "application/octet-stream";

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append("file", blob, filename || "upload");
  form.append("type", mimeType);
  form.append("messaging_product", "whatsapp");

  const resp = await fetchWithRetry(
    API_MEDIA,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`
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
  const url = API_MESSAGES;
  const r = await fetchWithRetry(url, {
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
  const url = API_MESSAGES;
  const r = await fetchWithRetry(url, {
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
  const url = API_MESSAGES;
  const r = await fetchWithRetry(url, {
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

  const r = await fetchWithRetry(API, {
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

  const r = await fetchWithRetry(API, {
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
