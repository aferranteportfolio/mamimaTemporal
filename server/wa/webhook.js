// server/wa/webhook.js
import express from "express";
import { getSentMessage } from "./message-store.js";
import { waEvents } from "./wa-events.js";


const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_TOKEN;
const L = (s,m,e)=>{const n=new Date().toISOString();console.log(`[${n}] [${s}] ${m}`, e ?? '');};

// --- helpers ---
function getInboundText(m) {
  if (m.type === "text" && m.text?.body) return m.text.body;
  if (m.type === "image" && m.image?.caption) return m.image.caption;
  if (m.type === "video" && m.video?.caption) return m.video.caption;
  if (m.interactive?.type === "button_reply") return m.interactive?.button_reply?.title || null;
  if (m.interactive?.type === "list_reply")   return m.interactive?.list_reply?.title   || null;
  return null;
}
function getInboundMedia(m) {
  if (m.type === "image" && m.image?.id) {
    return {
      kind: "image",
      id: m.image.id,
      mimeType: m.image.mime_type,
      sha256: m.image.sha256 ?? null,
      caption: m.image.caption ?? null,
    };
  }

  if (m.type === "video" && m.video?.id) {
    return {
      kind: "video",
      id: m.video.id,
      mimeType: m.video.mime_type,
      sha256: m.video.sha256 ?? null,
      caption: m.video.caption ?? null,
    };
  }

  if (m.type === "audio" && m.audio?.id) {
    return {
      kind: "audio",
      id: m.audio.id,
      mimeType: m.audio.mime_type,
      sha256: m.audio.sha256 ?? null,
      voice: !!m.audio.voice,
    };
  }

  if (m.type === "document" && m.document?.id) {
    return {
      kind: "document",
      id: m.document.id,
      mimeType: m.document.mime_type,
      sha256: m.document.sha256 ?? null,
      filename: m.document.filename ?? null,
      caption: m.document.caption ?? null,
    };
  }

  if (m.type === "sticker" && m.sticker?.id) {
    return {
      kind: "sticker",
      id: m.sticker.id,
      mimeType: m.sticker.mime_type || "image/webp",
      sha256: m.sticker.sha256 ?? null,
      animated: !!m.sticker.animated,
    };
  }

  return null;
}
function getInboundLocation(m) {
  if (m.type !== "location" || !m.location) return null;

  const latitude = Number(m.location.latitude);
  const longitude = Number(m.location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    name: m.location.name ?? null,
    address: m.location.address ?? null,
    url: `https://www.google.com/maps?q=${latitude},${longitude}`,
  };
}
function toMs(x) {
  // WA timestamps are seconds; if number-like use *1000
  const n = Number(x);
  if (!Number.isNaN(n) && n > 1e10) return n;        // already ms
  if (!Number.isNaN(n) && n > 0)    return n * 1000; // seconds -> ms
  const d = Date.parse(String(x));  // ISO safe
  return Number.isNaN(d) ? Date.now() : d;
}
function ticksFor(status) {
  if (status === "read") return "✓✓ (blue)";
  if (status === "delivered") return "✓✓";
  if (status === "sent") return "✓";
  if (status === "failed") return "✗";
  return "-";
}

// (optional) track last status to show transitions in logs
const lastStatusByWamid = new Map();

