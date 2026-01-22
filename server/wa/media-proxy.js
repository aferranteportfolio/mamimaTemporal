// server/wa/media-proxy.js
import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream";

export function createMediaProxyRouter({ token }) {
  const router = express.Router();

  router.get("/:id", async (req, res) => {
    const id = req.params.id;

    try {
      // 1) Resolve media URL
      const metaResp = await fetch(`https://graph.facebook.com/v21.0/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const metaJson = await metaResp.json().catch(() => ({}));
      if (!metaResp.ok) {
        return res.status(metaResp.status).json(metaJson);
      }
      const mediaUrl = metaJson?.url;
      if (!mediaUrl) {
        return res.status(404).json({ ok: false, error: "No media url" });
      }

      // 2) Fetch media with abort support
      const ac = new AbortController();
      const mediaResp = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal
      });

      // Abort upstream fetch if client disconnects
      req.on("aborted", () => {
        ac.abort(); // <- don't call mediaResp.body.cancel(); stream is locked later
      });

      if (!mediaResp.ok) {
        const txt = await mediaResp.text().catch(() => "");
        return res
          .status(mediaResp.status)
          .type("text/plain")
          .send(txt || "Failed to fetch media");
      }

      // 3) Send headers once, then stream
      const ctype = mediaResp.headers.get("content-type") || "application/octet-stream";
      const clen  = mediaResp.headers.get("content-length");
      res.setHeader("Content-Type", ctype);
      if (clen) res.setHeader("Content-Length", clen);
      res.setHeader("Cache-Control", "private, max-age=3600");

      // Convert WHATWG ReadableStream -> Node Readable
      const nodeStream = Readable.fromWeb(mediaResp.body);

      pipeline(nodeStream, res, (err) => {
        if (!err) return;
        // Ignore abort noise
        if (err.name === "AbortError") return;
        if (String(err?.code || "").includes("ERR_STREAM_PREMATURE_CLOSE")) return;
        console.error("[media-proxy] pipeline error", err);
        // Headers already sent; just ensure socket ends
        try { if (!res.writableEnded) res.end(); } catch {}
      });
    } catch (err) {
      // If headers not sent, respond with JSON; otherwise just end
      if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: String(err?.message || err) });
      }
      try { if (!res.writableEnded) res.end(); } catch {}
    }
  });

  return router;
}
