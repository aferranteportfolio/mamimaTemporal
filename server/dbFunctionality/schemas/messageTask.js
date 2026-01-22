import mongoose from 'mongoose';


const messageTaskSchema = new mongoose.Schema({
  state_id:   { type: Number, required: true },
  customer_id:{ type: String, required: true },
  sellerId:   { type: String, required: true },
  sendAt:     { type: Date,   required: false }, // 👈 new
  created_at: { type: Date,   default: Date.now },
  sent:       { type: Boolean, default: false },
  failed:     { type: Boolean, default: false },
  failReason: { type: String }
},
  {
    collection: 'message_tasks'   // 👈 match the existing collection name
  }
);


export const MessageTask =
  mongoose.models.MessageTask || mongoose.model('MessageTask', messageTaskSchema);