// server/server.js
import 'dotenv/config';
import './utils/consoleLogFilter.js';

import mongoose from 'mongoose';
import cors from 'cors';
import multer from 'multer';
import path from "node:path";
// server/server.js (or your main entry)
import './wa/listeners.js';
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.resolve(__dirname, "..");

import { Product } from './dbFunctionality/schemas/schema.js';
import { registerWaWebhook } from './wa/webhook.js';
import { sendText, sendImage } from '../src/api/index.js';
import { sendTextBack,uploadMediaToWhatsApp, sendImageByMediaId,sendVideoByMediaId, sendDocumentByMediaId } from './wa/send.js';
import { storeSentMessage } from './wa/message-store.js';
import { waEvents, emitInbound } from "./wa/wa-events.js"; 
import { installSse } from './realtime-sse.js';
import { sseHandler, broadcast } from './sse.js';
import { savedRepliesRouter, mountSavedRepliesStatic } from "./routes/saved-replies.js";
import { waWebhook } from "./wa/webhook.js";
import { seenRouter } from "./routes/seen.js";
import {
  mesageSorter,
  normalizeInboundMessage,
  checkMessageAndMatch,
  // exporting these only if you want to reuse or unit test
  actionsCTWA,
  actionsAnyText
} from "./utils/messageSorter.js"
import { savedRepliesControlRouter } from "./saved-replies-control.js";
import { conversationsRouter } from './routes/conversations.js';
import { muletillas  } from "./utils/muletillas.js"
import { programmedMessagesRouter, mountProgrammedMessagesStatic } from "./routes/programmed-messages.js";
import { installConnectionEventLogs, runProgrammedDispatcher } from "./jobs/programmed-dispatcher.js";
import { sendTextViaHttp } from "./http-senders.js";
import { startProgrammedLoop, runProgrammedNow, pmStatus } from "././jobs/pm/scheduler.js"
import "./jobs/cron-jobs.js"
import {
  incServerAttempts,
  incApiAccepted,
  incStatusSent,
  incStatusDelivered,
  incStatusRead,
  incStatusFailed,
  // legacy aliases still exist, but we’ll use the explicit ones here
} from "./metrics/wa-message-counter.js";
import { startOutboxWorker } from "./wa/outbox.js";
import { durationMs, emitObs, nowMs } from "./utils/observability.js";

import http from 'node:http';
// server/server.js
import express from 'express';


const OUR_NUMBER = String(process.env.OUR_NUMBER || process.env.WHATSAPP_SENDER || '').trim();
const DEV_ORIGIN = 'http://localhost:5173';

const app = express();
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ['Content-Type','Authorization'],
    exposedHeaders: ["Content-Length"],
  credentials: false,
  maxAge: 86400, 
}));
app.options(/.*/, cors());
installSse(app);
app.get('/events', sseHandler);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50   * 1024 * 1024 } // 8 MB
});
app.use(seenRouter)





import {     getIdDocument,
    createNewObjectInDatabase,
    initializeObjectInDatabase,
    initializeCostumerAndStoreMessageHistory, normalizeCustomerId,
    updateProductObejctByID,
    updateRemarketingObejctByID,
    updateShippingStatusByID,
    updatepurchaseStateByID,
    checkIfCatalogWasSent } from "./dbFunctionality/functionality.js";




// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────


//Server-side, call GET https://graph.facebook.com/v{version}/{media-id} with your Bearer token → you get JSON containing a url. 
//Then call that url (again with the same Bearer token) to stream the bytes. 
//Note: the url expires in ~5 minutes—fetch a fresh one when you need it

export async function getWhatsappMediaUrl(mediaId, token, version = 'v21.0') {
  const r = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`Graph error ${r.status}: ${await r.text()}`);
  const { url } = await r.json();
  if (!url) throw new Error('No "url" in Graph response');
  return url; // short-lived URL
}


const onlyDigits = (x) => String(x ?? '').replace(/\D/g, '');
const toIso = (t) =>
  /^\d+$/.test(String(t)) ? new Date(Number(t) * 1000).toISOString() : new Date(t || Date.now()).toISOString();

/**
 * Returns an array of simple message objects: { from, to, text, id, ts, type }
 */
