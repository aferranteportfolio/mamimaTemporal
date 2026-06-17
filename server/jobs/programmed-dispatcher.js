// server/jobs/programmed-dispatcher.js
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import tz from "dayjs/plugin/timezone.js";
import "dotenv/config";
import mongoose from "mongoose";
import { Product } from "../dbFunctionality/schemas/schema.js"; // for lastInboundTs checks

dayjs.extend(utc);
dayjs.extend(tz);

// === config ===
const BASE_DIR = path.resolve(process.cwd(), "programmedmsgs");
const DEFAULT_TZ = process.env.APP_TZ || "America/Lima";
const MINUTE_WINDOW = 6;           // kept for reference (shouldRunNow), but no longer used
const SEND_GAP_MS_IMAGE = 1600;
const SEND_GAP_MS_TEXT  = 500;

// === (optional) mongoose connection event logs ===
export function installConnectionEventLogs() {
  const c = mongoose.connection;
  const events = [
    "connecting",
    "connected",
    "open",
    "reconnected",
    "disconnecting",
    "disconnected",
    "close",
    "error",
  ];
  for (const ev of events) c.removeAllListeners(ev);
}

// === queue model ===
const queueSchema = new mongoose.Schema(
  {
    state_id:    Number,
    program_id:  String,
    customer_id: String,
    sellerId:    String,

    // when this row is allowed to be sent
    sendAt:      { type: Date },
    productTags: [String],
    dedupeKey:   String,

    sent:        { type: Boolean, default: false },
    created_at:  { type: Date, default: Date.now },
  },
  { collection: "message_tasks" }
);

export const Queue =
  mongoose.models.ProgrammedQueue || mongoose.model("ProgrammedQueue", queueSchema);

