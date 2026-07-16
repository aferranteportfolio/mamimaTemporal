import { useEffect, useMemo, useRef, useState } from "react";

/**
 * @param {{
 *   message: {
 *     id: string,
 *     chatId: string,
 *     from: "me" | "them",
 *     dir?: "in" | "out",
 *     type: "text" | "image" | "video" | "audio" | "location" | "document" | "file" | "ctwa_referral",
 *     text?: string,
 *     imageUrl?: string,
 *     videoUrl?: string,
 *     audioUrl?: string,
 *     mediaId?: string,
 *     fileUrl?: string,
 *     fileName?: string,
 *     location?: {
 *       latitude?: number,
 *       longitude?: number,
 *       name?: string | null,
 *       address?: string | null
 *     },
 *     locationUrl?: string,
 *     url?: string,
 *     timestamp: string,
 *     status?: string
 *   }
 * }} props
 */
export default function MessageBubble({ message, onReply, quoted }) {
  // ---------- LOG (generic diff) ----------
  const prevRef = useRef(null);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  function diff(prev, next) {
    if (!prev) return { _firstRender: true };
    const changed = {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of keys)
      if (prev[k] !== next[k]) changed[k] = { prev: prev[k], next: next[k] };
    return changed;
  }
  const changes = useMemo(() => diff(prevRef.current, message), [message]);
  useEffect(() => {
    prevRef.current = message;
  }, [message]);

  // ---------- VIEW ----------
  const isMe       = (message.isMe ?? (message.from === "me"));
  const isImage    = message.type === "image";
  const isVideo    = message.type === "video";
  const isAudio    = message.type === "audio";
  const isLocation = message.type === "location";
  const isDocument = message.type === "document" || message.type === "file";
  const isCtwa = message.type === "ctwa_referral" || message.referral_type === "ads";
  const statusRaw = String(message.status || "").toLowerCase();
  const statusUi =
    isMe && statusRaw
      ? ({
          sending: { label: "Sending…", tone: "sending" },
          queued: { label: "Queued", tone: "queued" },
          accepted: { label: "Accepted", tone: "sent" },
          sent: { label: "Sent", tone: "sent" },
          delivered: { label: "Delivered", tone: "sent" },
          read: { label: "Read", tone: "sent" },
          error: { label: "Failed", tone: "error" },
          failed: { label: "Failed", tone: "error" },
        }[statusRaw] || { label: statusRaw, tone: "queued" })
      : null;

  const ctwaMediaHref =
    message.referral_metadata?.media_url ||
    message.imageUrl ||
    message.videoUrl ||
    message.referral_metadata?.source_url ||
    null;

  const ctwaMediaSrc =
    message.referral_metadata?.image_url ||
    message.referral_metadata?.thumbnail_url ||
    message.imageUrl ||
    message.referral_metadata?.media_url ||
    null;

  const hasCtwaMedia = !!(ctwaMediaHref || ctwaMediaSrc);
  const [ctwaMediaUnavailable, setCtwaMediaUnavailable] = useState(false);

  const truncateText = (value, max = 30) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  };

  const ctwaHeadlineRaw = message.referral_metadata?.headline || "Ad referral";
  const ctwaBodyRaw = message.referral_metadata?.body || "";
  const ctwaPreviewText = truncateText(ctwaBodyRaw || ctwaHeadlineRaw, 30);

  const customerCtwaText = (() => {
    const customerText = String(message.text || "").trim();
    if (!customerText) return "";

    const normalizedCustomerText = customerText.toLowerCase();
    const normalizedAdHeadline = String(ctwaHeadlineRaw || "").trim().toLowerCase();
    const normalizedAdBody = String(ctwaBodyRaw || "").trim().toLowerCase();

    if (
      normalizedCustomerText &&
      (normalizedCustomerText === normalizedAdHeadline || normalizedCustomerText === normalizedAdBody)
    ) {
      return "";
    }

    return customerText;
  })();

  useEffect(() => {
    setCtwaMediaUnavailable(false);
  }, [message.id, ctwaMediaHref, ctwaMediaSrc]);

  // IMAGE / VIDEO SRC
  const mediaSrc = useMemo(() => {
    if (isImage) {
      return (
        message.imageUrl ||
        (message.mediaId ? `/api/media/${message.mediaId}` : undefined)
      );
    }
    if (isVideo) {
      return (
        message.videoUrl ||
        (message.mediaId ? `/api/media/${message.mediaId}` : undefined)
      );
    }
    return undefined;
  }, [isImage, isVideo, message.imageUrl, message.videoUrl, message.mediaId]);

  const documentSrc = useMemo(() => {
    if (!isDocument) return undefined;
    return message.fileUrl || message.url || (message.mediaId ? `/api/media/${message.mediaId}` : undefined);
  }, [isDocument, message.fileUrl, message.url, message.mediaId]);

  // AUDIO SRC → usamos audioUrl (URL directa de WhatsApp)
  const audioSrc = useMemo(() => {
    if (!isAudio) return undefined;
    return message.audioUrl || undefined;
  }, [isAudio, message.audioUrl]);

  // LOCATION: label + URL
  const { location, locationUrl: rawLocUrl, url: genericUrl } = message;
  const computedLocationUrl = useMemo(() => {
    if (!isLocation) return undefined;
    if (rawLocUrl) return rawLocUrl;
    if (genericUrl) return genericUrl;

    const lat = location?.latitude;
    const lng = location?.longitude;
    if (typeof lat === "number" && typeof lng === "number") {
      return `https://www.google.com/maps?q=${lat},${lng}`;
    }
    return undefined;
  }, [
    isLocation,
    rawLocUrl,
    genericUrl,
    location?.latitude,
    location?.longitude,
  ]);

  const locationLabel =
    location?.name ||
    message.text ||
    "Ubicación";

  // 🔍 Log when an audio message “arrives” to the bubble
  useEffect(() => {
    if (message?.type === "audio") {
      console.log("[FE][AUDIO][BUBBLE]", {
        id: message.id,
        chatId: message.chatId,
        from: message.from,
        type: message.type,
        audioUrl: message.audioUrl,
        mediaId: message.mediaId,
        timestamp: message.timestamp,
        status: message.status,
        renderCount: renderCountRef.current,
        changes,
      });
    }
  }, [
    message.id,
    message.chatId,
    message.from,
    message.type,
    message.audioUrl,
    message.mediaId,
    message.timestamp,
    message.status,
    changes,
  ]);

  // 🔍 Log when bubble has an audioSrc ready to render
  useEffect(() => {
    if (isAudio && audioSrc) {
      console.log("[FE][AUDIO][MESSAGE]", {
        id: message.id,
        chatId: message.chatId,
        from: message.from,
        type: message.type,
        audioUrl: audioSrc,
        mediaId: message.mediaId,
        timestamp: message.timestamp,
        status: message.status,
      });
    }
  }, [
    isAudio,
    audioSrc,
    message.id,
    message.chatId,
    message.from,
    message.type,
    message.mediaId,
    message.timestamp,
    message.status,
  ]);

  // 🔍 Log locations
  useEffect(() => {
    if (isLocation) {
      console.log("[FE][LOCATION][BUBBLE]", {
        id: message.id,
        chatId: message.chatId,
        from: message.from,
        location,
        locationUrl: computedLocationUrl,
        timestamp: message.timestamp,
      });
    }
  }, [
    isLocation,
    computedLocationUrl,
    location,
    message.id,
    message.chatId,
    message.from,
    message.timestamp,
  ]);

  return (
  <div className={`bubble-wrapper ${isMe ? "me" : "them"}`} data-message-id={message.id}>
    <div className={`bubble ${isMe ? "me" : "them"}`}>

  <button
    type="button"
    className="bubble-reply-btn"
    title="Responder"
    onClick={(e) => {
      e.stopPropagation();
      onReply?.(message);
    }}
  >
    ↩
  </button>

  {/* ✅ QUOTED HEADER */}
  {quoted && (
    <button
      type="button"
      className={`bubble-quote ${quoted?.canJump ? "is-clickable" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (quoted?.canJump) quoted?.onClick?.();
      }}
      title={quoted?.canJump ? "Ir al mensaje original" : "Mensaje original no disponible"}
    >
      <div className="bubble-quote-title">{quoted.author}</div>
      <div className="bubble-quote-text">{quoted.preview}</div>
    </button>
  )}

  {/* TEXT */}
  {message.type === "text" && !isCtwa && (
    <div style={{ whiteSpace: "pre-wrap" }}>{message.text}</div>
  )}


      {/* IMAGE */}
      {isImage && mediaSrc && (
        <div>
          <button
            type="button"
            title="Abrir imagen"
            aria-label="Abrir imagen"
            onClick={(e) => {
              e.stopPropagation();
              window.open(mediaSrc, "_blank", "noopener,noreferrer");
            }}
            style={{
              border: 0,
              padding: 0,
              margin: 0,
              background: "transparent",
              display: "block",
              cursor: "zoom-in",
            }}
          >
            <img
              src={mediaSrc}
              alt="sent"
              style={{ maxWidth: 280, borderRadius: 8, display: "block" }}
            />
          </button>
          {message.text && (
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
              {message.text}
            </div>
          )}
        </div>
      )}

      {/* VIDEO */}
      {isVideo && mediaSrc && (
        <div>
          <video
            src={mediaSrc}
            controls
            preload="metadata"
            playsInline
            style={{ maxWidth: 280, borderRadius: 8, display: "block" }}
          />
          {message.text && (
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
              {message.text}
            </div>
          )}
        </div>
      )}


      {/* DOCUMENT */}
      {isDocument && documentSrc && (
        <div style={{ maxWidth: 280 }}>
          <a
            href={documentSrc}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              padding: "6px 12px",
              borderRadius: 9999,
              border: "1px solid #d1d5db",
              background: "#111827",
              color: "#f9fafb",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            📄 {message.fileName || "Abrir documento"}
          </a>
          {message.text && (
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
              {message.text}
            </div>
          )}
        </div>
      )}

      {/* 🔊 AUDIO */}
      {isAudio && audioSrc && (
        <div style={{ pointerEvents: "auto" }}>
          <audio
            controls
            preload="metadata"
            style={{ maxWidth: 280, display: "block", pointerEvents: "auto" }}
            crossOrigin="anonymous"
            onPlay={() => {
              console.log("[FE][AUDIO][PLAY]", {
                id: message.id,
                chatId: message.chatId,
                mediaId: message.mediaId,
                src: audioSrc,
              });
            }}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              console.log("[FE][AUDIO][LOADED]", {
                id: message.id,
                chatId: message.chatId,
                duration: el.duration,
                currentSrc: el.currentSrc,
                mediaId: message.mediaId,
              });
            }}
            onError={(e) => {
              const el = e.currentTarget;
              const mediaError = el?.error;
              console.warn("[FE][AUDIO][ERROR]", {
                id: message.id,
                chatId: message.chatId,
                srcTried: el.currentSrc || audioSrc,
                mediaId: message.mediaId,
                errorCode: mediaError?.code,
                errorMessage: mediaError?.message,
              });
            }}
          >
            <source src={audioSrc} type="audio/ogg" />
            Tu navegador no soporta el elemento de audio.
          </audio>

          {message.text && (
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
              {message.text}
            </div>
          )}
        </div>
      )}

      {/* 📍 LOCATION */}
      {isLocation && (
        <div style={{ maxWidth: 280 }}>
          <div style={{ fontSize: 12, marginBottom: 4, color: "#4b5563" }}>
            {locationLabel}
          </div>

          {computedLocationUrl ? (
            <a
              href={computedLocationUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                padding: "6px 12px",
                borderRadius: 9999,
                border: "1px solid #d1d5db",
                background: "#111827",
                color: "#f9fafb",
                fontSize: 13,
                textDecoration: "none",
                cursor: "pointer",
              }}
              onClick={() => {
                console.log("[FE][LOCATION][CLICK]", {
                  url: computedLocationUrl,
                  id: message.id,
                  chatId: message.chatId,
                });
              }}
            >
              Ubicación
            </a>
          ) : (
            <button
              type="button"
              disabled
              style={{
                padding: "6px 12px",
                borderRadius: 9999,
                border: "1px solid #d1d5db",
                background: "#4b5563",
                color: "#e5e7eb",
                fontSize: 13,
                cursor: "default",
              }}
            >
              Ubicación
            </button>
          )}

          {location?.address && (
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: "#6b7280",
                whiteSpace: "pre-wrap",
              }}
            >
              {location.address}
            </div>
          )}
        </div>
      )}

      {/* CTWA REFERRAL CARD */}
      {isCtwa && (
        <div className="ctwa-card" role="note" aria-label="Mensaje de anuncio">
          <div className="ctwa-badge">Sponsored • From Ad</div>

          {hasCtwaMedia && !ctwaMediaUnavailable && ctwaMediaSrc && (
            <a
              className="ctwa-media-link"
              href={ctwaMediaHref || ctwaMediaSrc}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={ctwaMediaSrc}
                alt="Ad preview"
                className="ctwa-media"
                onError={() => setCtwaMediaUnavailable(true)}
              />
            </a>
          )}

          {(!hasCtwaMedia || ctwaMediaUnavailable || !ctwaMediaSrc) && (
            <div className="ctwa-media-unavailable">Media unavailable</div>
          )}

          <div className="ctwa-headline">{ctwaHeadlineRaw}</div>

          {ctwaPreviewText && (
            <div className="ctwa-body">{ctwaPreviewText}</div>
          )}

          {customerCtwaText && (
            <div className="ctwa-customer-text" style={{ whiteSpace: "pre-wrap" }}>
              {customerCtwaText}
            </div>
          )}

          <div className="ctwa-meta">
            {message.referral_metadata?.ad_name || "Meta Ad"}
            {message.referral_metadata?.campaign_id ? ` • Campaign ${message.referral_metadata.campaign_id}` : ""}
          </div>
        </div>
      )}

      {/* META (time) */}
      <div className="bubble-meta">
        {statusUi && (
          <span className={`bubble-status bubble-status--${statusUi.tone}`}>
            {statusUi.label}
          </span>
        )}
        <span className="bubble-time">
          {new Date(message.timestamp).toLocaleTimeString([], {
	  hour: "2-digit",
	  minute: "2-digit",
  second: "2-digit",
})}
        </span>
      </div>
    </div>
  </div>
);

}
