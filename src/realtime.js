const API_BASE = 'http://localhost:3050';

function safeJson(x) {
  try { return JSON.parse(x); } catch (e) { return { __parse_error: String(e), __raw: x }; }
}

function now() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z','Z');
}

function rsName(rs) {
  return ({0:'CONNECTING',1:'OPEN',2:'CLOSED'}[rs] ?? String(rs));
}

export function startSse(opts = {}) {
  const onInbound  = typeof opts.onInbound  === 'function' ? opts.onInbound  : null;
  const onOutbound = typeof opts.onOutbound === 'function' ? opts.onOutbound : null;

  const url = `${API_BASE}/events`;
  console.log(`[SSE] ${now()} • init → ${url}`);

  const es = new EventSource(url, { withCredentials: false });

  // Log that handlers are registered (helps catch typos)
  console.log('[SSE] registering listeners: open,error,ready,inbound,outbound,inbound_ui,outbound_ui (log-only)');

  es.addEventListener('open',  () => {
    console.log(`[SSE] ${now()} • open • readyState=${rsName(es.readyState)}`);
  });

  es.addEventListener('error', (e) => {
    console.log(`[SSE] ${now()} • error • readyState=${rsName(es.readyState)}`, e);
  });

  es.addEventListener('ready', (e) => {
    console.log(
      `[SSE] ${now()} • ready • dataLen=${(e.data||'').length} • lastEventId=${e.lastEventId || '(none)'}`
    );
  });

  es.addEventListener('inbound', (e) => {
    const d = safeJson(e.data);
    console.log(
      `[SSE] ${now()} • inbound • lastEventId=${e.lastEventId || '(none)'} • keys=${Object.keys(d||{}).join(',')}`
    );

    // 🔊 RAW AUDIO LOG
    if (d?.type === 'audio' || d?.media?.kind === 'audio') {
      console.log('[FE][AUDIO][SSE-INBOUND-RAW]', {
        id: d.id,
        from: d.from,
        to: d.to,
        ts: d.ts,
        type: d.type,
        text: d.text,
        media: d.media,
        mediaId: d.media?.id,
        mimeType: d.media?.mimeType,
        url: d.media?.url,
        voice: d.media?.voice,
      });
    }

    if (onInbound) onInbound(d, 'inbound');
  });

  es.addEventListener('outbound', (e) => {
    const d = safeJson(e.data);
    console.log(
      `[SSE] ${now()} • outbound • lastEventId=${e.lastEventId || '(none)'} • type=${d?.type} • id=${d?.id}`
    );
    if (onOutbound) onOutbound(d, 'outbound');
  });

  es.addEventListener('outbound_ui', (e) => {
    const d = safeJson(e.data);
    console.log(
      `[SSE] ${now()} • outbound_ui • lastEventId=${e.lastEventId || '(none)'} • type=${d?.type} • id=${d?.id}`
    );
    if (onOutbound) onOutbound(d, 'outbound_ui');
  });

  es.addEventListener('inbound_ui', (e) => {
    const d = safeJson(e.data);
    console.log(
      `[SSE] ${now()} • inbound_ui • lastEventId=${e.lastEventId || '(none)'} • keys=${Object.keys(d||{}).join(',')}`
    );

    // 🔊 UI AUDIO LOG (ya con audioUrl, chatId, etc.)
    if (d?.type === 'audio') {
      console.log('[FE][AUDIO][SSE-INBOUND-UI]', {
        id: d.id,
        chatId: d.chatId,
        from: d.from,
        dir: d.dir,
        type: d.type,
        audioUrl: d.audioUrl,
        text: d.text,
        timestamp: d.timestamp,
        status: d.status,
      });
    }

    if (onInbound) onInbound(d, 'inbound_ui');
  });

  return () => {
    console.log(`[SSE] ${now()} • close() requested • currentState=${rsName(es.readyState)}`);
    es.close();
    console.log(`[SSE] ${now()} • closed • newState=${rsName(es.readyState)}`);
  };
}