function extractSimpleMessages(body) {
  const out = [];

  const safeDigits = (v) => onlyDigits?.(v) ?? String(v ?? '');
  const tsToIso   = (t) => toIso?.(t) ?? new Date(Number(t) * 1000).toISOString();

  // Pick the best text we can infer from the message
  const pickText = (m) =>
    m?.text?.body ??
    m?.image?.caption ??
    m?.video?.caption ??
    m?.document?.caption ??
    m?.interactive?.button_reply?.title ??
    m?.interactive?.list_reply?.title ??
    m?.button?.text ??
    null;

  // Map WhatsApp message types to a uniform "media" block when applicable
  const pickMedia = (m) => {
    const t = m?.type;

    if (t === 'image' && m?.image) {
      return {
        kind: 'image',
        id: m.image.id,
        mimeType: m.image.mime_type,
        sha256: m.image.sha256 ?? null,
        caption: m.image.caption ?? null
      };
    }

    if (t === 'video' && m?.video) {
      return {
        kind: 'video',
        id: m.video.id,
        mimeType: m.video.mime_type,
        sha256: m.video.sha256 ?? null,
        caption: m.video.caption ?? null
      };
    }

    if (t === 'audio' && m?.audio) {
      return {
        kind: 'audio',
        id: m.audio.id,
        mimeType: m.audio.mime_type,
        sha256: m.audio.sha256 ?? null,
        voice: !!m.audio.voice,            // true for PTT/voice notes
        url: m.audio.url ?? null           // 👈 signed URL from Meta
      };
    }

    if (t === 'document' && m?.document) {
      return {
        kind: 'document',
        id: m.document.id,
        mimeType: m.document.mime_type,
        sha256: m.document.sha256 ?? null,
        filename: m.document.filename ?? null,
        caption: m.document.caption ?? null
      };
    }

    if (t === 'sticker' && m?.sticker) {
      return {
        kind: 'sticker',
        id: m.sticker.id,
        mimeType: m.sticker.mime_type,
        sha256: m.sticker.sha256 ?? null,
        animated: !!m.sticker.animated
      };
    }

    return null;
  };

  for (const entry of body?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      const v = ch?.value ?? {};
      const toDisplay = v?.metadata?.display_phone_number ?? null; // your business number (E.164)
      const toPhoneId = v?.metadata?.phone_number_id ?? null;      // your business phone_number_id
      const to = safeDigits(toDisplay) || toPhoneId || null;

      for (const m of v?.messages ?? []) {
        const type = m?.type || 'text';

        const contextMessageId = m?.context?.id || null;
        const referral = m?.referral || m?.context?.referral || null;
        const referralSource = String(referral?.source ?? referral?.source_type ?? "").toLowerCase();
        const hasAdReferralHints = !!(
          referral && (
            referral?.ad_id ||
            referral?.source_id ||
            referral?.source_url ||
            referral?.ctwa_clid ||
            referral?.headline ||
            referral?.body ||
            referral?.title ||
            referral?.description ||
            referral?.image_url ||
            referral?.video_url ||
            referral?.thumbnail_url
          )
        );
        const isCtwa = referralSource === "ads" || referralSource === "ad" || hasAdReferralHints;
        const mediaUrl =
          referral?.image_url ||
          referral?.video_url ||
          referral?.thumbnail_url ||
          referral?.media_url ||
          referral?.source_url ||
          null;

        const ctwaAdId = referral?.ad_id ?? referral?.source_id ?? null;
        const ctwaText =
          referral?.body ??
          referral?.description ??
          referral?.headline ??
          referral?.title ??
          pickText(m);

        if (isCtwa) {
          console.log("[WA][CTWA][TEXT]", {
            wamid: m?.id ?? null,
            from: safeDigits(m?.from),
            to,
            ad_id: ctwaAdId,
            text: ctwaText ?? null,
          });
        }

        const normalized = {
          from: safeDigits(m?.from),     // customer number (digits)
          to,                            // your biz number (digits) or phone_number_id
          id: m?.id ?? null,             // wamid
          ts: tsToIso(m?.timestamp),     // ISO string
          type: isCtwa ? "ctwa_referral" : type, // preserve CTWA as structured message
          text: pickText(m),             // best-effort textual content
          contextMessageId,
          replyToId: contextMessageId,
          context: contextMessageId ? { id: contextMessageId } : undefined,
          referral_type: isCtwa ? "ads" : null,
          referral_metadata: isCtwa
            ? {
                ad_id: referral?.ad_id ?? referral?.source_id ?? null,
                ad_name: referral?.ad_name ?? referral?.source_url ?? null,
                adset_id: referral?.adset_id ?? null,
                campaign_id: referral?.campaign_id ?? null,
                headline: referral?.headline ?? referral?.title ?? null,
                body: referral?.body ?? referral?.description ?? null,
                source: referral?.source ?? referral?.source_type ?? null,
                media_url: mediaUrl,
                image_url: referral?.image_url ?? referral?.thumbnail_url ?? null,
                video_url: referral?.video_url ?? null,
                source_url: referral?.source_url ?? null,
                source_id: referral?.source_id ?? null,
                ctwa_clid: referral?.ctwa_clid ?? null,
                type: referral?.type ?? null,
              }
            : null,
        };

        // Attach media block if applicable
        const media = pickMedia(m);
        if (media) normalized.media = media;

        // Optional: capture location payloads
        if (type === 'location' && m?.location) {
          normalized.location = {
            latitude:  Number(m.location.latitude),
            longitude: Number(m.location.longitude),
            name: m.location.name ?? null,
            address: m.location.address ?? null
          };
        }

        // Optional: contacts payloads (first contact only for simplicity)
        if (type === 'contacts' && Array.isArray(m?.contacts) && m.contacts.length) {
          const c = m.contacts[0];
          normalized.contact = {
            name: {
              formatted_name: c?.name?.formatted_name ?? null,
              first_name: c?.name?.first_name ?? null,
              last_name: c?.name?.last_name ?? null
            },
            wa_id: c?.wa_id ?? null,
            phones: (c?.phones ?? []).map(p => ({ wa_id: p.wa_id ?? null, type: p.type ?? null })),
            emails: (c?.emails ?? []).map(e => ({ email: e.email ?? null, type: e.type ?? null })),
          };
        }

        out.push(normalized);
      }
    }
  }

  return out;
}


// ───────────────────────────────────────────────────────────────
// Failed WA status → file logger
// ───────────────────────────────────────────────────────────────

const FAILED_LOG_DIR = path.resolve(
  process.cwd(),
  "failedMessagesSent",
  "failedLogs"
);

// ensure directory exists
function ensureFailedLogDir() {
  try {
    if (!fs.existsSync(FAILED_LOG_DIR)) {
      fs.mkdirSync(FAILED_LOG_DIR, { recursive: true });
    }
  } catch (err) {
    // last-resort: log to console if we can't create dir
    console.error("💥 Failed to create FAILED_LOG_DIR:", FAILED_LOG_DIR, err);
  }
}

function appendFailedStatusLog(st = {}) {
  ensureFailedLogDir();

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // "2025-12-05"
  const fileName = `wa-failed-${dateStr}.log`;
  const filePath = path.join(FAILED_LOG_DIR, fileName);

  const raw = st.raw || {};
  const errors = raw.errors || raw.error || null;

  const record = {
    ts: now.toISOString(),
    wamid: st.id || null,
    status: st.status || null,
    recipientId: st.recipientId || null,
    timestamp: st.timestamp || null,
    conversation: st.conversation || null,
    pricing: st.pricing || null,
    errors: Array.isArray(errors)
      ? errors.map(e => ({
          code: e.code ?? null,
          title: e.title ?? null,
          message: e.message ?? null,
          error_data: e.error_data ?? null,
        }))
      : errors,
    raw,
  };

  const line = JSON.stringify(record) + "\n";

  // append asynchronously, don't block the request
  fs.appendFile(filePath, line, (err) => {
    if (err) {
      // if writing fails, fallback to console so you don't lose info
      console.error("💥 Failed to append failed WA status log:", err);
      console.error("Failed record:", record);
    }
  });
}