// === helpers ===
async function listPrograms() {
  if (!fssync.existsSync(BASE_DIR)) return [];
  const dirs = await fs.readdir(BASE_DIR, { withFileTypes: true });
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const metaPath = path.join(BASE_DIR, d.name, "meta.json");
    try {
      const raw  = await fs.readFile(metaPath, "utf8");
      const meta = JSON.parse(raw);
      out.push({
        id:  meta.id || d.name,
        dir: path.join(BASE_DIR, d.name),
        meta,
        metaPath,
      });
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

function activeStateFromMisc(misc = {}) {
  if (misc.funnelLevel1) return 1;
  if (misc.funnelLevel2) return 2;
  if (misc.funnelLevel3) return 3;
  if (misc.funnelLevel4) return 4;
  // if you ever add funnelLevel5, map it here
  // if (misc.funnelLevel5) return 5;
  return null;
}

// kept for reference, but NOT used anymore to gate programs
function shouldRunNow(times = [], now = dayjs()) {
  if (!Array.isArray(times) || times.length === 0) return false;
  const localNow = now.tz(DEFAULT_TZ);
  return times.some((hhmm) => {
    const [H, M] = hhmm.split(":").map(Number);
    const target = localNow.clone().hour(H).minute(M).second(0);
    const diff   = Math.abs(localNow.diff(target, "minute"));
    return diff <= MINUTE_WINDOW;
  });
}

const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

async function waitForMongoReady({ verbose = true, timeoutMs = 30000 } = {}) {
  const start = Date.now();
  if (mongoose.connection.readyState === 1) return;
  while (mongoose.connection.readyState !== 1) {
    // 0 = disconnected, 2 = connecting, 3 = disconnecting
    await new Promise((r) => setTimeout(r, 250));
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Mongo not connected after ${timeoutMs}ms (readyState=${mongoose.connection.readyState})`
      );
    }
  }
}

/**
 * sendProgramToRow
 * @param {object} program  { meta, metaPath, state }
 * @param {mongoose.Document} row
 * @param {object} opts
 *  - sendText: async (to, text, sellerId) => wamid | {wamid} | {ok,wamid}
 *  - sendMedia?: async (to, {url,mime,caption}, sellerId) => wamid | {wamid} | {ok,wamid}
 *  - onMessageSent?: ({wamid,to,type,content?,url?})=>void
 *  - verbose?: boolean
 */
async function sendProgramToRow(
  program,
  row,
  { sendText, sendMedia, onMessageSent, verbose = true } = {}
) {
  if (typeof sendText !== "function") {
    throw new Error("sendText function is required");
  }

  const { meta, metaPath } = program;
  const msgs = Array.isArray(meta.messages) ? meta.messages : [];

  for (let i = 0; i < msgs.length; i++) {
    const m     = msgs[i] || {};
    const files = Array.isArray(m.files) ? m.files : [];

    // TEXT
    if ((m.text || "").trim()) {
      const t0       = Date.now();
      const textBody = m.text;

      const r  = await sendText(row.customer_id, textBody, row.sellerId);
      const ms = Date.now() - t0;

      // Normalize return shape
      const wamid =
        (r && (r.wamid || r.id)) || (typeof r === "string" ? r : null);
      const ok = !!wamid;

      if (!ok) throw new Error("text not sent (missing wamid)");

      try {
        onMessageSent?.({
          wamid,
          to: row.customer_id,
          type: "text",
          content: textBody,
          ms,
        });
      } catch {
        // swallow onMessageSent errors
      }

      await sleep(SEND_GAP_MS_TEXT);
    }

    // MEDIA (optional)
    for (const f of files) {
      if (!sendMedia) {
        continue;
      }

      const r = await sendMedia(
        row.customer_id,
        { url: f.url, mime: f.mime, caption: "" },
        row.sellerId
      );
      const wamid =
        (r && (r.wamid || r.id)) || (typeof r === "string" ? r : null);
      const ok = !!wamid;

      if (!ok) throw new Error("media not sent (missing wamid)");

      const type =
        f?.mime?.startsWith("image/")
          ? "image"
          : f?.mime?.startsWith("video/")
          ? "video"
          : f?.mime?.startsWith("audio/")
          ? "audio"
          : "document";

      try {
        onMessageSent?.({ wamid, to: row.customer_id, type, url: f.url });
      } catch {
        // swallow onMessageSent errors
      }

      await sleep(SEND_GAP_MS_IMAGE);
    }

    const next = msgs[i + 1];
    if (
      next &&
      (!next.files || next.files.length === 0) &&
      files.length > 0
    ) {
      await sleep(2200);
    }
  }

  // only here if all parts succeeded
  row.sent = true;
  await row.save();

  meta.usageCount = (meta.usageCount || 0) + 1;
  meta.lastUsedAt = new Date().toISOString();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

// === main tick (called from scheduler.js) ===
export async function runProgrammedDispatcher({
  forSellerId = null,
  force = false,          // kept for API compatibility, but we don't use schedule.times anymore
  verbose = true,
  limit = 200,
  sendText,               // required
  sendMedia = null,       // optional
  onMessageSent = null,   // optional
  onlyTaskId = null,      // optional: run exactly one queued task, used by manual tests
} = {}) {
  const t0  = Date.now();
  const now = dayjs();


  await waitForMongoReady({ verbose });

  const programs = await listPrograms();
  if (verbose) {
  }
  if (programs.length === 0) return { ok: 0, fail: 0 };

  // Use programs that have a funnelLevelX. New tasks store program_id so
  // multiple programmed messages can target the same funnel safely; legacy
  // tasks without program_id still fall back to the first matching funnel.
  const mapped = programs
    .map((p) => ({
      ...p,
      state: activeStateFromMisc(p.meta?.misc),
    }))
    .filter((p) => !!p.state);

  if (!mapped.length) {
    if (verbose);
    return { ok: 0, fail: 0 };
  }

  const statesOnly = [...new Set(mapped.map((x) => x.state))];

  if (verbose) {
  }

  const cutoff = now.subtract(24, "hour").toDate();
  const query = onlyTaskId
    ? {
        _id: onlyTaskId,
        sent: false,
        state_id: { $in: statesOnly },
      }
    : {
        sent: false,
        state_id: { $in: statesOnly },
        created_at: { $gte: cutoff },
      };
  if (forSellerId) query.sellerId = String(forSellerId);

  // Only process rows whose sendAt is reached, or legacy rows without sendAt.
  // When onlyTaskId is present, this prevents a manual test run from flushing
  // every other due programmed-message task in the queue.
  query.$or = [
    { sendAt: { $exists: false } },       // old rows
    { sendAt: { $lte: now.toDate() } },   // due rows
  ];

  const rows = await Queue.find(query).limit(limit).lean(false);

  if (verbose) {
  }
  if (!rows.length) return { ok: 0, fail: 0 };

  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    // Prefer the exact programmed message captured when the task was created.
    // Legacy rows created before program_id existed fall back by funnel state.
    const program = row.program_id
      ? mapped.find((p) => p.id === row.program_id && p.state === row.state_id)
      : mapped.find((p) => p.state === row.state_id);
    if (!program) {
      if (verbose) {
      }
      continue;
    }

    try {
      // 24h guard based on lastInboundTs (per conversation)
      const product = await Product.findOne({
        customer_id: row.customer_id,
        latestSeller: row.sellerId,
      }).lean();

      let lastInbound = product?.lastInboundTs || null;

      // Fallback: derive from customer_messages if needed
      if (
        !lastInbound &&
        Array.isArray(product?.customer_messages) &&
        product.customer_messages.length > 0
      ) {
        const latestCustomerMsg = product.customer_messages.reduce((a, b) =>
          b.timestamp > a.timestamp ? b : a
        );
        lastInbound = latestCustomerMsg.timestamp;
      }

      if (lastInbound) {
        const ageMs       = Date.now() - new Date(lastInbound).getTime();
        const DEADLINE_MS = 24 * 60 * 60 * 1000;

        if (ageMs > DEADLINE_MS) {
          // Too late → mark as processed so we don't retry
          if (verbose) {
          }
          row.sent = true;
          await row.save();
          fail++;
          continue;
        }
      }

      // If still inside 24h (or no timestamp info), send normally
      await sendProgramToRow(program, row, {
        sendText,
        sendMedia,
        onMessageSent,
        verbose,
      });
      ok++;
    } catch (err) {
      fail++;
      if (verbose) {
        console.error("[PD] error for row", row._id, err?.message || err);
      }
    }
  }

  const ms = Date.now() - t0;
  if (verbose) {

  }

  return { ok, fail };
}
