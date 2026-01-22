// server/wa/wa-events.js
// Node-only guard (avoids Vite/browser "node:events" errors)
if (typeof window !== "undefined") {
  throw new Error("wa-events.js must only be imported on the server.");
}

import { EventEmitter } from "events";

// ===== Config =====
const WA_DEBUG = String(process.env.WA_DEBUG ?? "0") === "1";

/**
 * Global singleton so every import path gets the same instance
 * even if the module is loaded via different relative paths.
 */
const instance = globalThis.__waEvents ?? new EventEmitter();
globalThis.__waEvents = instance;

export const waEvents = instance;
waEvents.setMaxListeners(200);

// Keep a reference to the real emit (before any overrides)
const realEmit = waEvents.emit.bind(waEvents);

/**
 * Emit on a later tick so the caller (e.g. webhook handler)
 * is not forced to run all listeners inline.
 */
function emitAsync(event, ...args) {
  setImmediate(() => {
    try {
      realEmit(event, ...args);
    } catch (e) {
      console.error("[WA][emitAsync] listener error", { event }, e);
    }
  });
}



// ----- Optional: keep your emit override, but keep it lightweight -----
waEvents.emit = (event, ...args) => {
  // Keep this cheap; under load avoid heavy stringifying/logging here.
  // You can add small conditional logs here if needed.
  return realEmit(event, ...args);
};

const realOn = waEvents.on.bind(waEvents);
waEvents.on = (event, listener) => {
  return realOn(event, listener);
};

// ----- Minimal JSDoc typing for payloads -----
/**
 * @typedef {Object} OutboundPayload
 * @property {string} [from]   Business number (E.164 or JID)
 * @property {string} [to]     Customer number (E.164 or JID)
 * @property {string|null} [text]
 * @property {string} [ts]     ISO timestamp
 * @property {string} [id]     Meta message id (wamid...)
 * @property {string} [type]   'text'|'image'|'video'|...
 * @property {string} [imageUrl]
 */

/**
 * @typedef {Object} InboundPayload
 * @property {string} [from]   Customer number
 * @property {string} [to]     Business number
 * @property {string|null} [text]
 * @property {string} [ts]     ISO timestamp
 * @property {string} [id]     Meta message id
 * @property {string} [type]
 * @property {string} [imageUrl]
 */

// ===== UI message helpers (for the web client) =====
/**
 * @typedef {Object} UiMessage
 * @property {string} id
 * @property {string} chatId
 * @property {"me"|"them"} from
 * @property {"out"|"in"} dir
 * @property {"text"|"image"} type
 * @property {string} [text]       // text or caption
 * @property {string} [imageUrl]   // e.g. /api/media/{mediaId}
 * @property {string|number|Date} timestamp
 * @property {string} [status]     // sent | delivered | read
 */

// ----- Helpers to normalize + validate -----
const iso = () => new Date().toISOString();

function normalizeOutbound(p = {}) {
  return {
    from: p.from ?? null,
    to: p.to ?? null,
    text: p.text ?? p.caption ?? null,
    ts: p.ts ?? iso(),
    id: p.id ?? p.messageId ?? p?.response?.messages?.[0]?.id ?? null,
    type: p.type ?? (p.imageUrl ? "image" : "text"),
    imageUrl: p.imageUrl ?? null,
    raw: p, // keep a copy for debugging
  };
}

function normalizeInbound(p = {}) {
  // Preserve any extra fields your pipeline already uses (media, urls, captions, etc.)
  const preserved = { ...p };

  return {
    ...preserved, // keep media / imageUrl / videoUrl / audio / etc
    from: p.from ?? null,
    to: p.to ?? null,
    text: p.text ?? p.caption ?? null,
    caption: p.caption ?? null,
    ts: p.ts ?? iso(),
    id: p.id ?? null,
    type: p.type ?? (p.imageUrl ? "image" : "text"),

    // Common URL fields (keep + normalize a bit)
    imageUrl: p.imageUrl ?? p.image_url ?? p.media?.url ?? null,
    videoUrl: p.videoUrl ?? p.video_url ?? null,
    audioUrl: p.audioUrl ?? p.audio_url ?? null,
    documentUrl: p.documentUrl ?? p.document_url ?? null,

    // Preserve media object if present
    media: p.media ?? null,

    // Keep a raw copy (if you already pass raw)
    raw: p.raw ?? preserved,
  };
}


function normTs(ts) {
  if (!ts) return new Date().toISOString();
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString();
}

// ===== INBOUND UI =====
/** @param {UiMessage} p */
export function emitInboundUi(p) {
  const n = {
    id: p.id,
    chatId: p.chatId,
    from: "them",
    dir: "in",
    type: p.type || (p.imageUrl ? "image" : "text"),
    text: p.text || "",
    imageUrl: p.imageUrl || null,
    timestamp: normTs(p.timestamp),
    status: p.status || "delivered",
  };

  emitAsync("inbound_ui", n);
  return n;
}

// ===== OUTBOUND UI (kept as-is; note: this does NOT emit outbound_ui in your original code) =====
/** @param {UiMessage} p */
export function emitOnboundUi(p) {
  const n = {
    id: p.id,
    chatId: p.chatId,
    from: p.from ?? null,
    to: p.to ?? null,
    dir: "in",
    type: p.type || (p.imageUrl ? "image" : "text"),
    text: p.text ?? p.caption ?? null,
    imageUrl: p.imageUrl || null,
    timestamp: normTs(p.timestamp),
    status: p.status || "delivered",
    raw: p,
  };

  return n;
}

// ===== LISTENERS =====
/** @param {(p:UiMessage)=>void} handler */
export function onOutboundUi(handler) {
  waEvents.on("outbound_ui", handler);
}
/** @param {(p:UiMessage)=>void} handler */
export function onInboundUi(handler) {
  waEvents.on("inbound_ui", handler);
}

// ----- Public API: on/emit wrappers -----
/** @param {(p:OutboundPayload)=>void} handler */
export function onOutbound(handler) {
  waEvents.on("outbound", handler);
}

/** @param {(p:InboundPayload)=>void} handler */
export function onInbound(handler) {
  waEvents.on("inbound", handler);
}

/** @param {OutboundPayload} payload */
export function emitOutbound(payload) {
  const n = normalizeOutbound(payload);
  emitAsync("outbound", n);
  return n;
}

/** @param {InboundPayload} payload */
export function emitInbound(payload) {
  const n = normalizeInbound(payload);
  emitAsync("inbound", n);
  return n;
}
