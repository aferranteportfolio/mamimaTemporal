// server/utils/messageSorter.js

import path from "node:path";
import { Product } from "../dbFunctionality/schemas/schema.js"; // <-- ADD THIS
import { sendTextMessage, sendMediaMessage } from "../wa/outbound-wrapper.js";
import {
  updateProductObejctByID,
  updateShippingStatusByID
} from "../dbFunctionality/functionality.js";
import fs from "node:fs";




const PRODUCT_VALUE_DEFAULT = "89";   // string
const SHIPPING_INFO_DEFAULT = "1";    // string
const QUANTITY_DEFAULT = 0;           // number
const SHIPPING_VALUE_DEFAULT = "14";  // string

/**
 * actuallySendSavedReplyObject
 *
 * @param {string} toPhone       e.g. "51915944684"
 * @param {object} savedReply    the meta.json contents
 * @param {string} folderName    the directory under /savedreplys
 * @param {object} miscCfg       the misc from meta.json
 */






const SAVED_REPLIES_ROOT = path.resolve(process.cwd(), "savedreplys");

// --- read meta.json safely ---------------------------------
function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    // If it's "file not found", just silently skip.
    if (err.code !== "ENOENT") {
      console.error("[autoReplyEngine] Failed to read", filePath, err);
    }
    return null;
  }
}

// --- turn one saved reply meta into a send function --------
function buildReplyFunction(savedReply, folderName, miscCfg) {
  return async function replyFn(toPhone) {
    await actuallySendSavedReplyObject(toPhone, savedReply, folderName, miscCfg);
  };
}

// --- load every folder in savedreplys/ ---------------------
function loadAllSavedReplies() {
  let dirs;
  try {
    dirs = fs.readdirSync(SAVED_REPLIES_ROOT, { withFileTypes: true });
  } catch (err) {
    console.error("[autoReplyEngine] Could not read saved replies dir:", err);
    return [];
  }

  const results = [];

  for (const entry of dirs) {
    // we only care about folders
    if (!entry.isDirectory()) continue;

    const folderName = entry.name;

    // Skip system/staging folders like "_incoming" etc.
    if (folderName.startsWith("_")) continue;

    const metaPath = path.join(SAVED_REPLIES_ROOT, folderName, "meta.json");
    const meta = readJsonSafe(metaPath);

    // If there's no meta.json or it's invalid, skip silently
    if (!meta) continue;

    const keywords = Array.isArray(meta.keywords) ? meta.keywords : [];
    const misc = (meta.misc && typeof meta.misc === "object") ? meta.misc : {};

    const replyFn = buildReplyFunction(meta, folderName, misc);

    results.push({
    id: meta.id || folderName,
    title: meta.title || folderName,
    keywords,
    misc,
    replyFn,
    folderName,
    rawMeta: meta
    });
  }

  return results;
}

// --- build action arrays from meta.misc --------------------
function buildActionsFromMeta() {
  const all = loadAllSavedReplies();

  const actionsCTWA = [];
  const actionsAnyText = [];

  for (const item of all) {
    // item: { id, title, keywords, misc, replyFn, folderName, rawMeta }

    if (item.misc?.a) {
      actionsCTWA.push([
        item.replyFn,     // replyFn(toPhone)
        item.keywords,    // ["faja", "postparto", ...]
        item.misc,        // { a,b,c,d,f }
        item.title        // "POST SHAPPER"
      ]);
    }

    if (item.misc?.b) {
      actionsAnyText.push([
        item.replyFn,
        item.keywords,
        item.misc,
        item.title
      ]);
    }
  }

  return { actionsCTWA, actionsAnyText };
}


// build once at startup:
const { actionsCTWA, actionsAnyText } = buildActionsFromMeta();

// DEBUG: show what we loaded at boot



// --- normalizeInboundMessage -------------------------------
function normalizeInboundMessage(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      from: "",
      to: "",
      bodyText: "",
      isAd: false,
      adTextHeadline: "",
      adTextBody: "",
      timestamp: new Date().toISOString()
    };
  }

  // CASE 1: internal simplified message from extractSimpleMessages()
  // {
  //   from:"51915944684",
  //   to:"51908008097",
  //   id:"wamid....",
  //   ts:"2025-11-01T16:38:23.000Z",
  //   type:"text",
  //   text:"faja"
  // }
  if (typeof raw.text === "string") {
    return {
      from: raw.from || "",
      to: raw.to || "",
      bodyText: raw.text.trim(),
      isAd: false,
      adTextHeadline: "",
      adTextBody: "",
      timestamp: raw.ts || raw.timestamp || new Date().toISOString()
    };
  }

  // CASE 2: direct WhatsApp webhook message
  // {
  //   from:"51915944684",
  //   text:{ body:"faja" },
  //   timestamp:"1762015103",
  //   referral:{ source_type:"ad", headline:"..", body:".." }
  // }
  const bodyText =
    (raw.text &&
      typeof raw.text.body === "string" &&
      raw.text.body.trim()) ||
    "";

  const isAd = !!(raw.referral && raw.referral.source_type === "ad");

  const adTextHeadline =
    (raw.referral &&
      typeof raw.referral.headline === "string" &&
      raw.referral.headline.trim()) ||
    "";

  const adTextBody =
    (raw.referral &&
      typeof raw.referral.body === "string" &&
      raw.referral.body.trim()) ||
    "";

  return {
    from: raw.from || "",
    to: raw.to || raw.recipient_id || "",
    bodyText,
    isAd,
    adTextHeadline,
    adTextBody,
    timestamp: raw.ts || raw.timestamp || new Date().toISOString()
  };
}

