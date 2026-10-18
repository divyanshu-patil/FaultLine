import type { AddressInfo } from "node:net";
import { createApp, CATALOG } from "buggybeans/src/app.ts";
import { openDb } from "buggybeans/src/db.ts";
import { parseFlags } from "buggybeans/src/env.ts";
import { createPayPal } from "buggybeans/src/paypal.ts";
import { createProxy, type WebhookRule } from "proxy/src/app.ts";
import { checkInvariants, getAttack, type AttackFacts, type TruthOrder } from "@faultline/core";
import type { AttackId, CatalogItem, Verdict } from "@faultline/schemas";
import { createFakePayPal, type FakePayPal } from "@faultline/testing";

const HOST = "https://api-m.sandbox.paypal.com";
const PROBE = "0123456789abcdef-probe";
const CATALOG_ITEM: CatalogItem = { sku: "house-blend", name: "House Blend 250 g", price: "12.00", currency: "USD", creditsPerItem: 100 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Server = { port: number; close: () => void };

function listen(app: { listen: (port: number, host: string, cb: () => void) => { address: () => AddressInfo | null; close: (cb?: () => void) => void } }): Promise<Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve({ port: (s.address() as AddressInfo).port, close: () => s.close() }));
  });
}

/** Offline attacks that need neither a forged signature (A3) nor a withheld capture response (A4). */
export const OFFLINE_ATTACKS: AttackId[] = ["A1", "A2", "A5", "A6", "A7", "A8"];

/**
 * Runs one attack in-process against a fresh BuggyBeans instance wired to FakePayPal, with the proxy applying the
 * webhook disturbance, then runs the real checker. `bugs` selects the seeded bug variant ("" = fixed store).
 */
export async function runOffline(attackId: AttackId, bugs: string): Promise<{ verdicts: Verdict[]; failed: string[] }> {
  const fake = createFakePayPal({ webhookLatencyMs: 2 });
  const flags = parseFlags(bugs);
  const db = openDb(":memory:", flags);
  const store = createApp({
    db,
    paypal: createPayPal({ base: HOST, clientId: "id", secret: "secret", fetch: captureHeaderFetch(attackId, fake) }),
    flags,
    clientId: "id",
    webhookId: fake.webhookId,
    probeToken: PROBE,
    base: "",
    catalog: CATALOG,
  });
  const storeSrv = await listen(store);

  const proxy = createProxy();
  const runId = "offline";
  const rule = ruleFor(attackId);
  proxy.registerRun(runId, { instanceId: "i0", port: storeSrv.port, runId, attackRowId: null }, rule);
  const proxySrv = await listen(proxy.app);
  fake.setWebhookTarget(`http://127.0.0.1:${proxySrv.port}/webhooks/paypal`);

  const storeBase = `http://127.0.0.1:${storeSrv.port}`;
  const buyer = { captureAttempted: false, sawError: false };
  try {
    const orderId = await drive(attackId, storeBase, fake, proxy, runId, buyer);
    await sleep(250); // let disturbed webhooks arrive
    const probe = await (await fetch(`${storeBase}/__crashtest/state`, { headers: { authorization: `Bearer ${PROBE}` } })).json();
    const facts = buildFacts(orderId, fake, probe, buyer);
    const verdicts = checkInvariants(getAttack(attackId).invariants, facts);
    return { verdicts, failed: verdicts.filter((v) => v.status === "fail").map((v) => v.invariant) };
  } finally {
    storeSrv.close();
    proxySrv.close();
  }
}

/** For A7 only, add PayPal's own negative-testing header to the capture call (a decline, not a forgery). */
function captureHeaderFetch(attackId: AttackId, fake: FakePayPal): typeof fetch {
  if (attackId !== "A7") return fake.fetch;
  return async (input, init) => {
    const req = new Request(input, init);
    if (/\/capture$/.test(new URL(req.url).pathname) && req.method === "POST") {
      const headers = new Headers(req.headers);
      headers.set("PayPal-Mock-Response", JSON.stringify({ mock_application_codes: "INSTRUMENT_DECLINED" }));
      return fake.fetch(req.url, { method: "POST", headers, body: await req.text() });
    }
    return fake.fetch(input, init);
  };
}

function ruleFor(attackId: AttackId): WebhookRule {
  if (attackId === "A1") return { kind: "duplicate", times: 3, gapMs: 15 };
  if (attackId === "A2") return { kind: "hold_until", hold: "CHECKOUT.ORDER.APPROVED", until: "PAYMENT.CAPTURE.COMPLETED" };
  if (attackId === "A8") return { kind: "drop" };
  return { kind: "passthrough" };
}

async function createOrder(base: string, amount?: string): Promise<string> {
  const res = await fetch(`${base}/api/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku: "house-blend", qty: 1, ...(amount ? { amount } : {}) }) });
  return (await res.json()).id as string;
}

async function captureOrder(base: string, orderId: string): Promise<{ status: string; httpStatus: number }> {
  const res = await fetch(`${base}/api/orders/${orderId}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await res.json().catch(() => ({}));
  return { status: body.status ?? "ERROR", httpStatus: res.status };
}

async function drive(attackId: AttackId, base: string, fake: FakePayPal, proxy: ReturnType<typeof createProxy>, runId: string, buyer: { captureAttempted: boolean; sawError: boolean }): Promise<string> {
  const orderId = await createOrder(base, attackId === "A5" ? "0.01" : undefined);
  proxy.mapOrder(orderId, runId);
  fake.approve(orderId); // buyer approves at PayPal
  await sleep(30);

  if (attackId === "A6") {
    const res = await fetch(`${base}/api/orders/${orderId}/fulfil`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    buyer.sawError = !res.ok; // fixed store has no fulfil route → 404
    return orderId;
  }
  buyer.captureAttempted = true;
  const cap = await captureOrder(base, orderId);
  buyer.sawError = cap.status !== "COMPLETED";
  return orderId;
}

function buildFacts(orderId: string, fake: FakePayPal, probe: { orders: unknown[]; entitlements: unknown[]; webhookEvents: unknown[]; storeTime?: string }, buyer: { captureAttempted: boolean; sawError: boolean }): AttackFacts {
  const order = fake.orders.get(orderId)!;
  const truth: TruthOrder = {
    id: orderId,
    status: order.status,
    amount: "12.00",
    currency: "USD",
    captures: order.captures.map((c) => ({ id: c.id, status: c.status, amount: c.amount.value, currency: c.amount.currency_code })),
    evidenceId: "tr-0001",
  };
  return {
    orderIds: [orderId],
    truth: { [orderId]: truth },
    after: { storeTime: probe.storeTime ?? new Date().toISOString(), orders: probe.orders as never, entitlements: probe.entitlements as never, webhookEvents: probe.webhookEvents as never },
    afterId: "st-0002",
    buyer: { captureAttempted: buyer.captureAttempted, sawError: buyer.sawError, evidenceId: "br-0003" },
    catalog: [CATALOG_ITEM],
    evidence: { webhooks: ["wf-0004"], captures: ["pc-0005"], creates: ["pc-0006"] },
  };
}
