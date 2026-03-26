// db-helpers.mjs
// ESM module with normalized, consistent helpers for your Product model

import { Product } from './schemas/schema.js';
import { durationMs, emitObs, nowMs } from '../utils/observability.js';

/* ---------- Utilities ---------- */
export function normalizeCustomerId(x) {
  if (!x) return null;
  // keep only digits, drop spaces, dashes, @c.us, etc.
  const digits = String(x).replace(/\D/g, '');
  if (!digits) return null;
  // ensure Peru CC (51)
  return digits.startsWith('51') ? digits : ('51' + digits);
}

function now() {
  return new Date();
}

/* ---------- Core lookups ---------- */
async function getIdDocument(rawId) {
  const customer_id = normalizeCustomerId(rawId);
  if (!customer_id) return null;
  return Product.findOne({ customer_id });
}

/* ---------- Creation ---------- */
async function createNewObjectInDatabase(costumerIdStringNumber, messageFromCostumer, messageFromUs, ourNumber, rawpayload) {
  const customer_id = normalizeCustomerId(costumerIdStringNumber);
  const latestSeller = normalizeCustomerId(ourNumber);

  // --- base state (kept as you had) ---
  const baseState = {
    messagesSentCollection: [],
    productObject: [
      {
        product_info_requested: String, // schema placeholder you had
        timestamp: now(),
        product_value: 0,
        shippingInfo: '',
        quantity: 1
      }
    ],
    shippingStatus: [
      {
        shippingInfoDelivered: false,
        shippingCost: 0,
        timestamp: now()
      }
    ],
    purchase_state: [
      {
        funnel_state: 0,
        timestamp: now(),
        product_purchased: false,
        passwordGiven: false
      }
    ],
    reMarketing: [
      { remarketing_state: 0, timestamp: now() },
      { free_shipping: false, timestamp: now(), freeShippingRetargetingStage: 0 },
      { babyCatalogo: false, timestamp: now() }
    ]
  };

  if (messageFromUs) {
    baseState.messagesSentCollection.push({
      message: messageFromUs,
      timestamp: now(),
      sentBy: latestSeller
    });
  }

  // --- NEW: unseen/read-cursor fields (server-truthy) ---
  const createdAt = new Date();
  const newProductData = {
    customer_id,
    latestSeller,
    costumer_profile: [{}],
    state: [baseState],

    // 👇 UNSEEN fields
    unreadCount: 0,        // optional denormalized counter
    lastMsgSeq: 0,         // monotonic message sequence (in+out)
    lastReadSeq: 0,        // what we’ve read up to
    lastInboundTs: null,   // last inbound message time
    lastReadTs: null,      // when we last marked as seen

    // basic auditing
    createdAt,
    updatedAt: createdAt
  };

  // NOTE: Do NOT increment unread or seq here.
  // Let updateMessageReceivedById() handle inbound/outbound to keep logic centralized.
  // If you ever want to seed the very first inbound message here, still avoid bumping counters here.

  // (You left this empty; leaving behavior unchanged)
  if (messageFromCostumer) {
    // intentionally no-op (unread/seq will be handled by updateMessageReceivedById)
  }

  try {
    const newDoc = new Product(newProductData);
    await newDoc.save();

  } catch (error) {
    console.error('❌ Failed to create/save product object:', error);
  }
}

/* ---------- Transforms ---------- */
async function initializeObjectInDatabase(message) {
  return {
    from: message.from,
    body: message.body
  };
}

/* ---------- Updates for messages ---------- */
// Requires: import { Product } from '../schema.js'; (adjust path)

