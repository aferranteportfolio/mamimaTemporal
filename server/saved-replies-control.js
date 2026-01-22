import express from "express";
import { actuallySendSavedReplyObject } from "../server/utils/messageSorter.js";

export const savedRepliesControlRouter = express.Router();

/**
 * POST /api/saved-replies/send
 * Body: { toPhone: "51915944684", replyId: "5eec50fc-d1b5fa" }
 */ 




savedRepliesControlRouter.post("/send", express.json(), async (req, res) => {
  const { toPhone, replyId } = req.body || {};

  if (!toPhone || !replyId) {
    return res.status(400).json({
      ok: false,
      error: "Missing toPhone or replyId"
    });
  }

  try {
  await actuallySendSavedReplyObject(toPhone, meta, folderName, miscCfg);    return res.json({ ok: true });
  } catch (err) {
    console.error("[saved-replies-control] send error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to send reply"
    });
  }
});
