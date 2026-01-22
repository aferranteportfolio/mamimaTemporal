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

    const onInbound  = (p) => send('inbound', p);
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
