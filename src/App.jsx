import { useEffect, useMemo, useState, useRef } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import SavedRepliesPage from "./components/SavedRepliesPage.jsx";
import ProgrammedMessagesPage from "./components/ProgrammedMessagesPage.jsx";
import TopNav from "./components/TopNav.jsx";
import { useRealtimeUpdates } from './hooks/useRealtimeUpdates.js';
import { Routes, Route, Navigate, HashRouter as Router } from "react-router-dom";

import {
  fetchConversations,
  fetchMessages,
  sendText as apiSendText,
  sendImage as apiSendImage,
  markSeen 
} from "./api/index.js";
import "./styles/global.css";

// ---------------- NEW: preload tuning knobs ----------------
const PRELOAD_COUNT = 50;       // how many conversations to prefetch
const PRELOAD_CONCURRENCY = 5;  // how many parallel fetches
// -----------------------------------------------------------

// --- helpers ---
function normalizeId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const local = digits.length > 9 ? digits.slice(-9) : digits;
  const spaced = local.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
  return { digits, local, spaced };
}

function normalizeConversation(c = {}) {
  const raw = c.phone ?? c.customerIdRaw ?? c.customerId ?? c.id ?? "";
  const { spaced, digits } = normalizeId(raw);
  const n = {
    id: c.id ?? digits,
    customerIdRaw: c.customerIdRaw ?? digits,
    customerId: c.customerId ?? spaced,
    phone: c.phone ?? digits,
    displayName: c.displayName ?? spaced,
    lastMessage: c.lastMessage ?? "",
    lastTimestamp: Number(c.lastTimestamp ?? 0),
    unread: Number(c.unread ?? 0),
    ...c,
  };
 // try { console.log('[UNSEEN] normalizeConversation:', n.id, 'unread=', n.unread); } catch {}
  return n;
}

function findConversationByAny(prev = [], ref) {
  const digits = normalizeId(ref).digits;
  const noSpace = String(ref || "").replace(/\s+/g, "");
  return prev.find(c =>
    c.customerIdRaw === digits ||
    c.phone === digits ||
    c.id === digits ||
    (c.customerId && c.customerId.replace(/\s+/g, "") === digits) ||
    c.id === noSpace
  ) || null;
}

function toMs(x) {
  const n = Number(x);
  if (!Number.isNaN(n) && n > 1e10) return n;
  if (!Number.isNaN(n) && n > 0)    return n * 1000;
  const d = Date.parse(String(x));
  return Number.isNaN(d) ? Date.now() : d;
}

function upsertConversationPreview(prev, chatId, text, whenMs) {
  const exists = prev.some(c => c.id === chatId);
  const updated = exists
    ? prev.map(c => c.id === chatId
        ? { ...c, lastMessage: text, lastTimestamp: whenMs, unread: (c.unread || 0) }
        : c)
    : [...prev, { id: chatId, customerId: chatId, phone: chatId, lastMessage: text, lastTimestamp: whenMs, unread: 0 }];
  return sortConversations(updated);
}

function newid(prefix = "m") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function tsNum(iso) {
  return iso ? new Date(iso).getTime() : 0;
}

function sortConversations(convs) {
  return [...(convs || [])].sort(
    (a, b) => Number(b.lastTimestamp || 0) - Number(a.lastTimestamp || 0)
  );
}

