// server/routes/saved-replies.js
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import onFinished from "on-finished"; // npm i on-finished (tiny, battle-tested)

export const savedRepliesRouter = express.Router();

// ======== Lightweight logger helpers ========================================
const SR_DEBUG = String(process.env.SR_DEBUG ?? "1") !== "0";
function rid(len = 8) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}
function stamp() {
  const d = new Date();
  return d.toISOString().replace("T", " ").replace("Z", "");
}
function log(req, ...args) {
  // always on for high-level visibility
  console.log(`[${stamp()}][SR][${req._rid}]`, ...args);
}
function dbg(req, ...args) {
  if (SR_DEBUG) console.log(`[${stamp()}][SR][${req._rid}][DBG]`, ...args);
}

// Attach per-request id + start time + end log
savedRepliesRouter.use((req, res, next) => {

  req._rid = req._rid || rid(6);
  const started = Date.now();
  const ct = req.headers["content-type"] || "";
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  log(req, `IN ${req.method} ${req.originalUrl} ct="${ct}" ip=${ip}`);
  onFinished(res, () => {
    const ms = Date.now() - started;
    log(req, `OUT ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ---- Storage base (folder + static) ----------------------------------------
const BASE_DIR = path.resolve(process.cwd(), "savedreplys");
if (!fssync.existsSync(BASE_DIR)) fssync.mkdirSync(BASE_DIR, { recursive: true });

// Call this once in your server to expose file URLs at /savedreplys/**
export function mountSavedRepliesStatic(app) {
  app.use("/savedreplys", express.static(BASE_DIR, { fallthrough: true }));
  console.log(`[SR] Static mounted at /savedreplys → ${BASE_DIR}`);
}

// Multer in-memory; we’ll write files ourselves
const upload = multer({ storage: multer.memoryStorage() });

// ---- Helpers ----------------------------------------------------------------
function buildAbsUrl(req, relUrl) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}${relUrl}`;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}


// --- helpers (put near readJson/writeJson) ---
function trimText(t, max = 1200) {
  return typeof t === "string" && t.length > max
    ? t.slice(0, max) + `…(+${t.length - max} bytes)`
    : t;
}
async function readJsonWithRaw(file) {
  const rawText = await fs.readFile(file, "utf8");
  let parsed;
  try { parsed = JSON.parse(rawText); }
  catch (e) { e.message = `Invalid JSON in ${file}: ` + e.message; throw e; }
  return { rawText, parsed };
}
function logMetaSummary(req, where, meta) {
  const msgs = Array.isArray(meta.messages) ? meta.messages.length : 0;
  const kws  = Array.isArray(meta.keywords) ? meta.keywords.length : 0;
  dbg(req, `[${where}] title="${meta.title}" usageCount=${meta.usageCount} lastUsedAt=${meta.lastUsedAt} msgs=${msgs} keywords=${kws}`);
}


async function readJson(file) {
  const s = await fs.readFile(file, "utf8");
  return JSON.parse(s);
}

async function writeJson(file, obj) {
  await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
}

// utility parsers
const asArray = (v) => Array.isArray(v) ? v : [];
const parseJSON = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const parseKeywords = (s) =>
  String(s || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

// Ensure new fields exist (migrate older meta.json)
function normalizeMeta(meta) {
  const m = { ...meta };
  if (typeof m.usageCount !== "number") m.usageCount = 0;
  if (m.lastUsedAt !== null && typeof m.lastUsedAt !== "string") m.lastUsedAt = null;
  if (!m.createdAt) m.createdAt = new Date().toISOString();
  if (!Array.isArray(m.messages)) m.messages = [];
  if (!Array.isArray(m.keywords)) m.keywords = [];
  return m;
}

function sortByPopularity(a, b) {
  return (b.usageCount || 0) - (a.usageCount || 0)
    || new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0)
    || new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

// Creates the files array entry and writes buffer to disk
async function persistUploadTo(dir, uploadFile, req, id) {
  const ext = path.extname(uploadFile.originalname || "").slice(0, 15) || "";
  const storedName = `${Date.now()}-${rid(12)}${ext}`;
  const absPath = path.join(dir, storedName);
  await fs.writeFile(absPath, uploadFile.buffer);
  const relUrl = `/savedreplys/${id}/${storedName}`;
  dbg(req, `persistUploadTo -> ${storedName} (${uploadFile.size} bytes)`);
  return {
    name: path.basename(uploadFile.originalname || storedName),
    storedName,
    size: uploadFile.size,
    mimeType: uploadFile.mimetype || "application/octet-stream",
    url: relUrl,
    absUrl: buildAbsUrl(req, relUrl),
  };
}

// Distribute uploaded files to messages ...
async function attachUploadsToMessages({
  req, id, dir, inMessages, uploads, mode, descriptor
}) {
  dbg(req, `attachUploadsToMessages mode=${mode} messages=${inMessages.length} uploads=${uploads.length}`);
  const outMessages = inMessages.map(m => ({
    text: typeof m?.text === "string" ? m.text : "",
    files: [],
  }));

  if (!uploads.length) return outMessages;

  const byField = new Map(uploads.map(u => [u.fieldname, u]));
  const byName = new Map();
  for (const f of uploads) {
    const base = path.basename(f.originalname || "");
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(f);
  }
  const pending = new Set(uploads);

  if (mode === "descriptor" && Array.isArray(descriptor)) {
    for (let i = 0; i < descriptor.length; i++) {
      const d = descriptor[i] || {};
      const count = Number(d.filesCount || 0);
      for (let j = 0; j < count; j++) {
        const key = `m${i}_f${j}`;
        const u = byField.get(key);
        if (u && pending.has(u)) {
          const fileInfo = await persistUploadTo(dir, u, req, id);
          outMessages[i].files.push(fileInfo);
          pending.delete(u);
        }
      }
    }
  } else {
    for (let i = 0; i < inMessages.length; i++) {
      const m = inMessages[i] || {};
      const wantFiles = Array.isArray(m.files) ? m.files : [];
      for (const wf of wantFiles) {
        const nm = wf && typeof wf.name === "string" ? path.basename(wf.name) : null;
        if (!nm) continue;
        const list = byName.get(nm);
        if (list && list.length) {
          const u = list.shift();
          if (u && pending.has(u)) {
            const fileInfo = await persistUploadTo(dir, u, req, id);
            outMessages[i].files.push(fileInfo);
            pending.delete(u);
          }
        }
      }
    }

    let msgIdx = 0;
    const wants = inMessages.map((m) =>
      Array.isArray(m?.files) ? (m.files.length || 0) : 0
    );
    while (pending.size) {
      let found = -1;
      for (let k = 0; k < inMessages.length; k++) {
        const idx = (msgIdx + k) % inMessages.length;
        if (wants[idx] > outMessages[idx].files.length) {
          found = idx;
          break;
        }
      }
      if (found === -1) break;

      const u = pending.values().next().value;
      const fileInfo = await persistUploadTo(dir, u, req, id);
      outMessages[found].files.push(fileInfo);
      pending.delete(u);
      msgIdx = (found + 1) % inMessages.length;
    }
  }

  if (pending.size) {
    if (!outMessages.length) outMessages.push({ text: "", files: [] });
    for (const u of pending) {
      const fileInfo = await persistUploadTo(dir, u, req, id);
      outMessages[0].files.push(fileInfo);
    }
    pending.clear();
  }

  dbg(req, `attachUploadsToMessages -> outMessages[0..${outMessages.length - 1}] with files distributed`);
  return outMessages;
}

// ---- Routes -----------------------------------------------------------------

// small logger for /:id/use
savedRepliesRouter.use((req, _res, next) => {
  if (req.method === "PATCH" && /\/[^/]+\/use$/.test(req.path)) {
    log(req, `[USE] IN ${req.method} ${req.originalUrl}`);
  }
  next();
});

// Decide parser by Content-Type
function pickBodyParser(req, res, next) {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("application/json")) {
    dbg(req, "pickBodyParser → express.json()");
    return express.json()(req, res, next);   // parse JSON bodies
  }
  dbg(req, `pickBodyParser → multer.any() (ct="${ct || "n/a"}")`);
  return upload.any()(req, res, next);
}

// POST — create (supports JSON and multipart)
savedRepliesRouter.post("/", pickBodyParser, async (req, res) => {
  try {
    const ct = req.headers["content-type"] || "";
    const isJson = ct.includes("application/json");
    dbg(req, `POST / (create) isJson=${isJson}`);

    if (isJson) {
      const body = req.body || {};
      const id = body.id || `${rid(8)}-${rid(6)}`;
      const dir = path.join(BASE_DIR, id);
      await ensureDir(dir);

      const inMessages = Array.isArray(body.messages) ? body.messages : [];
      dbg(req, `POST JSON title="${body.title}" messages=${inMessages.length}`);

      const outMessages = inMessages.map(m => ({
        text: typeof m?.text === "string" ? m.text : "",
        files: [],
      }));

      const savedMeta = normalizeMeta({
        id,
        title: String(body.title || ""),
        createdAt: new Date().toISOString(),
        usageCount: 0,
        lastUsedAt: null,
        messages: outMessages,
        keywords: asArray(body.keywords),
      });
      await writeJson(path.join(dir, "meta.json"), savedMeta);
      log(req, `CREATE id=${id} title="${savedMeta.title}" msgs=${savedMeta.messages.length}`);
      return res.json(savedMeta);
    }

    // ---------- Multipart branch ----------
    const files = Array.isArray(req.files) ? req.files : [];
    const metaStr = req.body?.meta;                    // legacy mode (contains title+messages)
    const descriptorStr = req.body?.messagesDescriptor;

    // NEW: support flat fields from UI
    const flatTitle = req.body?.title;
    const flatParts = parseJSON(req.body?.parts, null);     // ["text", ...]
    const flatMisc  = parseJSON(req.body?.misc, null);
    const flatKeywords =
      req.body?.keywords
        ? (parseJSON(req.body.keywords, null) ?? parseKeywords(req.body.keywords))
        : null;

    dbg(req, `POST multipart files=${files.length} flatTitle="${flatTitle ?? ""}"`);

    let metaIn = { title: "", messages: [] };
    if (metaStr) {
      try { metaIn = JSON.parse(metaStr); }
      catch { log(req, "ERROR invalid meta JSON"); return res.status(400).json({ ok: false, error: "invalid meta JSON" }); }
    } else if (flatTitle || flatParts) {
      metaIn = {
        title: String(flatTitle || ""),
        messages: Array.isArray(flatParts)
          ? flatParts.map(t => ({ text: String(t || ""), files: [] }))
          : [],
        misc: flatMisc || undefined,
        keywords: Array.isArray(flatKeywords) ? flatKeywords : undefined,
      };
    }

    let descriptor = null;
    if (descriptorStr) {
      try { descriptor = JSON.parse(descriptorStr); }
      catch { log(req, "ERROR invalid messagesDescriptor JSON"); return res.status(400).json({ ok: false, error: "invalid messagesDescriptor JSON" }); }
    }

    const id = metaIn.id || `${rid(8)}-${rid(6)}`;
    const dir = path.join(BASE_DIR, id);
    await ensureDir(dir);

    const inMessages = Array.isArray(metaIn.messages) ? metaIn.messages : [];
    const mode = descriptor ? "descriptor" : "meta";

    const outMessages = await attachUploadsToMessages({
      req, id, dir,
      inMessages,
      uploads: files,
      mode,
      descriptor
    });

    const savedMeta = normalizeMeta({
      id,
      title: String(metaIn.title || ""),
      createdAt: new Date().toISOString(),
      usageCount: 0,
      lastUsedAt: null,
      messages: outMessages,
      keywords: Array.isArray(metaIn.keywords) ? metaIn.keywords : (flatKeywords || []),
      misc: metaIn.misc ?? flatMisc ?? undefined,
    });

    await writeJson(path.join(dir, "meta.json"), savedMeta);
    log(req, `CREATE id=${id} title="${savedMeta.title}" msgs=${savedMeta.messages.length} filesTotal=${files.length}`);
    res.json(savedMeta);
  } catch (e) {
    console.error(`[${stamp()}][SR][${(req._rid||"err")}] [POST] ERROR:`, e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET BY ID — full meta (normalized)
savedRepliesRouter.get("/:id", async (req, res) => {
  try {
    const metaPath = path.join(BASE_DIR, req.params.id, "meta.json");
    const raw = await readJson(metaPath);
    const meta = normalizeMeta(raw);
    if (JSON.stringify(raw) !== JSON.stringify(meta)) {
      await writeJson(metaPath, meta);
      dbg(req, `GET /:id migrated meta for id=${req.params.id}`);
    }
    log(req, `GET id=${req.params.id} title="${meta.title}" msgs=${meta.messages.length}`);
    res.json(meta);
  } catch (e) {
    log(req, `GET id=${req.params.id} ERROR: ${e?.message || e}`);
    res
      .status(e?.code === "ENOENT" ? 404 : 500)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

// LIST
savedRepliesRouter.get("/", async (req, res) => {
  log(req, "[LIST] ENTER");
  const wantFull = String(req.query.full || "") === "1";
  try {
    let dirs = [];
    try {
      dirs = await fs.readdir(BASE_DIR, { withFileTypes: true });
    } catch {
      dirs = [];
    }

    const items = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const id = d.name;
      try {
        const metaPath = path.join(BASE_DIR, id, "meta.json");
        const raw = await readJson(metaPath);
        const meta = normalizeMeta(raw);
        if (JSON.stringify(meta) !== JSON.stringify(raw)) {
          await writeJson(metaPath, meta); // migrate silently
        }
        items.push(
          wantFull
            ? meta
            : {
                id: meta.id,
                title: meta.title,
                createdAt: meta.createdAt,
                usageCount: meta.usageCount,
                lastUsedAt: meta.lastUsedAt,
              }
        );
      } catch (e) {
        console.warn(`[${stamp()}][SR][${req._rid}] [LIST] skip id=${id} ${e.message}`);
      }
    }

    items.sort(sortByPopularity);
    log(req, `[LIST] EXIT 200 items=${items.length}`);
    res.json(items);
  } catch (e) {
    console.error(`[${stamp()}][SR][${req._rid}] [LIST] ERROR`, e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ===== Shared update logic (used by POST /:id and POST /:id/save) =====
function isJsonCT(req) {
  const ct = req.headers["content-type"] || "";
  return ct.includes("application/json");
}

async function doSaveUpdate(req, res) {
  const id = req.params.id;
  const dir = path.join(BASE_DIR, id);
  const metaPath = path.join(dir, "meta.json");
  const raw = await readJson(metaPath);
  const meta = normalizeMeta(raw);

  const isJson = isJsonCT(req);

  const title = String((isJson ? req.body.title : req.body.title) || meta.title || "");
  const parts = isJson ? asArray(req.body.parts) : parseJSON(req.body.parts, []);
  const misc  = isJson ? (req.body.misc ?? meta.misc) : (parseJSON(req.body.misc, meta.misc));

  const keywords = (() => {
    if (isJson) {
      if (Array.isArray(req.body.keywords)) return req.body.keywords;
      if (typeof req.body.keywords === "string") return parseKeywords(req.body.keywords);
      return meta.keywords;
    } else {
      if (req.body.keywords) {
        const p = parseJSON(req.body.keywords, null);
        if (Array.isArray(p)) return p;
        return parseKeywords(req.body.keywords);
      }
      return meta.keywords;
    }
  })();

  await ensureDir(dir);

  // texts -> messages
  const newMessages = (Array.isArray(parts) && parts.length
    ? parts
    : meta.messages.map(m => m.text)
  ).map(t => ({ text: String(t || ""), files: [] }));

  // keep existing files per index
  for (let i = 0; i < newMessages.length; i++) {
    newMessages[i].files = Array.isArray(meta.messages[i]?.files)
      ? [...meta.messages[i].files]
      : [];
  }

  // append new uploads (files[i][])
  const uploads = Array.isArray(req.files) ? req.files : [];
  const byIndex = new Map();
  for (const f of uploads) {
    const m = f.fieldname.match(/^files\[(\d+)\]\[\]$/);
    if (!m) continue;
    const idx = Number(m[1] || 0);
    if (!byIndex.has(idx)) byIndex.set(idx, []);
    byIndex.get(idx).push(f);
  }

  for (const [idx, arr] of byIndex) {
    for (const up of arr) {
      const fileInfo = await persistUploadTo(dir, up, req, id);
      if (!newMessages[idx]) newMessages[idx] = { text: "", files: [] };
      newMessages[idx].files.push(fileInfo);
    }
  }

  const updated = normalizeMeta({
    ...meta,
    title,
    messages: newMessages,
    misc,
    keywords
  });

  await writeJson(metaPath, updated);
  log(req, `UPDATE id=${id} title="${title}" msgs=${updated.messages.length} uploads=${uploads.length} keywords=${Array.isArray(keywords)?keywords.length:0}`);
  res.json(updated);
}

// POST — update title/messages/keywords/misc; append new uploads per message
savedRepliesRouter.post("/:id", pickBodyParser, async (req, res) => {
  try { await doSaveUpdate(req, res); }
  catch (e) {
    console.error(`[${stamp()}][SR][${req._rid}] [POST id] ERROR:`, e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// NEW: POST — same as PUT but avoids preflight if sent as simple multipart
// Call this from the browser instead of PUT to bypass CORS preflight.
savedRepliesRouter.post("/:id/save", pickBodyParser, async (req, res) => {
  try { await doSaveUpdate(req, res); }
  catch (e) {
    console.error(`[${stamp()}][SR][${req._rid}] [POST save] ERROR:`, e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH — mark used (increments usageCount + updates lastUsedAt)
savedRepliesRouter.patch("/:id/use", async (req, res) => {
  const id = req.params.id;
  try {
    const metaPath = path.join(BASE_DIR, id, "meta.json");
    const raw  = await readJson(metaPath);
    const meta = normalizeMeta(raw);
    const to = req.query.to || req.get("x-sr-to") || null;


    meta.usageCount = (meta.usageCount || 0) + 1;
    meta.lastUsedAt = new Date().toISOString();
    

    await writeJson(metaPath, meta);
    log(req, `USE id=${meta.id} usageCount=${meta.usageCount}`);
    res.json({ id: meta.id, usageCount: meta.usageCount, lastUsedAt: meta.lastUsedAt ,to, meta});
  } catch (e) {
    console.error(`[${stamp()}][SR][${req._rid}] [USE] ERROR id=${id}`, e);
    res.status(e?.code === "ENOENT" ? 404 : 500)
       .json({ ok: false, error: String(e?.message || e) });
  }
});

// DELETE — remove a saved reply (and its files)
savedRepliesRouter.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const dir = path.join(BASE_DIR, id);
    await fs.rm(dir, { recursive: true, force: true });
    log(req, `DELETE id=${id}`);
    res.json({ ok: true, id });
  } catch (e) {
    console.error(`[${stamp()}][SR][${req._rid}] [DELETE] ERROR`, e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
