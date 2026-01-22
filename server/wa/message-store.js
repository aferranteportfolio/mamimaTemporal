const sent = new Map(); // wamid -> { to, type, content, at }
export function storeSentMessage({ id, to, type, content }) {
  if (!id) return;
  sent.set(id, { to, type, content, at: Date.now() });
}
export function getSentMessage(id) { return sent.get(id); }
// Minimal helper: upgrade temp message id (outbox:<id>) -> real wamid
export function resolveQueuedMessage(outboxId, wamid) {
  const tempId = `outbox:${outboxId}`;

  // 👇 You must adapt these three lines to your storage implementation
  const msg = globalThis.__messageStore?.get?.(tempId);
  if (!msg) return false;

  // Update + re-key
  const updated = { ...msg, id: wamid, status: "sent", wamid };
  globalThis.__messageStore.set(wamid, updated);
  globalThis.__messageStore.delete(tempId);

  return true;
}
