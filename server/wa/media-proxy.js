// server/wa/media-proxy.js
import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream";

const mask = (value) => {
  const s = String(value || "");
  if (!s) return "missing";
  return `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)`;
};

const tokenFromEnv = () => (
  process.env.WHATSAPP_TOKEN ||
  process.env.WA_TOKEN ||
  process.env.META_ACCESS_TOKEN ||
  process.env.FACEBOOK_ACCESS_TOKEN ||
  ""
);

const previewBody = (body, max = 500) => {
  if (!body) return "";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const parseJsonObject = (text) => {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const graphMediaDiagnosis = (body) => {
  const error = body?.error || {};
  if (error.code === 100 && error.error_subcode === 33) {
    return {
      category: "media_not_found_or_not_authorized",
      likelyCauses: [
        "The token used by /api/media does not belong to the WhatsApp Business Account/phone number that received this media.",
        "The token is missing WhatsApp Business messaging/media permissions or was generated for the wrong Meta app/business.",
        "The media id is not a WhatsApp Cloud API media id for this account, or it was deleted/expired by Meta.",
      ],
      nextChecks: [
        "Confirm WHATSAPP_TOKEN is the same token used for this WhatsApp Cloud API phone number.",
        "Confirm the webhook phone_number_id in [webhook media] logs matches the token's WhatsApp business/phone setup.",
        "Use the [media-proxy] request + graph metadata failed logs to compare mediaId, graphVersion, and masked token across failing requests.",
      ],
    };
  }

  if (error.code === 190) {
    return {
      category: "invalid_or_expired_token",
      likelyCauses: ["The WhatsApp/Meta access token is invalid, expired, revoked, or malformed."],
      nextChecks: ["Regenerate WHATSAPP_TOKEN and restart the backend process so the proxy reads the new value."],
    };
  }

  return null;
};

export function createMediaProxyRouter({ token, graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v21.0" } = {}) {
  const router = express.Router();

  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    const activeToken = typeof token === "function" ? token() : (token || tokenFromEnv());
    const startedAt = Date.now();

    console.log("[media-proxy] request", {
      id,
      graphVersion,
      hasToken: !!activeToken,
      token: mask(activeToken),
      accept: req.get("accept") || null,
      referer: req.get("referer") || null,
    });

    if (!activeToken) {
      console.error("[media-proxy] missing token; set WHATSAPP_TOKEN (or WA_TOKEN/META_ACCESS_TOKEN/FACEBOOK_ACCESS_TOKEN)", { id });
      return res.status(500).json({ ok: false, error: "Missing WhatsApp media token on server" });
    }

    try {
      // 1) Resolve media URL
      const metaUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(id)}`;
      const metaResp = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      const metaText = await metaResp.text().catch(() => "");
      const metaJson = parseJsonObject(metaText);
      console.log("[media-proxy] graph metadata response", {
        id,
        status: metaResp.status,
        ok: metaResp.ok,
        contentType: metaResp.headers.get("content-type"),
        hasUrl: !!metaJson?.url,
        mimeType: metaJson?.mime_type || null,
      });
      if (!metaResp.ok) {
        const diagnosis = graphMediaDiagnosis(metaJson);
        console.error("[media-proxy] graph metadata failed", {
          id,
          status: metaResp.status,
          body: previewBody(metaJson || metaText),
          diagnosis,
        });
        return res.status(metaResp.status).json({
          ...(metaJson || { error: metaText || "Graph metadata failed" }),
          ok: false,
          mediaProxyDiagnosis: diagnosis,
        });
      }
      if (!metaJson) {
        console.error("[media-proxy] graph metadata was not JSON", { id, status: metaResp.status, body: previewBody(metaText) });
        return res.status(502).json({ ok: false, error: "Graph metadata response was not JSON" });
      }
      const mediaUrl = metaJson?.url;
      if (!mediaUrl) {
        return res.status(404).json({ ok: false, error: "No media url" });
      }

      // 2) Fetch media with abort support
      const ac = new AbortController();
      const mediaResp = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${activeToken}` },
        signal: ac.signal
      });

      // Abort upstream fetch if client disconnects
      req.on("aborted", () => {
        ac.abort(); // <- don't call mediaResp.body.cancel(); stream is locked later
      });

      console.log("[media-proxy] media bytes response", {
        id,
        status: mediaResp.status,
        ok: mediaResp.ok,
        contentType: mediaResp.headers.get("content-type"),
        contentLength: mediaResp.headers.get("content-length"),
        elapsedMs: Date.now() - startedAt,
      });

      if (!mediaResp.ok) {
        const txt = await mediaResp.text().catch(() => "");
        console.error("[media-proxy] media fetch failed", { id, status: mediaResp.status, body: previewBody(txt) });
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
      console.error("[media-proxy] unexpected error", { id, error: err?.message || String(err), stack: err?.stack });
      // If headers not sent, respond with JSON; otherwise just end
      if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: String(err?.message || err) });
      }
      try { if (!res.writableEnded) res.end(); } catch {}
    }
  });

  return router;
}