// --- checkMessageAndMatch ----------------------------------
function checkMessageAndMatch(normMsg, callback, triggerArray, isAdCheck = false, config = {}) {


  const triggers = (triggerArray || []).map(str => String(str || "").toLowerCase());

  const regexPattern = triggers
    .map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  if (!regexPattern) return false;

  const regex = new RegExp(regexPattern, "i");

  if (isAdCheck) {
    const adBodyLower = (normMsg.adTextBody || "").toLowerCase();
    const adHeadlineLower = (normMsg.adTextHeadline || "").toLowerCase();

    if (regex.test(adBodyLower) || regex.test(adHeadlineLower)) {
      callback(normMsg, config);
      return true;
    }
  } else {
    const msgLower = (normMsg.bodyText || "").toLowerCase();
    if (msgLower && msgLower.length < 300) {
      if (regex.test(msgLower)) {
        callback(normMsg, config);
        return true;
      }
    }
  }

  return false;
}

// --- mesageSorter ------------------------------------------
async function mesageSorter(rawMessage) {
  const normMsg = normalizeInboundMessage(rawMessage);
  console.log("📦 normalized inbound message:", normMsg);

  // 1. Try CTWA/ad replies first if message is from an ad
  if (normMsg.isAd) {
    const matchedAd = actionsCTWA.some(([replyFn, triggerArr, miscCfg]) => {
      return checkMessageAndMatch(
        normMsg,
        (m /*, cfg */) => {
          replyFn(m.from);
        },
        triggerArr,
        true,
        miscCfg
      );
    });

    if (matchedAd) {
      return;
    }
  }

  // 2. Try normal inbound replies
  actionsAnyText.some(([replyFn, triggerArr, miscCfg]) => {
    return checkMessageAndMatch(
      normMsg,
      (m /*, cfg */) => {
        replyFn(m.from);
      },
      triggerArr,
      false,
      miscCfg
    );
  });
}




function nowIso() {
  return new Date().toISOString();
}


/**
 * actuallySendSavedReplyObject
 *
 * 1. Respect cooldown (misc.c)
 * 2. If allowed, log DB (d/f)
 * 3. Send WhatsApp messages + media
 */
export async function actuallySendSavedReplyObject(toPhone, savedReply, folderName, miscCfg) {
  console.log(
    `[autoReplyEngine] 📨 REQUEST TO SEND "${savedReply.title}" ->`,
    toPhone
  );


  // -------------------------------------------------
  // 1. DB logging (d / f)
  // -------------------------------------------------
  try {
  // 1) Pre-log to DB; if any returns false → EXIT EARLY
  if (miscCfg?.d) {
    const okProduct = await updateProductObejctByID(
      toPhone,               // customerIdRaw
      savedReply.title,      // product_info_requested
      PRODUCT_VALUE_DEFAULT, // "89"
      SHIPPING_INFO_DEFAULT, // "1"
      QUANTITY_DEFAULT       // 0
    );

    if (okProduct === false) {
      console.warn("[autoReplyEngine] ❌ productObject update returned false; aborting send.", {
        toPhone,
        title: savedReply.title
      });
      return; // <-- STOP: do nothing else
    }

    console.log("[autoReplyEngine] 📝 logged productObject for", toPhone, "->", savedReply.title);
  }

  if (miscCfg?.f) {
    const okShip = await updateShippingStatusByID(
      toPhone,               // customerIdRaw
      SHIPPING_VALUE_DEFAULT // "14"
    );

    if (okShip === false) {
      console.warn("[autoReplyEngine] ❌ shippingStatus update returned false; aborting send.", {
        toPhone
      });
      return; // <-- STOP: do nothing else
    }

    console.log("[autoReplyEngine] 📝 logged shippingStatus for", toPhone);
  }
} catch (err) {
  console.error("[autoReplyEngine] ⚠ DB logging failed (thrown error); aborting send:", err);
  return; // <-- STOP on exceptions too
}

// -------------------------------------------------
// 2) Send the reply content (text + media in order)
// -------------------------------------------------
for (const part of savedReply.messages || []) {
  // Send text first
  if (part.text && part.text.trim()) {
    const cleanText = part.text.trim();
    console.log(`[autoReplyEngine]   text => ${JSON.stringify(cleanText)}`);
    await sendTextMessage(toPhone, cleanText);
  }

  // Then any media in this block
  if (Array.isArray(part.files)) {
    for (const f of part.files) {
      const absoluteFilePath = path.join(SAVED_REPLIES_ROOT, folderName, f.storedName);
      console.log(`[autoReplyEngine]   media => ${absoluteFilePath} (${f.mimeType})`);
      await sendMediaMessage(toPhone, {
        filePath: absoluteFilePath,
        mimeType: f.mimeType || "image/jpeg",
        originalName: f.name || f.storedName || "file"
      });
    }
  }
}

}


// --- exports ----------------------------------------------
export {
  mesageSorter,
  normalizeInboundMessage,
  checkMessageAndMatch,
  // mainly for debugging / introspection
  // (not required by webhook route)
  // note: these are the built arrays at boot time
  actionsCTWA,
  actionsAnyText,
  loadAllSavedReplies
};
