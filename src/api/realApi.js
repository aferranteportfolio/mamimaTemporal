// src/api/realApi.js
const isProd = !!(import.meta?.env?.PROD);
export const API_BASE = isProd
  ? (import.meta.env.VITE_API_BASE?.replace(/\/+$/, '') || '')
  : ''; // DEV => relative, goes through Vite proxy
// ---------- SAFE ENV / BASE URL RESOLUTION ----------
const hasImportMeta = typeof import.meta !== "undefined";
const VITE_ENV = hasImportMeta ? import.meta.env : undefined;

// when running in browser (vite dev/build), prefer VITE_API_BASE
// when running in node (SSR/tests), fall back to process.env or localhost:3050
const DEFAULT_ORIGIN =
  (typeof window !== "undefined" && window.location)
    ? `${window.location.protocol}//${window.location.hostname}:3050`
    : `http://localhost:3050`;





// wrapper to always prefix with API_BASE (and allow absolute URLs untouched)
function apiFetch(path, opts) {
  if (/^https?:\/\//i.test(path)) return fetch(path, opts);
  const p = path.startsWith("/") ? path : `/${path}`;
  return fetch(`${API_BASE}${p}`, opts);
}

function logFetch(label, url, opts, extra = {}) {
  const t0 = performance.now();
  return fetch(url, opts)
    .then(async (r) => {
      const dt = (performance.now() - t0).toFixed(0);
      let body = null;
      try { body = await r.clone().json(); } catch {}
      console.log(
        `[SR][NET][${label}] ${opts?.method || "GET"} ${url} -> ${r.status} (${dt}ms)`,
        { extra, body }
      );
      return r;
    })
    .catch(err => {
      const dt = (performance.now() - t0).toFixed(0);
      console.warn(`[SR][NET][${label}] ERROR ${opts?.method || "GET"} ${url} (${dt}ms)`, err);
      throw err;
    });
}

// ---------- ERROR HELPERS ----------
async function okJsonOrThrow(r, label) {
  if (r.ok) return r.json();
  let body = "";
  try { body = await r.text(); } catch {}
  const msg = body ? ` - ${body}` : "";
  throw new Error(`Failed ${label}: ${r.status}${msg}`);
}
function okOrThrow(r, label) {
  if (!r.ok) throw new Error(`Failed ${label}: ${r.status}`);
  return r;
}

// -------- Saved Replies API --------

export async function listSavedReplies() {
  const r = await apiFetch("/api/saved-replies?full=1");
  return okJsonOrThrow(r, "listSavedReplies");
}

export async function getSavedReply(id) {
  const r = await apiFetch(`/api/saved-replies/${encodeURIComponent(id)}`);
  
  return okJsonOrThrow(r, "getSavedReply");
}

/**
 * Util: ¿hay algún File en messages?
 */
function hasAnyFiles(messages) {
  return Array.isArray(messages) && messages.some(
    m => Array.isArray(m?.files) && m.files.some(f => f instanceof File)
  );
}

/**
 * Branch JSON (sin archivos)
 */
async function saveSavedReplyJson({ title, messages }) {
  const r = await apiFetch("/api/saved-replies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      messages: (messages || []).map(m => ({
        text: m?.text || "",
        files: [] // en JSON puro no se adjuntan
      }))
    }),
  });
  return okJsonOrThrow(r, "saveSavedReply(json)");
}

/**
 * Branch Multipart (con archivos) usando descriptor m{i}_f{j}
 */
async function saveSavedReplyMultipart({ title, messages }) {
  const fd = new FormData();

  // 1) descriptor: text + filesCount por mensaje
  const descriptor = (messages || []).map(m => ({
    text: m?.text || "",
    filesCount: Array.isArray(m?.files) ? m.files.length : 0,
  }));
  fd.append("messagesDescriptor", JSON.stringify(descriptor));

  // 2) meta (texto); los files se agregan vía m{i}_f{j}
  const meta = {
    title: title || "",
    messages: (messages || []).map(m => ({ text: m?.text || "", files: [] })),
  };
  fd.append("meta", JSON.stringify(meta));

  // 3) archivos determinísticos m{i}_f{j}
  (messages || []).forEach((m, i) => {
    (m?.files || []).forEach((file, j) => {
      if (file instanceof File) {
        fd.append(`m${i}_f${j}`, file, file.name || `file-${i}-${j}`);
      }
    });
  });

  const r = await apiFetch("/api/saved-replies", {
    method: "POST",
    body: fd,
  });
  return okJsonOrThrow(r, "saveSavedReply(multipart)");
}