app.post('/dev/emit/inbound', (req, res) => {
  const { from = '51915999999', to = '51908008097', text = 'dev ping' } = req.body || {};

  waEvents.emit('inbound', { from, to, text, ts: Date.now() });
  res.json({ ok: true });
});

function normalizePeruNumber(jidOrPhone) {
  if (!jidOrPhone) return null;
  if (jidOrPhone === 'status@broadcast') return null;
  let s = String(jidOrPhone).replace(/@c\.us$/i, '');
  s = s.replace(/\D/g, '');
  if (s.startsWith('51')) s = s.slice(2);
  if (s.length !== 9) return null;
  return `${s.slice(0,3)} ${s.slice(3,6)} ${s.slice(6)}`; // XXX XXX XXX
}

// Prefer raw id from these fields
function getCustomerIdRaw(product) {
  return (
    product?.customer_id ??
    product?.customerPhone ??
    product?.phone ??
    null
  );
}

// Build UI messages with correct "from" tag
function pickText(type, m) {
  const msg = m?.message ?? m?.text ?? m?.content ?? "";
  const cap = m?.caption ?? "";

  if (type === "text") return String(msg || "");              // ✅ text should come from message
  return String(cap || msg || "");                            // ✅ media can use caption first
}

// Build UI messages with correct "from" tag
function buildMessagesFromProduct(product) {
  if (!product) return [];

  const chatId = String(product._id);

  const toIsoTs = (ts) => {
    if (!ts) return new Date().toISOString();
    const d = ts instanceof Date ? ts : new Date(ts);
    return d.toISOString();
  };

const buildMediaUrl = (m) => {
  const id = m?.mediaId || m?.media?.id;
  if (id) return `/api/media/${id}`;  // ✅ always
  return null;
};


  // ---------- INBOUND ----------
  const inbound = (product.customer_messages || []).map((m, i) => {
    const type = (m?.type || "text").toLowerCase();
    const text = pickText(type, m);

    let imageUrl = null, videoUrl = null, audioUrl = null, fileUrl = null, location = null, locationUrl = null;

    if (type === "audio") {
      audioUrl = buildMediaUrl(m);
    } else if (type === "location") {
      const loc = m?.location || m?.media?.location;
      if (loc) {
        const lat = Number(loc.latitude);
        const lng = Number(loc.longitude);
        location = { latitude: lat, longitude: lng, name: loc.name ?? null, address: loc.address ?? null };
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) locationUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      }
    } else {
      const mediaUrl = buildMediaUrl(m);
      if (type === "image") imageUrl = mediaUrl;
      if (type === "video") videoUrl = mediaUrl;
      if (type === "document" || type === "file") fileUrl = mediaUrl;
    }

    const stableId = m?.id || `${chatId}-c${i}`;
    return {
      id: stableId,
      waId: typeof m?.id === "string" && m.id.startsWith("wamid.") ? m.id : null,
      chatId,
      from: "them",
      dir: "in",
      type,
      text,
      imageUrl,
      videoUrl,
      audioUrl,
      fileUrl,
      fileName: m?.media?.filename || m?.fileName || undefined,
      location,
      locationUrl,
      mediaId: m?.mediaId || m?.media?.id || null,
      referral_type: m?.referral_type || null,
      referral_metadata: m?.referral_metadata || null,
      contextMessageId: m?.contextMessageId || null,
      replyToId: m?.replyToId || m?.contextMessageId || null,
      timestamp: toIsoTs(m?.timestamp),
      status: "delivered",
    };
  });

  // ---------- OUTBOUND ----------
  const outboundRaw = product.state?.[0]?.messagesSentCollection || [];
  const outbound = outboundRaw.map((m, i) => {
    const type = (m?.type || "text").toLowerCase();
    const text = pickText(type, m);                           // ✅ same fix here

    let imageUrl = null, videoUrl = null, audioUrl = null, fileUrl = null, location = null, locationUrl = null;

    if (type === "audio") {
      audioUrl = buildMediaUrl(m);
    } else if (type === "location") {
      const loc = m?.location || m?.media?.location;
      if (loc) {
        const lat = Number(loc.latitude);
        const lng = Number(loc.longitude);
        location = { latitude: lat, longitude: lng, name: loc.name ?? null, address: loc.address ?? null };
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) locationUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      }
    } else {
      const mediaUrl = buildMediaUrl(m);
      if (type === "image") imageUrl = mediaUrl;
      if (type === "video") videoUrl = mediaUrl;
      if (type === "document" || type === "file") fileUrl = mediaUrl;
    }

    const stableId = m?.id || `${chatId}-s${i}`;
    return {
      id: stableId,
      waId: typeof m?.id === "string" && m.id.startsWith("wamid.") ? m.id : null,
      chatId,
      from: "me",
      dir: "out",
      type,
      text,
      imageUrl,
      videoUrl,
      audioUrl,
      fileUrl,
      fileName: m?.media?.filename || m?.fileName || undefined,
      location,
      locationUrl,
      mediaId: m?.mediaId || m?.media?.id || null,
      referral_type: m?.referral_type || null,
      referral_metadata: m?.referral_metadata || null,
      contextMessageId: m?.contextMessageId || null,
      replyToId: m?.replyToId || m?.contextMessageId || null,
      timestamp: toIsoTs(m?.timestamp),
      status: m?.status || "sent",
    };
  });

  const all = [...inbound, ...outbound];
  all.sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0));
  return all;
}






