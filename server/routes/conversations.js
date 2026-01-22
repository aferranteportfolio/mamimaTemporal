// server/routes/conversations.js
import express from 'express';
import { Product } from '../dbFunctionality/schemas/schema.js';

export const conversationsRouter = express.Router();

/**
 * GET /api/conversations
 * Returns the sidebar list with durable unread counts.
 */
conversationsRouter.get('/api/conversations', async (req, res) => {
  const seller = req.query.seller || '51908008097';
  try {
    // Pull only what we need (lean for speed)
    const docs = await Product.find({}, {
      customer_id: 1,
      latestSeller: 1,
      lastInboundTs: 1,
      lastMsgSeq: 1,
      lastReadSeq: 1,
      unreadCount: 1,
      updatedAt: 1,
    }).lean();

    const result = (docs || []).map(doc => {
      const unread =
        typeof doc.unreadCount === 'number'
          ? (doc.unreadCount ?? 0)
          : Math.max((doc.lastMsgSeq || 0) - (doc.lastReadSeq || 0), 0);

      return {
        id: doc.customer_id,
        phone: doc.customer_id,
        displayName: doc.customer_id,
        lastTimestamp: Number(new Date(doc.lastInboundTs || doc.updatedAt || 0)),
        unread,
      };
    });

    // console.groupCollapsed('[UNSEEN][API] GET /api/conversations response');
    // result.forEach(c => {
    //   console.log('•', c.id, { unread: c.unread, lastTimestamp: c.lastTimestamp });
    // });
    // console.groupEnd();

    res.json(result);
  } catch (err) {
    // console.error('GET /api/conversations failed:', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});
