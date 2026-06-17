// server/jobs/time-utils.mjs
const LIMA_TZ = 'America/Lima';
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 20; // exclusive: [08:00, 20:00) Lima

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

function isLimaBusinessTime(date) {
  const h = getLimaHour(date);
  return h >= BUSINESS_START_HOUR && h < BUSINESS_END_HOUR;
}

function findBusinessTimeAtOrAfter(start, latest, stepMs) {
  let candidate = new Date(start);
  for (let i = 0; i < 48 && candidate.getTime() <= latest.getTime(); i++) {
    if (isLimaBusinessTime(candidate)) return candidate;
    candidate = new Date(candidate.getTime() + stepMs);
  }
  return null;
}

function findBusinessTimeAtOrBefore(start, earliest, stepMs) {
  let candidate = new Date(start);
  for (let i = 0; i < 48 && candidate.getTime() > earliest.getTime(); i++) {
    if (isLimaBusinessTime(candidate)) return candidate;
    candidate = new Date(candidate.getTime() - stepMs);
  }
  return null;
}

/**
 * computeSendAt(lastInbound, schedule)
 *
 * Modes:
 *  - Legacy/no schedule: keep the previous "near 24h" behavior and only pick
 *    a Lima business-hour slot [08:00, 20:00). This preserves existing
 *    programmed messages that do not yet have delayAfterInbound config.
 *  - delayAfterInbound: start from lastInbound + delayHours, then keep it
 *    within Lima business hours [08:00, 20:00) and inside the safe WhatsApp
 *    deadline (lastInbound + 24h - 30min). This prevents overnight sends such
 *    as 02:00 while still honoring the configured delay as closely as possible.
 */
export function computeSendAt(lastInbound, schedule = null) {
  if (!lastInbound) return null;

  const inboundDate = lastInbound instanceof Date ? lastInbound : new Date(lastInbound);
  if (Number.isNaN(inboundDate.getTime())) return null;

  const DEADLINE_MS = 24 * 60 * 60 * 1000;
  const SAFETY_MS   = 30 * 60 * 1000; // send at least 30min before 24h
  const STEP_MS     = 30 * 60 * 1000; // search backwards in 30min steps
  const safeDeadline = new Date(inboundDate.getTime() + DEADLINE_MS - SAFETY_MS);

  if (schedule?.mode === 'delayAfterInbound') {
    const delayHours = Number(schedule.delayHours);
    if (!Number.isFinite(delayHours) || delayHours <= 0) return null;

    const requested = new Date(inboundDate.getTime() + delayHours * 60 * 60 * 1000);
    if (requested.getTime() <= inboundDate.getTime()) return null;

    // Clamp delays past the safe WhatsApp deadline rather than creating a task
    // that the dispatcher will inevitably reject after the 24h window expires.
    const bounded = requested.getTime() > safeDeadline.getTime() ? safeDeadline : requested;

    if (isLimaBusinessTime(bounded)) return bounded;

    // Prefer the first business slot after the configured delay. If that would
    // miss the safe WhatsApp deadline, fall back to the latest business slot
    // before the bounded deadline. This avoids surprise overnight sends.
    return (
      findBusinessTimeAtOrAfter(bounded, safeDeadline, STEP_MS) ||
      findBusinessTimeAtOrBefore(bounded, inboundDate, STEP_MS)
    );
  }

  // Legacy behavior: send as late as possible within the 24h window, but inside
  // Lima business hours. This intentionally keeps the old [08:00,20:00) rule.
  let candidate = new Date(safeDeadline);

  // Max 48 iterations = 24h / 30min → safe
  for (let i = 0; i < 48; i++) {
    const afterInbound = candidate.getTime() > inboundDate.getTime();

    // Business hours: [08:00, 20:00) Lima.
    if (afterInbound && isLimaBusinessTime(candidate)) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() - STEP_MS);
  }

  // If we somehow didn't find a business-hour time, give up
  return null;
}