function summarizeConversation(product) {
  const chatId = String(product._id);
  const customerIdRaw = getCustomerIdRaw(product);
  const pretty = normalizePeruNumber(customerIdRaw);

  const messages = buildMessagesFromProduct(product);
  const last = messages[messages.length - 1] || null;

  return {
    id: chatId,
    customerIdRaw: customerIdRaw || null,
    customerId: pretty || null,
    displayName: pretty || customerIdRaw || chatId,
    lastMessage: last?.text ?? '-',
    lastTimestamp: last?.timestamp ?? null,
    unread: 0,
  };
}

// For Socket.IO bridge


// Resolve/create conversation and return _id
async function resolveConversationId({ from, to }) {
  const doc = await Product.findOneAndUpdate(
    { customer_id: String(from) },
    {
      $setOnInsert: { createdAt: new Date(), customer_id: String(from) },
      $set: { latestSeller: String(to) },
    },
    { upsert: true, new: true }
  );
  return String(doc._id);
}

function makeMsg({ who, text, imageUrl, ts }) {
  return {
    id: `srv_${Date.now().toString(36)}`,
    from: who,
    type: imageUrl ? 'image' : 'text',
    text: imageUrl ? null : (text ?? null),
    imageUrl: imageUrl ?? null,
    timestamp: new Date(ts || Date.now()).toISOString(),
  };
}
function getInboundText(payload) {
  const msgs = payload?.entry?.[0]?.changes?.[0]?.value?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return null;

  const m = msgs[0]; // or loop if you expect multiple
  if (m.type === 'text' && m.text?.body) return m.text.body;
  return null; // handle other types (image/video/interactive) if needed
}
// ───────────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────────
// give this process a visible ID
const SERVER_ID = `srv:${process.pid}:${Math.random().toString(36).slice(2,6)}`;
console.log('🟢 BOOT', SERVER_ID);

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const WA_DEBUG = String(process.env.WA_DEBUG ?? "0") === "1";

// 1) VERIFICACIÓN (GET)
app.get("/wa/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    // ✔️ responder SOLO el challenge con 200
    return res.status(200).send(challenge);
  }
  // ❌ token incorrecto
  return res.sendStatus(403);
});

// 2) RECEPCIÓN DE MENSAJES (POST)
app.post(
  "/wa/webhook",
  express.raw({ type: "*/*", limit: "5mb" }),
  (req, res) => {
    // ✅ ACK FAST (Meta no reintenta)
    res.sendStatus(200);

    // Convert body -> string fast
    const rawBuf = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || "");
    const rawStr = rawBuf.toString("utf8");

    // ✅ Do the heavy work off the request stack
    setImmediate(() => {
      // Parse JSON
      let body = null;
      try {
        body = rawStr ? JSON.parse(rawStr) : null;
      } catch {
        body = null;
      }

      // Ignore non-WhatsApp events
      if (body?.object !== "whatsapp_business_account") return;

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value || {};

      // (Optional) debug log for incoming audio messages (gated)
      if (WA_DEBUG) {
        const messages = value.messages || [];
        for (const msg of messages) {
          if (msg?.type === "audio") {
            console.log("[WA][AUDIO] Incoming audio:", {
              wamid: msg.id,
              from: msg.from,
              to:
                value.metadata?.display_phone_number ||
                value.metadata?.phone_number_id ||
                "(unknown)",
              mediaId: msg.audio?.id,
              mimeType: msg.audio?.mime_type,
              url: msg.audio?.url,
              voice: msg.audio?.voice,
            });
          }
        }
      }

      // Emit statuses (still keep them off the stack)
      const statuses = value.statuses || [];
      for (const st of statuses) {
        setImmediate(() => {
          try {
            waEvents.emit("status", {
              id: st.id,
              status: st.status,
              timestamp: st.timestamp,
              recipientId: st.recipient_id,
              conversation: st.conversation || null,
              pricing: st.pricing || null,
              raw: st,
            });
          } catch (e) {
            console.error("[WA][STATUS][emit-error]", e);
          }
        });
      }

      // Convert WhatsApp payload -> your internal simplified "message" objects
      const msgs = extractSimpleMessages(body); // [{ from, to, text, id, ts, type, ... }, ...]

      // Emit inbound messages via wrapper (now async emit inside wa-events.js)
      for (const m of msgs) {
        emitInbound(m); // ✅ instead of waEvents.emit("inbound", m)
      }
    });
  }
);


// global tracer (runs for every request)


const httpServer = http.createServer(app);

app.use((req, res, next) => {

  next();
});







// GET /api/conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const seller = OUR_NUMBER;

    if (!seller) {
      return res.status(500).json({ ok: false, error: 'OUR_NUMBER is not configured' });
    }

    const limit = Math.min(
      parseInt(req.query.limit ?? '700', 10) || 700,
      700
    );

    const docs = await Product.find(
      { latestSeller: seller },
      {
        customer_id: 1,
        latestSeller: 1,
        unreadCount: 1,
        lastMsgSeq: 1,
        lastReadSeq: 1,
        lastInboundTs: 1,
        updatedAt: 1,
        customer_messages: { $slice: -1 },
      }
    )
      .sort({ lastInboundTs: -1, updatedAt: -1, _id: -1 }) // sort in Mongo
      .limit(limit)
      .lean();

    const convs = docs
      .map(doc => {
        const s = summarizeConversation(doc);

        const unread = Number.isFinite(doc.unreadCount)
          ? Math.max(doc.unreadCount, 0)
          : Math.max((doc.lastMsgSeq || 0) - (doc.lastReadSeq || 0), 0);

        const lastTs =
          doc.lastInboundTs ||
          s.lastTimestamp ||
          doc.updatedAt ||
          0;

        return {
          ...s,
          unread,
          lastTimestamp: lastTs,
        };
      })
      .sort((a, b) => {
        const ta = a.lastTimestamp
          ? (a.lastTimestamp instanceof Date
              ? a.lastTimestamp.getTime()
              : Date.parse(a.lastTimestamp) || Number(a.lastTimestamp) || 0)
          : 0;
        const tb = b.lastTimestamp
          ? (b.lastTimestamp instanceof Date
              ? b.lastTimestamp.getTime()
              : Date.parse(b.lastTimestamp) || Number(b.lastTimestamp) || 0)
          : 0;
        return tb - ta;
      });

    res.json({ ok: true, data: convs });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to build conversations' });
  }
});

