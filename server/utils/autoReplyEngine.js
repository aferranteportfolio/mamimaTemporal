// autoReplyEngine.mjs
// Dynamically builds auto-reply actions from ./savedreplys/**/meta.json

import fs from "node:fs";
import path from "node:path";
import { actuallySendSavedReplyObject } from "./saved-replies-send.mjs"; // <-- adjust path


////////////////////////////////////////////////////////////////////////////////
// 1. Utilities to load saved replies from disk
////////////////////////////////////////////////////////////////////////////////

// Directory where each saved reply folder lives.
// Example structure:
// savedreplys/
//   93795d03-8e5e5f/
//     meta.json
//     1761864904624-e472d242afb4.jpeg
//     ...
const SAVED_REPLIES_ROOT = path.resolve(process.cwd(), "savedreplys");

/**
 * readJsonSafe(filePath)
 * Tiny helper: read + parse a JSON file, or return null if fail.
 */
function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[autoReplyEngine] Failed to read", filePath, err);
    return null;
  }
}

/**
 * buildReplyFunction(savedReply)
 *
 * savedReply is the parsed meta.json:
 * {
 *   id,
 *   title,
 *   messages: [ { text, files: [ {absUrl,...}, ...] }, ... ],
 *   keywords: [...],
 *   misc: { a: true, b: true, c: true }
 * }
 *
 * We return a function (toPhone) => { ...send logic... }
 *
 * For now we just console.log() the intent.
 * Later you replace this with actual WhatsApp send logic:
 *   1. send every text block in order
 *   2. send every file block in order (images/video/etc)
 */
function buildReplyFunction(savedReply) {
  return function replyFn(toPhone) {
    console.log(
      `[autoReplyEngine] 📨 AUTO-REPLY "${savedReply.title}" ->`,
      toPhone
    );

    // You will later replace this with your real send pipeline:
    // send text messages and media via your existing sendText/sendImage fns.
    // We're just logging structure right now to prove wiring works.
    for (const part of savedReply.messages || []) {
      if (part.text && part.text.trim()) {
        console.log(
          `[autoReplyEngine]   text => ${JSON.stringify(part.text)}`
        );
      }

      if (Array.isArray(part.files)) {
        for (const f of part.files) {
          console.log(
            `[autoReplyEngine]   file => ${f.absUrl || f.url || f.storedName}`
          );
        }
      }
    }

    // TODO (future): update savedReply.usageCount, lastUsedAt, etc.
  };
}

/**
 * loadAllSavedReplies()
 *
 * Scans SAVED_REPLIES_ROOT for subfolders,
 * reads each meta.json,
 * returns an array of objects like:
 *
 * {
 *   id: "93795d03-8e5e5f",
 *   title: "POST SHAPPER",
 *   keywords: ["test","test1","test 1"],
 *   misc: { a:true, b:true, c:true },
 *   replyFn: (toPhone)=>{...},
 * }
 *
 * We skip folders that don't have a valid meta.json.
 */
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
    if (!entry.isDirectory()) continue;

    const folderName = entry.name;
    const metaPath = path.join(SAVED_REPLIES_ROOT, folderName, "meta.json");

    const meta = readJsonSafe(metaPath);
    if (!meta) continue;

    const keywords = Array.isArray(meta.keywords) ? meta.keywords : [];
    const misc = (meta.misc && typeof meta.misc === "object") ? meta.misc : {};

    const replyFn = buildReplyFunction(meta);

    results.push({
      id: meta.id || folderName,
      title: meta.title || folderName,
      keywords,
      misc,
      replyFn
    });
  }

  return results;
}


////////////////////////////////////////////////////////////////////////////////
// 2. Build action lists for CTWA vs normal chat
////////////////////////////////////////////////////////////////////////////////

/**
 * buildActionsFromMeta()
 *
 * We interpret:
 *   misc.a === true  -> allowed for CTWA/ad auto-response
 *   misc.b === true  -> allowed for normal inbound text auto-response
 *   misc.c === true  -> (weekly / throttle) we just carry it along for future logic
 *
 * Returns:
 *   {
 *     actionsCTWA:    [ [replyFn, triggerArray, config], ... ],
 *     actionsAnyText: [ [replyFn, triggerArray, config], ... ]
 *   }
 *
 * where triggerArray is keywords[] from the meta,
 * and config is { a,b,c,... } for future rate limiting / toggles.
 */
