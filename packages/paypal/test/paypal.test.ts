import { describe, expect, it } from "vitest";
import { assertSandboxHost, createPayPalClient, matchProxyRoute, normalizeOrder, orderIdOfEvent } from "../src/index.ts";

describe("sandbox allowlist (docs/12 §2)", () => {
  it("accepts only the sandbox host", () => {
    expect(assertSandboxHost(undefined)).toBe("https://api-m.sandbox.paypal.com");
    expect(assertSandboxHost("https://api-m.sandbox.paypal.com/")).toBe("https://api-m.sandbox.paypal.com");
    expect(() => assertSandboxHost("https://api-m.example.com")).toThrow(/sandbox only/);
    expect(() => assertSandboxHost("http://api-m.sandbox.paypal.com")).toThrow();
  });

  it("allows only the store routes in the proxy", () => {
    expect(matchProxyRoute("POST", "/v2/checkout/orders")).toBe("create_order");
    expect(matchProxyRoute("POST", "/v2/checkout/orders/5O190127TN364715T/capture")).toBe("capture");
    expect(matchProxyRoute("GET", "/v2/checkout/orders/5O190127TN364715T")).toBe("get_order");
    expect(matchProxyRoute("POST", "/v1/payments/payouts")).toBeNull();
    expect(matchProxyRoute("POST", "/v2/checkout/orders/X/authorize")).toBeNull();
    expect(matchProxyRoute("DELETE", "/v2/checkout/orders/X")).toBeNull();
  });

  it("refuses non-allowlisted paths in the client without calling the network", async () => {
    let calls = 0;
    const client = createPayPalClient({ clientId: "id", clientSecret: "s", fetch: async () => (calls++, new Response("{}")) });
    await expect(client.request("POST", "/v1/payments/payouts")).rejects.toThrow(/not allowed/);
    expect(calls).toBe(0);
  });
});

describe("truth normalisation", () => {
  it("reads captures from purchase units", () => {
    const t = normalizeOrder({
      id: "O1",
      status: "COMPLETED",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "12.00" },
          payments: { captures: [{ id: "C1", status: "COMPLETED", amount: { currency_code: "USD", value: "12.00" } }] },
        },
      ],
    });
    expect(t).toEqual({ id: "O1", status: "COMPLETED", amount: "12.00", currency: "USD", captures: [{ id: "C1", status: "COMPLETED", amount: "12.00", currency: "USD" }] });
  });

  it("finds the order id in order and capture events", () => {
    expect(orderIdOfEvent({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "O1" } })).toBe("O1");
    expect(orderIdOfEvent({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C1", supplementary_data: { related_ids: { order_id: "O2" } } } })).toBe("O2");
    expect(orderIdOfEvent({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C1" } })).toBeNull();
  });
});
