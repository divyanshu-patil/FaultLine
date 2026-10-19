import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createPayPalClient, normalizeOrder } from "@faultline/paypal";
import { createFakePayPal } from "../src/index.ts";

describe("FakePayPal (contract with docs/07 §8a)", () => {
  it("creates, refuses unapproved capture, approves, captures idempotently and emits signed webhooks", async () => {
    const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const fake = createFakePayPal({ webhookLatencyMs: 1 });
    fake.setWebhookTarget(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const pp = createPayPalClient({ clientId: "id", clientSecret: "s", fetch: fake.fetch });

    const created = await pp.request("POST", "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "12.00" } }] });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const early = await pp.request("POST", `/v2/checkout/orders/${id}/capture`, {});
    expect(early.status).toBe(422);
    expect(JSON.stringify(early.body)).toContain("ORDER_NOT_APPROVED");

    const declined = await pp.request("POST", `/v2/checkout/orders/${id}/capture`, {}, { "PayPal-Mock-Response": '{"mock_application_codes":"INSTRUMENT_DECLINED"}' });
    expect(JSON.stringify(declined.body)).toContain("INSTRUMENT_DECLINED");

    fake.approve(id);
    const c1 = await pp.request("POST", `/v2/checkout/orders/${id}/capture`, {}, { "PayPal-Request-Id": "capture-1" });
    const c2 = await pp.request("POST", `/v2/checkout/orders/${id}/capture`, {}, { "PayPal-Request-Id": "capture-1" });
    const c3 = await pp.request("POST", `/v2/checkout/orders/${id}/capture`, {}, { "PayPal-Request-Id": "capture-2" });
    expect([c1.status, c2.status, c3.status]).toEqual([201, 201, 422]);
    expect(c2.body).toEqual(c1.body);

    const truth = normalizeOrder((await pp.getOrder(id)).body);
    expect(truth.status).toBe("COMPLETED");
    expect(truth.captures).toHaveLength(1);

    // webhooks are delivered async; poll instead of a fixed sleep so the test is robust under parallel load
    for (let i = 0; i < 200 && received.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    expect(received.map((r) => JSON.parse(r.body).event_type)).toEqual(["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"]);
    const d = received[1]!;
    const verify = (sig: string) =>
      pp.request("POST", "/v1/notifications/verify-webhook-signature", {
        auth_algo: d.headers["paypal-auth-algo"],
        cert_url: d.headers["paypal-cert-url"],
        transmission_id: d.headers["paypal-transmission-id"],
        transmission_sig: sig,
        transmission_time: d.headers["paypal-transmission-time"],
        webhook_id: fake.webhookId,
        webhook_event: JSON.parse(d.body),
      });
    expect((await verify(String(d.headers["paypal-transmission-sig"]))).body).toEqual({ verification_status: "SUCCESS" });
    expect((await verify("forged")).body).toEqual({ verification_status: "FAILURE" });
    server.close();
  });
});
