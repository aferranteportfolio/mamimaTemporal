// server/jobs/time-utils.mjs
const LIMA_TZ = 'America/Lima';

// Get hour in Lima (0–23) for a given Date (UTC)
export function getLimaHour(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LIMA_TZ,
    hour: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(date);
  const hourStr = parts.find(p => p.type === 'hour')?.value || '0';
  return parseInt(hourStr, 10);
}

/**
 * computeSendAt(lastInbound)
 *
 * Goal:
 *  - Send as LATE as possible inside the 24h window
 *  - Only between business hours [08:00, 20:00) in Lima
 *  - Prefer "around 23h" after lastInbound, but always < 24h
 *  - Add a safety margin so we don't hit the hard 24h border
 */
export function computeSendAt(lastInbound) {
  if (!lastInbound) return null;

  const DEADLINE_MS = 24 * 60 * 60 * 1000;
  const SAFETY_MS   = 30 * 60 * 1000; // send at least 30min before 24h
  const STEP_MS     = 30 * 60 * 1000; // search backwards in 30min steps

  // Hard deadline: last inbound + 24h - safety
  const deadline = new Date(lastInbound.getTime() + DEADLINE_MS - SAFETY_MS);

  // Start from deadline and go backwards until we find a business-hour slot
  let candidate = new Date(deadline);

  // Max 48 iterations = 24h / 30min → safe
  for (let i = 0; i < 48; i++) {
    const h = getLimaHour(candidate);
    const afterInbound = candidate.getTime() > lastInbound.getTime();

    // Business hours: [08:00, 20:00)
    if (afterInbound && h >= 8 && h < 20) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() - STEP_MS);
  }

  // If we somehow didn't find a business-hour time, give up
  return null;
}
