// server/pm/scheduler.js
import { runProgrammedDispatcher } from "../programmed-dispatcher.js";
import { sendTextAdapter } from "../../server.js";

export const pmStatus = {
  startedAt: null,
  lastTickAt: null,
  lastTickIso: null,
  lastForce: false,
  lastOk: 0,
  lastFail: 0,
  lastMs: 0,
  running: false,
  loopStarted: false,
};

let inFlight = false;

async function tick({ force = false } = {}) {
  if (inFlight) return;
  inFlight = true;
  pmStatus.running = true;

  const t0 = Date.now();
  const nowIso = new Date().toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;


  try {
    const res = await runProgrammedDispatcher({
      force,
      sendText: sendTextAdapter,
      verbose: true,
    });
    pmStatus.lastOk   = res?.ok ?? 0;
    pmStatus.lastFail = res?.fail ?? 0;
  } catch (e) {
    pmStatus.lastFail += 1;
    console.error("[PM] tick error:", e);
  } finally {
    pmStatus.lastMs      = Date.now() - t0;
    pmStatus.lastTickAt  = Date.now();
    pmStatus.lastTickIso = new Date().toISOString();
    pmStatus.lastForce   = force;
    pmStatus.running     = false;
    inFlight             = false;

  }
}

function msToNextMinuteBoundary() {
  const now = Date.now();
  return 60_000 - (now % 60_000) + 250;
}

export function startProgrammedLoop() {
  if (pmStatus.loopStarted) return;
  pmStatus.loopStarted = true;
  pmStatus.startedAt = new Date().toISOString();


  const scheduleNext = () => {
    setTimeout(async () => {
      await tick({ force: false });
      scheduleNext();
    }, msToNextMinuteBoundary());
  };
  scheduleNext();
}

export async function runProgrammedNow(force = false) {
  await tick({ force });
}
