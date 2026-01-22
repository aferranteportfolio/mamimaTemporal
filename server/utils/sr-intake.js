// server/utils/sr-intake.js

// ---------- helpers ----------
function escapeRegex(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeKeywords(arr = []) {
  return arr
    .map(k => String(k || "").trim().toLowerCase())
    .filter(Boolean);
}

function getChannelFlags(reply) {
  const match = reply?.match || {};
  const misc  = reply?.misc  || {};
  // supports either explicit {match:{ads,messages}} or legacy misc.{a,b}
  const ads      = typeof match.ads === "boolean"      ? match.ads      : !!misc.a;
  const messages = typeof match.messages === "boolean" ? match.messages : !!misc.b;
  return { ads, messages };
}

// ---------- message inspectors ----------
export function isAdMessage(message) {
  // Cloud API referral path
  if (message?.referral?.source_type === "ad") return true;

  // Your lib: _data.ctwaContext { title, description }
  const ctx = message?._data?.ctwaContext;
  if (ctx && (typeof ctx.title === "string" || typeof ctx.description === "string")) return true;

  return false;
}

function adSearchText(message) {
  // Cloud API referral fields
  if (message?.referral) {
    const t = [
      message.referral?.headline,
      message.referral?.body,
      message.referral?.source_url,
      message.referral?.source_id
    ].filter(Boolean).join(" ");
    if (t) return t;
  }
  // Client lib context
  const ctx = message?._data?.ctwaContext || {};
  const t2 = [ctx.title, ctx.description].filter(Boolean).join(" ");
  return t2 || "";
}

function normalSearchText(message) {
  if (typeof message?.text?.body === "string") return message.text.body;
  if (typeof message?.button?.text === "string") return message.button.text;
  if (typeof message?.body === "string") return message.body; // your normalized shape
  return "";
}

// ---------- main (step 1 only: intake/normalize) ----------
/**
 * Build a normalized “matching input” object.
 *
 * @param {object} message          Raw inbound message payload
 * @param {Array<object>} replies   Saved replies list [{ id,title,keywords, match? or misc? }, ...]
 * @returns {{
 *   isAd: boolean,
 *   searchText: string,
 *   replies: Array<{
 *     id: string,
 *     title?: string,
 *     keywords: string[],
 *     regex: RegExp,            // combined regex of keywords (already escaped)
 *     flags: { ads:boolean, messages:boolean }
 *   }>
 * }}
 */
export function intakeMessageForMatching(message, replies = []) {
  const ad = isAdMessage(message);
  const searchText = ad ? adSearchText(message) : normalSearchText(message);

  const normalizedReplies = (replies || []).map(r => {
    const kws = normalizeKeywords(r.keywords || []);
    const combined = kws.length ? new RegExp("(" + kws.map(escapeRegex).join("|") + ")", "i") : null;
    return {
      id: r.id,
      title: r.title,
      keywords: kws,
      regex: combined,
      flags: getChannelFlags(r)
    };
  });

  return { isAd: ad, searchText, replies: normalizedReplies };
}
