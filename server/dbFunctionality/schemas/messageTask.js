import mongoose from 'mongoose';


const messageTaskSchema = new mongoose.Schema({
  state_id:   { type: Number, required: true },
  program_id: { type: String, required: false },
  customer_id:{ type: String, required: true },
  sellerId:   { type: String, required: true },
  sendAt:     { type: Date,   required: false }, // 👈 new
  created_at: { type: Date,   default: Date.now },
  sent:       { type: Boolean, default: false },
  sentAt:     { type: Date },
  processing: { type: Boolean, default: false },
  processingAt: { type: Date },
  failed:     { type: Boolean, default: false },
  failReason: { type: String },
  productTags: [{ type: String }],
  dedupeKey:  { type: String, required: false }
},
  {
    collection: 'message_tasks'   // 👈 match the existing collection name
  }
);


messageTaskSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export const MessageTask =
  mongoose.models.MessageTask || mongoose.model('MessageTask', messageTaskSchema);