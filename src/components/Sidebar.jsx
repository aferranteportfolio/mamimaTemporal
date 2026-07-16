// src/components/Sidebar.jsx
import { useMemo, useState } from "react";
import ChatRow from "./ChatRow.jsx";

/**
 * @param {{
 *  conversations: Array<{
 *    id:string,
 *    customerId:string,
 *    lastMessage?:string,
 *    lastTimestamp?:string|number,
 *    unread?:number,
 *    favorite?:boolean,
 *    isGroup?:boolean,
 *    type?:string
 *  }>,
 *  messagesByChat?: Record<string, Array<{ text?:string, ts?:string|number }>>,
 *  searchTerm: string,
 *  onSearch: (v:string)=>void,
 *  activeChatId: string|null,
 *  onSelectChat: (id:string)=>void
 * }} props
 */

const FILTROS = {
  TODOS: "todos",
  NO_LEIDOS: "noLeidos",
  FAVORITOS: "favoritos",
  GRUPOS: "grupos",
};

// DEBUG apagado
const DEBUG_SEARCH = false;
const dlog = () => {};

// --- helpers ---------------------------------------------------------------
const toTs = (x) => {
  if (x == null) return 0;
  const n = Number(x);
  if (!Number.isNaN(n) && n > 0) return n;
  const d = Date.parse(String(x));
  return Number.isNaN(d) ? 0 : d;
};

const normCompact = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "");

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

export default function Sidebar({
  conversations,
  messagesByChat = {},
  searchTerm,
  onSearch,
  activeChatId,
  onSelectChat
}) {
  const [filtro, setFiltro] = useState(FILTROS.TODOS);

  const enriquecidas = useMemo(() => {
    const out = (conversations || []).map((c) => {
      const live = messagesByChat[c.id] || [];
      const lastLive = [...live].reverse().find(hasRenderableMessage) || null;

      const previewText = lastLive?.text ?? c.lastMessage ?? "";
      const previewTs   = toTs(lastLive?.ts ?? c.lastTimestamp ?? 0);

      const favorite = !!c.favorite;
      const isGroup =
        c.isGroup ??
        c.type === "group" ??
        /@g\.us$/.test(String(c.id || ""));

      return {
        ...c,
        favorite,
        isGroup,
        lastMessage: previewText,
        lastTimestamp: previewTs,
        unread: Number(c.unread ?? 0),
        _idCompact: normCompact(c.id),
        _custCompact: normCompact(c.customerId),
        _lastMsgCompact: normCompact(previewText),
      };
    });

    return out;
  }, [conversations, messagesByChat]);

  const conteo = useMemo(() => {
    return {
      total: enriquecidas.length,
      noLeidos: enriquecidas.filter(c => c.unread > 0).length,
      favoritos: enriquecidas.filter(c => c.favorite).length,
      grupos: enriquecidas.filter(c => c.isGroup).length
    };
  }, [enriquecidas]);

  const filtradasPorBusqueda = useMemo(() => {
    const raw = String(searchTerm || "");
const qDigits = raw.replace(/[^\d]/g, "");
const qLocal = qDigits.length > 9 ? qDigits.slice(-9) : qDigits; // last 9 digits
const q = normCompact(qLocal || raw);

if (!q) return enriquecidas;

    const results = [];
    for (const c of enriquecidas) {
      if (
        c._custCompact.includes(q) ||
        c._idCompact.includes(q) ||
        c._lastMsgCompact.includes(q)
      ) {
        results.push(c);
      }
    }
    return results;
  }, [enriquecidas, searchTerm]);

  const filtradasPorBoton = useMemo(() => {
    switch (filtro) {
      case FILTROS.NO_LEIDOS:
        return filtradasPorBusqueda.filter(c => c.unread > 0);
      case FILTROS.FAVORITOS:
        return filtradasPorBusqueda.filter(c => c.favorite);
      case FILTROS.GRUPOS:
        return filtradasPorBusqueda.filter(c => c.isGroup);
      default:
        return filtradasPorBusqueda;
    }
  }, [filtradasPorBusqueda, filtro]);

  const normalized = useMemo(() => {
    return [...filtradasPorBoton].sort(
      (a, b) => Number(b.lastTimestamp || 0) - Number(a.lastTimestamp || 0)
    );
  }, [filtradasPorBoton]);

  return (
    <aside className="panel sidebar">
      <div className="panel-header">
        <div className="panel-title">Chats</div>
      </div>

      <div className="sidebar-body">
        <input
          className="input"
          placeholder="Search by phone or text…"
          value={searchTerm}
          onChange={(e) => onSearch(e.target.value)}
          autoComplete="off"
        />

        <div className="filters-row" style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button
            className={`btn ${filtro === FILTROS.TODOS ? "primary" : ""}`}
            onClick={() => setFiltro(FILTROS.TODOS)}
          >
            Todos{conteo.total ? ` (${conteo.total})` : ""}
          </button>
          <button
            className={`btn ${filtro === FILTROS.NO_LEIDOS ? "primary" : ""}`}
            onClick={() => setFiltro(FILTROS.NO_LEIDOS)}
          >
            No leídos{conteo.noLeidos ? ` (${conteo.noLeidos})` : ""}
          </button>
          <button
            className={`btn ${filtro === FILTROS.FAVORITOS ? "primary" : ""}`}
            onClick={() => setFiltro(FILTROS.FAVORITOS)}
          >
            Favoritos{conteo.favoritos ? ` (${conteo.favoritos})` : ""}
          </button>
          <button
            className={`btn ${filtro === FILTROS.GRUPOS ? "primary" : ""}`}
            onClick={() => setFiltro(FILTROS.GRUPOS)}
          >
            Grupos{conteo.grupos ? ` (${conteo.grupos})` : ""}
          </button>
        </div>
      </div>

      <div className="sidebar-list">
        {normalized.map((c) => (
          <ChatRow
            key={c.id}
            conversation={c}
            isActive={activeChatId === c.id}
            onClick={() => onSelectChat?.(c.id)}
          />
        ))}

        {normalized.length === 0 && (
          <div className="small" style={{ padding: 16 }}>
            Sin conversaciones para este filtro.
          </div>
        )}
      </div>
    </aside>
  );
}