// Map the raw inbound WA event to your UI message shape
function mapInboundToUi(raw) {
  const { from, to, id, ts, type: rawType, text, media, location: rawLoc } = raw || {};
  const whenMs  = Number.isFinite(ts) ? ts : toMs(ts);
  const whenIso = new Date(whenMs).toISOString();

  // Normalize location (for SSE events)
  const loc = rawLoc || media?.location || null;
  let type = rawType || 'text';

  if (!type && loc) type = 'location';

  const mediaObj = media
    ? {
        kind:     media.kind,
        id:       media.id,
        mimeType: media.mimeType,
        sha256:   media.sha256,
        caption:  media.caption ?? null,
        url:      media.url,
      }
    : undefined;

  // IMAGE
  const imageUrl =
    (type === 'image' && media?.id)
      ? `/api/media/${media.id}`
      : undefined;

  // AUDIO
  const audioUrl =
    (type === 'audio' && media?.url)
      ? media.url
      : undefined;

  const fileUrl =
    (type === 'document' && media?.url)
      ? media.url
      : undefined;

  // LOCATION
  let location = null;
  let locationUrl = null;
  if (type === 'location' && loc) {
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    location = {
      latitude: lat,
      longitude: lng,
      name: loc.name ?? null,
      address: loc.address ?? null,
    };
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      locationUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    }
  }

  const msg = {
    id,
    from,
    to,
    ts,
    type,
    text: text ?? (media?.caption ?? null),
    media: mediaObj,
    chatId: normalizeId(from).digits,
    dir: 'in',
    timestamp: whenIso,
    whenMs,
    imageUrl,
    audioUrl,
    fileUrl,
    fileName: type === 'document' ? (media?.filename || media?.name || null) : null,
    location,
    locationUrl,
    mediaId: media?.id ?? raw.mediaId ?? null,
  };

  if (msg.type === 'audio') {
    console.log("[FE][AUDIO][MAP-INBOUND]", {
      id: msg.id,
      chatId: msg.chatId,
      mediaId: msg.mediaId,
      audioUrl: msg.audioUrl,
      from: msg.from,
    });
  }

  if (msg.type === 'location') {
    console.log("[FE][LOCATION][MAP-INBOUND]", {
      id: msg.id,
      chatId: msg.chatId,
      location: msg.location,
      locationUrl: msg.locationUrl,
      from: msg.from,
    });
  }

  return msg;
}



