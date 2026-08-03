function timestampValue(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Return the current purchase-state entry across every product state.
 * Timestamps win when present; array order is the fallback for legacy data.
 */
export function currentPurchaseState(state = []) {
  let current = null;
  let order = 0;

  for (const productState of Array.isArray(state) ? state : []) {
    for (const purchaseState of productState?.purchase_state || []) {
      const candidate = {
        productState,
        purchaseState,
        timestamp: timestampValue(purchaseState?.timestamp),
        order: order++,
      };

      if (
        !current ||
        candidate.timestamp > current.timestamp ||
        (candidate.timestamp === current.timestamp && candidate.order > current.order)
      ) {
        current = candidate;
      }
    }
  }

  return current;
}

/**
 * Funnel level 1 targets purchase state 0. Funnel level 2 retains its legacy
 * shipping/seller-message requirements. All comparisons use only the current
 * purchase state so historical funnel entries cannot authorize a send.
 */
export function productMatchesProgramState(state = [], programState) {
  const current = currentPurchaseState(state);
  if (!current) return false;

  const expectedPurchaseState = programState === 1 ? 0 : programState;
  if (current.purchaseState?.funnel_state !== expectedPurchaseState) return false;

  if (programState === 2) {
    const { productState } = current;
    const lastShipping = productState?.shippingStatus?.[productState.shippingStatus.length - 1];
    const lastSent = productState?.messagesSentCollection?.[productState.messagesSentCollection.length - 1];
    return !!lastShipping && !!lastSent;
  }

  return true;
}
