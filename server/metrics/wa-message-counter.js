// server/metrics/wa-message-counter.js
import fs from "node:fs";
import path from "node:path";

const COUNTER_FILE = path.resolve(process.cwd(), "wa-message-stats.json");

// In-memory counters (new model)
let stats = {
  serverAttempts: 0,   // every time we TRY to send to WA API
  apiAccepted: 0,      // WA API returned 200 + wamid
  statusSent: 0,       // webhook status = "sent"
  statusDelivered: 0,  // webhook status = "delivered"
  statusRead: 0,       // webhook status = "read"
  statusFailed: 0      // webhook status = "failed"/"undeliverable"
};

// ─────────────────────────────────────────────────────────────
// Load existing file on startup (backwards compatible)
// ─────────────────────────────────────────────────────────────
try {
  if (fs.existsSync(COUNTER_FILE)) {
    const raw = fs.readFileSync(COUNTER_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object") {
      stats = {
        // if we already wrote new-style keys, use them
        serverAttempts: Number(
          parsed.serverAttempts ?? parsed.serverSent ?? 0
        ),
        apiAccepted: Number(
          parsed.apiAccepted ?? parsed.sent ?? 0
        ),
        statusSent: Number(
          parsed.statusSent ?? parsed.sent ?? 0
        ),
        statusDelivered: Number(
          parsed.statusDelivered ?? parsed.delivered ?? 0
        ),
        statusRead: Number(
          parsed.statusRead ?? parsed.read ?? 0
        ),
        statusFailed: Number(
          parsed.statusFailed ?? 0
        )
      };
    }
  }
} catch (err) {
  console.error("[WA STATS] failed to load stats file:", err);
}

// ─────────────────────────────────────────────────────────────
// Persist
// ─────────────────────────────────────────────────────────────
function persist() {
  const toSave = {
    ...stats,
    // also persist legacy-style fields so any external readers still see them
    sent: stats.statusSent,
    delivered: stats.statusDelivered,
    read: stats.statusRead,
    serverSent: stats.serverAttempts
  };

  fs.writeFile(
    COUNTER_FILE,
    JSON.stringify(toSave, null, 2),
    { encoding: "utf8" },
    (err) => {
      if (err) {
        console.error("[WA STATS] failed to write stats file:", err);
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────
// New explicit increment functions
// ─────────────────────────────────────────────────────────────
export function incServerAttempts() {
  stats.serverAttempts += 1;
  persist();
}

export function incApiAccepted() {
  stats.apiAccepted += 1;
  persist();
}

export function incStatusSent() {
  stats.statusSent += 1;
  persist();
}

export function incStatusDelivered() {
  stats.statusDelivered += 1;
  persist();
}

export function incStatusRead() {
  stats.statusRead += 1;
  persist();
}

export function incStatusFailed() {
  stats.statusFailed += 1;
  persist();
}

// ─────────────────────────────────────────────────────────────
// Legacy aliases (keep old code working exactly as before)
// ─────────────────────────────────────────────────────────────
export function incSent() {
  // Old "sent" was actually counting webhook status=sent
  incStatusSent();
}

export function incDelivered() {
  incStatusDelivered();
}

export function incRead() {
  incStatusRead();
}

export function incServerSent() {
  // Old "serverSent" ≈ server attempts
  incServerAttempts();
}

// ─────────────────────────────────────────────────────────────
// Getter
// ─────────────────────────────────────────────────────────────
export function getStats() {
  return {
    ...stats,
    // keep legacy fields in the returned object too
    sent: stats.statusSent,
    delivered: stats.statusDelivered,
    read: stats.statusRead,
    serverSent: stats.serverAttempts
  };
}
