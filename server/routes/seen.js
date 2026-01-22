// server/routes/seen.js
import express from "express";
import mongoose from "mongoose";
import { Product } from "../dbFunctionality/schemas/schema.js";

export const seenRouter = express.Router();

/**
 * POST /api/chats/:id/seen
 * id can be a Mongo _id (24-hex) or a customer_id (phone digits).
 */
seenRouter.post("/api/chats/:id/seen", async (req, res) => {
  const chatId = String(req.params.id || "").trim();

  const isObjectId = /^[a-f0-9]{24}$/i.test(chatId);
  const query = isObjectId
    ? { _id: new mongoose.Types.ObjectId(chatId) }
    : { customer_id: chatId };

  try {
    const doc = await Product.findOne(query).lean();
    if (!doc) {
      console.warn("[UNSEEN][API] mark-seen → not found", { chatId, query });
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const last = Number(doc.lastMsgSeq || 0);
    console.log("[UNSEEN][API] mark-seen →", chatId, "(seq to)", last);

    const update = {
      $set: {
        lastReadSeq: last,
        lastReadTs: new Date(),
        updatedAt: new Date(),
      },
    };
    // If you keep a counter and want to zero it:
    if (typeof doc.unreadCount === "number") {
      update.$set.unreadCount = 0;
    }

    await Product.updateOne(query, update);

    const after = await Product.findOne(query, {
      customer_id: 1,
      lastMsgSeq: 1,
      lastReadSeq: 1,
      unreadCount: 1,
      lastReadTs: 1,
    }).lean();

    console.log("[UNSEEN][DB] after mark-seen →", chatId, after);

    return res.json({ ok: true, data: { chatId, lastMsgSeq: after.lastMsgSeq, lastReadSeq: after.lastReadSeq, unreadCount: after.unreadCount } });
  } catch (err) {
    console.error("[UNSEEN][API] mark-seen error →", chatId, err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});
