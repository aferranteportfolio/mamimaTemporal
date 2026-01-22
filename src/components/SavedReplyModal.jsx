// SavedReplyModal.jsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function SavedReplyModal({
  open,
  initialTitle = "",
  initialMessages = [{ text: "", files: [] }],
  onCancel,
  onSave
}) {
  const [title, setTitle] = useState(initialTitle);
  const [messages, setMessages] = useState(() => cloneMsgs(initialMessages));

  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const firstMsgRef = useRef(null);
  const fileInputs = useRef([]);

  // keep local state in sync only when opening (avoid render loop)
  useEffect(() => {
    if (!open) return;

    setTitle(initialTitle ?? "");
    setMessages(cloneMsgs(initialMessages));

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    queueMicrotask(() => {
      if (!initialTitle?.trim()) titleRef.current?.focus();
      else firstMsgRef.current?.focus();
    });

    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  if (!open) return null;

  const canSave =
    !!title.trim() || messages.some(m => m.text.trim() || m.files?.length);

  const onBackdrop = (e) => {
    if (e.target === e.currentTarget) onCancel?.();
  };

  const setMsgText = (idx, v) => {
    setMessages(prev => prev.map((m, i) => (i === idx ? { ...m, text: v } : m)));
  };

  const onPickFiles = (idx, files) => {
    setMessages(prev =>
      prev.map((m, i) =>
        i === idx ? { ...m, files: Array.from(files || []) } : m
      )
    );
  };

  const onKeyDownShell = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") onCancel?.();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSave) {
      onSave?.({ title, messages: cloneMsgs(messages) });
    }
  };

  return createPortal(
    <div
      onMouseDown={onBackdrop}
      onKeyDown={onKeyDownShell}
      aria-hidden="false"
      style={{
        position: "fixed", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, background: "rgba(12,18,27,.55)",
        backdropFilter: "blur(2px)", zIndex: 10000
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-labelledby="srp-title"
        ref={dialogRef}
        style={{
          width: "min(720px, 92vw)",
          maxHeight: "85vh", overflow: "auto",
          background: "#fff", borderRadius: 20,
          boxShadow: "0 20px 60px rgba(0,0,0,.25)",
          display: "flex", flexDirection: "column",
          pointerEvents: "auto"
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="srp-header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid #eee"}}>
          <h3 id="srp-title" style={{margin:0}}>Nueva respuesta guardada</h3>
          <button className="srp-x" onClick={onCancel} aria-label="Cerrar">×</button>
        </div>

        <div className="srp-body" style={{padding:16}}>
          <label className="srp-label">Título</label>
          <div className="srp-pill" style={{marginBottom:12}}>
            <input
              ref={titleRef}
              className="srp-pill-input"
              placeholder="Ej. POSTSHAPPER"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="srp-messages">
            {messages.map((m, i) => (
              <div className="srp-msg" key={i} style={{marginBottom:16}}>
                <label className="srp-label">Contenido{i + 1}</label>

                <div className="srp-textarea-wrap" style={{position:"relative"}}>
                  <textarea
                    ref={i === 0 ? firstMsgRef : undefined}
                    className="srp-textarea"
                    placeholder="Escribe el mensaje…"
                    value={m.text}
                    onChange={(e) => setMsgText(i, e.target.value)}
                    style={{ width:"100%", minHeight:96, resize:"vertical", pointerEvents:"auto" }}
                  />
                  <button
                    type="button"
                    className="srp-clip"
                    title="Adjuntar archivos"
                    aria-label="Adjuntar archivos"
                    onClick={() => fileInputs.current[i]?.click()}
                    style={{
                      position:"absolute", right:6, bottom:6,
                      width:32, height:32, borderRadius:8, border:"1px solid #e5e7eb",
                      background:"#fff"
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 13.5V8a5 5 0 0 1 10 0v7a3.5 3.5 0 1 1-7 0V9.5"
                            fill="none" stroke="currentColor" strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <input
                    type="file"
                    multiple
                    ref={(el) => (fileInputs.current[i] = el)}
                    onChange={(e) => onPickFiles(i, e.target.files)}
                    style={{ display: "none" }}
                  />
                </div>

                {!!m.files?.length && (
                  <div className="srp-files" style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                    {m.files.map((f, idx) => (
                      <span key={idx} className="srp-filechip" title={f.name}>{f.name}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="srp-add"
            onClick={() => setMessages(p => [...p, { text: "", files: [] }])}
          >
            <i className="bi bi-plus-circle" />
            <span>agrega otro mensaje</span>
          </button>
        </div>

        <div className="srp-footer" style={{display:"flex",justifyContent:"flex-end",gap:8,padding:"12px 16px",borderTop:"1px solid #eee"}}>
          <button className="srp-btn ghost" onClick={onCancel}>Cancelar</button>
          <button
            className="srp-btn primary"
            onClick={() => onSave({ title, messages: cloneMsgs(messages) })}
            disabled={!canSave}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// — helpers —
function cloneMsgs(arr) {
  console.log("this is the arr that is being passed on" , arr)
  return (arr ?? []).map(m => ({
    text: m?.text ?? "",
    files: Array.isArray(m?.files) ? [...m.files] : []
  }));
}
