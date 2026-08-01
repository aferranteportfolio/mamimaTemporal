// server/wa/listeners.js
import '../utils/consoleLogFilter.js';
import { onOutbound, onInbound } from './wa-events.js';
import { broadcast } from '../sse.js'; // <- you already export broadcast from server/sse.js

const L = (tag, obj) => {
  const ts = new Date().toISOString();
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  console.log(`[${ts}] ${tag}\n${body}\n`);
};

// If you can map phone -> chatId on the server, do it here.
// Otherwise we still send 'to'/'fromPhone' and let the client map.
function getChatIdByPhone(phone) {
  try {
    return globalThis.conversationsByPhone?.get(String(phone))?.id || null;
  } catch { return null; }
}

function toOutboundUI(raw) {
  const chatId = raw.chatId || getChatIdByPhone(raw.to);
  return {
    id: raw.id,
    chatId,                   // IMPORTANT for FE thread placement
    from: 'me',
    dir: 'out',
    type: raw.type || 'text',
    text: raw.text || '',
    imageUrl: raw.imageUrl || undefined,
    videoUrl: raw.videoUrl || undefined,
    mediaId: raw.mediaId || undefined,
    timestamp: raw.ts || new Date().toISOString(),
    status: 'sent',
    to: raw.to,
    fromPhone: raw.from
  };
}

function toInboundUI(raw) {
  // The browser uses this identity to select/update the conversation. Falling
  // back to the sender is required when no in-memory phone-to-chat map exists.
  const chatId = raw.chatId || getChatIdByPhone(raw.from) || raw.from;

  if (!raw.from || !chatId) {
    console.error("[WA][INBOUND][DROP_INVALID_IDENTITY]", {
      id: raw?.id ?? null,
      from: raw?.from ?? null,
      chatId: chatId ?? null,
      availableKeys: Object.keys(raw || {}),
    });
    return null;
  }

  // Normalize type
  const hintedType = (raw.type || raw.media?.kind || "").toLowerCase();
  const type = ["text", "image", "video", "audio", "location", "document", "file", "ctwa_referral"].includes(hintedType)
    ? hintedType
    : "text";

  const media = raw.media || {};
  let imageUrl, videoUrl, audioUrl, fileUrl, locationUrl;

  if (type === "audio") {
    // 👉 for audio we only care about the audio URL
    audioUrl =
      raw.audioUrl ||
      media.url ||
      (raw.mediaId || media.id ? `/api/media/${raw.mediaId || media.id}` : undefined);
  } else {
    const mediaUrl =
      raw.imageUrl ||
      raw.videoUrl ||
      media.url ||
      (raw.mediaId || media.id ? `/api/media/${raw.mediaId || media.id}` : undefined);

    if (type === "image") imageUrl = mediaUrl;
    if (type === "video") videoUrl = mediaUrl;
    if (type === "document" || type === "file") fileUrl = mediaUrl;
  }

  if (type === "location") {
    locationUrl =
      raw.locationUrl ||
      raw.url ||
      (Number.isFinite(Number(raw.location?.latitude)) && Number.isFinite(Number(raw.location?.longitude))
        ? `https://www.google.com/maps?q=${Number(raw.location.latitude)},${Number(raw.location.longitude)}`
        : undefined);
  }

  return {
    id: raw.id,
    chatId,
    from: raw.from,
    dir: "in",
    type,
    text: raw.text || "",
    imageUrl,
    videoUrl,
    audioUrl,                                   // 👈 important
    fileUrl,
    location: raw.location || undefined,
    locationUrl,
    mediaId: raw.mediaId || media.id || undefined,
    referral_type: raw.referral_type || null,
    referral_metadata: raw.referral_metadata || null,
    timestamp: raw.ts || new Date().toISOString(),
    status: "received",
    fromPhone: raw.from,
    to: raw.to,
  };
}

// OUTBOUND = business → customer
onOutbound((payload) => {
  const ui = toOutboundUI(payload);
  // 👇 this is what realtime.js listens to
  broadcast("outbound_ui", ui);
});

// INBOUND = customer → business
onInbound((payload) => {
  const ui = toInboundUI(payload);
  if (!ui) return;
  // 👇 this is what realtime.js listens to
  broadcast("inbound_ui", ui);
});
