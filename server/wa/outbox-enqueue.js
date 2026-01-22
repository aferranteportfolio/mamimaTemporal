import { OutboxMessage } from "./outbox-model.js";

export async function enqueueText({ to, body, runId = null, seq = null }) {
  const doc = await OutboxMessage.create({
    kind: "text",
    to,
    body,
    runId,
    seq,
    state: "pending",
    attempts: 0,
    nextAttemptAt: new Date(),
  });
  return doc;
}
