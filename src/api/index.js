// src/api/index.js
import * as mock from "./mockApi.js";
import * as real from "./realApi.js";

const API_BASE = 'http://localhost:3050'; // same host you use in realtime.js

const raw =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_USE_MOCKS) ??
  process.env.VITE_USE_MOCKS ??
  "true";

const useMocks = String(raw).toLowerCase() === "true";
const api = useMocks ? mock : real;

// --- ADD: real markSeen call ---
export async function markSeen(chatId) {
  console.log("[UNSEEN][API] → markSeen request", chatId);
  const r = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/seen`, {
    method: "POST",
  });
  console.log("[UNSEEN][API] ← markSeen status", r.status);
  if (!r.ok) throw new Error(`markSeen failed: ${r.status}`);
  return r;
}

// existing
export async function sendVideo({ to, file, caption }) {
  const fd = new FormData();
  fd.append("to", to);
  if (caption) fd.append("caption", caption);
  fd.append("file", file);

  const r = await fetch("/api/send-video", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Failed /api/send-video: ${r.status}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "send-video failed");
  return j.data;
}

export const { fetchConversations, fetchMessages, sendText, sendImage } = api;
export { useMocks };
