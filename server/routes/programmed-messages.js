// server/routes/programmed-messages.js
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import { Product } from "../dbFunctionality/schemas/schema.js";
import { MessageTask } from "../dbFunctionality/schemas/messageTask.js";

export const programmedMessagesRouter = express.Router();

const BASE_DIR = path.resolve(process.cwd(), "programmedmsgs");
if (!fssync.existsSync(BASE_DIR)) fssync.mkdirSync(BASE_DIR, { recursive: true });

export function mountProgrammedMessagesStatic(app) {
  app.use("/programmedmsgs", express.static(BASE_DIR, { fallthrough: true }));
}

const upload = multer({ storage: multer.memoryStorage() });

// ---------- helpers ----------
const rid = (len = 8) =>
  crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);

const buildAbsUrl = (req, relUrl) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}${relUrl}`;
};

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

const cleanTags = (tags = []) =>
  [...new Set((Array.isArray(tags) ? tags : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean))];

function activeStateFromMisc(misc = {}) {
  if (misc.funnelLevel1) return 1;
  if (misc.funnelLevel2) return 2;
  if (misc.funnelLevel3) return 3;
  if (misc.funnelLevel4) return 4;
  return null;
}

const normalizePhone = (phone = "") => String(phone || "").replace(/\D/g, "");

function normalizeMeta(raw = {}) {
  const delayHours = Number(raw?.schedule?.delayHours);
  const mode = raw?.schedule?.mode === "delayAfterInbound" ? "delayAfterInbound" : "legacy24h";

  // shape guaranteed on disk
  return {
    id: raw.id || rid(10),
    title: raw.title || "",
    messages: Array.isArray(raw.messages) ? raw.messages : [], // [{text, files:[{url,name,mime,size}], delayMs?}]
    misc: {
      funnelLevel1: !!raw?.misc?.funnelLevel1,
      funnelLevel2: !!raw?.misc?.funnelLevel2,
      funnelLevel3: !!raw?.misc?.funnelLevel3,
      funnelLevel4: !!raw?.misc?.funnelLevel4,
    },
    schedule: {
      mode,
      delayHours: Number.isFinite(delayHours) && delayHours > 0 ? delayHours : 23.5,
      preset: raw?.schedule?.preset || "custom",
      times: Array.isArray(raw?.schedule?.times) ? raw.schedule.times : [] // legacy fixed-hour UI metadata
    },
    targeting: {
      productTags: cleanTags(raw?.targeting?.productTags)
    },
    testing: {
      phoneNumber: normalizePhone(raw?.testing?.phoneNumber)
    },
    usageCount: raw.usageCount || 0,
    lastUsedAt: raw.lastUsedAt || null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function saveFilesToFolder(req, folderAbs, files = []) {
  if (!files.length) return [];
  // Ensure folder
  await fs.mkdir(folderAbs, { recursive: true });

  const saved = [];
  for (const f of files) {
    const ext = path.extname(f.originalname) || "";
    const fname = `${Date.now()}-${rid(6)}${ext}`;
    const abs   = path.join(folderAbs, fname);
    await fs.writeFile(abs, f.buffer);
    saved.push({
      name: f.originalname,
      mime: f.mimetype,
      size: f.size,
      url: buildAbsUrl(req, `/programmedmsgs/${path.basename(folderAbs)}/${fname}`),
    });
  }
  return saved;
}


// ---------- product tag list ----------
programmedMessagesRouter.get("/product-tags/list", async (req, res) => {
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
    console.error("[PM] product-tags error:", err);
    res.status(500).json({ error: "product_tags_failed" });
  }
});

// ---------- list ----------
programmedMessagesRouter.get("/", async (req, res) => {
  const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = path.join(BASE_DIR, e.name, "meta.json");
    const meta = await readJson(metaPath);
    if (meta) items.push(meta);
  }
  res.json({ items });
});

// ---------- read one ----------
programmedMessagesRouter.get("/:id", async (req, res) => {
  const dir  = path.join(BASE_DIR, req.params.id);
  const meta = await readJson(path.join(dir, "meta.json"));
  if (!meta) return res.status(404).json({ error: "not_found" });
  res.json(meta);
});

// ---------- queue a due test task ----------
programmedMessagesRouter.post("/:id/test-task", async (req, res) => {
  try {
    const dir = path.join(BASE_DIR, req.params.id);
    const rawMeta = await readJson(path.join(dir, "meta.json"), null);
    if (!rawMeta) return res.status(404).json({ error: "not_found" });
    const meta = normalizeMeta(rawMeta);

    const customerId = normalizePhone(req.body?.phoneNumber || meta?.testing?.phoneNumber);
    if (!customerId) {
      return res.status(400).json({ error: "missing_phone_number" });
    }

    const stateId = activeStateFromMisc(meta.misc);
    if (!stateId) {
      return res.status(400).json({ error: "missing_funnel_level" });
    }

    // This is intentionally due immediately so you can test a configured
    // programmed message without waiting 12h/18h. The normal dispatcher still
    // owns the actual WhatsApp send path and keeps its final 24h + business-hour
    // guards, so tests queued outside 08:00–20:00 Lima are deferred.
    const dedupeKey = `test:${meta.id}:${customerId}:${Date.now()}:${rid(4)}`;
    const task = await MessageTask.create({
      state_id: stateId,
      program_id: meta.id,
      customer_id: customerId,
      sellerId: req.body?.sellerId ? String(req.body.sellerId) : "manual-test",
      sendAt: new Date(),
      productTags: cleanTags(meta?.targeting?.productTags),
      dedupeKey,
    });

    res.status(201).json({
      ok: true,
      taskId: String(task._id),
      customer_id: customerId,
      program_id: meta.id,
      state_id: stateId,
      sendAt: task.sendAt,
    });
  } catch (err) {
    console.error("[PM] test-task error:", err);
    res.status(400).json({ error: "test_task_failed", detail: String(err?.message || err) });
  }
});

// ---------- create ----------
/**
 * Body (multipart/form-data):
 * - meta: JSON string with { title, messages:[{text, fileCids:["cid1","cid2"], delayMs?}], misc:{...}, schedule:{...} }
 * - files: one or more files, each with fieldname "file" and header "x-cid" (or name like "file:cid123")
 */
programmedMessagesRouter.post("/", upload.any(), async (req, res) => {
  try {
    const raw = JSON.parse(req.body.meta || "{}");
    const meta = normalizeMeta(raw);

    const id = meta.id || rid(10);
    meta.id = id;

    const dir = path.join(BASE_DIR, id);
    await fs.mkdir(dir, { recursive: true });

    // Map cids -> buffer files
    const cidMap = new Map();
    for (const f of req.files || []) {
      // accept either `x-cid` header or "file:<cid>" fieldname
      const headerCid = req.headers["x-file-cid"];
      const fieldCid  = (f.fieldname.startsWith("file:") && f.fieldname.split(":")[1]) || null;
      const cid = f.originalname.startsWith("cid:")
        ? f.originalname.slice(4)
        : headerCid || fieldCid || f.fieldname; // last resort
      cidMap.set(cid, f);
    }

    // Collect all files in order (only those referenced)
    const incomingFiles = [];
    meta.messages.forEach(m => (m.fileCids || []).forEach(cid => {
      const f = cidMap.get(cid);
      if (f) incomingFiles.push(f);
    }));

    const saved = await saveFilesToFolder(req, dir, incomingFiles);

    // Replace fileCids with concrete file objects
    let idx = 0;
    meta.messages = meta.messages.map(m => {
      const count = (m.fileCids || []).length;
      const files = count ? saved.slice(idx, idx + count) : [];
      idx += count;
      return {
        text: m.text || "",
        files,
        delayMs: typeof m.delayMs === "number" ? m.delayMs : undefined
      };
    });

    await writeJson(path.join(dir, "meta.json"), meta);
    res.status(201).json(meta);
  } catch (err) {
    console.error("[PM] create error:", err);
    res.status(400).json({ error: "bad_request", detail: String(err?.message || err) });
  }
});

// ---------- update ----------
programmedMessagesRouter.put("/:id", upload.any(), async (req, res) => {
  try {
    const id  = req.params.id;
    const dir = path.join(BASE_DIR, id);
    const current = normalizeMeta(await readJson(path.join(dir, "meta.json"), { id }));

    const raw = JSON.parse(req.body.meta || "{}");
    const next = normalizeMeta({ ...current, ...raw, id, updatedAt: new Date().toISOString() });

    // Accept new files like POST; append to existing
    const cidMap = new Map();
    for (const f of req.files || []) {
      const fieldCid = (f.fieldname.startsWith("file:") && f.fieldname.split(":")[1]) || null;
      const cid = f.originalname.startsWith("cid:")
        ? f.originalname.slice(4)
        : req.headers["x-file-cid"] || fieldCid || f.fieldname;
      cidMap.set(cid, f);
    }

    const incomingFiles = [];
    next.messages.forEach(m => (m.fileCids || []).forEach(cid => {
      const f = cidMap.get(cid);
      if (f) incomingFiles.push(f);
    }));

    const saved = await saveFilesToFolder(req, dir, incomingFiles);
    let idx = 0;
    next.messages = next.messages.map(m => {
      const priorFiles = Array.isArray(m.files) ? m.files : [];
      const count = (m.fileCids || []).length;
      const newOnes = count ? saved.slice(idx, idx + count) : [];
      idx += count;
      return {
        text: m.text || "",
        files: [...priorFiles, ...newOnes],
        delayMs: typeof m.delayMs === "number" ? m.delayMs : undefined
      };
    });

    await writeJson(path.join(dir, "meta.json"), next);
    res.json(next);
  } catch (err) {
    console.error("[PM] update error:", err);
    res.status(400).json({ error: "bad_request", detail: String(err?.message || err) });
  }
});

// ---------- delete ----------
programmedMessagesRouter.delete("/:id", async (req, res) => {
  const id = String(req.params.id || "");
  const dir = path.join(BASE_DIR, id);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    const deletedTasks = await MessageTask.deleteMany({ program_id: id, sent: false });
    res.json({ ok: true, deletedTasks: deletedTasks.deletedCount || 0 });
  } catch (e) {
    res.status(404).json({ error: "not_found" });
  }
});
