import { useEffect, useMemo, useRef, useState } from "react";
import { sendImage } from "../api/index.js";

export default function InlineImageComposer({ to, files, onClose, onSent, onSendImage }) {
  const [items, setItems] = useState([]);
  const [caption, setCaption] = useState("");
  const fileInputRef = useRef(null);

  // build previews
  useEffect(() => {
    const arr = Array.from(files || []);
    const mapped = arr.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setItems(mapped);
    return () => mapped.forEach(x => URL.revokeObjectURL?.(x.url));
  }, [files]);

  const removeAt = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const onAddMore = (e) => {
    const more = Array.from(e.target.files || []);
    if (!more.length) return;
    const mapped = more.map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setItems(prev => [...prev, ...mapped]);
    e.target.value = "";
  };

  const canSend = to && items.length > 0;

  const onSend = async () => {
    try {
      for (const it of items) {
        if (onSendImage) {
          await onSendImage(it.file, caption);
        } else {
          await sendImage({ to, file: it.file, caption });
        }
      }
      onSent?.();
      onClose?.();
    } catch (err) {
      console.error("sendImage failed", err);
      alert("Error al enviar la(s) imagen(es). Revisa la consola.");
    }
  };

  return (
    <div
      className="inline-image-composer"
      style={{
        position: "sticky",
        bottom: 0,
        background: "#fff",
        borderTop: "1px solid #e5e7eb",
        padding: "12px",
        zIndex: 2
      }}
    >
      {/* Top bar like WhatsApp: title + close */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Enviar imágenes</div>
        <button
          onClick={onClose}
          style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer" }}
          title="Cerrar"
        >
          ✕
        </button>
      </div>

      {/* Main preview (first image) */}
      {items[0] && (
        <div
          style={{
            width: "100%",
            maxHeight: "45vh",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid #e5e7eb",
            marginBottom: 8
          }}
        >
          <img
            src={items[0].url}
            alt="preview"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#00000010" }}
          />
        </div>
      )}

      {/* Thumbnails row + +Add button */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto", marginBottom: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img
              src={it.url}
              alt={`thumb-${i}`}
              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }}
              onClick={() => {
                // move clicked image to slot 0 (becomes main preview)
                setItems(prev => {
                  const copy = [...prev];
                  const [chosen] = copy.splice(i, 1);
                  return [chosen, ...copy];
                });
              }}
            />
            <button
              onClick={() => removeAt(i)}
              title="Eliminar"
              style={{
                position: "absolute", top: -6, right: -6, width: 20, height: 20,
                borderRadius: "50%", border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer"
              }}
            >
              ×
            </button>
          </div>
        ))}

        <label
          style={{
            display: "inline-flex", justifyContent: "center", alignItems: "center",
            width: 64, height: 64, border: "2px dashed #d1d5db", borderRadius: 8,
            cursor: "pointer", flex: "0 0 auto"
          }}
          title="Agregar más"
        >
          +
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={onAddMore}
          />
        </label>
      </div>

      {/* Caption box */}
      <textarea
        rows={2}
        placeholder="Escribe un pie de foto…"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={1024}
        style={{
          width: "100%",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 8,
          outline: "none",
          marginBottom: 8
        }}
      />

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb" }}>
          Cancelar
        </button>
        <button
          onClick={onSend}
          disabled={!canSend}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "none",
            color: "#fff",
            background: canSend ? "#16a34a" : "#9ca3af",
            cursor: canSend ? "pointer" : "not-allowed"
          }}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
