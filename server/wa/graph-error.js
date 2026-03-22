export function summarizeGraphError(json = null, status = null) {
  const error = json?.error ?? null;
  const code = error?.code ?? null;
  const subcode = error?.error_subcode ?? null;
  const type = error?.type ?? null;
  const message = error?.message ?? null;
  const fbtraceId = error?.fbtrace_id ?? null;
  const errorData = error?.error_data ?? null;
  const isAuthError = status === 401 || status === 403 || code === 190 || type === "OAuthException";
  const isRateLimit = code === 4 || code === 80007 || status === 429;
  const isRecipientThrottle = code === 131056;

  let hint = null;
  if (isAuthError) {
    hint = "Auth failure from WhatsApp Graph API. Check whether WHATSAPP_TOKEN is missing, expired, or revoked.";
  } else if (isRecipientThrottle) {
    hint = "Recipient-level pacing hit (Meta error 131056). Increase per-recipient delay before retrying.";
  } else if (isRateLimit) {
    hint = "Rate limit from WhatsApp Graph API. Slow down send throughput or honor Retry-After.";
  }

  return {
    status: status ?? null,
    code,
    subcode,
    type,
    message,
    fbtraceId,
    errorData,
    isAuthError,
    isRateLimit,
    isRecipientThrottle,
    hint,
  };
}

export function compactErrorForLog(value) {
  if (!value) return null;

  if (typeof value === "string") {
    return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? String(value.stack).split("\n").slice(0, 6).join("\n") : null,
    };
  }

  try {
    const serialized = JSON.parse(JSON.stringify(value));
    const text = JSON.stringify(serialized);
    if (text.length <= 600) return serialized;
    return { preview: `${text.slice(0, 600)}…` };
  } catch {
    return String(value);
  }
}
