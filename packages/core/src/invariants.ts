import type { CatalogItem, InvariantId, OrderStatus, ProbeOrder, ProbeState, Verdict } from "@faultline/schemas";

export type TruthCapture = { id: string; status: string; amount: string; currency: string };
export type TruthOrder = {
  id: string;
  status: string;
  amount: string;
  currency: string;
  captures: TruthCapture[];
  evidenceId: string;
};

/** Everything the deterministic judge may look at. Built by the worker from recorded facts only. */
export type AttackFacts = {
  orderIds: string[];
  truth: Record<string, TruthOrder>;
  after: ProbeState;
  afterId: string;
  buyer: { captureAttempted: boolean; sawError: boolean; evidenceId: string | null };
  catalog: CatalogItem[];
  evidence: { webhooks: string[]; captures: string[]; creates: string[] };
};

type OrderCtx = {
  store: ProbeOrder;
  truth: TruthOrder;
  completed: TruthCapture[];
  credits: number;
  item: CatalogItem | undefined;
};
type Check = { applicable: boolean; ok: boolean; expected: string; actual: string; evidence: string[] };

const PAID: OrderStatus[] = ["paid", "fulfilled"];

function cents(value: string): number {
  return Math.round(Number(value) * 100);
}
function money(c: number): string {
  return (c / 100).toFixed(2);
}

/** Allowed store statuses for PayPal's view of the order (docs/05 §2, I4 table). */
export function allowedStatuses(truth: TruthOrder, captureAttempted: boolean): OrderStatus[] {
  if (truth.captures.some((c) => c.status === "COMPLETED")) return PAID;
  if (truth.captures.some((c) => c.status === "PENDING")) return ["pending_capture"];
  if (truth.captures.some((c) => c.status === "DECLINED")) return ["failed", "created", "approved"];
  if (truth.status === "APPROVED") return captureAttempted ? ["failed", "created", "approved"] : ["approved", "created"];
  if (truth.status === "CREATED") return ["created", "abandoned"];
  return ["created", "approved", "failed", "abandoned"];
}

const checks: Record<InvariantId, (o: OrderCtx, f: AttackFacts) => Check> = {
  I1: (o, f) => {
    const recorded = o.store.captureId;
    const ok = o.completed.length <= 1 && (recorded === null || o.completed.some((c) => c.id === recorded));
    return {
      applicable: o.completed.length > 0 || recorded !== null,
      ok,
      expected: `≤ 1 COMPLETED capture at PayPal; store capture id matches it`,
      actual: `${o.completed.length} COMPLETED at PayPal (${o.completed.map((c) => c.id).join(", ") || "none"}); store recorded ${recorded ?? "none"}`,
      evidence: [o.truth.evidenceId, f.afterId, ...f.evidence.captures],
    };
  },
  I2: (o, f) => {
    const max = (o.item?.creditsPerItem ?? 0) * o.store.qty;
    return {
      applicable: true,
      ok: o.credits <= max,
      expected: `${max} credits`,
      actual: `${o.credits} credits`,
      evidence: [f.afterId, ...f.evidence.webhooks],
    };
  },
  I3: (o, f) => {
    const expected = o.item ? cents(o.item.price) * o.store.qty : NaN;
    const captured = o.completed.reduce((sum, c) => sum + cents(c.amount), 0);
    const currencyOk = o.completed.every((c) => c.currency === (o.item?.currency ?? "USD"));
    return {
      applicable: o.completed.length > 0,
      ok: captured === expected && currencyOk,
      expected: `${money(expected)} ${o.item?.currency ?? "USD"}`,
      actual: `${money(captured)} ${o.completed[0]?.currency ?? ""}`.trim(),
      evidence: [o.truth.evidenceId, ...f.evidence.creates],
    };
  },
  I4: (o, f) => {
    const allowed = allowedStatuses(o.truth, f.buyer.captureAttempted);
    const paypal = o.completed.length > 0 ? "capture COMPLETED" : `order ${o.truth.status}`;
    return {
      applicable: true,
      ok: allowed.includes(o.store.status),
      expected: `${allowed.join(" | ")} (PayPal: ${paypal})`,
      actual: o.store.status,
      evidence: [o.truth.evidenceId, f.afterId],
    };
  },
  I5: (o, f) => ({
    applicable: true,
    ok: o.credits === 0 || o.completed.length > 0,
    expected: "no credits unless PayPal shows a COMPLETED capture",
    actual: `${o.credits} credits; PayPal ${o.completed.length > 0 ? "capture COMPLETED" : `order ${o.truth.status}, no completed capture`}`,
    evidence: [o.truth.evidenceId, f.afterId, ...f.evidence.webhooks],
  }),
  I6: (o, f) => ({
    applicable: o.completed.length > 0,
    ok: o.credits > 0,
    expected: "credits granted for the COMPLETED capture",
    actual: `${o.credits} credits`,
    evidence: [o.truth.evidenceId, f.afterId],
  }),
  I7: (o, f) => {
    const notPaid = !PAID.includes(o.store.status);
    const problems = [
      notPaid ? null : `store says ${o.store.status}`,
      o.credits === 0 ? null : `${o.credits} credits granted`,
      f.buyer.sawError ? null : "buyer saw success",
    ].filter(Boolean);
    return {
      applicable: f.buyer.captureAttempted && o.completed.length === 0,
      ok: problems.length === 0,
      expected: "not paid, no credits, buyer sees an error",
      actual: problems.length === 0 ? "not paid, no credits, buyer saw an error" : problems.join("; "),
      evidence: [o.truth.evidenceId, f.afterId, ...(f.buyer.evidenceId ? [f.buyer.evidenceId] : [])],
    };
  },
};

function orderContexts(f: AttackFacts): OrderCtx[] {
  const out: OrderCtx[] = [];
  for (const orderId of f.orderIds) {
    const store = f.after.orders.find((o) => o.paypalOrderId === orderId);
    const truth = f.truth[orderId];
    if (!store || !truth) continue;
    out.push({
      store,
      truth,
      completed: truth.captures.filter((c) => c.status === "COMPLETED"),
      credits: f.after.entitlements.filter((e) => e.storeOrderId === store.storeOrderId).reduce((s, e) => s + e.credits, 0),
      item: f.catalog.find((c) => c.sku === store.sku),
    });
  }
  return out;
}

/** The deterministic judge. Pure: same facts, same verdicts. The model never calls this with its own data. */
export function checkInvariants(ids: InvariantId[], facts: AttackFacts): Verdict[] {
  const orders = orderContexts(facts);
  return ids.map((invariant) => {
    const results = orders.map((o) => checks[invariant](o, facts)).filter((r) => r.applicable);
    if (results.length === 0) {
      return { invariant, status: "not_applicable", expected: "—", actual: orders.length ? "not applicable" : "no store order found", evidence: [facts.afterId] };
    }
    const failed = results.find((r) => !r.ok);
    const r = failed ?? results[0]!;
    return {
      invariant,
      status: failed ? "fail" : "pass",
      expected: r.expected,
      actual: r.actual,
      evidence: [...new Set(r.evidence)],
    };
  });
}

export const INVARIANT_TEXT: Record<InvariantId, string> = {
  I1: "At most one COMPLETED capture per order, and the store's capture id matches PayPal's",
  I2: "Credits are granted at most once per order",
  I3: "Captured amount equals catalog price × quantity",
  I4: "Store order status agrees with PayPal's order status",
  I5: "No credits unless PayPal shows a COMPLETED capture",
  I6: "Every COMPLETED capture gets its credits",
  I7: "A declined capture is not paid, grants nothing, and the buyer sees an error",
};
