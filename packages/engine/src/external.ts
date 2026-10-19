import { createProxy } from "proxy/src/app.ts";
import { checkInvariants, getAttack } from "@faultline/core";
import type { AttackId, CatalogItem, Verdict } from "@faultline/schemas";
import { startFakePayPalServer, type FakePayPalServer } from "@faultline/testing";
import { buildFacts, listen, ruleFor, type StoreProbe } from "./offline.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attacks runnable against an external store on the simulated backend (no forged signature / withheld capture). */
export const EXTERNAL_ATTACKS: AttackId[] = ["A1", "A2", "A5", "A6", "A7", "A8"];

const DEFAULT_ITEM: CatalogItem = { sku: "house-blend", name: "House Blend 250 g", price: "12.00", currency: "USD", creditsPerItem: 100 };
const DEFAULT_PATHS = {
  create: "/api/orders", // POST {sku, qty, amount?} -> { id: <paypal order id> }
  capture: "/api/orders/{id}/capture", // POST -> { status }
  fulfil: "/api/orders/{id}/fulfil", // POST (A6)
  webhook: "/webhooks/paypal", // POST (store receives disturbed deliveries here)
  state: "/__crashtest/state", // GET (Bearer probe token) -> StoreProbe
};

/** The contract an external store implements so FaultLine can attack and check it. See docs/21-integrate-your-store.md. */
export type StoreContract = {
  base: string;
  probeToken: string;
  paths?: Partial<typeof DEFAULT_PATHS>;
  item?: CatalogItem;
};

export type ExternalResult = { verdicts: Verdict[]; failed: string[] };

/**
 * A long-lived simulated-PayPal + webhook-disturbance harness an external store is pointed at. Start it once,
 * configure the store with `paypalBase` / `webhookId`, then `run` each attack. The store — not FaultLine — calls
 * PayPal; FaultLine only disturbs the deliveries and runs the deterministic checker.
 */
export type ExternalHarness = {
  paypalBase: string; // the store's PAYPAL_API_BASE
  webhookId: string; // the store's PAYPAL_WEBHOOK_ID
  run(attackId: AttackId, store: StoreContract): Promise<ExternalResult>;
  close(): Promise<void>;
};

export type HarnessOptions = { host?: string; paypalPort?: number; proxyPort?: number };

export async function createExternalHarness(opts: HarnessOptions = {}): Promise<ExternalHarness> {
  const host = opts.host ?? "127.0.0.1";
  const fake: FakePayPalServer = await startFakePayPalServer({ webhookLatencyMs: 2 }, host, opts.paypalPort ?? 0);
  const proxy = createProxy();
  const proxySrv = await listen(proxy.app, opts.proxyPort ?? 0, host);
  fake.fake.setWebhookTarget(`http://${host}:${proxySrv.port}/webhooks/paypal`);

  async function run(attackId: AttackId, store: StoreContract): Promise<ExternalResult> {
    const item = store.item ?? DEFAULT_ITEM;
    const p = { ...DEFAULT_PATHS, ...(store.paths ?? {}) };
    const base = store.base.replace(/\/+$/, "");
    const at = (tpl: string, id: string) => `${base}${tpl.replace("{id}", encodeURIComponent(id))}`;
    const runId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    proxy.registerRun(runId, { instanceId: runId, port: 0, runId, attackRowId: null, webhookUrl: `${base}${p.webhook}` }, ruleFor(attackId));

    const buyer = { captureAttempted: false, sawError: false };
    const created = await fetch(`${base}${p.create}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: item.sku, qty: 1, ...(attackId === "A5" ? { amount: "0.01" } : {}) }),
    });
    const orderId = ((await created.json()) as { id?: string }).id;
    if (!orderId) throw new Error(`store ${p.create} did not return an order id (status ${created.status})`);
    proxy.mapOrder(orderId, runId);
    fake.fake.approve(orderId); // the buyer approves at PayPal
    await sleep(30);

    if (attackId === "A6") {
      const res = await fetch(at(p.fulfil, orderId), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      buyer.sawError = !res.ok; // a fixed store exposes no fulfil-without-capture route
    } else {
      if (attackId === "A7") fake.fake.declineCapture(orderId); // PayPal declines the first capture
      buyer.captureAttempted = true;
      const res = await fetch(at(p.capture, orderId), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      buyer.sawError = (body.status ?? "ERROR") !== "COMPLETED";
    }

    await sleep(250); // let disturbed webhooks arrive
    const probeRes = await fetch(`${base}${p.state}`, { headers: { authorization: `Bearer ${store.probeToken}` } });
    if (!probeRes.ok) throw new Error(`store probe ${p.state} returned ${probeRes.status} (check the probe token)`);
    const probe = (await probeRes.json()) as StoreProbe;

    const facts = buildFacts(orderId, fake.fake, probe, buyer, item);
    const verdicts = checkInvariants(getAttack(attackId).invariants, facts);
    return { verdicts, failed: verdicts.filter((v) => v.status === "fail").map((v) => v.invariant) };
  }

  return {
    paypalBase: fake.url,
    webhookId: fake.fake.webhookId,
    run,
    close: async () => {
      proxySrv.close();
      await fake.close();
    },
  };
}
