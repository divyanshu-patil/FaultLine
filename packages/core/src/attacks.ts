import { AttackSpec, type AttackId, type BugId, type DiagnosisCategory, type InvariantId } from "@faultline/schemas";

const CAPTURE = "/v2/checkout/orders/*/capture";
const BUY = { sku: "house-blend", qty: 1, approve: true } as const;
const APPROVED = "CHECKOUT.ORDER.APPROVED" as const;
const COMPLETED = "PAYMENT.CAPTURE.COMPLETED" as const;

const specs: AttackSpec[] = [
  {
    id: "A1",
    name: "Duplicate webhook",
    priority: "must",
    bugClass: "missing_dedupe",
    disturbs: "Delivers the real, signed PAYMENT.CAPTURE.COMPLETED webhook three times, byte for byte.",
    buyer: { ...BUY },
    webhookRules: [{ match: { eventType: COMPLETED }, action: "duplicate", times: 3, gapMs: 400 }],
    faultRules: [],
    expectedDeliveries: [APPROVED, COMPLETED],
    invariants: ["I2", "I4", "I5"],
    realVsSimulated: "Real sandbox purchase; the real signed delivery is replayed byte for byte by FaultLine.",
    referenceFix: "Record each webhook event id under a unique constraint and grant credits idempotently (one entitlement per order).",
  },
  {
    id: "A2",
    name: "Out-of-order events",
    priority: "should",
    bugClass: "ordering",
    disturbs: "Holds CHECKOUT.ORDER.APPROVED until after PAYMENT.CAPTURE.COMPLETED has been delivered.",
    buyer: { ...BUY },
    webhookRules: [{ match: { eventType: APPROVED }, action: "hold_until", until: COMPLETED }],
    faultRules: [],
    expectedDeliveries: [APPROVED, COMPLETED],
    invariants: ["I4", "I6"],
    realVsSimulated: "Real purchase and real deliveries; FaultLine only changes their order.",
    referenceFix: "Only move order status forward (rank table) or re-read the order from PayPal on every event.",
  },
  {
    id: "A3",
    name: "Forged webhook",
    priority: "must",
    bugClass: "no_signature_check",
    disturbs: "Abandons checkout, then sends a forged PAYMENT.CAPTURE.COMPLETED for that real order with an invalid signature.",
    buyer: { ...BUY, approve: false },
    webhookRules: [],
    faultRules: [],
    forge: true,
    expectedDeliveries: [],
    invariants: ["I5", "I4"],
    realVsSimulated: "The PayPal order is real; the webhook is forged by FaultLine and labelled as forged.",
    referenceFix: "Verify every event with POST /v1/notifications/verify-webhook-signature before acting, then re-read the order from PayPal.",
  },
  {
    id: "A4",
    name: "Capture times out after success",
    priority: "must",
    bugClass: "capture_retry",
    disturbs: "Lets the first capture reach PayPal, records PayPal's real answer, then returns 504 to the store.",
    buyer: { ...BUY },
    webhookRules: [],
    faultRules: [
      { match: { method: "POST", pathPattern: CAPTURE, occurrence: 1 }, fault: { kind: "timeout_after_forward", ms: 3000 } },
    ],
    expectedDeliveries: [APPROVED, COMPLETED],
    invariants: ["I1", "I4", "I6"],
    realVsSimulated: "The capture at PayPal is real; the timeout on the way back is injected by FaultLine.",
    referenceFix: "Send a stable PayPal-Request-Id per order, retry on timeout/5xx, reconcile with GET order, and let webhooks repair failed orders.",
  },
  {
    id: "A5",
    name: "Price tampering",
    priority: "must",
    bugClass: "client_amount_trusted",
    disturbs: "Rewrites the browser's create-order request to amount 0.01.",
    buyer: { ...BUY, tamperAmount: "0.01" },
    webhookRules: [],
    faultRules: [],
    expectedDeliveries: [APPROVED, COMPLETED],
    invariants: ["I3", "I2"],
    realVsSimulated: "Real purchase; only the browser request body is tampered.",
    referenceFix: "Compute order amounts on the server from sku and quantity; ignore client-sent amounts.",
  },
  {
    id: "A6",
    name: "Fulfil without capture",
    priority: "should",
    bugClass: "fulfil_without_capture",
    disturbs: "Approves, blocks the capture call, then calls the store's fulfil endpoint directly.",
    buyer: { ...BUY, skipCapture: true, callFulfil: true },
    webhookRules: [],
    faultRules: [],
    expectedDeliveries: [APPROVED],
    invariants: ["I5", "I4"],
    realVsSimulated: "Real approved order; the browser skips capture on purpose.",
    referenceFix: "Fulfil only inside the server-side capture handler after PayPal reports status COMPLETED.",
  },
  {
    id: "A7",
    name: "Declined capture",
    priority: "must",
    bugClass: "decline_handled_as_success",
    disturbs: "Asks PayPal itself to decline the first capture (negative testing, INSTRUMENT_DECLINED).",
    buyer: { ...BUY },
    webhookRules: [],
    faultRules: [
      { match: { method: "POST", pathPattern: CAPTURE, occurrence: 1 }, fault: { kind: "negative_test", code: "INSTRUMENT_DECLINED" } },
    ],
    expectedDeliveries: [APPROVED],
    invariants: ["I7", "I5"],
    realVsSimulated: "PayPal returns the decline itself through its negative-testing feature.",
    referenceFix: "Check the HTTP status and status === COMPLETED before marking paid or granting; show an error and let the buyer retry.",
  },
  {
    id: "A8",
    name: "Dropped webhooks",
    priority: "should",
    bugClass: "webhook_only_fulfilment",
    disturbs: "Receives every webhook for the order but never forwards any of them to the store.",
    buyer: { ...BUY },
    webhookRules: [{ match: {}, action: "drop" }],
    faultRules: [],
    expectedDeliveries: [APPROVED, COMPLETED],
    invariants: ["I6", "I4"],
    realVsSimulated: "Real purchase and real deliveries; FaultLine withholds them from the store.",
    referenceFix: "Fulfil from the capture response (idempotently); treat webhooks as a backup path and reconcile pending orders.",
  },
];

