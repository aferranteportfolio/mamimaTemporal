// server/wa/outbox-store.js
import { initializeCostumerAndStoreMessageHistory, normalizeCustomerId } from "../dbFunctionality/functionality.js";

const OUR_NUMBER = normalizeCustomerId(process.env.OUR_NUMBER || "");

function iso() {
  return new Date().toISOString();
}

export async function storeQueuedText({ to, text, outboxId, contextMessageId = null }) {
  const dbPayload = {
    id: `outbox:${outboxId}`,
    outboxId,
    status: "queued",
    from: OUR_NUMBER,
    to,
    type: "text",
    message: text,
    timestamp: iso(),
    dir: "out",
    contextMessageId,
    replyToId: contextMessageId,
  };

  await initializeCostumerAndStoreMessageHistory(dbPayload, 0);
  return dbPayload.id;
}

export async function storeAcceptedText({ to, text, outboxId, wamid, contextMessageId = null }) {
  const dbPayload = {
    id: wamid,
    outboxId,
    status: "sent",
    from: OUR_NUMBER,
    to,
    type: "text",
    message: text,
    timestamp: iso(),
    dir: "out",
    contextMessageId,
    replyToId: contextMessageId,
  };

  await initializeCostumerAndStoreMessageHistory(dbPayload, 0);
}