export default function App() {
  const [conversations, setConversations] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState({});
  const [loading, setLoading] = useState(true);
 const [activeTab, setActiveTab] = useState(() => location.hash.replace('#/','') || 'chat');
useEffect(() => {
  const onHash = () => setActiveTab(location.hash.replace('#/','') || 'chat');
  window.addEventListener('hashchange', onHash);
  return () => window.removeEventListener('hashchange', onHash);
}, []);

  // message loading state for current chat
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState(null);
  const loadingChatRef = useRef(null);

  // ---------------- NEW: image warming helpers ----------------
  function warmImage(src) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = src;
      } catch {
        resolve();
      }
    });
  }

  async function warmImagesFromMessages(msgs = []) {
    const urls = Array.from(
      new Set(
        (msgs || [])
          .map(m => m?.imageUrl || (m?.type === "image" && m?.mediaId ? `/api/media/${m.mediaId}` : null))
          .filter(Boolean)
      )
    );
    if (!urls.length) return;
    // try { console.log(`[PRELOAD] warming ${urls.length} image(s)`); } catch {}
    await Promise.all(urls.map(warmImage));
  }
  // ------------------------------------------------------------

  // ---------------- NEW: preloader with concurrency -----------
  const preloaderAbortRef = useRef(null);
  const hasPreloadedRef = useRef(false);

  async function preloadRecentConversations(list) {
    const ids = list.slice(0, PRELOAD_COUNT).map(c => c.id);
    const pending = ids.filter(id => !(messagesByChat[id]?.length));
    if (!pending.length) {
     // try { console.log("[PRELOAD] nothing to do; all cached"); } catch {}
      return;
    }

    let index = 0;
    const results = [];
    const controller = new AbortController();
    preloaderAbortRef.current = controller;

    async function worker(slot) {
      while (index < pending.length && !controller.signal.aborted) {
        const id = pending[index++];
        try {
         // console.log(`[PRELOAD] [${slot}] fetching messages for`, id);
          const msgs = await fetchMessages(id, { signal: controller.signal });

          setMessagesByChat(prev => (prev[id]?.length ? prev : { ...prev, [id]: msgs || [] }));
          await warmImagesFromMessages(msgs);

          results.push({ id, ok: true, count: (msgs || []).length });
        } catch (err) {
          if (controller.signal.aborted) break;
        //  console.warn(`[PRELOAD] [${slot}] failed for ${id}:`, err?.message || err);
          results.push({ id, ok: false });
        }
      }
    }

    const workers = Array.from({ length: PRELOAD_CONCURRENCY }, (_, i) => worker(i + 1));
    await Promise.all(workers);

    try {
      const ok = results.filter(r => r.ok).length;
    //  console.log(`[PRELOAD] done. success=${ok}/${results.length}`);
    } catch {}
  }
  // ------------------------------------------------------------

  useEffect(() => {
    const onHash = () => setActiveTab(location.hash.replace('#/','') || 'chat');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const activeChatIdRef = useRef(null);
  useEffect(() => { 
    activeChatIdRef.current = activeChatId; 
  //  try { console.log('[UNSEEN] setActiveChatId →', activeChatId); } catch {}
  }, [activeChatId]);

  function handleInbound(raw) {
    const msg = mapInboundToUi(raw);
    const senderDigits = normalizeId(msg.from).digits;
    const senderSpaced = normalizeId(msg.from).spaced;

    const conv = findConversationByAny(conversations, msg.from);
    const convId = conv?.id ?? senderDigits;

    try {
      const isActive = convId === activeChatIdRef.current;
     // console.log('[UNSEEN] inbound → chatId=', convId, 'isActive=', isActive, 'prevUnread=', conv?.unread);
    } catch {}

    setMessagesByChat(prev => {
      const arr = prev[convId] || [];
      if (arr.some(m => m.id === msg.id)) return prev;
      return { ...prev, [convId]: [...arr, { ...msg, chatId: convId }] };
    });

    setConversations(prev => {
      const found = findConversationByAny(prev, msg.from);
      const resolvedId = found?.id ?? senderDigits;
      const isActive = resolvedId === activeChatIdRef.current;

      const lastMessage =
        (msg.text && msg.text.trim()) ||
        (msg.type === "image"
          ? "[Image]"
          : msg.type === "video"
            ? "[Video]"
            : msg.type === "audio"
              ? "[Audio]"
              : msg.type === "document" || msg.type === "file"
                ? "[Document]"
                : "");

      const next = found
        ? prev.map(c => {
            if (c.id !== resolvedId) return c;
            const nextUnread = isActive ? 0 : (c.unread || 0) + 1;
          //  try { console.log('[UNSEEN] inbound update →', resolvedId, 'was=', c.unread, 'now=', nextUnread, 'isActive=', isActive); } catch {}
            return {
              ...c,
              lastMessage,
              lastTimestamp: msg.whenMs,
              unread: nextUnread
            };
          })
        : [
            ...prev,
            normalizeConversation({
              id: senderDigits,
              customerIdRaw: senderDigits,
              customerId: senderSpaced,
              phone: senderDigits,
              displayName: senderSpaced,
              lastMessage,
              lastTimestamp: msg.whenMs,
              unread: (resolvedId === activeChatIdRef.current) ? 0 : 1
            })
          ];

      return sortConversations(next);
    });
  }

  function handleOutbound(raw) {
    const id        = raw.id;
    const type      = raw.type || (raw.imageUrl ? 'image' : 'text');
    const text      = raw.text ?? raw.caption ?? '';
    const status    = raw.status || 'sent';
    const whenIso   = raw.timestamp || raw.ts || new Date().toISOString();
    const whenMs    = Number.isFinite(raw.ts) ? raw.ts : Date.parse(whenIso);
    const mediaUrl  = raw.imageUrl || raw.url || null;

    let convId = raw.chatId || null;
    if (!convId && raw.to) {
      const found = findConversationByAny(conversations, raw.to);
      const { digits } = normalizeId(raw.to);
      convId = found?.id ?? digits;
    }
    if (!convId) {
    //  console.warn('[handleOutbound] missing chatId and no resolvable "to":', raw);
      return;
    }

   // try { console.log('[UNSEEN] outbound → chatId=', convId, 'type=', type, 'text.len=', (text||'').length); } catch {}

    setMessagesByChat(prev => {
      const arr = prev[convId] || [];
      const at = arr.findIndex(m => m.id === id);

      if (at >= 0) {
        const copy = [...arr];
        copy[at] = {
          ...copy[at],
          status,
          text: text ?? copy[at].text,
          imageUrl: mediaUrl ?? copy[at].imageUrl,
          timestamp: new Date(whenMs).toISOString(),
        };
        return { ...prev, [convId]: copy };
      }

      const payload =
        type === 'image'
          ? { id, chatId: convId, dir: 'out', from: 'me', type: 'image', imageUrl: mediaUrl, text, timestamp: new Date(whenMs).toISOString(), status }
          : { id, chatId: convId, dir: 'out', from: 'me', type: 'text',  text,                     timestamp: new Date(whenMs).toISOString(), status };

      return { ...prev, [convId]: [...arr, payload] };
    });

    setConversations(prev => {
      const found = prev.find(c => c.id === convId);
      const lastMessage = type === 'image' ? '[Image]' : (text || '');

      const next = found
        ? prev.map(c => (c.id === convId ? { ...c, lastMessage, lastTimestamp: whenMs } : c))
        : [
            ...prev,
            normalizeConversation({
              id: convId,
              customerIdRaw: convId,
              customerId: normalizeId(convId).spaced,
              phone: convId,
              displayName: normalizeId(convId).spaced,
              lastMessage,
              lastTimestamp: whenMs,
              unread: 0
            })
          ];

      return sortConversations(next);
    });
  }

  useRealtimeUpdates({
    onInbound: handleInbound,
    onOutbound: handleOutbound
  });

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        console.groupCollapsed('[Init] load');
        const convs = await fetchConversations();
        console.log('[Init] conversations raw', { count: convs.length, sample: convs.slice(0, 5) });
        
        const normalized = convs.map(normalizeConversation);
        const sorted = sortConversations(normalized);
        setConversations(sorted);

        try {


        } catch {}



        const firstId = sorted[0]?.id || null;
        setActiveChatId(firstId);


        if (firstId) {
          const msgs = await fetchMessages(firstId);

          setMessagesByChat(prev => ({ ...prev, [firstId]: msgs }));
        }
      } catch (err) {

        alert('Failed to load initial data. Check your API or mock mode.');
      } finally {

        setLoading(false);
      }
    })();

    // cleanup preloader on unmount
    return () => {
      try { preloaderAbortRef.current?.abort?.(); } catch {}
    };
  }, []);

  // NEW: kick off background prefetch after conversations load (once)
  useEffect(() => {
    if (!conversations.length) return;
    if (hasPreloadedRef.current) return;
    hasPreloadedRef.current = true;
    (async () => {
     
    })();
  }, [conversations]);

  // Load messages whenever activeChatId changes and cache them
