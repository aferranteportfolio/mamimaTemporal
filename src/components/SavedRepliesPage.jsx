import { useMemo, useState, useEffect } from "react";

// Safe client-only API base (used for DELETE/PUT/POST)
const API_BASE =
  (typeof window !== "undefined" && import.meta?.env?.VITE_API_BASE?.replace(/\/+$/,"")) ||
  (typeof window !== "undefined" && `${location.protocol}//${location.hostname}:3050`) ||
  "";

// Parse "foo, bar ,baz" -> ["foo","bar","baz"]
const parseKeywords = (s = "") =>
  s.split(",").map(x => x.trim()).filter(Boolean);

export default function SavedRepliesPage() {
  // ====== SERVER LIST ======
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // fetch the SAME endpoint you already use elsewhere
  useEffect(() => {
    let abort = new AbortController();

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        console.log("[SR] FETCH -> /api/saved-replies?full=1");
        const res = await fetch("/api/saved-replies?full=1", {
          signal: abort.signal,
          headers: { Accept: "application/json" },
          // credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log("[SR] FETCH ← items", data);

        // normalize to {id, title, ...}
        const normalized = (Array.isArray(data) ? data : []).map(x => ({
          id: x.id || x._id || crypto.randomUUID(),
          title: x.title || x.name || "Untitled",
          messages: x.messages || x.parts || [],   // keep what the server returns
          triggers: x.triggers || [],
          keywords: x.keywords || [],              // prefer keywords if server already has them
          misc: x.misc ?? null,
          raw: x
        }));

        setList(normalized);
      } catch (e) {
        if (e.name !== "AbortError") {
          console.error("[SR] list fetch failed:", e);
          setErr(e.message || String(e));
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => abort.abort();
  }, []);

  // ====== LOCAL UI STATE ======
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);

  // pick first item after fetch
  useEffect(() => {
    if (!list.length) return;
    if (!activeId) setActiveId(list[0].id);
  }, [list, activeId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return !s ? list : list.filter(x => (x.title || "").toLowerCase().includes(s));
  }, [list, q]);

  const active = useMemo(
    () => filtered.find(x => x.id === activeId) || filtered[0],
    [filtered, activeId]
  );

  // ====== FORM STATE (from active) ======
  const [title, setTitle] = useState("");
  const [parts, setParts] = useState([""]);
  const [triggers, setTriggers] = useState("HERE GOES SOME TEXT"); // textarea backing string (comma-separated)
  const [misc, setMisc] = useState({ a: false, b: false, c: false });

  // Each attachment item can be:
  //  - remote: { key, name, mimeType, url, remote:true }
  //  - local : { key, name, mimeType, file, previewUrl, remote:false }
  const [attachments, setAttachments] = useState(parts.map(() => []));

  // media support (images + videos)
  const VIDEO_WHITELIST = new Set(["video/mp4", "video/webm", "video/ogg"]);
  const isImageMime = (t="") => t.startsWith("image/");
  const isVideoMime = (t="") => VIDEO_WHITELIST.has(t);

  // Map a server file (has url/absUrl/mimeType) to a media item
  const toRemoteItem = (srv) => {
    const url = srv.absUrl || srv.url || "";
    return {
      key: `remote:${url}`,
      name: srv.name || srv.storedName || "media",
      mimeType: srv.mimeType || "",
      url,
      remote: true
    };
  };

  // Map a local File to a media item
  const toLocalItem = (file) => {
    const previewUrl = URL.createObjectURL(file);
    return {
      key: `local:${file.name}|${file.size}|${file.lastModified}`,
      name: file.name,
      mimeType: file.type,
      file,
      previewUrl,
      remote: false
    };
  };

  // whenever active changes, load its fields into the form
  useEffect(() => {
    if (!active) return;

    setTitle(active.title || "");

    // Text parts
    const serverParts = Array.isArray(active.messages)
      ? active.messages.map(m => m?.text ?? "")
      : Array.isArray(active.parts)
      ? active.parts
      : [""];

    setParts(serverParts.length ? serverParts : [""]);

    // Prefer keywords if present; else fall back to triggers
    const fromKeywords =
      Array.isArray(active.keywords) && active.keywords.length
        ? active.keywords.join(", ")
        : null;
    const fromOldTriggers =
      Array.isArray(active.triggers)
        ? active.triggers.join(", ")
        : typeof active.triggers === "string"
        ? active.triggers
        : null;

    setTriggers(fromKeywords ?? fromOldTriggers ?? "HERE GOES SOME TEXT");

    setMisc(active.misc ?? { a:false, b:false, c:false });

    // Load existing media (images/videos) from server into attachments
    const serverAttachments = Array.isArray(active.messages)
      ? active.messages.map(m =>
          Array.isArray(m.files) ? m.files.map(toRemoteItem) : []
        )
      : serverParts.map(() => []); // fallback same length as parts

    setAttachments(serverAttachments);
  }, [activeId, active]);

  // ====== HELPERS ======
  const onPick = (id) => setActiveId(id);

  const onAdd = () => {
    // Local phantom draft
    const phantom = { id: `new-${Date.now()}`, title: "Nuevo" };
    setList(prev => [phantom, ...prev]);
    setActiveId(phantom.id);
    setTitle("");
    setParts([""]);
    setTriggers("");
    setMisc({a:false,b:false,c:false});
    setAttachments([[]]);
  };

  const onEdit = (id) => { setMenuOpenId(null); setActiveId(id); };

  const onDelete = async (id) => {
    setMenuOpenId(null);
    try {
      const res = await fetch(`/api/saved-replies/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setList(prev => prev.filter(x => x.id !== id));
      if (activeId === id) setActiveId(null);
    } catch (e) {
      console.error("[SR] delete failed:", e);
      alert("No se pudo eliminar.");
    }
  };

  const updatePart = (i, val) =>
    setParts(prev => prev.map((p, idx) => (idx === i ? val : p)));

  const addPart = () => {
    setParts(prev => [...prev, ""]);
    setAttachments(prev => [...prev, []]);
  };

  const removePart = (i) => {
    setParts(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
    setAttachments(prev =>
      prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev
    );
  };

  const addFilesToPart = (i, fileList) => {
    const incomingFiles = Array.from(fileList || [])
      .filter(f => isImageMime(f.type) || isVideoMime(f.type))
      .map(toLocalItem);

    setAttachments(prev => {
      const clone = prev.map(arr => [...arr]);
      const cur = clone[i] || [];
      const dedupe = new Map(cur.map(x => [x.key, x]));
      incomingFiles.forEach(x => dedupe.set(x.key, x));
      clone[i] = Array.from(dedupe.values());
      return clone;
    });
  };

  const removeFileFromPart = (i, idx) => {
    setAttachments(prev => {
      const clone = prev.map(arr => [...arr]);
      const it = clone[i][idx];
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      clone[i].splice(idx, 1);
      return clone;
    });
  };

// ⬇️ Replace your entire onSave with this one
const onSave = async () => {
  try {
    // Build FormData with text + files
    const fd = new FormData();
    fd.append("title", title);
    fd.append("parts", JSON.stringify(parts));
    fd.append("misc", JSON.stringify(misc));

    // If your triggers textbox is actually CSV keywords now:
    // - If you still keep triggers as textarea with "\n", convert as you like.
    // Here, we assume you collected keywords into a string or array.
    // If it's a CSV string in `triggers`, keep this:
    fd.append("keywords", triggers); // can be "a,b,c" or JSON "['a','b']"

    // Attach files per block: files[i][]
    attachments.forEach((arr, i) => {
      arr.forEach((it) => {
        if (!it.remote && it.file) {
          // only upload new local files; remote ones already persisted
          fd.append(`files[${i}][]`, it.file, it.name);
        }
      });
    });

    const creating = active?.id?.startsWith("new-");

    // ✅ Create (same as before, still POST /api/saved-replies)
    // ✅ Update (now POST /:id/save — avoids preflight)
    const url = creating
      ? `${API_BASE}/api/saved-replies`
      : `${API_BASE}/api/saved-replies/${encodeURIComponent(active.id)}/save`;

    const res = await fetch(url, {
      method: "POST",
      body: fd
      // 🚫 do not set headers, let browser set multipart boundary
      // 🚫 do not include credentials (keeps it simple, no preflight)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();

    // upsert into list
    const savedId = saved.id || saved._id || active.id;
    const savedTitle = saved.title || title || "Untitled";
    setList(prev => {
      const idx = prev.findIndex(x => x.id === active.id || x.id === savedId);
      const merged = { ...(prev[idx] || {}), ...saved, id: savedId, title: savedTitle };
      if (idx >= 0) {
        const copy = [...prev]; copy[idx] = merged; return copy;
      }
      return [merged, ...prev];
    });
    setActiveId(savedId);
    alert("Guardado.");
  } catch (e) {
    console.error("[SR] save failed:", e);
    alert("No se pudo guardar.");
  }
};


  // ====== RENDER ======
  return (
    <div className="sr-page">
      {/* COLUMN 1: LEFT LIST */}
      <aside className="sr-col sr-col-list">
        <div className="sr-col-header">
          <div className="sr-col-title">SAVED REPLY LIST</div>

          <div className="sr-searchbar">
            <input
              className="sr-search-input"
              placeholder="SEARCH BAR"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>

          <div className="sr-add-wrap">
            <button type="button" className="sr-add-btn" onClick={onAdd}>
              Add
            </button>
          </div>
        </div>

        <ul className="sr-list-items">
          {loading && <li className="sr-empty">Cargando…</li>}
          {err && !loading && <li className="sr-empty">Error: {err}</li>}
          {!loading && !err && filtered.length === 0 && (
            <li className="sr-empty">Sin resultados</li>
          )}

          {!loading && !err && filtered.map(item => (
            <li
              key={item.id}
              className={"sr-list-item" + (activeId === item.id ? " active" : "")}
            >
              <button className="sr-list-main" onClick={() => setActiveId(item.id)}>
                {item.title}
              </button>

              <div className="sr-li-kebab" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="sr-kebab-btn"
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === item.id}
                  onClick={() => setMenuOpenId(cur => (cur === item.id ? null : item.id))}
                >
                  ⋯
                </button>

                {menuOpenId === item.id && (
                  <div className="sr-li-menu" role="menu">
                    <button className="sr-li-menu-btn" onClick={() => onEdit(item.id)}>
                      Edit
                    </button>
                    <button className="sr-li-menu-btn danger" onClick={() => onDelete(item.id)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* COLUMN 2: MESSAGE CONFIG */}
      <section className="sr-col sr-col-config">
        <div className="sr-col-header">
          <div className="sr-col-title">MESSAGE CONFIGURATION</div>
          <div className="sr-col-subtitle">(WE ALREADY HAVE THIS, IS THE SAVED REPLY MODAL)</div>
        </div>

        <form className="sr-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <div className="sr-field">
            <label className="sr-label">Titulo</label>
            <div className="sr-pill">
              <input
                className="sr-pill-input"
                placeholder="Ej. POSTS HAPPER"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          {parts.map((val, i) => (
            <div className="sr-field" key={i}>
              <label className="sr-label">Contenido{i + 1}</label>

              <div className="sr-textarea-wrap sr-card">
                <textarea
                  className="sr-textarea"
                  placeholder="Escribe el mensaje…"
                  value={val}
                  onChange={(e) => updatePart(i, e.target.value)}
                />

                <input
                  id={`file-${i}`}
                  type="file"
                  multiple
                  accept="image/*,video/mp4,video/webm,video/ogg"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    addFilesToPart(i, e.target.files);
                    e.target.value = "";
                  }}
                />

                <button
                  type="button"
                  className="sr-clip"
                  title="Adjuntar archivo (imagen o video)"
                  onClick={() => document.getElementById(`file-${i}`)?.click()}
                >
                  📎
                </button>

                <span className="sr-counter">{val.length}</span>
              </div>

              {!!(attachments[i]?.length) && (
                <div className="sr-files">
                  {attachments[i].map((it, idx) => {
                    const isImg = isImageMime(it.mimeType);
                    const isVid = isVideoMime(it.mimeType);
                    const src = it.previewUrl || it.url; // local vs remote

                    return (
                      <div
                        className={`sr-filechip ${isImg ? "img" : isVid ? "vid" : ""}`}
                        key={it.key}
                        title={it.name}
                      >
                        {isImg && <img src={src} alt={it.name} />}
                        {isVid && <video src={src} muted controls playsInline />}
                        <span className="sr-file-name">{it.name}</span>
                        <button
                          type="button"
                          className="sr-file-x"
                          onClick={() => removeFileFromPart(i, idx)}
                          aria-label="Quitar archivo"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 6 }}>
                <button type="button" className="sr-btn sr-btn-light" onClick={() => removePart(i)}>
                  Borrar
                </button>
              </div>
            </div>
          ))}

          <button type="button" className="sr-add-dashed" onClick={addPart}>
            agrega otro mensaje
          </button>

          <div className="sr-actions-right">
            <button type="button" className="sr-btn ghost">Cancelar</button>
            <button type="submit" className="sr-btn primary">Guardar</button>
          </div>
        </form>
      </section>

      {/* COLUMN 3: TRIGGER LIST */}
      <section className="sr-col sr-col-triggers">
        <div className="sr-col-header">
          <div className="sr-col-title">TRIGGER LIST</div>
          <div className="sr-col-subtitle">&nbsp;</div>
        </div>

        <div className="sr-triggers-body">
          <div className="sr-trigger-box">
            <textarea
              className="sr-trigger-input"
              value={triggers}
              onChange={e => setTriggers(e.target.value)}
              placeholder="comma-separated keywords…  e.g.  post parto, faja, talla m"
            />
          </div>

          {/* Live preview chips */}
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {parseKeywords(triggers).map((k, i) => (
              <span key={i} style={{
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 12
              }}>{k}</span>
            ))}
          </div>

          <div className="sr-trigger-savewrap">
            <button className="sr-btn sr-btn-primary" onClick={onSave}>
              SAVE
            </button>
          </div>
        </div>
      </section>

      {/* COLUMN 4: MISC CONFIG */}
      <aside className="sr-col sr-col-misc">
        <div className="sr-col-header sr-col-header-row">
          <div className="sr-col-title">MISC CONFIG</div>

          <div className="sr-misc-icons">
            <button className="sr-icon-btn" title="refresh/clone">↻</button>
            <button className="sr-icon-btn" title="lock">🔒</button>
            <button className="sr-icon-btn" title="duplicate">📄</button>
            <button className="sr-icon-btn" title="trash">🗑</button>
            <button className="sr-icon-btn" title="more">⋯</button>
          </div>
        </div>

        <div className="sr-misc-body">
          <label className="sr-misc-check">
            <input type="checkbox" checked={misc.a} onChange={e => setMisc(m => ({ ...m, a: e.target.checked }))} />
            <span>Responde a anuncios</span>
          </label>

          <label className="sr-misc-check">
            <input type="checkbox" checked={misc.b} onChange={e => setMisc(m => ({ ...m, b: e.target.checked }))} />
            <span>responde a mensajes</span>
          </label>

          <label className="sr-misc-check">
            <input type="checkbox" checked={misc.c} onChange={e => setMisc(m => ({ ...m, c: e.target.checked }))} />
            <span>responde Solo una vez por semana</span>
          </label>
          <label className="sr-misc-check">
            <input type="checkbox" checked={misc.d} onChange={e => setMisc(m => ({ ...m, d: e.target.checked }))} />
            <span>Tipo de respuesta : Producto</span>
          </label>
          <label className="sr-misc-check">
            <input type="checkbox" checked={misc.f} onChange={e => setMisc(m => ({ ...m, f: e.target.checked }))} />
            <span>Tipo de respuesta : Envio</span>
          </label>

        </div>
      </aside>
    </div>
  );
}
