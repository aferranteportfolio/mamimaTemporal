// src/components/SavedRepliesMenu.jsx
import { useMemo, useRef, useState, useEffect } from "react";
import { markSavedReplyUsed } from "../api/realApi.js";

export default function SavedRepliesMenu({
  items = [],
  activeTo,          // phone/recipient from parent
  onInsert,
  onSend,
  onCreate,
  onEdit,
  onDelete,
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [openItem, setOpenItem] = useState(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);

  // --- helpers (handle legacy {title, body} and new {messages:[{text,files}]}) ---
  const previewBody = (it) => {
    if (typeof it.body === "string") return it.body; // legacy
    const texts = (it.messages || []).map(m => (m?.text || "").trim()).filter(Boolean);
    return texts[0] || ""; // first line preview
  };
  const filesCount = (it) =>
    (it.messages || []).reduce((n, m) => n + ((m?.files?.length) || 0), 0);

  // include messages text in search haystack
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(it => {
      const msgText = (it.messages || []).map(m => m?.text || "").join(" ");
      const hay = `${it.title || ""} ${it.body || ""} ${msgText}`.toLowerCase();
      const byQ = !needle || hay.includes(needle);
      const byF = filter === "all" ? true : true; // placeholder for future filters
      return byQ && byF;
    });
  }, [items, q, filter]);

  // close kebab when clicking outside / Esc
  useEffect(() => {
    function onDoc(e) {
      if (!openItem) return;
      if (listRef.current?.contains(e.target)) return;
      setOpenItem(null);
    }
    function onKey(e){ if (e.key === "Escape") setOpenItem(null); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openItem]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select?.();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const markUsed = (id) => {
    if (!id) return;
    // fire-and-forget; pass phone if we have it
    const to = activeTo || undefined;
    markSavedReplyUsed(id, { to }).catch(err => {
      console.warn("[SR] markUsed failed:", err?.message || err);
    });
  };

  return (
    <div className="sr-menu" ref={listRef}>
      <div className="sr-header" style={{ position: "relative", zIndex: 1 }}>
        <div className="sr-title">Respuestas guardadas</div>

        <button
          type="button"
          className="sr-add"
          onClick={() => { console.log("[sr] + Agregar clicked"); onCreate?.(); }}
          style={{ pointerEvents: "auto" }}
        >
          + Agregar
        </button>
      </div>

      <div className="sr-tools">
        <div className="sr-search">
          <span className="sr-search-ico">🔎</span>
          <input
            ref={searchRef}
            placeholder="Buscar"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>

        <div className="sr-filter">
          <button className="sr-filter-btn" type="button" onClick={() => setFilter("all")}>
            Usado frecuentemente ▾
          </button>
        </div>
      </div>

      <div className="sr-list">
        {filtered.map(it => {
          const count = filesCount(it);
          return (
            <div key={it.id} className="sr-item">
              <div className="sr-avatar" aria-hidden="true">{it.emoji || "🗂️"}</div>

              {/* Clicking the main area sends immediately (keep behavior) */}
              <button
                type="button"
                className="sr-main"
                title="Enviar ahora"
                onClick={(e) => {
                  e.stopPropagation();
                  markUsed(it.id);                 // 👈 mark usage with phone
                  onSend?.(it, { noPreview: true });
                  setOpenItem(null);
                }}
              >
                <div className="sr-item-title">
                  {it.title || "(sin título)"}
                  {count > 0 && (
                    <span className="sr-filebadge" aria-label={`${count} adjunto(s)`}>
                      {count}
                    </span>
                  )}
                </div>
                <div className="sr-item-body">
                  {previewBody(it)}
                </div>
              </button>

              {/* Kebab: Insertar / Editar / Eliminar */}
              <div className="sr-kebab-wrap">
                <button
                  type="button"
                  className="sr-kebab"
                  aria-haspopup="menu"
                  aria-expanded={openItem === it.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenItem(v => (v === it.id ? null : it.id));
                  }}
                >
                  ⋯
                </button>

                {openItem === it.id && (
                  <div className="sr-item-menu" role="menu">
                    <button
                      type="button"
                      className="sr-item-menu-btn"
                      onClick={() => {
                        markUsed(it.id);           // 👈 count Insert as “use”
                        onInsert?.(it);
                        setOpenItem(null);
                      }}
                    >
                      Insertar
                    </button>

                    <button
                      type="button"
                      className="sr-item-menu-btn"
                      onClick={() => { onEdit?.(it); setOpenItem(null); }}
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      className="sr-item-menu-btn danger"
                      onClick={() => {
                        setOpenItem(null);
                        if (!onDelete) return;
                        const ok = confirm(`Eliminar “${it.title || "sin título"}”?`);
                        if (ok) onDelete(it);
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="sr-empty">Sin resultados</div>
        )}
      </div>
    </div>
  );
}