// local helpers (inline to keep this self-contained)
function buildInboundMsg(src) {
  const isObj = src && typeof src === "object";

  // Pick best timestamp
  const tsRaw = isObj ? (src.ts ?? src.timestamp ?? Date.now()) : Date.now();
  const ts = typeof tsRaw === "number" ? tsRaw : Date.parse(tsRaw) || Date.now();

  // --- INTERACTIVE detection (quick-reply buttons, etc.) ---
  const interactive = isObj ? (src.interactive || null) : null;
  const isButtonReply =
    interactive?.type === "button_reply" && interactive.button_reply;
  const buttonReply = isButtonReply ? interactive.button_reply : null;

  // --- LOCATION detection ---
  const locationRaw = isObj ? (src.location || src.media?.location) : null;
  const hasLocation = !!locationRaw;

  // Determine type using multiple hints
  const hintedType = isObj ? (src.type || src.media?.kind) : null;
  const referral = isObj ? (src.referral_metadata || src.referral || src.context?.referral || null) : null;
  const referralSource = String(referral?.source ?? referral?.source_type ?? src?.referral_type ?? "").toLowerCase();
  const hasAdReferralHints = !!(
    referral && (
      referral?.ad_id ||
      referral?.source_id ||
      referral?.source_url ||
      referral?.ctwa_clid ||
      referral?.headline ||
      referral?.body ||
      referral?.title ||
      referral?.description ||
      referral?.image_url ||
      referral?.video_url ||
      referral?.thumbnail_url
    )
  );
  const isCtwaReferral =
    hintedType === "ctwa_referral" ||
    referralSource === "ads" ||
    referralSource === "ad" ||
    hasAdReferralHints;
  let type = "text";

  if (isCtwaReferral) {
    type = "ctwa_referral";
  } else if (isButtonReply) {
    // Treat the UBICACION button as a location-type message
    if (buttonReply?.id === "UBICACION") {
      type = "location";
    } else {
      type = "button_reply";
    }
  } else if (hintedType === "image" || src?.media?.mimeType?.startsWith?.("image")) {
    type = "image";
  } else if (hintedType === "video" || src?.media?.mimeType?.startsWith?.("video")) {
    type = "video";
  } else if (hintedType === "audio" || src?.media?.mimeType?.startsWith?.("audio")) {
    type = "audio";
  } else if (hintedType === "document" || hintedType === "file" || src?.media?.mimeType?.startsWith?.("application/") || src?.media?.mimeType?.includes?.("pdf")) {
    type = "document";
  } else if (hintedType === "location" || hasLocation) {
    type = "location";
  }

  // Extract media id from modern or legacy shape
  const mediaId = (isObj && (src.media?.id || src.mediaId)) || null;

  // Prefer explicit text; else caption from media; else button title; else empty
  const caption = isObj ? (src.media?.caption ?? src.caption ?? null) : null;
  let message = isObj ? (src.text ?? src.message ?? caption ?? "") : String(src ?? "");
  if (!message && buttonReply) {
    message = buttonReply.title || buttonReply.id || "";
  }

  // Normalize LOCATION block
  let location = undefined;
  if (hasLocation) {
    const loc = locationRaw;
    location = {
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      name: loc.name ?? null,
      address: loc.address ?? null,
      url: loc.url ?? undefined, // WA sometimes sends it
    };
  }

  // Normalize media block (images / video / audio)
  const media =
    (isObj && (src.media || mediaId))
      ? {
          id: mediaId || src.media?.id,
          mimeType: src.media?.mimeType,
          sha256: src.media?.sha256,
          caption: caption ?? undefined,
          kind: src.media?.kind,
          voice: src.media?.voice,
          url: src.media?.url,
        }
      : undefined;

  // --- Build a URL for location / special buttons ---
  let url;

  // Real location with coordinates
  if (type === "location" && location?.latitude && location?.longitude) {
    url =
      location.url ||
      `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
  }

  // Special case: interactive button "UBICACION" without coords → fixed URL
  if (!url && isButtonReply && buttonReply?.id === "UBICACION") {
    url = "https://maps.google.com/?q=-12.046374,-77.042793"; // <-- pon tu ubicación real
  }

  const payload = {
    id: isObj ? (src.id ?? undefined) : undefined,
    contextMessageId: isObj ? (src.contextMessageId ?? src.context?.message_id ?? src.context?.id ?? null) : null,
    replyToId: isObj
      ? (src.replyToId ?? src.reply_to_id ?? src.contextMessageId ?? src.context?.message_id ?? src.context?.id ?? null)
      : null,
    type, // 'text' | 'image' | 'video' | 'audio' | 'location' | 'button_reply' | 'document'
    message,
    mediaId: mediaId || undefined,
    caption: caption ?? undefined,
    media,
    location,
    // FE uses locationUrl; keep url too just in case
    locationUrl: url || location?.url || undefined,
    url: url || undefined,
    interactive: isButtonReply
      ? { id: buttonReply.id, title: buttonReply.title }
      : undefined,
    referral_type: isCtwaReferral ? "ads" : ((src?.referral_type || referral?.source || referral?.source_type) ?? null),
    referral_metadata: isCtwaReferral
      ? {
          ad_id: referral?.ad_id ?? referral?.source_id ?? null,
          ad_name: referral?.ad_name ?? referral?.source_url ?? null,
          adset_id: referral?.adset_id ?? null,
          campaign_id: referral?.campaign_id ?? null,
          headline: referral?.headline ?? referral?.title ?? null,
          body: referral?.body ?? referral?.description ?? null,
          source: referral?.source ?? referral?.source_type ?? "ads",
          media_url: referral?.media_url ?? referral?.image_url ?? referral?.thumbnail_url ?? referral?.video_url ?? referral?.source_url ?? null,
          image_url: referral?.image_url ?? referral?.thumbnail_url ?? null,
          video_url: referral?.video_url ?? null,
          source_url: referral?.source_url ?? null,
          source_id: referral?.source_id ?? null,
          ctwa_clid: referral?.ctwa_clid ?? null,
          type: referral?.type ?? null,
        }
      : (src?.referral_metadata ?? null),
    timestamp: new Date(ts),
    sentBy: undefined,
  };

  return payload;
}




function buildOutboundMsg(src, ourNumber) {
  const isObj = src && typeof src === "object";

  const type =
    (isObj && src.type) ||
    (isObj && src.imageUrl && "image") ||
    (isObj && src.videoUrl && "video") ||
    (isObj && src.media?.mimeType?.startsWith("image") && "image") ||
    (isObj && src.media?.mimeType?.startsWith("video") && "video") ||
    (isObj && (src.fileUrl || src.documentUrl) && "document") ||
    (isObj && (src.media?.kind === "document" || src.media?.kind === "file") && "document") ||
    (isObj && src.media?.mimeType?.startsWith("application/") && "document") ||
    (isObj && src.mediaId && (src.type === "document" || src.type === "file") && "document") ||
    (isObj && src.mediaId && "image") ||
    "text";

  return {
    // ✅ NEW: identifiers for dedupe/replace
    id: isObj ? (src.id ?? undefined) : undefined,
    outboxId: isObj ? (src.outboxId ?? undefined) : undefined,
    status: isObj ? (src.status ?? undefined) : undefined,
    contextMessageId: isObj ? (src.contextMessageId ?? src.context?.message_id ?? src.context?.id ?? null) : null,
    replyToId: isObj
      ? (src.replyToId ?? src.reply_to_id ?? src.contextMessageId ?? src.context?.message_id ?? src.context?.id ?? null)
      : null,

    type,
    message: isObj ? (src.text ?? src.message ?? src.caption ?? "") : String(src ?? ""),

    mediaId: isObj ? (src.mediaId ?? src.media?.id) : undefined,
    caption: isObj ? (src.caption ?? "") : undefined,
    media: isObj ? src.media : undefined,
    mimeType: isObj ? (src.mimeType ?? src.media?.mimeType) : undefined,

    timestamp: isObj?.timestamp ? new Date(src.timestamp) : now(),
    sentBy: ourNumber,
  };
}



export async function updateMessageReceivedById(doc, inboundMsg, outboundMsg, ourNumber) {
  const isInbound  = !!inboundMsg && !outboundMsg;
  const isOutbound = !!outboundMsg && !inboundMsg;
  const mode = isInbound ? "inbound" : isOutbound ? "outbound" : "unknown";

  // Defensive: load fresh doc state
  const freshReadStartedAt = nowMs();
  const fresh = await Product.findById(doc._id).lean();
  emitObs("db.message_history.fresh_read", {
    productId: String(doc?._id || ""),
    mode,
    freshReadMs: durationMs(freshReadStartedAt),
  });
  const before = {
    lastMsgSeq: fresh?.lastMsgSeq ?? 0,
    lastReadSeq: fresh?.lastReadSeq ?? 0,
    unreadCount: fresh?.unreadCount ?? 0,
    hasState0: Array.isArray(fresh?.state) && fresh.state.length > 0,
  };

  // Next sequence for any message (in or out)
  const nextSeq = (before.lastMsgSeq || 0) + 1;

  // Base atomic update
  const $set = { lastMsgSeq: nextSeq, updatedAt: now() };
  const $inc = {};
  const update = { $set, $inc };

  // Build payloads (only for the side we’re handling)
  let inPayload  = null;
  let outPayload = null;

  if (isInbound) {
    inPayload = buildInboundMsg(inboundMsg);
    $set.lastInboundTs = inPayload.timestamp;
    // keep counter if you use it
    if (typeof before.unreadCount === 'number') $inc.unreadCount = 1;

    // push inbound into customer_messages
    update.$push = { customer_messages: inPayload };

  }

 if (isOutbound) {
  outPayload = buildOutboundMsg(outboundMsg, ourNumber);

  // ✅ If this is the "accepted" update (wamid arrived) and we have outboxId,
  // try to UPDATE the queued placeholder instead of pushing a new element.
  const isAcceptUpdate =
    !!outPayload.outboxId &&
    (String(outPayload.id || "").startsWith("wamid.") || outPayload.status === "sent");

  if (isAcceptUpdate) {
    const placeholderUpdateStartedAt = nowMs();
    const upd = await Product.updateOne(
      { _id: doc._id, "state.0.messagesSentCollection.outboxId": outPayload.outboxId },
      {
        $set: {
          updatedAt: now(),

          // replace placeholder fields
          "state.0.messagesSentCollection.$[m].id": outPayload.id,
          "state.0.messagesSentCollection.$[m].status": outPayload.status || "sent",
          "state.0.messagesSentCollection.$[m].timestamp": outPayload.timestamp,

          // keep content synced too (optional)
          "state.0.messagesSentCollection.$[m].message": outPayload.message,
          "state.0.messagesSentCollection.$[m].caption": outPayload.caption,
          "state.0.messagesSentCollection.$[m].type": outPayload.type,
          "state.0.messagesSentCollection.$[m].mediaId": outPayload.mediaId,
          "state.0.messagesSentCollection.$[m].media": outPayload.media,
          "state.0.messagesSentCollection.$[m].mimeType": outPayload.mimeType,
          "state.0.messagesSentCollection.$[m].sentBy": outPayload.sentBy,
        }
      },
      { arrayFilters: [{ "m.outboxId": outPayload.outboxId }] }
    );
    emitObs("db.message_history.placeholder_update", {
      productId: String(doc?._id || ""),
      outboxId: outPayload.outboxId,
      mode,
      placeholderUpdateMs: durationMs(placeholderUpdateStartedAt),
      modifiedCount: upd.modifiedCount ?? 0,
    });

    // ✅ If we updated an existing queued item, STOP here.
    if (upd.modifiedCount) {
      return true;
    }
    // If not found, we fall through and push (rare edge case).
  }

  // Normal outbound push (queued or immediate send)
  // NOTE: this is the only place where we should increment lastMsgSeq
  const nextSeq = (before.lastMsgSeq || 0) + 1;
  const $set = { lastMsgSeq: nextSeq, updatedAt: now() };
  const update = { $set, $inc: {} };

  if (!before.hasState0) {
    $set.state = [{
      messagesSentCollection: [outPayload],
      productObject: [],
      shippingStatus: [],
      purchase_state: [],
      reMarketing: []
    }];
  } else {
    update.$push = { "state.0.messagesSentCollection": outPayload };
  }

  const outboundPushStartedAt = nowMs();
  await Product.updateOne({ _id: doc._id }, update);
  emitObs("db.message_history.outbound_update", {
    productId: String(doc?._id || ""),
    outboxId: outPayload?.outboxId ?? null,
    mode,
    outboundUpdateMs: durationMs(outboundPushStartedAt),
    hasState0: before.hasState0,
    path: before.hasState0 ? "push_existing_state" : "create_state",
  });
}

  // Execute atomic update
  const messageUpdateStartedAt = nowMs();
  const result = await Product.updateOne({ _id: doc._id }, update);
  emitObs("db.message_history.atomic_update", {
    productId: String(doc?._id || ""),
    mode,
    messageUpdateMs: durationMs(messageUpdateStartedAt),
    modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
  });


  // Rare fallback: if state[0] missing and $set.state didn’t apply (edge race)
  if (isOutbound && !(result.modifiedCount ?? result.nModified)) {
    const ensure = await Product.updateOne(
      { _id: doc._id, "state.0": { $exists: false } },
      {
        $set: {
          updatedAt: now(),
          state: [{
            messagesSentCollection: [outPayload || buildOutboundMsg(outboundMsg, ourNumber)],
            productObject: [],
            shippingStatus: [],
            purchase_state: [],
            reMarketing: []
          }],
          lastMsgSeq: nextSeq
        }
      }
    );

  }

  // Tail debug for confirmation
  const after = await Product.findById(doc._id, {
    customer_id: 1,
    "state.0.messagesSentCollection": { $slice: -3 },
    customer_messages: { $slice: -3 },
    lastMsgSeq: 1,
    unreadCount: 1,
    lastReadSeq: 1,
    lastInboundTs: 1,
  }).lean();



  return true;
}



/**
 * Unified initializer + message history persister
 * state === 1 => INBOUND (customer -> us)
 * else         => OUTBOUND (us -> customer)
 */
async function initializeCostumerAndStoreMessageHistory(message, state) {
  //console.log("158 dbfunc " , message)
  
  const customerRaw = state === 1 ? message.from : message.to; 
  const ourRaw = state === 1 ? message.to : message.from;


  const customerId = normalizeCustomerId(customerRaw);
  const ourNumber  = normalizeCustomerId(ourRaw);

  if (!customerId) {
    console.error('❌ initializeCostumerAndStoreMessageHistory: invalid customerId', { customerRaw });
    return;
  }

  const docLookupStartedAt = nowMs();
  let doc = await Product.findOne({ customer_id: customerId });
  emitObs("db.message_history.lookup", {
    customerId,
    state,
    hasDocument: !!doc,
    lookupMs: durationMs(docLookupStartedAt),
    outboxId: message?.outboxId ?? null,
    messageId: message?.id ?? null,
  });
   
  if (state === 1) {
    // INBOUND
    if (!doc) {
      const createStartedAt = nowMs();
      await createNewObjectInDatabase(customerId, null, null, ourNumber,message);
      const createMs = durationMs(createStartedAt);
      const refetchStartedAt = nowMs();
      doc = await Product.findOne({ customer_id: customerId });
      emitObs("db.message_history.created_missing_conversation", {
        customerId,
        state,
        createMs,
        refetchMs: durationMs(refetchStartedAt),
        outboxId: message?.outboxId ?? null,
        messageId: message?.id ?? null,
      });

    }
 
    const updateStartedAt = nowMs();
    await updateMessageReceivedById(doc, message, null, ourNumber);
    emitObs("db.message_history.persisted", {
      customerId,
      state,
      direction: "inbound",
      persistMs: durationMs(updateStartedAt),
      outboxId: message?.outboxId ?? null,
      messageId: message?.id ?? null,
    });

  } else {
    // OUTBOUND
    if (!doc) {
      const createStartedAt = nowMs();
      await createNewObjectInDatabase(customerId, null, null, ourNumber);
      const createMs = durationMs(createStartedAt);
      const refetchStartedAt = nowMs();
      doc = await Product.findOne({ customer_id: customerId });
      emitObs("db.message_history.created_missing_conversation", {
        customerId,
        state,
        createMs,
        refetchMs: durationMs(refetchStartedAt),
        outboxId: message?.outboxId ?? null,
        messageId: message?.id ?? null,
      });

    }
    console.log(message)
    const updateStartedAt = nowMs();
    await updateMessageReceivedById(doc, null, message, ourNumber);
    emitObs("db.message_history.persisted", {
      customerId,
      state,
      direction: "outbound",
      persistMs: durationMs(updateStartedAt),
      outboxId: message?.outboxId ?? null,
      messageId: message?.id ?? null,
      status: message?.status ?? null,
    });

  }
}

/* ---------- Product object updates ---------- */
async function updateProductObejctByID(customerIdRaw, product_info_requested, product_value, shippingInfo, quantity, specialProduct) {
  const customerId = normalizeCustomerId(customerIdRaw);

 

  const product = await Product.findOne({ customer_id: customerId });
  if (!product) {
    return;
  }

  product.state = product.state && product.state.length ? product.state : [{}];
  const state = product.state[0];

  state.productObject = state.productObject || [];
  const existingProduct = state.productObject.find(
    obj => obj.product_info_requested === product_info_requested
  );

  state.purchase_state = state.purchase_state && state.purchase_state.length ? state.purchase_state : [{}];
  const ps0 = state.purchase_state[0];
  const ts = ps0.timestamp ? new Date(ps0.timestamp) : new Date(0);
  const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

  if (!existingProduct) {
    product.costumer_profile = product.costumer_profile || [];
    product.costumer_profile.push({
      productOfInterest: product_info_requested,
      timestamp: now()
    });

    state.productObject.push({
      product_info_requested,
      timestamp: now(),
      product_value,
      shippingInfo,
      quantity,
      specialProduct
    });

    if (ts < fifteenDaysAgo) {
      ps0.funnel_state = 1;
      ps0.timestamp = now();
    }

    await product.save();
    return true;
  } else {
    existingProduct.timestamp = now();
    existingProduct.product_value = product_value;
    existingProduct.shippingInfo = shippingInfo;
    existingProduct.quantity = quantity;
    existingProduct.specialProduct = specialProduct;

    if (ts < fifteenDaysAgo) {
      ps0.funnel_state = 1;
      ps0.timestamp = now();
    }

    await product.save();
    return false;
  }
}

/* ---------- Shipping status updates ---------- */


  async function updateShippingStatusByID(costumerId,shippingValue) {
    const product = await Product.findOne({ customer_id: costumerId });

    if (!product) {
      throw new Error("Product not found");
    }
    
    const state = product.state?.[0];
    if (!state) {
      throw new Error("State array is empty or undefined");
    }
    
    // Ensure shippingStatus[0] exists
    if (!state.shippingStatus || !state.shippingStatus[0]) {
      state.shippingStatus = [{}]; // Optional: only if you want to create an object if missing
    }
    
    let shippingProfile = state.shippingStatus[0];
    
    if (shippingProfile.shippingInfoDelivered !== true) {
      // Update existing object
      shippingProfile.shippingInfoDelivered = true;
      shippingProfile.shippingCost = shippingValue;
      shippingProfile.timestamp = new Date();
    
      // Also make sure purchase_state[0] exists
      if (!state.purchase_state || !state.purchase_state[0]) {
        state.purchase_state = [{}]; // Optional fallback
      }
    
      state.purchase_state[0].funnel_state = 2;
      state.purchase_state[0].timestamp = new Date();
      state.purchase_state[0].product_purchased = false;
      state.purchase_state[0].passwordGiven = false;
    
      await product.save();
      return true
    
    } else {
      // Already delivered, just update timestamps
      shippingProfile.timestamp = new Date();
    
      const ts = new Date(state.purchase_state[0].timestamp);
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

      // Update only if the timestamp is older than 15 days
      if (ts < fifteenDaysAgo) {
        state.purchase_state[0].funnel_state = 2;
        state.purchase_state[0].timestamp = new Date();
      }

      await product.save();
      return false
    }
  }
/* ---------- Purchase state updates ---------- */
async function updatepurchaseStateByID(customerIdRaw, funnelState, password_Given, productPurchased) {
  console.log("****WE INSIDE THIS?*")
  const customer_id = normalizeCustomerId(customerIdRaw);
  const product = await Product.findOne({ customer_id });
  if (!product) return;

  product.state = product.state && product.state.length ? product.state : [{}];
  const state = product.state[0];

  state.purchase_state = state.purchase_state && state.purchase_state.length ? state.purchase_state : [{}];
  const purchaseState = state.purchase_state[0];

  purchaseState.funnel_state = funnelState;
  purchaseState.timestamp = now();
  purchaseState.product_purchased = productPurchased;
  purchaseState.passwordGiven = password_Given;

  await product.save();
}

/* ---------- Remarketing ---------- */
async function updateRemarketingObejctByID(customer_id_raw, remarketingValue) {
  const customer_id = normalizeCustomerId(customer_id_raw);
  let doc = await Product.findOne({ customer_id });
  if (doc) {
    doc.state = doc.state && doc.state.length ? doc.state : [{}];
    const st0 = doc.state[0];
    st0.reMarketing = st0.reMarketing || [];
    st0.reMarketing.push({
      remarketing_state: remarketingValue,
      timestamp: now()
    });
    await doc.save();
    // re-fetch if needed elsewhere
    doc = await Product.findOne({ customer_id });
  }
}

/* ---------- Catalog check ---------- */
async function checkIfCatalogWasSent(customer_id_raw) {
  const customer_id = normalizeCustomerId(customer_id_raw);
  const customer = await Product.findOne({ customer_id });

  if (!customer) {
    throw new Error('Product not found');
  }

  customer.state = customer.state && customer.state.length ? customer.state : [{}];
  const state = customer.state[0];

  state.productObject = state.productObject || [];
  const match = state.productObject.find(
    (item) => item.product_info_requested === 'bodys_Bebe_MangaLArga'
  );

  if (match && match.specialProduct) {
    const currentTime = now();
    const { babyCatalogo, timestamp } = match.specialProduct;

    if (babyCatalogo === false && currentTime - new Date(timestamp) <= 24 * 60 * 60 * 1000) {
      match.specialProduct.babyCatalogo = true;
      // mark modified nested field
      customer.markModified('state');
      await customer.save();
      return true;
    }
  } else {
    console.log('No match found or specialProduct is missing');
    return false;
  }

  return false;
}






/**
 * state === 1 => INBOUND (customer -> us)
 * else         => OUTBOUND (us -> customer)
 * payload can be: { type:'text', text:'...' } or { type:'image', mediaId:'...', caption:'...' }
 */


/* ---------- Exports ---------- */
export {
  getIdDocument,
  createNewObjectInDatabase,
  initializeObjectInDatabase,
  initializeCostumerAndStoreMessageHistory,
  updateProductObejctByID,
  updateRemarketingObejctByID,
  updateShippingStatusByID,
  updatepurchaseStateByID,
  checkIfCatalogWasSent
};
