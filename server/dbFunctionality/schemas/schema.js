// schema.js
import mongoose from 'mongoose';

// ---- Message schema (used for INBOUND and OUTBOUND) ----
const ChatMessageSchema = new mongoose.Schema(
  {
    // ✅ NEW: stable identifiers for dedupe/update
    id: { type: String },        // "wamid...." OR "outbox:<mongoId>"
    outboxId: { type: String },  // mongo _id of OutboxMessage as string
    status: {
      type: String,
      enum: ["queued", "sending", "sent", "failed"],
      default: "sent"
    },

    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "location", "button_reply", "document", "file", "ctwa_referral"],
      default: "text",
    },

    referral_type: { type: String, default: null },
    referral_metadata: { type: mongoose.Schema.Types.Mixed, default: null },

    contextMessageId: { type: String, default: null },
    replyToId: { type: String, default: null },

    message: { type: String },

    mediaId: { type: String },
    caption: { type: String },

    media: {
      id:       { type: String },
      mimeType: { type: String },
      size:     { type: Number },
      sha256:   { type: String },
      durationMs:{ type: Number },
      width:    { type: Number },
      height:   { type: Number },
      url:      { type: String },
      voice:    { type: Boolean },
    },

    audioUrl: { type: String },

    location: {
      latitude: { type: Number },
      longitude:{ type: Number },
      name:     { type: String },
      address:  { type: String },
      url:      { type: String },
    },

    locationUrl: { type: String },
    url:         { type: String },

    timestamp: { type: Date, default: Date.now },
    sentBy: { type: String },
  },
  { _id: false }
);


// ---- Root document schema ----
const productSchema = new mongoose.Schema({
  customer_id:   { type: String },
  latestSeller:  { type: String },

  // INBOUND (customer -> us)
  customer_messages: [ChatMessageSchema],

  costumer_profile: [{}], // (kept)

  state: [{
    // OUTBOUND (us -> customer)
    messagesSentCollection: [ChatMessageSchema],

    productObject: [{
      product_info_requested: String,
      timestamp: Date,
      product_value: Number,
      shippingInfo: String,
      quantity: Number,
      specialProduct: Object
    }],

    shippingStatus: [{
      shippingInfoDelivered: Boolean,
      shippingCost: Number,
      timestamp: Date
    }],

    purchase_state: [{
      funnel_state: Number,
      timestamp: Date,
      product_purchased: Boolean,
      passwordGiven: Boolean
    }],

    reMarketing: [
      { remarketing_state: Number, timestamp: Date },
      { free_shipping: Boolean, timestamp: Date, freeShippingRetargetingStage: { type: Number, default: 0 } },
      { babyCatalogo: { type: Boolean, default: false }, timestamp: { type: Date, default: Date.now } }
    ]
  }],

  // ──────────────────────────────────────────────────────
  // NEW: Read-cursor / unseen tracking (server-truthy)
  // ──────────────────────────────────────────────────────
  unreadCount:  { type: Number, default: 0 },  // optional denormalized counter
  lastMsgSeq:   { type: Number, default: 0 },  // monotonic message sequence (in+out)
  lastReadSeq:  { type: Number, default: 0 },  // what the operator has read up to
  lastInboundTs:{ type: Date,   default: null },// last inbound message time (for sort)
  lastReadTs:   { type: Date,   default: null },// when we last marked as seen

  // (Optional, for multi-operator read state)
  // lastReadSeqByUser: { type: Map, of: Number, default: undefined },

}, { versionKey: false });

// Helpful indexes (do NOT enforce unique unless you want it)
productSchema.index({ lastInboundTs: -1 });
// productSchema.index({ customer_id: 1 }, { unique: true }); // <- only if safe for your data

export const Product = mongoose.model('Product', productSchema);
