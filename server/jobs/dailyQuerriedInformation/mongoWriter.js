// server/jobs/dailyQuerriedInformation/mongoWriter.mjs
import MessageTask from '../../database/model/MessageTask.mjs';

export async function insertMessageTasks(results) {
  if (!Array.isArray(results) || results.length === 0) return;

  const docs = results.map(r => ({
    state_id:   r.state_id,
    program_id: r.program_id,
    customer_id:r.customer_id,
    sellerId:   r.sellerId,
    sendAt:     r.sendAt || new Date(), // default "now" if missing
    productTags:r.productTags || [],
    dedupeKey:  r.dedupeKey,
  }));

  await MessageTask.insertMany(docs, { ordered: false });
}
