import test from "node:test";
import assert from "node:assert/strict";

import { currentPurchaseState, productMatchesProgramState } from "./eligibility.js";

test("uses the most recent purchase state instead of a historical match", () => {
  const state = [{
    purchase_state: [
      { funnel_state: 3, timestamp: "2026-08-02T01:44:00.000Z" },
      { funnel_state: 4, timestamp: "2026-08-02T15:50:44.404Z" },
    ],
  }];

  assert.equal(currentPurchaseState(state).purchaseState.funnel_state, 4);
  assert.equal(productMatchesProgramState(state, 3), false);
  assert.equal(productMatchesProgramState(state, 4), true);
});

test("uses array order when legacy purchase states have no timestamps", () => {
  const state = [{ purchase_state: [{ funnel_state: 2 }, { funnel_state: 3 }] }];

  assert.equal(currentPurchaseState(state).purchaseState.funnel_state, 3);
});

test("maps program level 1 to purchase state 0", () => {
  const state = [{ purchase_state: [{ funnel_state: 0 }] }];

  assert.equal(productMatchesProgramState(state, 1), true);
});

test("requires shipping and a seller message for program level 2", () => {
  const eligible = [{
    purchase_state: [{ funnel_state: 2 }],
    shippingStatus: [{ status: "ready" }],
    messagesSentCollection: [{ id: "wamid.1" }],
  }];

  assert.equal(productMatchesProgramState(eligible, 2), true);
  assert.equal(
    productMatchesProgramState([{ ...eligible[0], shippingStatus: [] }], 2),
    false
  );
});
