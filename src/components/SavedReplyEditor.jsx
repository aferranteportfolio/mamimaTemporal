import { useMemo, useRef, useState, useEffect } from "react";

/**
 * @param {{
 *  items: Array<{ id:string, title:string, body?:string, preview?:string, steps?: Array<{type:'text'|'image', text?:string, caption?:string}> }>,
 *  onInsert?: (item:any)=>void,
 *  onSend?: (item:any)=>void,
 *  onCreate?: ()=>void
 * }} props
 */
export default function SavedReplyEditor({ items = [], onInsert, onSend, onCreate }) {
  const [q, setQ] = useState("");
  const [openKebab, setOpenKebab] = useState(null); // which row’s kebab is open
  const wrapRef = useRef(null);

  // search
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter(it => {
      const hay = `${it.title ?? ""} ${it.body ?? ""} ${it.preview ?? ""} ${(it.steps ?? [])
        .map(s => (s.type === "text" ? s.text : s.caption) ?? "")
        .join(" ")}`.toLowerCase();
      return hay.includes(n);
    });
  }, [items, q]);

  // close kebab on outside click/esc
  useEffect(() => {
    function onDoc(e) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target)) return;
      setOpenKebab(null);
    }
    function onKey(e) { if (e.key === "Escape") setOpenKebab(null); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="sr-menu" ref={wrapRef}>
      {/* Header */}
      <div className="sr-header">
        <div className="sr-title">Respuestas guardadas</div>
        <button className="sr-add" onClick={onCreate}>+ Agregar</button>
      </div>

      {/* Tools */}
      <div className="sr-tools">
        <div className="sr-search">
          <span className="sr-search-ico">🔎</span>
          <input
            placeholder="Buscar"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="sr-list">
        {filtered.map((it) => {
          // ⬇️ Your preview line lives HERE
          const preview = it.preview
            ?? it.body
            ?? (it.steps?.map(s =>
                  s.type === "text"
                    ? (s.text || "").slice(0, 40)
                    : "[Imagen]"
                ).join(" · ") || "");

          return (
            <div key={it.id} className="sr-item">
              <div className="sr-avatar">🗂️</div>

              <button
                className="sr-main"
                title="Insertar en el mensaje"
                onClick={() => onInsert?.(it)}
              >
                <div className="sr-item-title">{it.title}</div>
                <div className="sr-item-body">{preview}</div>
              </button>

              <div className="sr-kebab-wrap">
                <button
                  className="sr-kebab"
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenKebab(v => (v === it.id ? null : it.id));
                  }}
                >
                  ⋯
                </button>

                {openKebab === it.id && (
                  <div className="sr-item-menu" role="menu">
                    <button
                      className="sr-item-menu-btn"
                      onClick={() => { onInsert?.(it); setOpenKebab(null); }}
                    >
                      Insertar
                    </button>
                    {onSend && (
                      <button
                        className="sr-item-menu-btn"
                        onClick={() => { onSend?.(it); setOpenKebab(null); }}
                      >
                        Enviar
                      </button>
                    )}
                    {/* Hook up Edit/Delete later if you persist to a backend */}
                    {/* <button className="sr-item-menu-btn">Editar</button>
                    <button className="sr-item-menu-btn danger">Eliminar</button> */}
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
