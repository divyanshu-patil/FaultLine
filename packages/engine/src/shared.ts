// Helpers shared by the offline (BuggyBeans) and external (any store) runners. Nothing here imports BuggyBeans,
// so the external runner — and the CLI bundle — stay free of node:sqlite and the bundled store.
import type { AddressInfo } from "node:net";
import type { WebhookRule } from "proxy/src/app.ts";
import type { AttackFacts, TruthOrder } from "@faultline/core";
import type { AttackId, CatalogItem } from "@faultline/schemas";
import type { FakePayPal } from "@faultline/testing";

export const CATALOG_ITEM: CatalogItem = { sku: "house-blend", name: "House Blend 250 g", price: "12.00", currency: "USD", creditsPerItem: 100 };

export type Server = { port: number; close: () => void };

export function listen(app: { listen: (...args: never[]) => { address: () => AddressInfo | string | null; close: () => void } }, port = 0, host = "127.0.0.1"): Promise<Server> {
  return new Promise((resolve) => {
    const s = (app.listen as (port: number, host: string, cb: () => void) => { address: () => AddressInfo | string | null; close: () => void })(port, host, () =>
      resolve({ port: (s.address() as AddressInfo).port, close: () => s.close() }),
    );
  });
}

export function ruleFor(attackId: AttackId): WebhookRule {
  if (attackId === "A1") return { kind: "duplicate", times: 3, gapMs: 15 };
  if (attackId === "A2") return { kind: "hold_until", hold: "CHECKOUT.ORDER.APPROVED", until: "PAYMENT.CAPTURE.COMPLETED" };
  if (attackId === "A8") return { kind: "drop" };
  return { kind: "passthrough" };
}

export type StoreProbe = { orders: unknown[]; entitlements: unknown[]; webhookEvents: unknown[]; storeTime?: string };

export function buildFacts(orderId: string, fake: FakePayPal, probe: StoreProbe, buyer: { captureAttempted: boolean; sawError: boolean }, item: CatalogItem = CATALOG_ITEM): AttackFacts {
  const order = fake.orders.get(orderId)!;
  const truth: TruthOrder = {
    id: orderId,
    status: order.status,
    amount: item.price,
    currency: item.currency,
    captures: order.captures.map((c) => ({ id: c.id, status: c.status, amount: c.amount.value, currency: c.amount.currency_code })),
    evidenceId: "tr-0001",
  };
  return {
    orderIds: [orderId],
    truth: { [orderId]: truth },
    after: { storeTime: probe.storeTime ?? new Date().toISOString(), orders: probe.orders as never, entitlements: probe.entitlements as never, webhookEvents: probe.webhookEvents as never },
    afterId: "st-0002",
    buyer: { captureAttempted: buyer.captureAttempted, sawError: buyer.sawError, evidenceId: "br-0003" },
    catalog: [item],
    evidence: { webhooks: ["wf-0004"], captures: ["pc-0005"], creates: ["pc-0006"] },
  };
}
