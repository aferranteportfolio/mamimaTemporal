import mongoose from "mongoose";

const OutboxSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["text", "image", "video", "document"], default: "text" },

    to: { type: String, required: true, index: true },
    body: { type: String, default: "" }, // text body (or caption)
    media: {
      id: { type: String, default: null },  // mediaId if you use it
      url: { type: String, default: null }, // or URL if you use it
      mimeType: { type: String, default: null }
    },

    // tracking
    state: { type: String, enum: ["pending", "sending", "accepted", "failed"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },

    // Meta response
    wamid: { type: String, default: null, index: true },
    lastHttpStatus: { type: Number, default: null },
    lastErrorCode: { type: Number, default: null },
    lastError: { type: Object, default: null },

    // optional: group runs / debugging
    runId: { type: String, default: null },
    seq: { type: Number, default: null }
  },
  { timestamps: true }
);

OutboxSchema.index({ state: 1, nextAttemptAt: 1 });

export const OutboxMessage =
  mongoose.models.OutboxMessage || mongoose.model("OutboxMessage", OutboxSchema);
