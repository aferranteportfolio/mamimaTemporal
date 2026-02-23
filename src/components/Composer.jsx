// src/components/Composer.jsx
import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import SavedRepliesMenu from "./SavedRepliesMenu.jsx";
import SavedReplyModal from "./SavedReplyModal.jsx";
import {
  API_BASE,
  saveSavedReply,
  listSavedReplies,
  markSavedReplyUsed,
  updateSavedReply,
  deleteSavedReply
} from "../api/realApi.js";
const SEND_GAP_MS_IMAGE = 1600;
const SEND_GAP_MS_TEXT  = 500;
const SEND_GAP_AFTER_IMAGE_BEFORE_TEXT = 2200;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CLIENT_SEND_TIMEOUT_MS = 1500;

const TA_MAX_PX = Math.floor(window.innerHeight * 0.5);
function resizeTextarea(el) {
  if (!el) return;
  el.style.height = "0px";
  const next = Math.min(el.scrollHeight, TA_MAX_PX);
  el.style.height = next + "px";
}

export default function Composer({
  disabled,
  onSendText,
  onSendImage,
  focusSignal,
  replyTo,
  onCancelReply,
  onAfterSendOk,
  savedReplies: savedRepliesProp = [
    { id: "1", title: "POSTSHAPPER",     body: "Bríndenos su celular para enviarle más información" },
    { id: "2", title: "Sacaleche doble", body: "——————— SACALECHE INTELIGENT * Es doble, eléctrico * 4 modos, 9 velocidades * Capacidad: 300 ml * Libre de BPA * Listo para usar * Tenemos más modelos ———————" },
    { id: "3", title: "MANOS LIBRES",    body: "——————— EXTRACTOR MANOS LIBRES * Manos libres, eléctrico * Batería recargable * 4 modos, 9 velocidades * Capacidad: 180 ml * Libre de BPA ———————" }
  ],
  activeTo,
}) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const [savedReplies, setSavedReplies] = useState(savedRepliesProp);
  const [showSavedReplyModal, setShowSavedReplyModal] = useState(false);
  const [editingReply, setEditingReply] = useState(null);

  const fileRef = useRef(null);
  const taRef = useRef(null);
  const menuBtnRef = useRef(null);
  const flyoutRef = useRef(null);
  const wrapperRef = useRef(null);

  const SERVER_ORIGIN =
    import.meta.env.VITE_API_BASE?.replace(/\/+$/, "") ||
    `${location.protocol}//${location.hostname}:3050`;

  function fileUrlFromMeta(f) {
    const u = f?.absUrl
      || (f?.url?.startsWith("http") ? f.url
      : f?.url ? `${SERVER_ORIGIN}${f.url.startsWith("/") ? "" : "/"}${f.url}` : null);
    return u;
  }

  function composeTextFromSaved(item) {
  const parts = [];

  // legacy
  if (typeof item?.body === "string") {
    const b = item.body.trim();
    if (b) parts.push(b);
  }

  // new format
  for (const m of item?.messages || []) {
    const t = (m?.text || "").trim();
    if (t) parts.push(t);
  }

  return parts.join("\n").trim();
}


  async function fileFromMeta(f) {
    const url = fileUrlFromMeta(f);
    if (!url) return null;

    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const blob = await res.blob();

    const filename = f?.name || f?.storedName || "archivo";
    const type = f?.mimeType || blob.type || "application/octet-stream";
    return new File([blob], filename, { type });
  }

  async function hydrateIfNeeded(item) {
    if (item?.messages && Array.isArray(item.messages)) return item;
    const list = await listSavedReplies();
    const hydrated = list.find(x => x.id === item.id);
    if (!hydrated) throw new Error("No se encontró el detalle de la respuesta guardada.");
    return hydrated;
  }

  async function sendSaved(item, opts = {}) {
    try {
      item = await hydrateIfNeeded(item);

      setSavedReplies(prev => {
        if (!Array.isArray(prev)) return prev;
        const next = prev.map(x =>
          x.id === item.id
            ? {
                ...x,
                usageCount: (x.usageCount || 0) + 1,
                lastUsedAt: new Date().toISOString(),
              }
            : x
        );
        return next.sort((a, b) =>
          (b.usageCount || 0) - (a.usageCount || 0) ||
          new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0) ||
          new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        );
      });

      markSavedReplyUsed(item.id, { to: activeTo || undefined }).catch(() => {});

      let previousWasImage = false;

      const msgs = Array.isArray(item?.messages) ? item.messages : [];
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i] || {};
        const text  = (m.text || "").trim();
        const files = Array.isArray(m.files) ? m.files : [];

        if (previousWasImage && files.length === 0 && text) {
          await sleep(SEND_GAP_AFTER_IMAGE_BEFORE_TEXT);
          previousWasImage = false;
        }

        if (files.length > 0) {
          const [first, ...rest] = files;

          const f0 = await fileFromMeta(first);
          if (f0) {
            await onSendImage(f0, { noPreview: true, caption: text || undefined, ...opts });
            await sleep(SEND_GAP_MS_IMAGE);
          }

          for (const fmeta of rest) {
            const f = await fileFromMeta(fmeta);
            if (f) {
              await onSendImage(f, { noPreview: true, ...opts });
              await sleep(SEND_GAP_MS_IMAGE);
            }
          }

          previousWasImage = true;
        } else if (text) {
          await onSendText(text);
          await sleep(SEND_GAP_MS_TEXT);
          previousWasImage = false;
        } else {
          previousWasImage = false;
        }
      }
    } catch (err) {
      alert("Failed to send saved reply: " + (err?.message || String(err)));
    } finally {
      setMenuOpen(false);
    }
  }

  async function openEditModal(reply) {
    try {
      const full = await hydrateIfNeeded(reply);
      setEditingReply(full);
      setShowSavedReplyModal(true);
    } catch (e) {
      alert("No se pudo abrir la edición: " + (e?.message || String(e)));
    }
  }

  async function handleSaveEdit({ title, messages }) {
    if (!editingReply) return;

    const payload = {
      title,
      messages: (messages || []).map(m => ({ text: m?.text || "" }))
    };

    setSavedReplies(prev => {
      if (!Array.isArray(prev)) return prev;
      const next = prev.map(x =>
        x.id === editingReply.id
          ? { ...x, title: payload.title, messages: payload.messages }
          : x
      );
      return next;
    });

    try {
      const updated = await updateSavedReply(editingReply.id, payload);
      setSavedReplies(prev => {
        if (!Array.isArray(prev)) return prev;
        return prev.map(x => x.id === updated.id ? { ...x, ...updated } : x);
      });
      setShowSavedReplyModal(false);
      setEditingReply(null);
    } catch {
      try {
        const items = await listSavedReplies();
        setSavedReplies(items);
      } catch {}
      alert("No se pudo guardar los cambios.");
    }
  }

  async function onDeleteReply(id) {
    setSavedReplies(prev => prev.filter(x => x.id !== id));
    try {
      await deleteSavedReply(id);
    } catch {
      try {
        const items = await listSavedReplies();
        setSavedReplies(items);
      } catch {}
      alert("No se pudo eliminar.");
    }
  }

  const handlePaste = useCallback(async (e) => {
    if (disabled) return;

    const dt = e.clipboardData || window.clipboardData;
    if (!dt) return;

    const images = [];

    if (dt.items && dt.items.length) {
      for (const it of dt.items) {
        if (it.kind === "file") {
          const f = it.getAsFile?.();
          if (f && f.type?.startsWith("image/")) {
            const name = f.name && !/^image\.\w+$/.test(f.name)
              ? f.name
              : `pasted-${Date.now()}.${(f.type.split("/")[1] || "png")}`;
            images.push(new File([f], name, { type: f.type }));
          }
        }
      }
    }

    if (!images.length && dt.files && dt.files.length) {
      for (const f of dt.files) {
        if (f.type?.startsWith("image/")) {
          const name = f.name && !/^image\.\w+$/.test(f.name)
            ? f.name
            : `pasted-${Date.now()}.${(f.type.split("/")[1] || "png")}`;
          images.push(new File([f], name, { type: f.type }));
        }
      }
    }

    if (images.length) {
      e.preventDefault();
      try {
        for (const img of images) {
          await onSendImage(img);
        }
        taRef.current?.focus();
      } catch (err) {
        alert("Failed to send pasted image: " + (err?.message || String(err)));
      }
    }

    requestAnimationFrame(() => resizeTextarea(taRef.current));
  }, [disabled, onSendImage]);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const onPaste = (e) => handlePaste(e);
    node.addEventListener("paste", onPaste);
    return () => node.removeEventListener("paste", onPaste);
  }, [handlePaste]);

  useEffect(() => {
    (async () => {
      try {
        const items = await listSavedReplies();
        if (Array.isArray(items) && items.length)
          setSavedReplies(items);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    taRef.current?.focus();
    requestAnimationFrame(() => resizeTextarea(taRef.current));
  }, [focusSignal]);

  useEffect(() => {
    function onDoc(e) {
      if (!menuOpen) return;
      if (menuBtnRef.current?.contains(e.target)) return;
      if (flyoutRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        return;
      }

      if (
        e.code === "Backquote" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        setMenuOpen(prev => !prev);
      }
    }

    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    resizeTextarea(taRef.current);
  }, []);

  async function send() {
    const value = text.trim();
    if (!value) return;

    setText("");
    setTimeout(() => resizeTextarea(taRef.current), 0);

    Promise.resolve(onSendText(value))
  .then(() => onAfterSendOk?.())
  .catch(err => {
    setText(value);
    setTimeout(() => resizeTextarea(taRef.current), 0);
    alert("Failed to send: " + (err?.message || String(err)));
  })
  .finally(() => {
    taRef.current?.focus();
  });

  }

  function insertSaved(it) {
    const v = composeTextFromSaved(it);
    if (!v) return;
    setText(prev => (prev ? `${prev}\n\n${v}` : v));
    setMenuOpen(false);
    taRef.current?.focus();
    setTimeout(() => resizeTextarea(taRef.current), 0);
  }

  async function handleSaveSavedReply({ title, messages }) {
    // (tu lógica sigue igual)
  }
  // save flow from modal
  async function handleSaveSavedReply({ title, messages }) {
    srlog("SAVE request", { title, messages });
    try {
      const saved = await saveSavedReply({ title, messages });
      srlog("SAVE ok", saved);
      setShowSavedReplyModal(false);

      const url = `${API_BASE}/api/saved-replies?full=1`;
      console.log("%c[SR] REFRESH ->", "color:#7c3aed;font-weight:bold", url);
      const items = await listSavedReplies();
      console.log("%c[SR] REFRESH ← items", "color:#7c3aed;font-weight:bold", items);

      srlog("LIST after save", items.map(i => ({ id:i.id, title:i.title })));
      setSavedReplies(items.slice().sort(sortReplies));
    } catch (e) {
      srlog("SAVE error", e);
      alert("Error al guardar: " + e.message);
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="composer"
      style={{ position: "relative" }}
      tabIndex={0}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={onPickFile}
      />

      <button
        className="btn icon"
        onClick={() => fileRef.current && fileRef.current.click()}
        disabled={disabled}
        title="Adjuntar archivos"
      >
        📎
      </button>
      {replyTo && (
  <div
    style={{
      position: "absolute",
      left: 44,   // leaves space for the 📎 button
      right: 90,  // leaves space for menu + send
      bottom: 52, // sits above textarea area
      background: "#f3f4f6",
      borderLeft: "4px solid #22c55e",
      borderRadius: 10,
      padding: "8px 10px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Responder</div>
      <div
        style={{
          fontSize: 13,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {replyTo.preview}
      </div>
    </div>

    <button
      type="button"
      onClick={onCancelReply}
      title="Cancelar respuesta"
      style={{ border: "none", background: "transparent", cursor: "pointer" }}
    >
      ✕
    </button>
  </div>
)}

      <textarea
        ref={taRef}
        className="textarea"
        placeholder="Type a message"
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          requestAnimationFrame(() => resizeTextarea(taRef.current));
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        onPaste={handlePaste}
      />

      <div className="composer-menu-anchor">
        <button
          ref={menuBtnRef}
          type="button"
          className="btn icon"
          title="Respuestas guardadas"
          disabled={disabled}
          onClick={() => setMenuOpen(v => !v)}
        >
          ⋯
        </button>

        {menuOpen && (
          <div
            ref={flyoutRef}
            className="sr-fly"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <SavedRepliesMenu
              items={savedReplies}
              /** 👇 use the prop we receive instead of activeConversation */
              activeTo={activeTo || null}
              onInsert={insertSaved}
              onSend={sendSaved}                   // sends text + images (with hydration)
              onCreate={() => setShowSavedReplyModal(true)}
              onEdit={openEditModal}
              onDelete={(r) => onDeleteReply(r.id)}
            />

            <SavedReplyModal
              open={showSavedReplyModal}
              initialTitle={editingReply ? (editingReply.title || "") : ""}
              initialMessages={
                editingReply
                  ? (editingReply.messages || []).map(m => ({ text: m?.text || "", files: [] }))
                  : [{ text: "", files: [] }]
              }
              onCancel={() => { setShowSavedReplyModal(false); setEditingReply(null); }}
              onSave={(data) => editingReply ? handleSaveEdit(data) : handleSaveSavedReply(data)}
            />
          </div>
        )}
      </div>

      <button
        className="btn primary"
        onClick={send}
        disabled={disabled}
      >
        Send
      </button>
    </div>
  );

  // -------------- local helpers using refs --------------
  async function onPickFile(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    try {
      for (const file of files) {
        await onSendImage(file);
      }
      taRef.current?.focus();
    } catch (err) {
      alert("Failed to send attachment: " + (err?.message || String(err)));
    }
  }
}
