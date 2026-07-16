// src/components/ChatWindow.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import MessageBubble from "./MessageBubble.jsx";
import Composer from "./Composer.jsx";
import InlineImageComposer from "./InlineImageComposer.jsx";
import QuickListButton from "./QuickListButton.jsx";
import DayDivider from "./DayDivider.jsx";   // 👈 NEW

// ---- helpers for day grouping ----
function startOfDay(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getDayLabel(date) {
  const d = startOfDay(date);
  const today = startOfDay(new Date());
  const yesterday = startOfDay(new Date(today.getTime() - 24 * 60 * 60 * 1000));

  if (isSameDay(d, today)) return "Hoy";
  if (isSameDay(d, yesterday)) return "Ayer";

  return d.toLocaleDateString([], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function ChatWindow({
  activeConversation,
  connectivity,
  messages,     // NEW: resolved array for the active chat
  loading,      // NEW
  error,        // NEW
  onSendText,
  onSendImage, // (chatId, to, file, caption?) => Promise
}) {
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const [composeFiles, setComposeFiles] = useState(null);
  const [replyTo, setReplyTo] = useState(null);

const buildReplyTo = useCallback((m) => {
  if (!m) return null;

  const type = (m.type || "text").toLowerCase();
  const txt = (m.text || m.caption || "").trim();

  const preview =
    type === "text" ? (txt || "(texto)") :
    type === "image" ? (txt || "📷 Foto") :
    type === "video" ? (txt || "🎥 Video") :
    type === "audio" ? "🎤 Audio" :
    type === "location" ? "📍 Ubicación" :
    type === "document" || type === "file" ? (txt || "📄 Documento") :
    "(mensaje)";

  const waId =
    m.wamid ||
    m.waId ||
    m.message_id ||
    m.messageId ||
    (typeof m.id === "string" && m.id.startsWith("wamid.") ? m.id : null);

  if (!waId) {
    console.warn("[REPLY] No wamid on clicked message (WhatsApp quoting won't work yet).", {
      uiId: m.id,
      keys: Object.keys(m || {}),
    });
  }

  return {
    uiId: m.id,     // always available (your app id)
    waId,           // required for real WhatsApp reply
    sender: m.isMe || m.from === "me" ? "Tú" : "Cliente",
    preview,
    type,
    thumbUrl: m.imageUrl || m.videoUrl || null,
  };
}, []);



  const quickItems = [
    "Hola, ¿en qué puedo ayudarte?",
    "¿Podrías enviarme una foto del comprobante?",
    "Gracias, ya lo reviso.",
    "Te aviso apenas esté listo."
  ];

  const activeId = activeConversation?.id || null;

  useEffect(() => {
    // mount/unmount hook (left empty intentionally)
  }, []);
  useEffect(() => {
  setReplyTo(null);
}, [activeId])

  const normalizeForUI = (m) => {
    const waIdCandidate =
  m.wamid ??
  m.waId ??
  m.message_id ??
  m.messageId ??
  m.id;

const waId =
  typeof waIdCandidate === "string" && waIdCandidate.startsWith("wamid.")
    ? waIdCandidate
    : null;

const replyCand =
  m.replyToId ??
  m.contextMessageId ??
  m.context?.message_id ??
  m.context?.id;

const replyToWaId =
  typeof replyCand === "string" && replyCand.startsWith("wamid.")
    ? replyCand
    : null;

    const ts =
      typeof m.timestamp === "number"
        ? m.timestamp
        : /^\d{10}$/.test(String(m.timestamp))
        ? Number(m.timestamp) * 1000
        : Date.parse(m.timestamp);
      const replyToId =
      m.replyToId ??
      m.reply_to_id ??
      m.contextMessageId ??
      m.context?.id ??
      m.context?.message_id ??
      m.context?.messageId ??
      (typeof m.context === "string" ? m.context : null);

    return {
        ...m,
      waId,
      replyToWaId,
      replyToId,
      id: m.id ?? `${m.chatId}-${ts || "na"}`,
      text: m.text ?? "",
      imageUrl: m.imageUrl ?? undefined,
      isMe: m.from === "me" || m.dir === "out",
      ts: isNaN(ts) ? null : ts, // 👈 normalized timestamp
      timeHHMM: isNaN(ts)
        ? ""
        : new Date(ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
    };
  };
  
  const hasRenderableMessage = (message) => {
    const type = String(message?.type || "text").toLowerCase();
    const text = String(message?.text || message?.message || "").trim();
    if (text) return true;
    if (type === "location") return !!(message?.location || message?.locationUrl || message?.url);
    if (["image", "video", "audio", "document", "file"].includes(type)) {
      return !!(message?.imageUrl || message?.videoUrl || message?.audioUrl || message?.fileUrl || message?.url || message?.mediaId || message?.media?.id);
    }
    if (type === "ctwa_referral") return !!message?.referral_metadata;
    return false;
  };

  const uiMessages = useMemo(() => {
    const base = (messages || [])
      .filter(hasRenderableMessage)
      .slice()
      .sort((a, b) => {
        const ta =
          typeof a.timestamp === "number"
            ? a.timestamp
            : /^\d{10}$/.test(String(a.timestamp))
            ? Number(a.timestamp) * 1000
            : Date.parse(a.timestamp);
        const tb =
          typeof b.timestamp === "number"
            ? b.timestamp
            : /^\d{10}$/.test(String(b.timestamp))
            ? Number(b.timestamp) * 1000
            : Date.parse(b.timestamp);
        return ta - tb;
      })
      .filter(
        (x) =>
          x.type === "text" ||
          x.type === "image" ||
          x.type === "video" ||
          x.type === "audio" || // ✅ audio kept
          x.type === "location" || // ✅ location kept
          x.type === "document" ||
          x.type === "file" ||
          x.type === "ctwa_referral"
      );

    try {
      const last = base[base.length - 1];
      const audioCount = base.filter((m) => m.type === "audio").length;
      const locationCount = base.filter((m) => m.type === "location").length;
      console.log("[FE][ChatWindow] uiMessages", {
        activeId,
        total: base.length,
        audioCount,
        locationCount,
        lastType: last?.type,
      });
    } catch {}

    return base.map(normalizeForUI);
  }, [messages, activeId]);
  
  const messageLookup = useMemo(() => {
    const byUiId = new Map();
    const byWaId = new Map();
    for (const m of uiMessages) {
      byUiId.set(m.id, m);
      if (m.waId) byWaId.set(m.waId, m);
    }
    return { byUiId, byWaId };
  }, [uiMessages]);

  const jumpToMessage = useCallback((targetId) => {
    if (!targetId) return;

    const selector = `[data-message-id="${String(targetId).replace(/"/g, '\"')}"]`;
    const node = listRef.current?.querySelector(selector);
    if (!node) return;

    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("message-jump-highlight");
    window.setTimeout(() => {
      node.classList.remove("message-jump-highlight");
    }, 1400);
  }, []);

useEffect(() => {
  const el = listRef.current;
  if (!el) return;

  const raf = requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });

  return () => cancelAnimationFrame(raf);
}, [uiMessages, activeId]);


  // Focus composer when chat changes
  useEffect(() => {
    composerRef.current?.focus?.();
  }, [activeId]);

  if (!activeConversation) {
    return (
      <section
        className="panel chat-window"
        style={{
          borderLeft: "none",
          display: "grid",
          placeItems: "center",
        }}
      >
        <div className="small">Select a chat to start</div>
      </section>
    );
  }

  const toTarget =
    activeConversation.customerIdRaw ||
    activeConversation.phone ||
    activeConversation.customerId ||
    activeConversation.id;

  // ---- Build items with day dividers ----
// ---- Build items with day dividers (memoized) ----
const customerLabel =
  activeConversation?.displayName?.trim() ||
  activeConversation?.customerId ||
  "Cliente";

const renderedItems = useMemo(() => {
  const out = [];
  let lastDay = null;

  const quotePreview = (orig) => {
    const type = (orig?.type || "text").toLowerCase();
    const txt = (orig?.text || orig?.caption || "").trim();

    if (type === "text") return txt || "(texto)";
    if (type === "image") return txt || "📷 Foto";
    if (type === "video") return txt || "🎥 Video";
    if (type === "audio") return "🎤 Audio";
    if (type === "location") return "📍 Ubicación";
    if (type === "document" || type === "file") return txt || "📄 Documento";
    if (type === "ctwa_referral") return "📣 Anuncio";
    return "(mensaje)";
  };

  for (const m of uiMessages) {
    const ts = m.ts ?? Date.parse(m.timestamp);
    if (!isNaN(ts)) {
      const dayDate = startOfDay(ts);
      if (!lastDay || !isSameDay(dayDate, lastDay)) {
        out.push(<DayDivider key={`day-${ts}`} label={getDayLabel(ts)} />);
        lastDay = dayDate;
      }
    }

    const replyRef = m.replyToId || m.replyToWaId || m.contextMessageId || null;
    const orig = replyRef
      ? (messageLookup.byUiId.get(replyRef) || messageLookup.byWaId.get(replyRef) || null)
      : null;

    const quoted = replyRef
      ? {
          author: orig ? (orig.isMe ? "Tú" : customerLabel) : "Mensaje original",
          preview: orig ? quotePreview(orig) : "Original message unavailable",
          onClick: () => {
            if (orig?.id) jumpToMessage(orig.id);
          },
          canJump: !!orig?.id,
        }
      : null;

    out.push(
      <MessageBubble
        key={m.id}
        message={m}
        quoted={quoted}
        onReply={(msg) => setReplyTo(buildReplyTo(msg))}
      />
    );
  }

  return out;
}, [uiMessages, messageLookup, customerLabel, buildReplyTo, jumpToMessage]);



  return (
    <section
      className="panel chat-window"
      style={{
        borderLeft: "none",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        minHeight: 0,
        height: "100%",
      }}
    >
      {/* TOP — fixed */}
      <div className="panel-header chat-top">
        <div>
          <div className="panel-title">{activeConversation.customerId}</div>
          <div className="small">last seen recently</div>
        </div>
        <div className="small">
          Connectivity:{" "}
          <span
            style={{
              color:
                connectivity === "ok"
                  ? "#16a34a"
                  : connectivity === "fail"
                  ? "#dc2626"
                  : "#6b7280",
            }}
          >
            {connectivity}
          </span>
        </div>
      </div>

      {/* MIDDLE — only this scrolls */}
      <div
        className="messages chat-scroll"
        ref={listRef}
        style={{ overflow: "auto", minHeight: 0 }}
      >
        {error && (
          <div className="small" style={{ padding: 8, color: "#dc2626" }}>
            {String(error)}
          </div>
        )}
        {loading && !uiMessages.length && (
          <div className="small" style={{ padding: 8 }}>
            Cargando conversación…
          </div>
        )}

        {renderedItems}
      </div>

      {/* Inline image preview */}
      {composeFiles && (
        <InlineImageComposer
          chatId={activeConversation.id}
          to={toTarget}
          files={composeFiles}
          onSendImage={(file, caption) =>
            onSendImage(activeConversation.id, toTarget, file, caption)
          }
          onClose={() => setComposeFiles(null)}
          onSent={() => setComposeFiles(null)}
        />
      )}

      {/* BOTTOM — fixed */}
      <div className="chat-composer">
        <Composer
          ref={composerRef}
          disabled={false}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onAfterSendOk={() => setReplyTo(null)}
          onSendText={async (text) => {
          console.log("[REPLY][SEND opts]", { contextMessageId: replyTo?.waId || null });
          await onSendText(activeConversation.id, toTarget, text, {
            contextMessageId: replyTo?.waId || null,  // only wamid goes to WhatsApp
            replyToUiId: replyTo?.uiId || null        // optional: for your own UI linkage
          });

          setReplyTo(null);
        }}

          onSendImage={(fileOrFiles, opts) => {
            const arr =
              fileOrFiles && typeof fileOrFiles.length === "number"
                ? Array.from(fileOrFiles)
                : fileOrFiles
                ? [fileOrFiles]
                : [];

            if (opts?.noPreview) {
              (async () => {
                for (const f of arr) {
                  await onSendImage(
                    activeConversation.id,
                    toTarget,
                    f,
                    opts?.caption
                  );
                }
              })();
              return;
            }

            if (arr.length) setComposeFiles(arr);
          }}
          focusSignal={activeConversation.id}
          activeTo={toTarget}
        />
      </div>
    </section>
  );
}
