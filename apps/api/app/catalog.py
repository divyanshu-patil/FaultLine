"""Attack catalog summary and target presets.

This mirrors the authoritative data in @faultline/core (packages/core/src/attacks.ts). The worker runs from the
TypeScript source of truth; the API only needs the display summary and the preset list. Kept in sync by
test_catalog_matches (reads the TS file).
"""

from __future__ import annotations

ATTACKS = [
    {"id": "A1", "name": "Duplicate webhook", "priority": "must", "bugClass": "missing_dedupe",
     "invariants": ["I2", "I4", "I5"], "realVsSimulated": "Real sandbox purchase; the real signed delivery is replayed byte for byte by FaultLine.",
     "description": "Delivers the real, signed capture webhook three times to see if credits are granted more than once."},
    {"id": "A2", "name": "Out-of-order events", "priority": "should", "bugClass": "ordering",
     "invariants": ["I4", "I6"], "realVsSimulated": "Real purchase and real deliveries; FaultLine only changes their order.",
     "description": "Holds the approval event until after the capture event to see if order status regresses."},
    {"id": "A3", "name": "Forged webhook", "priority": "must", "bugClass": "no_signature_check",
     "invariants": ["I5", "I4"], "realVsSimulated": "The PayPal order is real; the webhook is forged by FaultLine and labelled as forged.",
     "description": "Abandons checkout, then sends an unsigned capture event to see if the store grants credits without verifying the signature."},
    {"id": "A4", "name": "Capture times out after success", "priority": "must", "bugClass": "capture_retry",
     "invariants": ["I1", "I4", "I6"], "realVsSimulated": "The capture at PayPal is real; the timeout on the way back is injected by FaultLine.",
     "description": "Lets PayPal capture the money but cuts the response, to see if the store leaves the customer charged with nothing."},
    {"id": "A5", "name": "Price tampering", "priority": "must", "bugClass": "client_amount_trusted",
     "invariants": ["I3", "I2"], "realVsSimulated": "Real purchase; only the browser request body is tampered.",
     "description": "Rewrites the browser's amount to 0.01 to see if the server trusts a client-sent price."},
    {"id": "A6", "name": "Fulfil without capture", "priority": "should", "bugClass": "fulfil_without_capture",
     "invariants": ["I5", "I4"], "realVsSimulated": "Real approved order; the browser skips capture on purpose.",
     "description": "Calls the store's fulfil endpoint directly without a capture, to see if it grants credits anyway."},
    {"id": "A7", "name": "Declined capture", "priority": "must", "bugClass": "decline_handled_as_success",
     "invariants": ["I7", "I5"], "realVsSimulated": "PayPal returns the decline itself through its negative-testing feature.",
     "description": "Asks PayPal to decline the capture, to see if the store treats a decline as a success."},
    {"id": "A8", "name": "Dropped webhooks", "priority": "should", "bugClass": "webhook_only_fulfilment",
     "invariants": ["I6", "I4"], "realVsSimulated": "Real purchase and real deliveries; FaultLine withholds them from the store.",
     "description": "Withholds every webhook to see if a store that fulfils only from webhooks ever delivers the goods."},
]

MUST_ATTACKS = [a["id"] for a in ATTACKS if a["priority"] == "must"]

DEFAULT_BUDGET = {"maxSteps": 20, "maxAttacks": 8, "maxPatchAttempts": 2, "maxModelCalls": 40, "maxSeconds": 900}

INVARIANT_TEXT = {
    "I1": "At most one COMPLETED capture per order, and the store's capture id matches PayPal's",
    "I2": "Credits are granted at most once per order",
    "I3": "Captured amount equals catalog price x quantity",
    "I4": "Store order status agrees with PayPal's order status",
    "I5": "No credits unless PayPal shows a COMPLETED capture",
    "I6": "Every COMPLETED capture gets its credits",
    "I7": "A declined capture is not paid, grants nothing, and the buyer sees an error",
}

BUG_DESCRIPTIONS = {
    "B1": "Grants credits on every capture webhook (no dedupe)",
    "B2": "Sets order status from whichever event arrived last",
    "B3": "Trusts webhook bodies without signature verification",
    "B4": "Marks the order failed on capture timeout; no retry, no reconcile",
    "B5": "Uses the amount sent by the browser",
    "B6": "Has a fulfil endpoint that grants without checking PayPal",
    "B7": "Treats a declined capture as success",
    "B8": "Grants credits only from webhooks; no reconciliation",
}

PRESET_BUGS = {"demo": ["B1", "B3", "B4", "B5", "B7"], "all": list(BUG_DESCRIPTIONS), "fixed": []}