useEffect(() => {
  const chatId = activeChatId;
  if (!chatId) return;
    console.log("[MessagesEffect] loading history for", chatId);
  if (loadingChatRef.current === chatId) return;    // ✅

  let aborted = false;
  const ac = new AbortController();

  (async () => {
    try {
      loadingChatRef.current = chatId;
      setMsgError(null);
      setMsgLoading(true);
      const res = await fetchMessages(chatId, { signal: ac.signal });
      if (aborted) return;

      const items = (res || [])
        .map(m => ({
          ...m,
          dir: m.dir || (m.from === "me" ? "out" : "in"),
          timestamp: m.timestamp || m.ts || m.date || new Date().toISOString()
        }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      setMessagesByChat(prev => ({ ...prev, [chatId]: items }));

      if (items.length) {
        const last = items[items.length - 1];
        setConversations(prev =>
          prev.map(c =>
            c.id === chatId
              ? { ...c, lastMessage: last.text ?? "", lastTimestamp: new Date(last.timestamp).getTime() }
              : c
          )
        );
      }
    } catch (err) {
      if (aborted) return;

      setMsgError(err?.message || "Failed to load messages");
    } finally {
      if (!aborted) {
        setMsgLoading(false);
        loadingChatRef.current = null;
      }
    }
  })();

  return () => {
    aborted = true;
    ac.abort();
    if (loadingChatRef.current === chatId) loadingChatRef.current = null;
  };
}, [activeChatId]);   // 👈 SOLO depende del chat activo, NO de messagesByChat


  // pick chat & lazy-load messages if needed (kept)
async function handleSelectChat(id) {
  const fromSearch = searchResults.find(c => c.id === id);
if (fromSearch) {
  setConversations(prev => {
    if (prev.some(c => c.id === id)) return prev;
    return sortConversations([...prev, normalizeConversation(fromSearch)]);
  });
}
  console.log("[SelectChat] clicked", id);
  const prev = conversations.find(c => c.id === id);
  const prevUnread = prev?.unread || 0;

  setActiveChatId(id);

  setConversations(prevList => {
    const updated = prevList.map(c =>
      c.id === id ? { ...c, unread: 0 } : c
    );
    return sortConversations(updated);
  });

  if (prevUnread > 0) {
    requestAnimationFrame(() => {
      setTimeout(async () => {
        try {
          await markSeen(id);
        } catch (e) {
          // ignore
        }
      }, 150);
    });
  }
}


  function appendMessage(chatId, msg) {
    setMessagesByChat((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] || []), msg]
    }));

    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              lastMessage: msg.type === "text" ? msg.text : "[Image]",
              lastTimestamp: msg.timestamp
            }
          : c
      );
      return sortConversations(updated);
    });
  }

  async function onSendText(chatId, to, text) {
    const tempId = newid();
    const nowIso = new Date().toISOString();

    const localMsg = { id: tempId, chatId, from: "me", dir: "out", type: "text", text, timestamp: nowIso, status: "sent" };
    appendMessage(chatId, localMsg);

    try {
      const res = await apiSendText({ to, text });
      const wamid = res?.id;

      if (wamid) {
        setMessagesByChat(prev => {
          const arr = prev[chatId] || [];
          const i = arr.findIndex(m => m.id === tempId);
          const j = arr.findIndex(m => m.id === wamid);

          if (i < 0 && j < 0) return prev;

          let next = [...arr];

          if (i >= 0) {
            next[i] = { ...next[i], id: wamid };
          }

          next = next.filter((m, idx) => !(idx !== i && m.id === wamid));

          return { ...prev, [chatId]: next };
        });
      }
    } catch (err) {

      alert("Send text failed — check backend.");
    }
  }

  useEffect(() => {
    const arr = messagesByChat[activeChatId] || [];
   
  }, [messagesByChat, activeChatId]);

  useEffect(() => {

  }, [conversations]);

  async function onSendMedia(chatId, to, file, caption = '') {
    const isVideo = file?.type?.startsWith('video');
    const isPdf = file?.type === 'application/pdf';
    const localUrl = URL.createObjectURL(file);
    const tempId = newid();
    const nowIso = new Date().toISOString();

    appendMessage(chatId, {
      id: tempId,
      chatId,
      from: "me",
      dir: "out",
      type: isVideo ? "video" : isPdf ? "document" : "image",
      ...(isVideo
        ? { videoUrl: localUrl }
        : isPdf
        ? { fileUrl: localUrl, fileName: file?.name }
        : { imageUrl: localUrl }),
      text: caption,
      timestamp: nowIso,
      status: "sending",
    });

    try {
      const res = await apiSendImage({ to, file, caption });

    //  console.log('[client] onSendMedia → server response', res);

      setMessagesByChat(prev => {
        const arr = prev[chatId] || [];
        const i = arr.findIndex(m => m.id === tempId);
        const realId = res?.id || null;
        const j = realId ? arr.findIndex(m => m.id === realId) : -1;

        if (i < 0 && j < 0) return prev;

        let next = [...arr];

        const finalUrl =
          res?.url ||
          (res?.mediaId ? `/api/media/${res.mediaId}` :
          (isVideo
            ? next[i]?.videoUrl
            : isPdf
            ? next[i]?.fileUrl
            : next[i]?.imageUrl));

        if (i >= 0) {
          next[i] = {
            ...next[i],
            id: realId || next[i].id,
            status: "sent",
            ...(isVideo
              ? { videoUrl: finalUrl }
              : isPdf
              ? { fileUrl: finalUrl, fileName: file?.name }
              : { imageUrl: finalUrl }),
          };
        }

        if (realId) {
          next = next.filter((m, idx) => !(idx !== i && m.id === realId));
        }

        return { ...prev, [chatId]: next };
      });
    } catch (err) {
     // console.error(err);
      setMessagesByChat(prev => {
        const arr = prev[chatId] || [];
        const i = arr.findIndex(m => m.id === tempId);
        if (i < 0) return prev;
        const next = [...arr];
        next[i] = { ...next[i], status: "error" };
        return { ...prev, [chatId]: next };
      });
      alert("Send media failed — check backend.");
    }
  }

  async function onSendImage(chatId, to, file, caption = '') {
    return onSendMedia(chatId, to, file, caption);
  }

  async function onSendVideo(chatId, to, file, caption = '') {
    return onSendMedia(chatId, to, file, caption);
  }

  const abortRef = useRef(null);

