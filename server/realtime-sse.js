// server/realtime-sse.js
import { waEvents } from './wa/wa-events.js';

export function installSse(app) {
  app.get('/events', (req, res) => {

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');

    res.write(`retry: 2000\n\n`);
    res.write(`event: open\n`);
    res.write(`data: "ok"\n\n`);

    const heartbeat = setInterval(() => {
      res.write(`event: ping\n`);
      res.write(`data: {}\n\n`);
    }, 25000);

    const send = (evt, payload) => {
      const id = payload?.id || payload?.messageId || '(none)';
      const bytes = JSON.stringify(payload || {}).length;
      res.write(`event: ${evt}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const normalizeInboundForUi = (p = {}) => {
      const type = String(p.type || p.media?.kind || (p.imageUrl ? "image" : "text")).toLowerCase();
      const mediaId = p.mediaId || p.media?.id || null;
      const proxyUrl = mediaId ? `/api/media/${mediaId}` : null;
      return {
        ...p,
        chatId: p.chatId || p.from || null,
        // Keep the customer phone in `from`; App.jsx uses it to attach the
        // realtime message to the correct conversation.
        from: p.from || null,
        dir: "in",
        type,
        text: p.text || p.caption || p.media?.caption || "",
        mediaId,
        imageUrl: type === "image" ? (p.imageUrl || proxyUrl || undefined) : p.imageUrl,
        videoUrl: type === "video" ? (p.videoUrl || proxyUrl || undefined) : p.videoUrl,
        audioUrl: type === "audio" ? (p.audioUrl || proxyUrl || undefined) : p.audioUrl,
        fileUrl: type === "document" ? (p.fileUrl || p.documentUrl || proxyUrl || undefined) : p.fileUrl,
        timestamp: p.timestamp || p.ts || new Date().toISOString(),
        status: p.status || "delivered",
      };
    };

    // Send one normalized inbound event. Sending both raw `inbound` and
    // `inbound_ui` caused duplicate UI handling and made media rendering depend
    // on which event arrived first.
    const onInbound  = (p) => send('inbound_ui', normalizeInboundForUi(p));
    const onOutbound = (p) => { send('outbound_ui', p); send('outbound', p); };

    waEvents.on('inbound', onInbound);
    waEvents.on('outbound', onOutbound);

    // console.log('[SSE DEBUG] listeners now → inbound:',
    //   waEvents.listenerCount('inbound'),
    //   'outbound:', waEvents.listenerCount('outbound'));

    req.on('close', () => {
      clearInterval(heartbeat);
      waEvents.off('inbound', onInbound);
      waEvents.off('outbound', onOutbound);

      // console.log('[SSE DEBUG] /events DISCONNECT. remaining → inbound:',
      //   waEvents.listenerCount('inbound'),
      //   'outbound:', waEvents.listenerCount('outbound'));

      res.end();
    });
  });
}