function buildActionsFromMeta() {
  const all = loadAllSavedReplies();

  const actionsCTWA = [];
  const actionsAnyText = [];

  for (const item of all) {
    // item.keywords is our trigger array
    // item.replyFn is our function to send the reply
    // item.misc is config toggles

    if (item.misc?.a) {
      // "respond to ads / CTWA leads"
      actionsCTWA.push([item.replyFn, item.keywords, item.misc]);
    }
    if (item.misc?.b) {
      // "respond to normal inbound messages"
      actionsAnyText.push([item.replyFn, item.keywords, item.misc]);
    }
  }

  return { actionsCTWA, actionsAnyText };
}

// We build them once at startup. If you plan to allow editing meta.json live,
// you could rebuild per message instead.
const { actionsCTWA, actionsAnyText } = buildActionsFromMeta();


////////////////////////////////////////////////////////////////////////////////
// 3. Normalizer (fixed order!)
//    - First handle internal simplified messages (text is string)
//    - Then handle raw webhook messages (text.body, referral, etc)
////////////////////////////////////////////////////////////////////////////////
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

  // CASE 1: internal simplified shape
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


////////////////////////////////////////////////////////////////////////////////
// 4. Matcher
//    Given a normalized message, check if it matches the triggers.
//    We also pass down config (misc) so later we can respect misc.c (throttle).
////////////////////////////////////////////////////////////////////////////////
function checkMessageAndMatch(normMsg, callback, triggerArray, isAdCheck = false, config = {}) {
  console.log("🔍 checkMessageAndMatch() received normalized:", normMsg, "config:", config);

  // Ensure triggerArray is always array-like
  const triggers = (triggerArray || []).map(str => String(str || "").toLowerCase());

  // Make OR regex out of all keywords, escaped safely
  const regexPattern = triggers
    .map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  if (!regexPattern) return false;

  const regex = new RegExp(regexPattern, "i");

  if (isAdCheck) {
    // We're in CTWA/ad mode. Match against ad creatives.
    const adBodyLower = (normMsg.adTextBody || "").toLowerCase();
    const adHeadlineLower = (normMsg.adTextHeadline || "").toLowerCase();

    if (regex.test(adBodyLower) || regex.test(adHeadlineLower)) {
      // here we *could* enforce config.c (weekly) before callback
      callback(normMsg, config);
      return true;
    }
  } else {
    // Normal inbound text mode
    const msgLower = (normMsg.bodyText || "").toLowerCase();
    if (msgLower && msgLower.length < 300) {
      if (regex.test(msgLower)) {
        // here we *could* enforce config.c (weekly) before callback
        callback(normMsg, config);
        return true;
      }
    }
  }

  return false;
}


////////////////////////////////////////////////////////////////////////////////
// 5. Sorter
//    - normalize inbound message
//    - if isAd -> try CTWA-capable replies (misc.a)
//    - else -> try normal replies (misc.b)
//    - pass misc to the callback so we know what toggles were set
//      (for future: respect misc.c to prevent over-sending)
////////////////////////////////////////////////////////////////////////////////
async function mesageSorter(rawMessage) {
  const normMsg = normalizeInboundMessage(rawMessage);


  // 1. Ad-origin logic (CTWA)
  if (normMsg.isAd) {
    const matchedAd = actionsCTWA.some(([replyFn, triggerArr, miscCfg]) => {
      return checkMessageAndMatch(
        normMsg,
        (m /*, cfg */) => {
          // For now we just pass phone.
          replyFn(m.from);
        },
        triggerArr,
        /* isAdCheck */ true,
        miscCfg
      );
    });

    if (matchedAd) {
      return; // stop here if one reply already fired for the ad
    }
  }

  // 2. Normal inbound text logic
  actionsAnyText.some(([replyFn, triggerArr, miscCfg]) => {
    return checkMessageAndMatch(
      normMsg,
      (m /*, cfg */) => {
        replyFn(m.from);
      },
      triggerArr,
      /* isAdCheck */ false,
      miscCfg
    );
  });
}


////////////////////////////////////////////////////////////////////////////////
// EXPORTS
////////////////////////////////////////////////////////////////////////////////
export {
  mesageSorter,
  normalizeInboundMessage,
  checkMessageAndMatch,

  // mainly for introspection / tests / debug UI
  actionsCTWA,
  actionsAnyText,
  loadAllSavedReplies
};
