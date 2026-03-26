// server/wa/listeners.js
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
  const chatId = raw.chatId || getChatIdByPhone(raw.from);

  // Normalize type
  const hintedType = (raw.type || raw.media?.kind || "").toLowerCase();
  const type = ["text", "image", "video", "audio", "ctwa_referral"].includes(hintedType)
    ? hintedType
    : "text";

  const media = raw.media || {};
  let imageUrl, videoUrl, audioUrl;

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
  }

  return {
    id: raw.id,
    chatId,
    from: "them",
    dir: "in",
    type,
    text: raw.text || "",
    imageUrl,
    videoUrl,
    audioUrl,                                   // 👈 important
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
  // console.log("[SSE][OUTBOUND_UI]", ui);
  // 👇 this is what realtime.js listens to
  broadcast("outbound_ui", ui);
});

// INBOUND = customer → business
onInbound((payload) => {
  const ui = toInboundUI(payload);
  // console.log("[SSE][INBOUND_UI]", ui);
  // 👇 this is what realtime.js listens to
  broadcast("inbound_ui", ui);
});


// console.log('🧭 WA listeners (with SSE broadcast) loaded');
