import { createHmac, randomBytes, randomUUID } from "node:crypto";

const HOST = "https://api-m.sandbox.paypal.com";

type Capture = { id: string; status: "COMPLETED"; amount: { currency_code: string; value: string } };
type Order = {
  id: string;
  status: "CREATED" | "APPROVED" | "COMPLETED";
  referenceId: string;
  amount: { currency_code: string; value: string };
  captures: Capture[];
};

export type FakePayPalOptions = {
  webhookId?: string;
  webhookLatencyMs?: number;
};

const pid = () => randomBytes(12).toString("hex").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17).padEnd(17, "7");
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "paypal-debug-id": "fake" + pid().slice(0, 8), ...headers } });
const issue = (status: number, code: string) => json(status, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: code, description: code }], debug_id: "fake" });

/**
 * In-memory Orders v2 + webhooks + verify endpoint (docs/15 §2). Shapes follow the spike recordings in docs/07 §8a.
 * Use `fetch` wherever a PayPal fetch is injectable; call `approve` to play the buyer.
 */
export function createFakePayPal(opts: FakePayPalOptions = {}) {
  const webhookId = opts.webhookId ?? "8PT597110X687430LKGECATA";
  const secret = randomBytes(16);
  const orders = new Map<string, Order>();
  const idem = new Map<string, { status: number; body: unknown }>();
  const emitted: { eventType: string; orderId: string; status: number | null }[] = [];
  let webhookUrl: string | null = null;
  let tokens = 0;

  const sign = (tid: string, time: string, eventId: string) => createHmac("sha256", secret).update(`${tid}|${time}|${webhookId}|${eventId}`).digest("base64");

  function orderJson(o: Order) {
    return {
      id: o.id,
      intent: "CAPTURE",
      status: o.status,
      purchase_units: [
        { reference_id: o.referenceId, amount: o.amount, ...(o.captures.length ? { payments: { captures: o.captures.map((c) => ({ ...c, final_capture: true })) } } : {}) },
      ],
      links: [
        { href: `${HOST}/v2/checkout/orders/${o.id}`, rel: "self", method: "GET" },
        { href: `https://www.sandbox.paypal.com/checkoutnow?token=${o.id}`, rel: "approve", method: "GET" },
      ],
    };
  }

  function emit(eventType: string, o: Order, resource: unknown) {
    const event = {
      id: `WH-${pid()}-${pid().slice(0, 8)}`,
      event_version: "1.0",
      create_time: new Date().toISOString(),
      resource_type: eventType.startsWith("CHECKOUT") ? "checkout-order" : "capture",
      event_type: eventType,
      summary: eventType,
      resource,
    };
    const raw = JSON.stringify(event);
    const tid = randomUUID();
    const time = new Date().toISOString();
    const headers = {
      "content-type": "application/json",
      "paypal-transmission-id": tid,
      "paypal-transmission-time": time,
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fake",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": sign(tid, time, event.id),
    };
    const record = { eventType, orderId: o.id, status: null as number | null };
    emitted.push(record);
    setTimeout(() => {
      if (!webhookUrl) return;
      fetch(webhookUrl, { method: "POST", headers, body: raw })
        .then((r) => {
          record.status = r.status;
        })
        .catch(() => undefined);
    }, opts.webhookLatencyMs ?? 20);
  }

  function approve(orderId: string) {
    const o = orders.get(orderId);
    if (!o) throw new Error(`fake paypal: no order ${orderId}`);
    if (o.status !== "CREATED") return;
    o.status = "APPROVED";
    emit("CHECKOUT.ORDER.APPROVED", o, orderJson(o));
  }

  async function handle(method: string, path: string, headers: Headers, bodyText: string): Promise<Response> {
    if (method === "POST" && path === "/v1/oauth2/token") {
      if (!headers.get("authorization")?.startsWith("Basic ")) return json(401, { error: "invalid_client" });
      return json(200, { scope: "https://uri.paypal.com/services/payments", access_token: `FAKE-${++tokens}`, token_type: "Bearer", app_id: "APP-FAKE", expires_in: 32399, nonce: "n" });
    }
    if (!headers.get("authorization")?.startsWith("Bearer FAKE-")) return json(401, { name: "AUTHENTICATION_FAILURE" });
    const body = bodyText ? JSON.parse(bodyText) : {};

    if (method === "POST" && path === "/v2/checkout/orders") {
      const pu = body.purchase_units?.[0];
      if (body.intent !== "CAPTURE" || !pu?.amount?.value) return json(400, { name: "INVALID_REQUEST" });
      const o: Order = { id: pid(), status: "CREATED", referenceId: pu.reference_id ?? "default", amount: pu.amount, captures: [] };
      orders.set(o.id, o);
      return json(201, { id: o.id, status: o.status, links: orderJson(o).links });
    }

    const m = /^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture|\/confirm-payment-source)?$/.exec(path);
    const o = m ? orders.get(m[1]!) : undefined;
    if (m && !o) return json(404, { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] });

    if (o && method === "GET" && !m![2]) return json(200, orderJson(o));

    if (o && method === "POST" && m![2] === "/confirm-payment-source") {
      approve(o.id);
      return json(200, { id: o.id, status: o.status });
    }

    if (o && method === "POST" && m![2] === "/capture") {
      const mock = headers.get("paypal-mock-response");
      if (mock) return issue(422, JSON.parse(mock).mock_application_codes);
      const requestId = headers.get("paypal-request-id");
      const key = requestId ? `${path}|${requestId}` : null;
      if (key && idem.has(key)) {
        const prev = idem.get(key)!;
        return json(prev.status, prev.body);
      }
      if (o.status === "COMPLETED") return issue(422, "ORDER_ALREADY_CAPTURED");
      if (o.status !== "APPROVED") return issue(422, "ORDER_NOT_APPROVED");
      const capture: Capture = { id: pid(), status: "COMPLETED", amount: o.amount };
      o.captures.push(capture);
      o.status = "COMPLETED";
      const res = { id: o.id, status: "COMPLETED", purchase_units: [{ reference_id: o.referenceId, payments: { captures: [capture] } }] };
      if (key) idem.set(key, { status: 201, body: res });
      emit("PAYMENT.CAPTURE.COMPLETED", o, { ...capture, final_capture: true, supplementary_data: { related_ids: { order_id: o.id } } });
      return json(201, res);
    }

    if (method === "POST" && path === "/v1/notifications/verify-webhook-signature") {
      const tidOk = typeof body.transmission_id === "string" && /^(?!\d+$)\w+\S+/.test(body.transmission_id);
      if (!/^[a-zA-Z0-9]+$/.test(body.webhook_id ?? "") || !tidOk) return json(400, { name: "INVALID_REQUEST" });
      const ok = body.webhook_id === webhookId && body.transmission_sig === sign(body.transmission_id, body.transmission_time, body.webhook_event?.id);
      return json(200, { verification_status: ok ? "SUCCESS" : "FAILURE" });
    }
    return json(404, { name: "NOT_FOUND", path });
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== HOST) throw new Error(`fake paypal: refused host ${url.origin}`);
    return handle(req.method, url.pathname, req.headers, await req.text());
  };

  return {
    fetch: fakeFetch,
    approve,
    webhookId,
    orders,
    emitted,
    setWebhookTarget(url: string | null) {
      webhookUrl = url;
    },
  };
}

export type FakePayPal = ReturnType<typeof createFakePayPal>;