app.get('/api/conversations/search', async (req, res) => {
  try {
    const seller = OUR_NUMBER;

    if (!seller) {
      return res.status(500).json({ ok: false, error: 'OUR_NUMBER is not configured' });
    }
    const rawQ = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);

    if (!rawQ || rawQ.length < 3) {
      return res.json({ ok: true, data: [] });
    }

    const qDigits = rawQ.replace(/[^\d]/g, '');
    if (!qDigits) {
      return res.json({ ok: true, data: [] });
    }
console.log("[SEARCH][BE] query", { seller, q: rawQ, qDigits, limit });
    const docs = await Product.find(
      {
        latestSeller: seller,
        customer_id: new RegExp('^51' + qDigits),

      },
      {
        customer_id: 1,
        latestSeller: 1,
        unreadCount: 1,
        lastMsgSeq: 1,
        lastReadSeq: 1,
        lastInboundTs: 1,
        updatedAt: 1,
        customer_messages: { $slice: -1 },
      }
    )
      .sort({ lastInboundTs: -1, updatedAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    const convs = docs
      .map(doc => {
        const s = summarizeConversation(doc);

        const unread = Number.isFinite(doc.unreadCount)
          ? Math.max(doc.unreadCount, 0)
          : Math.max((doc.lastMsgSeq || 0) - (doc.lastReadSeq || 0), 0);

        const lastTs =
          doc.lastInboundTs ||
          s.lastTimestamp ||
          doc.updatedAt ||
          0;

        return {
          ...s,
          unread,
          lastTimestamp: lastTs,
        };
      })
      .sort((a, b) => {
        const ta = a.lastTimestamp
          ? (a.lastTimestamp instanceof Date
              ? a.lastTimestamp.getTime()
              : Date.parse(a.lastTimestamp) || Number(a.lastTimestamp) || 0)
          : 0;
        const tb = b.lastTimestamp
          ? (b.lastTimestamp instanceof Date
              ? b.lastTimestamp.getTime()
              : Date.parse(b.lastTimestamp) || Number(b.lastTimestamp) || 0)
          : 0;
        return tb - ta;
      });

    res.json({ ok: true, data: convs });
  } catch (err) {
    console.error('[GET /api/conversations/search] error:', err);
    res.status(500).json({ ok: false, error: 'Failed to search conversations' });
  }
});




function getImageMessagesWithUrl(doc) {
  const base = "http://localhost:3050/api/media/";

  const images = (doc?.state ?? [])
    .flatMap(s => s?.messagesSentCollection ?? [])
    .filter(m => m?.type === "image")
    .map(m => ({
      ...m,
      mediaUrl: m?.mediaId ? base + String(m.mediaId) : null
    }));

  return images;
}
// Messages for a conversation (query param: ?conversationId=...)
app.get("/api/messages", async (req, res) => {
  try {
    const conversationId = String(
      req.query.conversationId || req.query.chatId || ""
    ).trim();

    if (!conversationId) {
      return res
        .status(400)
        .json({ ok: false, error: "conversationId required" });
    }

    // Query params
    const full  = String(req.query.full || "") === "1";
    const limit = Math.min(parseInt(req.query.limit ?? "200", 10) || 200, 300);
    const since = Number(req.query.sinceSeq || 0); // load *newer than* this seq

    // ---------------- Load doc (tolerate phone ids) ----------------
    let product = null;

    if (mongoose.isValidObjectId(conversationId)) {
      // Normal case: conversationId is a Mongo _id
      product = await Product.findById(conversationId).lean();
    } else {
      // conversationId looks like a phone (e.g. "51957317851")
      // try to resolve by customer_id (ajusta el campo si tu schema usa otro nombre)
      product = await Product.findOne({ customer_id: conversationId }).lean();

      if (!product) {
        console.warn(
          "[API/messages] non-ObjectId conversationId, no product found. Returning empty history:",
          conversationId
        );
        return res.json({
          ok: true,
          data: [],
          stats: { total: 0, minSeq: 0, maxSeq: 0, returned: 0 },
        });
      }
    }

    if (!product) {
      return res.json({
        ok: true,
        data: [],
        stats: { total: 0, minSeq: 0, maxSeq: 0, returned: 0 },
      });
    }
    // ---------------------------------------------------------------

    // Build + normalize items
    const allRaw = buildMessagesFromProduct(product) || []; // [{id, chatId, from, type, text, imageUrl, videoUrl, timestamp, ...}]

    const audioMsgs = (allRaw || []).filter(m => m.type === "audio");
if (audioMsgs.length) {
  console.log("[API/messages] audio messages found:", audioMsgs.map(a => ({
    id: a.id,
    ts: a.timestamp,
    mediaId: a.mediaId,
    audioUrl: a.audioUrl,
  })));
} else {
  console.log("[API/messages] no audio messages in history for", conversationId);
}


    // Stable sort by timestamp then by id for tie-break
    const allSorted = allRaw.slice().sort((a, b) => {
      const ta = Number(new Date(a.timestamp || 0));
      const tb = Number(new Date(b.timestamp || 0));
      if (ta !== tb) return ta - tb;
      const ia = String(a.id || "");
      const ib = String(b.id || "");
      return ia.localeCompare(ib);
    });

    // Ensure chatId and seq exist (seq = 1..N)
    const all = allSorted.map((m, idx) => ({
      chatId: conversationId,
      seq: typeof m.seq === "number" ? m.seq : idx + 1,
      ...m,
    }));

    const total  = all.length;
    const minSeq = total ? Number(all[0].seq) : 0;
    const maxSeq = total ? Number(all[total - 1].seq) : 0;

    // Select items
    let items;
    if (full) {
      items = all;
    } else if (since > 0) {
      // incremental: only newer than since
      items = all.filter((m) => Number(m.seq) > since);
    } else {
      // first load: return last `limit` by COUNT (never by date)
      items = all.slice(-limit);
    }

    res.json({
      ok: true,
      data: items,
      stats: { total, minSeq, maxSeq, returned: items.length },
    });
  } catch (err) {
    console.error("[API/messages][ERROR]", err);
    res.status(500).json({ ok: false, error: "Failed to build messages" });
  }
});


  // ⬆️ justo después de `const app = express();`
  app.use(express.json({ limit: '2mb' }));               // <- parsea JSON
  app.use(express.urlencoded({ extended: true }));       // <- por si mandas form data

import { createMediaProxyRouter } from './wa/media-proxy.js';

app.use('/api/media', createMediaProxyRouter({
  token: process.env.WHATSAPP_TOKEN
}));
console.log('✅ Media proxy mounted at /api/media/:id');


// Send text (single, canonical endpoint)
import { enqueueText } from "./wa/outbox.js";


import { storeQueuedText } from "./wa/outbox-store.js";

app.post("/api/send-text", async (req, res) => {
  const reqStartedAt = nowMs();
  try {
    const { to, text, contextMessageId } = req.body || {};

    if (!to || !text || !String(text).trim()) {
      return res.status(400).json({ ok: false, error: 'Missing "to" or "text"' });
    }

    const cleanText = String(text).trim();

    // Only allow real WhatsApp ids
    const ctx =
      typeof contextMessageId === "string" && contextMessageId.startsWith("wamid.")
        ? contextMessageId
        : null;

    // 🔢 attempt (now means "queued")
    incServerAttempts();

    // 1) enqueue (store ctx in outbox)
    const enqueueStartedAt = nowMs();
    const doc = await enqueueText({ to, text: cleanText, contextMessageId: ctx });
    const enqueueMs = durationMs(enqueueStartedAt);
    const outboxId = String(doc._id);
    emitObs("outbox.enqueue.created", {
      outboxId,
      to,
      kind: "text",
      contextMessageId: ctx,
      enqueueMs,
      requestToEnqueueMs: durationMs(reqStartedAt),
      source: "api.send-text",
    });

    // 2) store queued placeholder in DB (store ctx there too)
    const dbPlaceholderStartedAt = nowMs();
    const tempId = await storeQueuedText({ to, text: cleanText, outboxId, contextMessageId: ctx });
    const dbPlaceholderMs = durationMs(dbPlaceholderStartedAt);
    emitObs("outbox.enqueue.placeholder_stored", {
      outboxId,
      tempId,
      to,
      kind: "text",
      contextMessageId: ctx,
      dbPlaceholderMs,
      totalEnqueuePathMs: durationMs(reqStartedAt),
      source: "api.send-text",
    });

    return res.json({
      ok: true,
      queued: true,
      outboxId,
      id: tempId,
      contextMessageId: ctx, // useful for debugging
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    emitObs("outbox.enqueue.error", {
      to: req.body?.to || null,
      kind: "text",
      totalEnqueuePathMs: durationMs(reqStartedAt),
      error: String(err?.message || err),
      source: "api.send-text",
    });
    console.error("❌ /api/send-text error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});





// server/server.js

// Place this BEFORE your savedRepliesRouter mounts
// Place this BEFORE savedRepliesRouter mounts


app.use("/api/saved-replies", (req, res, next) => {
  // Debug what's actually arriving

  // Capture recipient early (safe for multipart)
  res.locals.srTo =
    req.query.to ||
    req.get("x-sr-to") ||
    req.get("x-recipient") ||
    req.body?.to ||
    null;

  const t0 = Date.now();


  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = (body) => {
    try {
      const to   = res.locals.srTo || body?.to || body?.meta?.to || "-";
      const misc = body?.meta?.misc ?? body?.misc;
      const id   = body?.id || body?.meta?.id || "?";
      const ttl  = body?.meta?.title || "-";
      const use  = body?.usageCount ?? body?.meta?.usageCount ?? null;

      // Fire-and-forget DB side-effects (don’t block the response)
      if (misc?.d === true && to && ttl) {
        (async () => {
          try {
            await updateProductObejctByID(
              to,     // customerIdRaw
              ttl,    // product_info_requested
              "89",   // PRODUCT_VALUE_DEFAULT
              "1",    // SHIPPING_INFO_DEFAULT
              0       // QUANTITY_DEFAULT
            );

          } catch (err) {
            console.warn("[SR][DB] updateProductObejctByID failed:", err?.message || err);
          }
        })();
      }

      if (misc?.f === true && to) {
        (async () => {
          try {
            await updateShippingStatusByID(
              to,   // costumerIdRaw
              "14"  // SHIPPING_VALUE_DEFAULT
            );

          } catch (err) {
            console.warn("[SR][DB] updateShippingStatusByID failed:", err?.message || err);
          }
        })();
      }

    } catch (e) {
      console.warn("[SR][RESP][json] log error:", e?.message || e);
    }

    return originalJson(body);
  };

  res.send = (payload) => {
    try {
      const to = res.locals.srTo || "-";
      const preview = Buffer.isBuffer(payload)
        ? `<Buffer ${payload.length} bytes>`
        : (typeof payload === "string" && payload.length > 500
            ? payload.slice(0, 500) + "…"
            : payload);
    } catch (e) {
      console.warn("[SR][RESP][send] log error:", e?.message || e);
    }

    return originalSend(payload);
  };

  res.on("finish", () => {
  });

  next();
});



app.get("/api/product-tags", async (req, res) => {
  try {
    const docs = await Product.find({}, { "state.productObject.product_info_requested": 1, costumer_profile: 1 }).lean();
    const tags = new Set();
    for (const doc of docs) {
      for (const state of doc.state || []) {
        for (const item of state.productObject || []) {
          if (item?.product_info_requested) tags.add(String(item.product_info_requested).trim());
        }
      }
      for (const profile of doc.costumer_profile || []) {
        if (profile?.productOfInterest) tags.add(String(profile.productOfInterest).trim());
      }
    }
    const items = [...tags]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ value: tag, label: tag.replace(/[_-]+/g, " ") }));
    res.json({ items });
  } catch (err) {
    console.error("[API/product-tags] failed:", err);
    res.status(500).json({ error: "product_tags_failed" });
  }
});

mountProgrammedMessagesStatic(app); // serves /programmedmsgs/** files
app.use("/api/programmed-messages", programmedMessagesRouter);

app.use("/api/saved-replies", savedRepliesRouter);
app.use("/api/saved-replies", savedRepliesControlRouter);


mountSavedRepliesStatic(app); // serves /savedreplys/<id>/<file>


app.post("/api/send-image", upload.single("file"), async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim();
    const caption = String(req.body?.caption || "");
    const file = req.file;

    if (!to) return res.status(400).json({ ok: false, error: 'Missing "to"' });
    if (!file?.buffer?.length)
      return res.status(400).json({ ok: false, error: 'Missing "file"' });

    const mime = (file.mimetype || "").toLowerCase();
    const forcedKind = (req.body?.kind || "").toLowerCase(); // optional: "image" | "video" | "document"
    const isVideo = forcedKind ? forcedKind === "video" : mime.startsWith("video/");
    const isDocument = forcedKind
      ? forcedKind === "document"
      : mime === "application/pdf" || mime.startsWith("application/");

    const IMAGE_OK = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const VIDEO_OK = ["video/mp4", "video/3gpp", "video/quicktime"];
    const DOCUMENT_OK = ["application/pdf"];

    if (!isVideo && !isDocument && !IMAGE_OK.includes(mime)) {
      return res.status(415).json({ ok: false, error: `Unsupported image type: ${mime}` });
    }
    if (isVideo && !VIDEO_OK.includes(mime)) {
      return res.status(415).json({ ok: false, error: `Unsupported video type: ${mime}` });
    }
    if (isDocument && !DOCUMENT_OK.includes(mime)) {
      return res.status(415).json({ ok: false, error: `Unsupported document type: ${mime}` });
    }

    const mediaId = await uploadMediaToWhatsApp({
      buffer: file.buffer,
      filename: file.originalname || (isVideo ? "upload.mp4" : isDocument ? "upload.pdf" : "upload.jpg"),
      mimetype: mime,
    });

    // 🔢 1) attempt
    incServerAttempts();

    const wamid = isVideo
      ? await sendVideoByMediaId(to, mediaId, caption)
      : isDocument
      ? await sendDocumentByMediaId(to, mediaId, file.originalname || "document.pdf", caption)
      : await sendImageByMediaId(to, mediaId, caption);

    // 🔢 2) accepted
    if (wamid) incApiAccepted();

    const ts = new Date().toISOString();

    // ✅ DB/STORAGE payload (this is what your waEvents.on('outbound') expects)
const dbPayload = {
  id: wamid,
  from: OUR_NUMBER,
  to,
  type: isVideo ? "video" : isDocument ? "document" : "image",
  mediaId,
  mimeType: mime,
  message: caption || "",
  caption: caption || "",
  timestamp: ts,
  dir: "out",

  // ✅ keep it consistent with inbound
  media: { id: mediaId, mimeType: mime, timestamp: ts },
};


    // Persist in your history (DB only)
    await initializeCostumerAndStoreMessageHistory(dbPayload, 0);


    return res.json({ ok: true, id: wamid, mediaId, kind: isVideo ? "video" : isDocument ? "document" : "image" });
  } catch (err) {
    console.error("❌ /api/send-media error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});







app.get('/events', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || 'http://localhost:5173');
  res.setHeader('Vary', 'Origin'); // important when origin is dynamic
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // If you use compression middleware, disable it for this route.
  // (compression breaks SSE in some browsers)
  // e.g., if using `compression()`, mount it AFTER this route or skip it here.

  res.flushHeaders?.();           // send headers immediately if available

  const ping = setInterval(() => res.write(':keep-alive\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); });
});


// Adapter: dispatcher wants (to, text, sellerId)
export async function sendTextAdapter(to, text, sellerId) {
  // If your /api/send-text supports 'from', pass sellerId as 'from'se
  return await sendTextViaHttp(to, String(text || ""), sellerId);
}

export async function sendMediaAdapter(to, fileInfo = {}, sellerId) {
  const url = String(fileInfo.url || "");
  if (!url) throw new Error("Missing media URL");
  let contentType = "";
  let buffer = null;

  const mediaPathname = (() => {
    try { return new URL(url).pathname; }
    catch { return url; }
  })();
  if (mediaPathname.startsWith("/programmedmsgs/")) {
    const mediaRoot = path.resolve(process.cwd(), "programmedmsgs");
    const relPath = decodeURIComponent(mediaPathname.replace(/^\/programmedmsgs\/?/, ""));
    const localPath = path.resolve(mediaRoot, relPath);
    if (localPath.startsWith(`${mediaRoot}${path.sep}`) || localPath === mediaRoot) {
      try {
        buffer = await fs.promises.readFile(localPath);
      } catch {
        buffer = null;
      }
    }
  }

  if (!buffer) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Media fetch failed: ${resp.status} ${url}`);
    contentType = resp.headers.get("content-type") || "";
    buffer = Buffer.from(await resp.arrayBuffer());
  }

  const mime = String(fileInfo.mime || contentType || "application/octet-stream").split(";")[0];
  const extByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/3gpp": ".3gp",
    "application/pdf": ".pdf",
  };
  const urlName = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "");
  const baseName = String(fileInfo.name || urlName || "programmed-media");
  const filename = path.extname(baseName)
    ? baseName
    : `${baseName}${extByMime[mime] || ""}`;
  const mediaId = await uploadMediaToWhatsApp({ buffer, mimeType: mime, filename });

  const caption = String(fileInfo.caption || "");
  const type = mime.startsWith("video/")
    ? "video"
    : mime.startsWith("image/")
    ? "image"
    : "document";

  const wamid = type === "video"
    ? await sendVideoByMediaId(to, mediaId, caption)
    : type === "image"
    ? await sendImageByMediaId(to, mediaId, caption)
    : await sendDocumentByMediaId(to, mediaId, filename, caption);

  const ts = new Date().toISOString();
  const dbPayload = {
    id: wamid,
    from: sellerId || OUR_NUMBER,
    to,
    type,
    mediaId,
    mimeType: mime,
    message: caption,
    caption,
    timestamp: ts,
    dir: "out",
    media: { id: mediaId, mimeType: mime, timestamp: ts },
  };

  await initializeCostumerAndStoreMessageHistory(dbPayload, 0);

  const chatDoc = await Product.findOne({ customer_id: normalizeCustomerId(to) }, { _id: 1 }).lean();
  broadcast("outbound_ui", {
    id: wamid,
    chatId: chatDoc?._id ? String(chatDoc._id) : null,
    from: "me",
    dir: "out",
    type,
    text: caption,
    imageUrl: type === "image" ? `/api/media/${mediaId}` : undefined,
    videoUrl: type === "video" ? `/api/media/${mediaId}` : undefined,
    mediaId,
    timestamp: ts,
    status: "sent",
    to,
    fromPhone: sellerId || OUR_NUMBER,
  });

  return { ok: true, id: wamid, wamid, mediaId, kind: type };
}

// Avoid overlapping runs
let pmRunning = false;
async function pmTick({ force = false } = {}) {
  if (pmRunning) return;
  pmRunning = true;
  try {
    await runProgrammedDispatcher({
      force,
      sendText: sendTextAdapter,
      sendMedia: sendMediaAdapter,
      // ⚠️ DO NOT pass onMessageSent — /api/send-text already stores the message
      verbose: true,
    });
  } finally {
    pmRunning = false;
  }
}



app.get("/admin/pm/status", (req, res) => {
  res.json({
    ...pmStatus,
    uptimeSec: Math.floor(process.uptime()),
    pid: process.pid,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});


app.get("/admin/pm/pending", async (req, res) => {
  const pending = await ProgrammedQueue.find({ state_id: 1, sent: false })
    .select("programId customer_id sellerId created_at")
    .limit(50)
    .lean();
  res.json({ count: pending.length, pending });
});

// manual trigger (already have)
app.post("/admin/pm/run", async (req, res) => {
  const force = String(req.query.force || "").toLowerCase() === "true";
  const onlyTaskId = req.query.taskId ? String(req.query.taskId) : null;
  await runProgrammedNow(force, { onlyTaskId });
  res.json({ ok: true, force, onlyTaskId });
});

app.get("/__whoami", (req, res) => {
  res.json({
    pid: process.pid,
    cwd: process.cwd(),
    node: process.version,
    time: new Date().toISOString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    env: process.env.NODE_ENV,
  });
});

// Register the webhook (handles inbound + outbound statuses)
registerWaWebhook(app);


// ───────────────────────────────────────────────────────────────────────────────
// Conections
// ───────────────────────────────────────────────────────────────────────────────




const seenStatusKeys = new Set();


waEvents.on("status", (st = {}) => {
  const id = st.id;
  const status = st.status;

  if (!id || !status) return;

  // dedupe: (messageId + status) only once
  const key = `${id}:${status}`;
  if (seenStatusKeys.has(key)) {
    return;
  }
  seenStatusKeys.add(key);

  // increment the right counter (new explicit names)
  if (status === "sent") {
    incStatusSent();
  } else if (status === "delivered") {
    incStatusDelivered();
  } else if (status === "read") {
    incStatusRead();
  } else if (status === "failed" || status === "undeliverable") {
    // adjust if WA uses slightly different strings
    incStatusFailed();
    appendFailedStatusLog(st);
  }

  // optional log / SSE...
});

waEvents.on("inbound", async (payload = {}) => {

  
  payload.from = normalizeCustomerId(String(payload.from)); // customer
  payload.to   = normalizeCustomerId(String(payload.to));   // your biz number
  await initializeCostumerAndStoreMessageHistory(payload, 1);
  try {
    mesageSorter(payload);
  } catch (err) {
    console.error("mesageSorter error:", err, "for message:", payload);
  }
});



waEvents.on('outbound', async (payload = {}) => {
  try {
    payload.from = OUR_NUMBER;  // our number
    payload.to = normalizeCustomerId(String(payload.to)); // ensure "51" + digits
   


  } catch (err) {
    console.error("[WA OUTBOUND][DB] failed to store outbound message:", err);
  }
});


// ───────────────────────────────────────────────────────────────────────────────
// Start
// ───────────────────────────────────────────────────────────────────────────────


async function start() {
  try {
    // 1) Connect to Mongo
    await mongoose.connect("mongodb://127.0.0.1:27017/whatsAppDB_3", {
      // options are optional in Mongoose 7+, included here if you want:
      // serverSelectionTimeoutMS: 10000,
    });

    // 2) Start HTTP server
    httpServer.listen(3050, () => {
        console.log(`📱 OUR_NUMBER: ${OUR_NUMBER || '(not set)'}`);
  console.log(`🚀 API + Realtime on http://localhost:${3050}`);
  console.log(`🛰️  WA webhook endpoints:
   • GET  http://localhost:${3050}/wa/webhook  (verify)
   • POST http://localhost:${3050}/wa/webhook  (receive)`);
    });
    startProgrammedLoop()
  } catch (err) {
    console.error('💥 Failed to start: Mongo connect error:', err);
    process.exit(1);
  }
}
start()



installConnectionEventLogs();


const w = startOutboxWorker({
  token: process.env.WHATSAPP_TOKEN,
  phoneId: process.env.WHATSAPP_PHONE_ID,
  incApiAccepted,
  storeSentMessage,
  muletillas,
});

console.log("✅ Outbox worker:", w);
