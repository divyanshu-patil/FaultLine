import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp, CATALOG } from "buggybeans/src/app.ts";
import { openDb } from "buggybeans/src/db.ts";
import { parseFlags } from "buggybeans/src/env.ts";
import { createPayPal } from "buggybeans/src/paypal.ts";
import { createProxy, type WebhookRule } from "proxy/src/app.ts";
import { checkInvariants, getAttack, type AttackFacts, type TruthOrder } from "@faultline/core";
import { parseBugList, renderVariant } from "@faultline/patch";
import type { AttackId, CatalogItem, Verdict } from "@faultline/schemas";
import { createFakePayPal, type FakePayPal } from "@faultline/testing";

/** The BuggyBeans store modules the attack runner needs: the static set runs the seeded store;
 *  a dynamically-imported set (from a patched source tree) runs the AI's fix under the same checks. */
type StoreMod = {
  createApp: typeof createApp;
  CATALOG: typeof CATALOG;
  openDb: typeof openDb;
  parseFlags: typeof parseFlags;
  createPayPal: typeof createPayPal;
};
const STATIC_MOD: StoreMod = { createApp, CATALOG, openDb, parseFlags, createPayPal };

const HOST = "https://api-m.sandbox.paypal.com";
const PROBE = "0123456789abcdef-probe";
const CATALOG_ITEM: CatalogItem = { sku: "house-blend", name: "House Blend 250 g", price: "12.00", currency: "USD", creditsPerItem: 100 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Server = { port: number; close: () => void };

export function listen(app: { listen: (...args: never[]) => { address: () => AddressInfo | string | null; close: () => void } }, port = 0, host = "127.0.0.1"): Promise<Server> {
  return new Promise((resolve) => {
    const s = (app.listen as (port: number, host: string, cb: () => void) => { address: () => AddressInfo | string | null; close: () => void })(port, host, () =>
      resolve({ port: (s.address() as AddressInfo).port, close: () => s.close() }),
    );
  });
}

/** Offline attacks that need neither a forged signature (A3) nor a withheld capture response (A4). */
export const OFFLINE_ATTACKS: AttackId[] = ["A1", "A2", "A5", "A6", "A7", "A8"];

/**
 * Runs one attack in-process against a fresh BuggyBeans instance wired to FakePayPal, with the proxy applying the
 * webhook disturbance, then runs the real checker. `bugs` selects the seeded bug variant ("" = fixed store).
 */
export async function runOffline(attackId: AttackId, bugs: string): Promise<{ verdicts: Verdict[]; failed: string[] }> {
  return runAttackWith(STATIC_MOD, attackId, bugs);
}

/**
 * Proves (or disproves) an AI fix: renders the seeded store, overlays the model's patched files, runs that patched
 * store through the *same* attack and the *same* checker. `verified` iff every invariant of the attack passes.
 * `patched` maps store-relative paths (e.g. "src/routes/webhooks.ts") to the full patched file contents.
 */
export async function verifyOffline(attackId: AttackId, bugs: string, patched: Record<string, string>): Promise<{ verdicts: Verdict[]; failed: string[]; verified: boolean }> {
  const dir = materializePatchedStore(bugs, patched);
  try {
    const mod = await importStore(dir);
    const { verdicts, failed } = await runAttackWith(mod, attackId, bugs);
    return { verdicts, failed, verified: failed.length === 0 };
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

async function runAttackWith(mod: StoreMod, attackId: AttackId, bugs: string): Promise<{ verdicts: Verdict[]; failed: string[] }> {
  const fake = createFakePayPal({ webhookLatencyMs: 2 });
  const flags = mod.parseFlags(bugs);
  const db = mod.openDb(":memory:", flags);
  const store = mod.createApp({
    db,
    paypal: mod.createPayPal({ base: HOST, clientId: "id", secret: "secret", fetch: captureHeaderFetch(attackId, fake) }),
    flags,
    clientId: "id",
    webhookId: fake.webhookId,
    probeToken: PROBE,
    base: "",
    catalog: mod.CATALOG,
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

/** Store files rendered into the patched tree, relative to BuggyBeans' src/ (patch keys are "src/<rel>"). */
const STORE_FILES = ["app.ts", "db.ts", "env.ts", "paypal.ts", "routes/orders.ts", "routes/webhooks.ts", "routes/probe.ts", "routes/pages.ts"];

/** Write a full BuggyBeans src tree rendered with the seeded bugs, overlaying the model's patched files, and
 *  return its src dir. Placed inside the package so bare imports (express, zod) resolve; caller removes the root. */
function materializePatchedStore(bugs: string, patched: Record<string, string>): string {
  const srcDir = dirname(fileURLToPath(import.meta.resolve("buggybeans/src/app.ts")));
  const active = parseBugList(bugs);
  const root = mkdtempSync(join(srcDir, "..", ".fl-verify-"));
  const outSrc = join(root, "src");
  mkdirSync(join(outSrc, "routes"), { recursive: true });
  for (const rel of STORE_FILES) {
    const rendered = renderVariant(readFileSync(join(srcDir, rel), "utf8"), active);
    writeFileSync(join(outSrc, rel), patched[`src/${rel}`] ?? rendered);
  }
  copyFileSync(join(srcDir, "catalog.json"), join(outSrc, "catalog.json"));
  return outSrc;
}

async function importStore(srcDir: string): Promise<StoreMod> {
  const href = (rel: string) => pathToFileURL(join(srcDir, rel)).href;
  const [app, dbm, env, pp] = await Promise.all([import(href("app.ts")), import(href("db.ts")), import(href("env.ts")), import(href("paypal.ts"))]);
  return { createApp: app.createApp, CATALOG: app.CATALOG, openDb: dbm.openDb, parseFlags: env.parseFlags, createPayPal: pp.createPayPal };
}

export function ruleFor(attackId: AttackId): WebhookRule {
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