/**
 * Create a saved reply.
 * - Si ANY message tiene File, usa multipart; si no, JSON.
 */
export async function saveSavedReply({ title, messages }) {
  if (hasAnyFiles(messages)) {
    return saveSavedReplyMultipart({ title, messages });
  }
  return saveSavedReplyJson({ title, messages });
}

export async function markSavedReplyUsed(id, { to } = {}) {
  const qp = to ? `?to=${encodeURIComponent(to)}` : "";
  const url = `${API_BASE}/api/saved-replies/${id}/use${qp}`;
  const headers = to ? { "x-sr-to": to } : undefined;
  console.log("[SR][NET] markUsed →", { url, headers });



  const r = await logFetch(
    "markUsed",
    url,
    { method: "PATCH", headers: to ? { "x-sr-to": to } : undefined },
    { id, to }
  );
  if (!r.ok) throw new Error(`PATCH /saved-replies/${id}/use -> ${r.status}`);
  return r.json();
}


export async function saveProgrammedMessage({ id, title, messages, misc, schedule }) {
  const form = new FormData();
  const withCids = (messages || []).map((m, idx) => {
    const fileCids = [];
    (m.files || []).forEach((file, i) => {
      const cid = `${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}-${idx}-${i}`;
      fileCids.push(cid);
      form.append(`file:${cid}`, file, `cid:${cid}`);
    });
    return { text: m.text || "", delayMs: m.delayMs ?? 0, fileCids };
  });
  form.append("meta", JSON.stringify({ id, title, messages: withCids, misc, schedule }));

  const API_BASE =
    (typeof window !== "undefined" && import.meta?.env?.VITE_API_BASE?.replace(/\/+$/,"")) ||
    (typeof window !== "undefined" && `${location.protocol}//${location.hostname}:3050`) ||
    "";

  const url = id
    ? `${API_BASE}/api/programmed-messages/${encodeURIComponent(id)}`
    : `${API_BASE}/api/programmed-messages`;
    

  const res = await fetch(url, { method: id ? "PUT" : "POST", body: form });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}

export async function listProgrammedMessages() {
  const API_BASE =
    (typeof window !== "undefined" && import.meta?.env?.VITE_API_BASE?.replace(/\/+$/,"")) ||
    (typeof window !== "undefined" && `${location.protocol}//${location.hostname}:3050`) ||
    "";
  const res = await fetch(`${API_BASE}/api/programmed-messages`);
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json(); // { items: [...] }
}

// Get one by id
export async function getProgrammedMessage(id) {
  const API_BASE =
    (typeof window !== "undefined" && import.meta?.env?.VITE_API_BASE?.replace(/\/+$/,"")) ||
    (typeof window !== "undefined" && `${location.protocol}//${location.hostname}:3050`) ||
    "";
  const r = await fetch(`${API_BASE}/api/programmed-messages/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`GET failed: ${r.status}`);
  return r.json(); // meta.json contents
}
/**
 * Update an existing saved reply (title/messages text only; no new files here).
 * Matches server PUT /api/saved-replies/:id
 */
export async function updateSavedReply(id, { title, messages }) {
  const r = await apiFetch(`/api/saved-replies/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      title,
      messages: (messages || []).map(m => ({ text: m?.text || "" })) // el server preserva files existentes
    })
  });
  return okJsonOrThrow(r, "updateSavedReply");
}

/**
 * Delete a saved reply by id.
 */
