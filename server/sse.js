// sse.js
export const clients = new Set();

export function sseHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || 'http://localhost:5173');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client = { res };
  clients.add(client);
  req.on('close', () => clients.delete(client));

  // optional hello
  res.write(`event: ready\ndata: {"ok":true}\n\n`);
}

export function broadcast(eventName, payload) {
  const data = JSON.stringify(payload);
  for (const res of clients) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${data}\n\n`);
  }
}