export const ATTACKS: readonly AttackSpec[] = specs.map((s) => AttackSpec.parse(s));
export const MUST_ATTACKS: AttackId[] = ATTACKS.filter((a) => a.priority === "must").map((a) => a.id);

export function getAttack(id: AttackId): AttackSpec {
  const spec = ATTACKS.find((a) => a.id === id);
  if (!spec) throw new Error(`unknown attack ${id}`);
  return spec;
}

export const BUG_PRESETS = {
  demo: ["B1", "B3", "B4", "B5", "B7"],
  all: ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"],
  none: [],
} as const satisfies Record<string, readonly BugId[]>;

/** Seeded truth: which category each bug belongs to (docs/05 §4). Used by evals only, never shown to the model. */
export const BUG_CATEGORY: Record<BugId, DiagnosisCategory> = {
  B1: "missing_dedupe",
  B2: "ordering",
  B3: "no_signature_check",
  B4: "capture_retry",
  B5: "client_amount_trusted",
  B6: "fulfil_without_capture",
  B7: "decline_handled_as_success",
  B8: "webhook_only_fulfilment",
};

export const BUG_FOR_ATTACK: Record<AttackId, BugId> = {
  A1: "B1",
  A2: "B2",
  A3: "B3",
  A4: "B4",
  A5: "B5",
  A6: "B6",
  A7: "B7",
  A8: "B8",
};

export const BUG_DESCRIPTIONS: Record<BugId, string> = {
  B1: "Fulfils from webhooks only and grants credits on every delivery (no event-id dedupe)",
  B2: "Sets order status from whichever event arrived last",
  B3: "Trusts webhook bodies without signature verification",
  B4: "Marks the order failed on capture timeout; no retry, no reconcile",
  B5: "Uses the amount sent by the browser",
  B6: "Has a fulfil endpoint that grants without checking PayPal",
  B7: "Treats a declined capture as success",
  B8: "Grants credits only from webhooks; no reconciliation",
};

/** Allowed diagnosis categories per failed invariant (docs/05 §4). */
export const ALLOWED_CATEGORIES: Record<InvariantId, DiagnosisCategory[]> = {
  I1: ["capture_retry", "missing_dedupe", "other"],
  I2: ["missing_dedupe", "decline_handled_as_success", "other"],
  I3: ["client_amount_trusted", "other"],
  I4: ["ordering", "capture_retry", "webhook_only_fulfilment", "no_signature_check", "fulfil_without_capture", "decline_handled_as_success", "other"],
  I5: ["no_signature_check", "fulfil_without_capture", "decline_handled_as_success", "other"],
  I6: ["capture_retry", "webhook_only_fulfilment", "other"],
  I7: ["decline_handled_as_success", "other"],
};

/** A category is consistent when every failed invariant allows it. */
export function categoryAllowed(category: DiagnosisCategory, failed: InvariantId[]): boolean {
  return failed.every((inv) => ALLOWED_CATEGORIES[inv].includes(category));
}

/**
 * Expected failing invariants (docs/05 §5, as implemented). Key: config → attack → failing invariants.
 * `own` means the store has only the bug that attack targets.
 */
export const EXPECTED_MATRIX: Record<"none" | "own" | "demo", Record<AttackId, InvariantId[]>> = {
  none: { A1: [], A2: [], A3: [], A4: [], A5: [], A6: [], A7: [], A8: [] },
  own: { A1: ["I2"], A2: ["I4"], A3: ["I4", "I5"], A4: ["I4", "I6"], A5: ["I3"], A6: ["I4", "I5"], A7: ["I5", "I7"], A8: ["I6"] },
  demo: { A1: ["I2"], A2: [], A3: ["I4", "I5"], A4: ["I4", "I6"], A5: ["I3"], A6: [], A7: ["I7"], A8: ["I6"] },
};