useEffect(() => {
  const raw = searchTerm.trim();
const digits = raw.replace(/[^\d]/g, "");
const local9 = digits.length > 9 ? digits.slice(-9) : digits; // drop country code etc.
const q = local9;


  // If empty -> go back to normal feed
  if (!q) {
    setSearchResults([]);
    setIsSearching(false);

    // cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    return;
  }

  // Guard: don’t query DB for 1–2 chars
  if (q.length < 3) {
    setSearchResults([]);
    setIsSearching(false);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    return;
  }

  // Debounce
  const t = setTimeout(async () => {
    // cancel previous request
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsSearching(true);

      const seller = "51908008097"; // or wherever you store your current seller
      const baseUrl = import.meta.env.VITE_API_URL; // you already use this

      const res = await fetch(
        `${baseUrl}/api/conversations/search?seller=${encodeURIComponent(
          seller
        )}&q=${encodeURIComponent(q)}&limit=50`,
        { signal: controller.signal }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      console.log("[SEARCH][FE] response", {
  ok: data?.ok,
  keys: Object.keys(data || {}),
  len_data: Array.isArray(data?.data) ? data.data.length : null,
  len_conversations: Array.isArray(data?.conversations) ? data.conversations.length : null,
  sample: (data?.data?.[0] ?? data?.conversations?.[0] ?? null),
});
      setSearchResults(Array.isArray(data.data) ? data.data.map(normalizeConversation) : []);    } catch (err) {
      // Abort is expected when typing fast
      if (err?.name !== "AbortError") {
        console.error("[search] failed:", err);
        setSearchResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  }, 350);

  // cleanup for debounce timer
  return () => clearTimeout(t);
}, [searchTerm]);
const conversationsForSidebar = useMemo(() => {
  return searchTerm.trim() ? searchResults : conversations;
}, [searchTerm, searchResults, conversations]);
  const active =
  (searchResults.find(c => c.id === activeChatId) ||
   conversations.find(c => c.id === activeChatId) ||
   null);


  // ---------- Build & log ChatWindow props ----------
  const activeMessages = messagesByChat[activeChatId] || [];
  const chatWindowProps = {
    activeConversation: active,
    connectivity: "unknown",
    messages: activeMessages,
    loading: msgLoading,
    error: msgError,
    onSendText,
    onSendImage,
    onSendVideo,
  };

  useEffect(() => {
    const activeId = chatWindowProps.activeConversation?.id;
    const list = chatWindowProps.messages || [];




  }, [chatWindowProps.activeConversation, chatWindowProps.connectivity, chatWindowProps.messages]);
  // ---------- END ----------

  if (loading) {
    return (
      <div className="app" style={{ placeItems: "center", display: "grid" }}>
        <div className="small">Loading…</div>
      </div>
    );
  }

  return (
    <Router>
      <div className="page">
        <header className="topnav">
          <nav className="topnav-inner">
            <a className={`pill ${location.hash === "#/chat" ? "active" : ""}`} href="#/chat">CHAT ROOM</a>
            <a className={`pill ${location.hash === "#/saved-replies" ? "active" : ""}`} href="#/saved-replies">SAVED REPLYS</a>
            <a className={`pill ${location.hash === "#/programmed-messages" ? "active" : ""}`} href="#/programmed-messages">MENSAJERIA PROGRAMADA</a>
            <a className={`pill ${location.hash === "#/account" ? "active" : ""}`} href="#/account">ACCOUNT</a>
            <a className={`pill ${location.hash === "#/ESTADISTICAS" ? "active" : ""}`} href="#/ESTADISTICAS">ESTADISTICAS</a>
            <a className={`pill ${location.hash === "#/CONFIGURACION GENERAL" ? "active" : ""}`} href="#/CONFIGURACION GENERAL">CONFIGURACION GENERAL</a>
          </nav>
        </header>

        <div className="app">
          <div className="sidebar-wrap">
            <Sidebar
            conversations={conversationsForSidebar}
            messagesByChat={messagesByChat}
            searchTerm={searchTerm}
            onSearch={setSearchTerm}
            activeChatId={activeChatId}
            onSelectChat={handleSelectChat}
          />


          </div>

          <div className="chat-wrap">
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatWindow key={activeChatId}{...chatWindowProps}/>} />
              <Route path="/saved-replies" element={<SavedRepliesPage />} />
              <Route path="/programmed-messages" element={<ProgrammedMessagesPage />} />
              <Route path="/account" element={<div style={{ padding: 16 }}>Account (stub)</div>} />
              <Route path="*" element={<Navigate to="/chat" replace />} />
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </Router>
  );
}
