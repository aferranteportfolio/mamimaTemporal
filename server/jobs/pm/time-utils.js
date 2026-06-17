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
 * computeSendAt(lastInbound, schedule)
 *
 * Modes:
 *  - Legacy/no schedule: keep the previous "near 24h" behavior and only pick
 *    a Lima business-hour slot [08:00, 20:00). This preserves existing
 *    programmed messages that do not yet have delayAfterInbound config.
 *  - delayAfterInbound: schedule exactly lastInbound + delayHours, clamped to
 *    lastInbound + 24h - 30min safety. Explicit delays are allowed at 20:00+
 *    because the UI now communicates delay-based scheduling rather than fixed
 *    business-hour slots; the dispatcher still performs the final 24h guard.
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
    return requested.getTime() > safeDeadline.getTime() ? safeDeadline : requested;
  }

  // Legacy behavior: send as late as possible within the 24h window, but inside
  // Lima business hours. This intentionally keeps the old [08:00,20:00) rule.
  let candidate = new Date(safeDeadline);

  // Max 48 iterations = 24h / 30min → safe
  for (let i = 0; i < 48; i++) {
    const h = getLimaHour(candidate);
    const afterInbound = candidate.getTime() > inboundDate.getTime();

    // Business hours: [08:00, 20:00)
    if (afterInbound && h >= 8 && h < 20) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() - STEP_MS);
  }

  // If we somehow didn't find a business-hour time, give up
  return null;
}
