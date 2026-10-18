import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createProxy, type Instance } from "../src/app.ts";

/** A stand-in BuggyBeans instance that records the webhook deliveries it receives. */
function fakeInstance() {
  const deliveries: { type: string; id: string }[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/webhooks/paypal") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const e = JSON.parse(body);
          deliveries.push({ type: e.event_type, id: e.id });
        } catch {
          /* ignore */
        }
        res.end(JSON.stringify({ received: true }));
      });
    } else {
      res.setHeader("content-type", "text/plain");
      res.end(`store says: ${req.url}`);
    }
  });
  return { server, deliveries };
}

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
const proxyListen = (app: import("express").Express) => new Promise<{ server: Server; port: number }>((r) => {
  const server = app.listen(0, "127.0.0.1", () => r({ server, port: (server.address() as AddressInfo).port }));
});

const webhook = (orderId: string, type: string, id: string) =>
  JSON.stringify({ id, event_type: type, resource: type.startsWith("CHECKOUT") ? { id: orderId } : { supplementary_data: { related_ids: { order_id: orderId } } } });

const post = (base: string, path: string, body: string) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "paypal-transmission-sig": "real-sig" }, body });

describe("proxy gateway + webhook disturbances (non-forging)", () => {
  const servers: Server[] = [];
  afterEach(() => servers.forEach((s) => s.close()));

  async function setup(rule: Parameters<ReturnType<typeof createProxy>["registerRun"]>[2]) {
    const inst = fakeInstance();
    servers.push(inst.server);
    const port = await listen(inst.server);
    const proxy = createProxy();
    const instance: Instance = { instanceId: "ab12", port, runId: "run1", attackRowId: null };
    proxy.registerRun("run1", instance, rule);
    proxy.mapOrder("O-1", "run1");
    const { server, port: pport } = await proxyListen(proxy.app);
    servers.push(server);
    return { base: `http://127.0.0.1:${pport}`, deliveries: inst.deliveries };
  }

  it("routes /i/:id/* to the instance", async () => {
    const { base } = await setup({ kind: "passthrough" });
    const res = await fetch(`${base}/i/ab12/p/house-blend`);
    expect(await res.text()).toBe("store says: /p/house-blend");
  });

  it("A1 duplicate: forwards the same real delivery three times", async () => {
    const { base, deliveries } = await setup({ kind: "duplicate", times: 3, gapMs: 1 });
    await post(base, "/webhooks/paypal", webhook("O-1", "PAYMENT.CAPTURE.COMPLETED", "WH-1"));
    await new Promise((r) => setTimeout(r, 30));
    expect(deliveries.filter((d) => d.id === "WH-1")).toHaveLength(3);
  });

  it("A8 drop: withholds every delivery", async () => {
    const { base, deliveries } = await setup({ kind: "drop" });
    const res = await post(base, "/webhooks/paypal", webhook("O-1", "PAYMENT.CAPTURE.COMPLETED", "WH-2"));
    expect(res.status).toBe(200); // PayPal still gets its ack
    await new Promise((r) => setTimeout(r, 20));
    expect(deliveries).toHaveLength(0);
  });

  it("A2 hold_until: releases the held APPROVED only after COMPLETED, out of order", async () => {
    const { base, deliveries } = await setup({ kind: "hold_until", hold: "CHECKOUT.ORDER.APPROVED", until: "PAYMENT.CAPTURE.COMPLETED" });
    await post(base, "/webhooks/paypal", webhook("O-1", "CHECKOUT.ORDER.APPROVED", "WH-A"));
    await new Promise((r) => setTimeout(r, 10));
    expect(deliveries).toHaveLength(0); // approval is held
    await post(base, "/webhooks/paypal", webhook("O-1", "PAYMENT.CAPTURE.COMPLETED", "WH-C"));
    await new Promise((r) => setTimeout(r, 20));
    expect(deliveries.map((d) => d.id)).toEqual(["WH-C", "WH-A"]); // completed first, then the late approval
  });

  it("unknown order is acked but never forwarded", async () => {
    const { base, deliveries } = await setup({ kind: "passthrough" });
    const res = await post(base, "/webhooks/paypal", webhook("O-UNKNOWN", "PAYMENT.CAPTURE.COMPLETED", "WH-X"));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(deliveries).toHaveLength(0);
  });
});