export async function deleteSavedReply(id) {
  const r = await apiFetch(`/api/saved-replies/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Accept": "application/json" }
  });
  return okJsonOrThrow(r, "deleteSavedReply");
}

// -------- Existing chat APIs --------
export async function fetchConversations() {
  const r = await fetch('/api/conversations');
  const j = await r.json();

  // normalize to an array, regardless of server shape
  const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []);

  console.groupCollapsed('[UNSEEN][API] ← /api/conversations raw');
  try {
    console.table(arr.map(c => ({
      id: c.id || c.phone || c.customerIdRaw,
      unread: c.unread,
      lastTimestamp: c.lastTimestamp
    })));
  } finally {
    console.groupEnd();
  }

  return arr;
}

function normalizeHistoryMessage(raw) {
  if (!raw || typeof raw !== "object") return raw;

  const m = raw;
  const type = (m.type || m.media?.kind || (m.imageUrl ? "image" : "text")).toLowerCase();

  const mediaId = m.mediaId || m.media?.id || null;

  let imageUrl = m.imageUrl || null;
  let videoUrl = m.videoUrl || null;
  let audioUrl = m.audioUrl || null;
  let fileUrl = m.fileUrl || m.documentUrl || null;

  // ---- media URLs (fallbacks) ----
  if (type === "image" && !imageUrl) {
    imageUrl = m.media?.url || (mediaId ? `/api/media/${mediaId}` : null);
  }

  if (type === "video" && !videoUrl) {
    videoUrl = m.media?.url || (mediaId ? `/api/media/${mediaId}` : null);
  }

  if (type === "audio" && !audioUrl) {
    // Prefer direct WA URL if present, else fall back to proxy
    audioUrl = m.media?.url || (mediaId ? `/api/media/${mediaId}` : null);
  }

  if ((type === "document" || type === "file") && !fileUrl) {
    fileUrl = m.media?.url || (mediaId ? `/api/media/${mediaId}` : null);
  }

  // ---- location normalization ----
  let location = m.location || null;
  let locationUrl = m.locationUrl || null;

  const lat =
    location?.latitude ??
    m.latitude ??
    m.lat ??
    m.location_latitude;

  const lng =
    location?.longitude ??
    m.longitude ??
    m.lng ??
    m.location_longitude;

  if (!location && lat != null && lng != null) {
    location = {
      latitude: Number(lat),
      longitude: Number(lng),
      name: m.location_name || m.name || null,
      address: m.location_address || m.address || null,
    };
  }

  if (!locationUrl && lat != null && lng != null) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
      // Simple Google Maps link (similar to WhatsApp behavior)
      locationUrl = `https://www.google.com/maps?q=${latNum},${lngNum}`;
    }
  }

  const out = {
    ...m,
    type,
    mediaId: mediaId || undefined,
    imageUrl: imageUrl || undefined,
    videoUrl: videoUrl || undefined,
    audioUrl: audioUrl || undefined,
    fileUrl: fileUrl || undefined,
    fileName: (type === "document" || type === "file") ? (m.fileName || m.media?.filename || m.media?.name || undefined) : undefined,
    location: location || undefined,
    locationUrl: locationUrl || undefined,
  };

  // Small debug logs so we see what the history returns
  if (out.type === "audio") {
    console.log("[FE][HISTORY][AUDIO]", {
      id: out.id,
      chatId: out.chatId,
      mediaId: out.mediaId,
      audioUrl: out.audioUrl,
    });
  }

  if (out.type === "location") {
    console.log("[FE][HISTORY][LOCATION]", {
      id: out.id,
      chatId: out.chatId,
      location: out.location,
      locationUrl: out.locationUrl,
    });
  }

  return out;
}


export async function fetchMessages(chatId) {
  const url = `/api/messages?conversationId=${encodeURIComponent(chatId)}`;

  const r = await apiFetch(url);
  const j = await okJsonOrThrow(r, "fetchMessages");

  const rawArr = j?.data ?? j ?? [];
  const arr = Array.isArray(rawArr) ? rawArr : [];

  const normalized = arr.map(normalizeHistoryMessage);

  try {
    console.log("[FE][API] fetchMessages(normalized)", {
      chatId,
      total: normalized.length,
      audios: normalized.filter(m => m.type === "audio").length,
      locations: normalized.filter(m => m.type === "location").length,
    });
  } catch {}

  return normalized;
}



export async function sendText({ to, text }) {
  const r = await apiFetch("/api/send-text", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ to, text }),
  });
  return okJsonOrThrow(r, "sendText");
}

export async function sendImage({ to, file, caption }) {
  const fd = new FormData();
  fd.append("to", to);
  fd.append("file", file);
  if (caption) fd.append("caption", caption);
  const r = await apiFetch("/api/send-image", { method: "POST", body: fd });
  return okJsonOrThrow(r, "sendImage");
}

export async function sendVideo({ to, file, caption }) {
  const fd = new FormData();
  fd.append("to", to);
  if (caption) fd.append("caption", caption);
  fd.append("file", file);
  const r = await apiFetch("/api/send-video", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Failed /api/send-video: ${r.status}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "send-video failed");
  return j.data;
}
