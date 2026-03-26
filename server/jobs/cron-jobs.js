// server/jobs/cron-jobs.mjs
import '../utils/consoleLogFilter.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import cron from 'node-cron';

import { insertMessageTasks } from './mongoWriter.js';
import { dailyQuerryAllStates } from './querrys/dailyQuerryAllStates.js';
// import { dailyQuerry15DaysAgo } from './dailyQuerry15DaysAgo.mjs';
// import { dailyQuerry30DaysAgo } from './dailyQuerry30DaysAgo.mjs';

const TZ = 'America/Lima';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whatsAppDB_3';
const STATE_PATH = path.resolve(process.cwd(), '.cron-state.json');
const ENABLE_CATCHUP = String(process.env.CRON_CATCHUP || '1') === '1'; // enable by default

// ------------------- Mongo connect (once) -------------------
async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI /* , { useNewUrlParser: true, useUnifiedTopology: true } */);
  }
}

// ------------------- Simple state (for catch-up) ------------
async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function saveState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}
function ymdInTZ(d = new Date(), tz = TZ) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  // en-CA gives YYYY-MM-DD
  return f.format(d);
}

// ------------------- Shared runner w/ logs & guard ----------
const running = new Map(); // name -> boolean

async function runQuery(name, queryFn) {
  if (running.get(name)) {
    return;
  }
  running.set(name, true);

  const t0 = Date.now();
  try {
    await connectDB();
    const results = await queryFn();

    if (Array.isArray(results) && results.length > 0) {
      await insertMessageTasks(results);
    }

    // persist lastRunAt for catch-up logic
    const state = await loadState();
    state[name] = { lastRunAt: new Date().toISOString(), lastRunYMD: ymdInTZ() };
    await saveState(state);

  } catch (err) {
    console.error(`❌ [CRON][${name}] failed after ${Date.now() - t0} ms ->`, err?.message || err);
  } finally {
    running.set(name, false);
  }
}

// ------------------- Safe scheduler helper ------------------
function safeSchedule(cronExpr, name, fn, { timezone = TZ, catchUpAfterMinute = null } = {}) {
  // node-cron default uses 5 fields (m h dom mon dow). Your expressions follow that pattern.
  cron.schedule(
    cronExpr,
    () => {
      // keep the cron callback tiny; delegate to async
      runQuery(name, fn);
    },
    { timezone }
  );

  // Optional catch-up: if job hasn’t run today and we’re past a given minute threshold in local time, run once.
  // Example: for a 14:01 job, set catchUpAfterMinute = 5 (14:05). If process was busy at 14:01 and warning appeared, it will run once after start.
  if (ENABLE_CATCHUP && typeof catchUpAfterMinute === 'number') {
    (async () => {
      try {
        const state = await loadState();
        const today = ymdInTZ();
        const already = state[name]?.lastRunYMD === today;

        // local time in TZ
        const now = new Date();
        const nowStr = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: TZ }); // HH:MM:SS
        const [HH, MM] = nowStr.split(':').map((n) => parseInt(n, 10));

        if (!already && (HH > 14 || (HH === 14 && MM >= catchUpAfterMinute))) {
          await runQuery(name, fn);
        }
      } catch (e) {
        // ignore catch-up check errors
      }
    })();
  }
}

// ------------------- Schedules ------------------------------
// NOTE: Comments fixed to reflect the actual time (Lima time).
// Format used: "MM HH * * *" -> minute, hour, daily.

// Every minute, all day (ONLY for testing)
safeSchedule('* * * * *', 'dailyQuerryAllStates', dailyQuerryAllStates);

// i.e. 08:05, 09:05, 10:05, ..., 19:05 (Lima time)

// If in the future you want to re-enable 15/30 days:
// safeSchedule('0 9 * * *', 'dailyQuerry15DaysAgo', dailyQuerry15DaysAgo);
// safeSchedule('5 9 * * *', 'dailyQuerry30DaysAgo', dailyQuerry30DaysAgo);

// ------------------- Process guards -------------------------
process.on('unhandledRejection', (r) => {
  console.error('[UNHANDLED REJECTION]', r);
});
process.on('uncaughtException', (e) => {
  console.error('[UNCAUGHT EXCEPTION]', e);
});
