import { MessageTask } from '../dbFunctionality/schemas/messageTask.js';

export async function insertMessageTasks(results) {
  if (!results?.length) {
    console.log("⚠️ No tasks to insert.");
    return { insertedCount: 0, duplicateCount: 0 };
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
    return { insertedCount: inserted.length, duplicateCount: 0 };
  } catch (err) {
    const insertedCount = Array.isArray(err?.insertedDocs) ? err.insertedDocs.length : 0;
    const writeErrors = Array.isArray(err?.writeErrors) ? err.writeErrors : [];

    const duplicateErrors = writeErrors.filter((e) => e?.code === 11000);
    const nonDuplicateErrors = writeErrors.filter((e) => e?.code !== 11000);

    if (nonDuplicateErrors.length > 0 || !writeErrors.length) {
      console.error("❌ Insert failed:", err);
      throw err;
    }

    console.warn(
      `⚠️ Insert completed with duplicates only. inserted=${insertedCount}, duplicates=${duplicateErrors.length}`
    );

    return {
      insertedCount,
      duplicateCount: duplicateErrors.length
    };
  }
}
