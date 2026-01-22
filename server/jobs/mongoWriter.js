import { MessageTask } from '../dbFunctionality/schemas/messageTask.js';

export async function insertMessageTasks(results) {
  if (!results?.length) {
    console.log("⚠️ No tasks to insert.");
    return;
  }

  const tasks = results.map(({ _id, ...r }) => ({
    ...r,
    sent: false,
    created_at: new Date()
  }));

  console.log("📝 About to insert tasks:", tasks.slice(0, 3));

  try {
    const inserted = await MessageTask.insertMany(tasks, { ordered: false });
    console.log(`✅ ${inserted.length} tasks inserted.`);
  } catch (err) {
    console.error("❌ Insert failed:", err);
  }
}
