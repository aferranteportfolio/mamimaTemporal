// server/wa/webhook.js
import express from "express";
import { getSentMessage } from "./message-store.js";
import { Product } from "../dbFunctionality/schemas/schema.js";
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

// --- persistence helpers (unchanged) ---
async function saveInboundToMongo({ from, to, text, ts }) {
  const base = { latestSeller: String(to) };
  const update = {
    $setOnInsert: { createdAt: new Date() },
    $set: base,
    $push: { customer_messages: { message: text, timestamp: new Date(ts) } }
  };
  await Product.updateOne({ customer_id: String(from) }, update, { upsert: true });
}

async function saveOutboundToMongo({ from, to, text, ts }) {
  const doc = await Product.findOne({ customer_id: String(to) });
  if (!doc) {
    await Product.create({
      customer_id: String(to),
      latestSeller: String(from),
      state: [{ messagesSentCollection: [{ message: text, timestamp: new Date(ts) }] }]
    });
    L('DB', 'Created new conversation w/ outbound message', { to, from, ts });
    return;
  }
  if (!Array.isArray(doc.state) || !doc.state[0]) {
    doc.state = [{ messagesSentCollection: [] }];
  }
  doc.latestSeller = String(from);
  doc.state[0].messagesSentCollection.push({ message: text, timestamp: new Date(ts) });
  await doc.save();
  L('DB', 'Appended outbound message', { to, from, count: doc.state[0].messagesSentCollection.length });
}

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
              const from = m.from;                      // customer
              const to = ourNumber;                     // our number
              const type = m.type;
              const text = getInboundText(m);
              const ts = toMs(m.timestamp);
              

              L('INBOUND', 'message summary', {
                wamid: m.id, type, from, to, ts, ticks: 'n/a',
                text: text?.slice?.(0, 140) || null
              });

              if (text) {
                // Emit to FE
                waEvents.emit('inbound', {
                  from,
                  to,
                  text,
                  ts,
                  id: m.id,
                  type,
                  // Preserve CTWA/ad metadata so auto-reply matching can
                  // evaluate "responde a anuncios" triggers against ad text.
                  referral: m.referral || null,
                  context: m.context || null,
                  __rawMessage: m,
                });
                L('INBOUND', 'emit inbound', { event: 'inbound', to, from, ts });

                // Persist
                saveInboundToMongo({ from, to, text, ts })
                  .then(() => L('DB', 'inbound saved', { from }))
                  .catch(err => L('DB', 'inbound save error', { error: String(err?.message || err) }));
              } else {
                L('INBOUND', 'no text extracted', { wamid: m.id, type });
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

              if (status === "sent" && text) {
                // only on "sent" do we persist the outbound text
                saveOutboundToMongo({ from: ourNumber, to, text, ts })
                  .then(() => L('DB', 'outbound saved', { to }))
                  .catch(err => L('DB', 'outbound save error', { error: String(err?.message || err) }));
              }
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
