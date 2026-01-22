import { useEffect, useMemo, useRef } from "react";

/**
 * @param {{
 *   message: {
 *     id: string,
 *     chatId: string,
 *     from: "me" | "them",
 *     dir?: "in" | "out",
 *     type: "text" | "image" | "video" | "audio" | "location",
 *     text?: string,
 *     imageUrl?: string,
 *     videoUrl?: string,
 *     audioUrl?: string,
 *     mediaId?: string,
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
export default function MessageBubble({ message }) {
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
  const isMe       = message.from === "me";
  const isImage    = message.type === "image";
  const isVideo    = message.type === "video";
  const isAudio    = message.type === "audio";
  const isLocation = message.type === "location";

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
  <div className={`bubble-wrapper ${isMe ? "me" : "them"}`}>
    <div className={`bubble ${isMe ? "me" : "them"}`}>
      {/* TEXT */}
      {message.type === "text" && (
        <div style={{ whiteSpace: "pre-wrap" }}>{message.text}</div>
      )}

      {/* IMAGE */}
      {isImage && mediaSrc && (
        <div>
          <img
            src={mediaSrc}
            alt="sent"
            style={{ maxWidth: 280, borderRadius: 8, display: "block" }}
          />
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

      {/* META (time) */}
      <div className="bubble-meta">
        <span className="bubble-time">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  </div>
);

}