export function registerWaWebhook(app) {
  // GET verify
  app.get("/webhook", (req, res) => {
    L('WEBHOOK', 'GET /webhook verify hit', req.query);
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      L('WEBHOOK', 'verify OK');
      return res.status(200).send(challenge);
    }
    L('WEBHOOK', 'verify FAIL');
    return res.sendStatus(403);
  });

  // POST events
  app.post("/webhook", (req, res) => {
    console.log('[WA] inbound payload:', JSON.stringify(req.body, null, 2));
    L('WEBHOOK', 'POST /webhook hit');
    try {
      const entries = req.body?.entry ?? [];
      if (!entries.length) L('WEBHOOK', 'No entries array in body');

      for (const entry of entries) {
        const changes = entry?.changes ?? [];
        if (!changes.length) L('WEBHOOK', 'Entry has no changes');

        for (const change of changes) {
          console.log("webhookjs 96 rawbody ", entries)
          const v = change?.value || {};
          const meta = v.metadata || {};
          const ourNumber = meta.display_phone_number || meta.phone_number_id;

          // --- INBOUND ---
          if (Array.isArray(v.messages) && ourNumber) {
            for (const m of v.messages) {
              // `messages[].from` is canonical, while `contacts[].wa_id` is a
              // reliable fallback present in Meta inbound envelopes.
              const from = m.from || v.contacts?.[0]?.wa_id || null; // customer
              const to = ourNumber;                     // our number
              const inboundType = m.type;
              const text = getInboundText(m);
              const media = getInboundMedia(m);
              const location = getInboundLocation(m);
              const type = media?.kind === "sticker" ? "image" : inboundType;
              const ts = toMs(m.timestamp);
              

              L('INBOUND', 'message summary', {
                wamid: m.id, type, from, to, ts, ticks: 'n/a',
                text: text?.slice?.(0, 140) || null,
                mediaId: media?.id || null,
                hasLocation: !!location
              });

              if (!from) {
                console.error("[WA][WEBHOOK][DROP_MISSING_SENDER]", {
                  id: m?.id ?? null,
                  type: m?.type ?? null,
                  hasContactsWaId: Boolean(v.contacts?.[0]?.wa_id),
                });
              } else if (text || media || location) {
                // Emit to FE and to the centralized DB history listener.
                // Do not write directly here; the server-level inbound listener
                // persists this payload once with id/media metadata.
                waEvents.emit('inbound', {
                  from,
                  to,
                  text: text || media?.caption || (location ? (location.name || location.address || "📍 Ubicación") : ''),
                  caption: media?.caption || null,
                  ts,
                  id: m.id,
                  type,
                  mediaId: media?.id || null,
                  media,
                  location,
                  locationUrl: location?.url || null,
                  imageUrl: type === "image" && media?.id ? `/api/media/${media.id}` : undefined,
                  videoUrl: type === "video" && media?.id ? `/api/media/${media.id}` : undefined,
                  audioUrl: type === "audio" && media?.id ? `/api/media/${media.id}` : undefined,
                  documentUrl: type === "document" && media?.id ? `/api/media/${media.id}` : undefined,
                  // Preserve CTWA/ad metadata so auto-reply matching can
                  // evaluate "responde a anuncios" triggers against ad text.
                  referral: m.referral || null,
                  context: m.context || null,
                  __rawMessage: m,
                });
                L('INBOUND', 'emit inbound', { event: 'inbound', to, from, ts, mediaId: media?.id || null, hasLocation: !!location });
              } else {
                L('INBOUND', 'no text, media, or location extracted', { wamid: m.id, type });
              }
            }
          } else {
            if (!ourNumber && (v.messages?.length)) {
              L('INBOUND', 'messages exist but ourNumber missing', { meta });
            }
          }

          // --- OUTBOUND STATUSES ---
          if (Array.isArray(v.statuses) && ourNumber) {
            for (const s of v.statuses) {
              const wamid = s.id;                       // message id
              const to = s.recipient_id;                // customer
              const status = s.status;                  // sent|delivered|read|failed
              const ts = toMs(s.timestamp);

              // best-effort recover text we sent earlier
              const saved = getSentMessage(wamid);      // { to, type, content }
              let text = null;
              if (saved?.type === "text") text = saved.content;
              else if (saved?.type === "image") {
                const m = /caption="([^"]*)"/.exec(saved.content || "");
                text = m?.[1] || null;
              }

              const prev = lastStatusByWamid.get(wamid);
              lastStatusByWamid.set(wamid, status);

              if (s.errors?.length) {
                L('STATUS', 'OUTBOUND ERROR', { wamid, to, errors: s.errors });
              }

              L('STATUS', 'status event', {
                wamid,
                to,
                from: ourNumber,
                status,
                ticks: ticksFor(status),
                prevStatus: prev || null,
                ts,
                text: text?.slice?.(0, 140) || null
              });

              // FE event so you can update ticks in the bubble
              waEvents.emit('outbound', {
                from: ourNumber, to, text, ts, status, id: wamid, raw: s
              });
              L('STATUS', 'emit outbound', { event: 'outbound', wamid, status });

              // History persistence for outbound messages is handled by the
              // outbox/send routes when the message is accepted by WhatsApp.
              // Status webhooks should only update delivery state/logs; writing
              // history here creates duplicate text rows without media metadata.
            }
          }
        }
      }

      res.sendStatus(200);
    } catch (e) {
      console.error("Webhook error:", e);
      // Always 200 to avoid Meta retries, but do log the error
      res.sendStatus(200);
    }
  });
}



const router = express.Router();

// capture the exact raw JSON body too
router.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); }
}));

router.post("/webhook", (req, res) => {
  // 100% raw body as received from Meta (string)
  console.log("[WA] RAW BODY:", req.rawBody);

  // parsed JSON (still raw, before you touch it)
  const raw = req.body;
  console.log("[WA] RAW JSON:", JSON.stringify(raw, null, 2));

  // your mapping/normalization to internal shape
  const normalized = mapWebhookToInternal(raw);

  // pass BOTH to listeners
  waEvents.emit("inbound", normalized, raw);

  res.sendStatus(200);
});

export default router;

export const waWebhook = express.Router();

// Capture raw bytes exactly as sent by Meta
waWebhook.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
}));

waWebhook.post("/webhook", (req, res) => {
  // 1) Absolute raw bytes
  console.log("[WA] RAW BODY:", req.rawBody);

  // 2) Raw parsed JSON (unmodified)
  const raw = req.body;
  console.log("[WA] RAW JSON:", JSON.stringify(raw, null, 2));

  // 3) Walk Meta’s envelope (entry -> changes -> value -> messages[])
  const entries = raw?.entry ?? [];
  for (const entry of entries) {
    const changes = entry?.changes ?? [];
    for (const change of changes) {
      const v = change?.value || {};
      const meta = v.metadata || {};
      const ourNumber = meta.display_phone_number || meta.phone_number_id;

      // Emit one event per incoming message
      if (Array.isArray(v.messages)) {
        for (const m of v.messages) {
          // Build a minimal internal payload for your app
          const p = {
            from: m.from,                   // customer
            to: ourNumber,                  // your business number
            id: m.id,                       // wamid...
            ts: new Date(+m.timestamp * 1000).toISOString?.() || undefined,
            type: m.type,                   // 'text'|'image'|...
            text: m.text?.body ?? m.caption ?? "",
            imageUrl: undefined,            // you’ll map/proxy media later if needed

            // keep the *original* objects alongside:
            __rawMessage: m,
            __rawValue: v,
            __rawBody: req.rawBody,
          };

          // This is where you EMIT the event
          emitInbound(p);
        }
      }
    }
  }

  res.sendStatus(200);
});
