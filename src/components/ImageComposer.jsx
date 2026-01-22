import { useEffect, useRef, useState } from "react";
import { sendImage } from "../api/index.js"; // 👈 add sendImage

export default function MediaComposer({ to, files, onClose, onSent }) {
  // items: { file: File, url: string, kind: "image"|"video" }
  const [items, setItems] = useState([]);
  const [caption, setCaption] = useState("");

  // build previews
  useEffect(() => {
    const arr = Array.from(files || []);
    const mapped = arr.map(f => ({
      file: f,
      url: URL.createObjectURL(f),
      kind: f.type.startsWith("video") ? "video" : "image",
    }));
    setItems(mapped);

    return () => {
      // cleanup object URLs
      mapped.forEach(x => URL.revokeObjectURL?.(x.url));
    };
  }, [files]);

  const addMoreRef = useRef(null);

  const onAddMore = (e) => {
    const more = Array.from(e.target.files || []);
    if (!more.length) return;

    const mapped = more.map(f => ({
      file: f,
      url: URL.createObjectURL(f),
      kind: f.type.startsWith("video") ? "video" : "image",
    }));

    setItems(prev => [...prev, ...mapped]);
    e.target.value = ""; // reset picker
  };

  const removeAt = (i) =>
    setItems(prev => {
      const x = prev[i];
      if (x?.url) URL.revokeObjectURL?.(x.url);
      return prev.filter((_, idx) => idx !== i);
    });

  const canSend = items.length > 0 && to;

  // WhatsApp: one media per message → send sequentially
  const onSend = async () => {
    try {
      for (const it of items) {
        if (it.kind === "video") {
          await sendImage({ to, file: it.file, caption }); // expects same shape as sendImage
        } else {
          await sendImage({ to, file: it.file, caption });
        }
      }
      onSent?.();
      onClose?.();
    } catch (err) {
      console.error("send media failed", err);
      alert("Error al enviar. Revisa la consola.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Enviar medios</h3>
          <button className="text-sm px-2 py-1 rounded hover:bg-gray-100" onClick={onClose}>✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Thumbnails / previews */}
          <div className="grid grid-cols-3 gap-3">
            {items.map((it, i) => (
              <div key={i} className="relative group rounded-xl overflow-hidden border">
                {it.kind === "video" ? (
                  <video
                    src={it.url}
                    className="w-full h-32 object-cover"
                    controls
                    muted
                  />
                ) : (
                  <img
                    src={it.url}
                    alt={`media-${i}`}
                    className="w-full h-32 object-cover"
                  />
                )}
                <span className="absolute left-1 top-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                  {it.kind}
                </span>
                <button
                  onClick={() => removeAt(i)}
                  className="absolute top-1 right-1 bg-white/90 rounded-full px-2 py-0.5 text-xs shadow hidden group-hover:block"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
            ))}

            {/* Add more */}
            <label className="flex items-center justify-center h-32 border-2 border-dashed rounded-xl cursor-pointer hover:bg-gray-50">
              <span className="text-sm">+ Agregar</span>
              <input
                ref={addMoreRef}
                type="file"
                accept="image/*,video/*"   // 👈 allow videos too
                multiple
                className="hidden"
                onChange={onAddMore}
              />
            </label>
          </div>

          {/* Caption */}
          <div>
            <label className="block text-sm font-medium mb-1">Texto (opcional)</label>
            <textarea
              className="w-full border rounded-xl p-2 focus:outline-none focus:ring"
              rows={3}
              maxLength={1024}
              placeholder="Escribe un texto para acompañar…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <div className="text-xs text-gray-500 mt-1">{caption.length}/1024</div>
          </div>
        </div>

        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button className="px-3 py-2 rounded-lg hover:bg-gray-100" onClick={onClose}>Cancelar</button>
          <button
            className={`px-4 py-2 rounded-lg text-white ${canSend ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'}`}
            disabled={!canSend}
            onClick={onSend}
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
