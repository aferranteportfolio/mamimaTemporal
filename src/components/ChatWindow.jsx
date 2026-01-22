// src/components/ChatWindow.jsx
import { useEffect, useMemo, useRef, useState } from "react";
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

  const normalizeForUI = (m) => {
    const ts =
      typeof m.timestamp === "number"
        ? m.timestamp
        : /^\d{10}$/.test(String(m.timestamp))
        ? Number(m.timestamp) * 1000
        : Date.parse(m.timestamp);

    return {
      ...m,
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

  const uiMessages = useMemo(() => {
    const base = (messages || [])
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
          x.type === "location" // ✅ location kept
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
const renderedItems = useMemo(() => {
  const out = [];
  let lastDay = null;

  for (const m of uiMessages) {
    const ts = m.ts ?? Date.parse(m.timestamp);
    if (!isNaN(ts)) {
      const dayDate = startOfDay(ts);
      if (!lastDay || !isSameDay(dayDate, lastDay)) {
        out.push(
          <DayDivider
            key={`day-${ts}`}
            label={getDayLabel(ts)}
          />
        );
        lastDay = dayDate;
      }
    }

    out.push(<MessageBubble key={m.id} message={m} />);
  }

  return out;
}, [uiMessages]);


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
          onSendText={(text) =>
            onSendText(activeConversation.id, toTarget, text)
          }
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
