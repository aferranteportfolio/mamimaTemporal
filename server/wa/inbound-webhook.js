import express from 'express';

// export a function that RETURNS a router
export function createMediaProxyRouter({ token }) {
  const router = express.Router();

  router.get('/:id', async (req, res) => {
    const id = req.params.id;
    try {
      // Node 18+ has global fetch; if you imported node-fetch, that's fine too.
      const meta = await fetch(`https://graph.facebook.com/v21.0/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const metaJson = await meta.json();
      if (!meta.ok) return res.status(meta.status).json(metaJson);

      const mediaUrl = metaJson?.url;
      if (!mediaUrl) return res.status(404).json({ ok: false, error: 'No media url' });

      const mediaResp = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      res.setHeader('Content-Type', mediaResp.headers.get('content-type') || 'application/octet-stream');
      mediaResp.body.pipe(res);
    } catch (err) {
      console.error('[media-proxy] error', err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  return router;
}
