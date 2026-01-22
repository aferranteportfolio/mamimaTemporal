// server/http-senders.js
import fetch from "node-fetch";

const API_BASE =
  process.env.VITE_API_BASE?.replace(/\/+$/, "") ||
  `http://localhost:${process.env.PORT || 3050}`;

export async function sendTextViaHttp(to, text, from /* sellerId */) {
  const resp = await fetch(`${API_BASE}/api/send-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // If your route supports multi-sender, include { from }
    body: JSON.stringify({ to, text, from }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.ok) {
    const err = new Error(`send-text failed HTTP ${resp.status}: ${json?.error || "unknown"}`);
    err.status = resp.status;
    err.body = json;
    throw err;
  }
  return json.id; // WAMID string
}
