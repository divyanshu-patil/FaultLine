import { describe, expect, it } from "vitest";
import type { InvariantId, OrderStatus, ProbeState } from "@faultline/schemas";
import { ATTACKS, EXPECTED_MATRIX, categoryAllowed, checkInvariants, type AttackFacts, type TruthCapture } from "../src/index.ts";

const catalog = [
  { sku: "house-blend", name: "House Blend", price: "12.00", currency: "USD" as const, creditsPerItem: 100 },
];

type Fx = {
  status: OrderStatus;
  captureId?: string | null;
  credits?: number[];
  qty?: number;
  paypal: "CREATED" | "APPROVED" | "COMPLETED";
  captures?: Partial<TruthCapture>[];
  attempted?: boolean;
  sawError?: boolean;
};

function facts(fx: Fx): AttackFacts {
  const qty = fx.qty ?? 1;
  const captures = (fx.captures ?? (fx.paypal === "COMPLETED" ? [{}] : [])).map((c, i) => ({
    id: `CAP${i}`,
    status: "COMPLETED",
    amount: (12 * qty).toFixed(2),
    currency: "USD",
    ...c,
  }));
  const after: ProbeState = {
    storeTime: "2026-10-19T00:00:00Z",
    orders: [
      {
        storeOrderId: "o_1",
        paypalOrderId: "PP1",
        sku: "house-blend",
        qty,
        status: fx.status,
        captureId: fx.captureId === undefined ? (captures[0]?.id ?? null) : fx.captureId,
        amount: "12.00",
        currency: "USD",
        updatedAt: "2026-10-19T00:00:00Z",
      },
    ],
    entitlements: (fx.credits ?? []).map((credits, i) => ({
      storeOrderId: "o_1",
      credits,
      source: "webhook" as const,
      grantedAt: "2026-10-19T00:00:00Z",
      ref: `r${i}`,
    })),
    webhookEvents: [],
  };
  return {
    orderIds: ["PP1"],
    truth: { PP1: { id: "PP1", status: fx.paypal, amount: "12.00", currency: "USD", captures, evidenceId: "tr-0001" } },
    after,
    afterId: "st-0002",
    buyer: { captureAttempted: fx.attempted ?? fx.paypal !== "CREATED", sawError: fx.sawError ?? false, evidenceId: "br-0003" },
    catalog,
    evidence: { webhooks: ["wf-0004"], captures: ["pc-0005"], creates: ["pc-0006"] },
  };
}

const paid: Fx = { status: "paid", credits: [100], paypal: "COMPLETED" };

const table: Record<InvariantId, { pass: Fx[]; fail: Fx[] }> = {
  I1: {
    pass: [paid, { ...paid, captureId: null }, { status: "fulfilled", credits: [100], paypal: "COMPLETED" }],
    fail: [
      { ...paid, captureId: "OTHER" },
      { ...paid, captures: [{}, { id: "CAP9" }] },
      { status: "paid", captureId: "FORGED", credits: [100], paypal: "CREATED" },
    ],
  },
  I2: {
    pass: [paid, { status: "created", paypal: "CREATED" }, { ...paid, qty: 2, credits: [100, 100] }],
    fail: [{ ...paid, credits: [100, 100] }, { ...paid, credits: [100, 100, 100] }, { ...paid, credits: [300] }],
  },
  I3: {
    pass: [paid, { ...paid, qty: 3, credits: [300] }, { ...paid, captures: [{ amount: "12.00" }] }],
    fail: [
      { ...paid, captures: [{ amount: "0.01" }] },
      { ...paid, captures: [{ amount: "11.99" }] },
      { ...paid, captures: [{ currency: "EUR" }] },
    ],
  },
  I4: {
    pass: [paid, { status: "created", paypal: "CREATED" }, { status: "approved", paypal: "APPROVED", attempted: false }],
    fail: [
      { status: "failed", paypal: "COMPLETED" },
      { status: "approved", credits: [100], paypal: "COMPLETED" },
      { status: "paid", credits: [100], paypal: "CREATED" },
    ],
  },
  I5: {
    pass: [paid, { status: "created", paypal: "CREATED" }, { status: "approved", paypal: "APPROVED" }],
    fail: [
      { status: "paid", credits: [100], paypal: "CREATED" },
      { status: "fulfilled", credits: [100], paypal: "APPROVED", attempted: false },
      { status: "paid", credits: [100], paypal: "APPROVED", sawError: false },
    ],
  },
  I6: {
    pass: [paid, { ...paid, credits: [50, 50] }, { status: "fulfilled", credits: [100], paypal: "COMPLETED" }],
    fail: [{ status: "paid", paypal: "COMPLETED" }, { status: "failed", paypal: "COMPLETED" }, { status: "approved", paypal: "COMPLETED" }],
  },
  I7: {
    pass: [
      { status: "approved", paypal: "APPROVED", sawError: true },
      { status: "created", paypal: "APPROVED", sawError: true },
      { status: "failed", paypal: "APPROVED", sawError: true },
    ],
    fail: [
      { status: "paid", paypal: "APPROVED", sawError: false },
      { status: "approved", credits: [100], paypal: "APPROVED", sawError: true },
      { status: "approved", paypal: "APPROVED", sawError: false },
    ],
  },
};

describe("invariants (T-CORE-invariants, AC-35)", () => {
  for (const [inv, { pass, fail }] of Object.entries(table) as [InvariantId, { pass: Fx[]; fail: Fx[] }][]) {
    it.each(pass.map((fx, i) => [i, fx] as const))(`${inv} passes fixture %i`, (_i, fx) => {
      const [v] = checkInvariants([inv], facts(fx));
      expect(v!.status).toBe("pass");
    });
    it.each(fail.map((fx, i) => [i, fx] as const))(`${inv} fails fixture %i`, (_i, fx) => {
      const [v] = checkInvariants([inv], facts(fx));
      expect(v!.status).toBe("fail");
      expect(v!.evidence.length).toBeGreaterThan(0);
    });
  }

  it("reports expected/actual the way the UI shows them (AC-36, AC-39)", () => {
    const [i2] = checkInvariants(["I2"], facts({ ...paid, credits: [100, 100, 100] }));
    expect(i2).toMatchObject({ status: "fail", expected: "100 credits", actual: "300 credits" });
    const [i3] = checkInvariants(["I3"], facts({ ...paid, captures: [{ amount: "0.01" }] }));
    expect(i3).toMatchObject({ status: "fail", expected: "12.00 USD", actual: "0.01 USD" });
  });

  it("is not applicable when the store has no order for the PayPal order", () => {
    const f = facts(paid);
    f.after.orders = [];
    expect(checkInvariants(["I4"], f)[0]!.status).toBe("not_applicable");
  });
});

describe("attack catalog (T-CORE-attacks)", () => {
  it("has one spec per attack id with known invariants", () => {
    expect(ATTACKS.map((a) => a.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
  });

  it("expects every matrix failure to be an invariant the attack checks", () => {
    for (const config of ["own", "demo"] as const) {
      for (const a of ATTACKS) {
        for (const inv of EXPECTED_MATRIX[config][a.id]) expect(a.invariants).toContain(inv);
      }
    }
  });

  it("allows each attack's own bug class for its own-bug failures (category consistency)", () => {
    for (const a of ATTACKS) expect(categoryAllowed(a.bugClass, EXPECTED_MATRIX.own[a.id])).toBe(true);
    expect(categoryAllowed("client_amount_trusted", ["I2"])).toBe(false);
  });
});
