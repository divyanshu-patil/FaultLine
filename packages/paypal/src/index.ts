import { z } from "zod";

/** The only PayPal API host FaultLine may talk to (AGENTS.md rule 1, docs/12 §2). */
export const SANDBOX_API_HOST = "https://api-m.sandbox.paypal.com";

export function assertSandboxHost(host: string | undefined): string {
  const value = (host ?? SANDBOX_API_HOST).replace(/\/+$/, "");
  if (value !== SANDBOX_API_HOST) {
    throw new Error(`PAYPAL_API_HOST must be ${SANDBOX_API_HOST} (sandbox only); got ${value}`);
  }
  return value;
}

type Route = { method: string; re: RegExp; name: string };
const ID = "[A-Za-z0-9-]+";

/** Store traffic the fault proxy forwards (docs/07 §8). */
export const PROXY_ROUTES: Route[] = [
  { method: "POST", re: /^\/v1\/oauth2\/token$/, name: "token" },
  { method: "POST", re: /^\/v2\/checkout\/orders$/, name: "create_order" },
  { method: "GET", re: new RegExp(`^/v2/checkout/orders/${ID}$`), name: "get_order" },
  { method: "POST", re: new RegExp(`^/v2/checkout/orders/${ID}/capture$`), name: "capture" },
  { method: "POST", re: /^\/v1\/notifications\/verify-webhook-signature$/, name: "verify_webhook" },
];

/** FaultLine's own calls: truth reads, card approval, webhook setup. */
const CLIENT_ROUTES: Route[] = [
  ...PROXY_ROUTES,
  { method: "POST", re: new RegExp(`^/v2/checkout/orders/${ID}/confirm-payment-source$`), name: "confirm_payment_source" },
  { method: "GET", re: /^\/v1\/notifications\/webhooks$/, name: "list_webhooks" },
  { method: "POST", re: /^\/v1\/notifications\/webhooks$/, name: "create_webhook" },
  { method: "PATCH", re: new RegExp(`^/v1/notifications/webhooks/${ID}$`), name: "update_webhook" },
];

function match(routes: Route[], method: string, path: string): string | null {
  return routes.find((r) => r.method === method.toUpperCase() && r.re.test(path))?.name ?? null;
}
export const matchProxyRoute = (method: string, path: string) => match(PROXY_ROUTES, method, path);

/** Order id from a webhook event (docs/02 §6; capture path ⚠️ S2). */
export function orderIdOfEvent(event: unknown): string | null {
  const e = event as { event_type?: string; resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } } };
  if (e?.event_type?.startsWith("CHECKOUT.ORDER.")) return e.resource?.id ?? null;
  return e?.resource?.supplementary_data?.related_ids?.order_id ?? null;
}

// ---------- truth (docs/04 F9) ----------

const OrderJson = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
        payments: z
          .object({
            captures: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

export type Truth = {
  id: string;
  status: string;
  amount: string;
  currency: string;
  captures: { id: string; status: string; amount: string; currency: string }[];
};

export function normalizeOrder(json: unknown): Truth {
  const o = OrderJson.parse(json);
  const pu = o.purchase_units[0];
  return {
    id: o.id,
    status: o.status,
    amount: pu?.amount?.value ?? "0.00",
    currency: pu?.amount?.currency_code ?? "USD",
    captures: o.purchase_units.flatMap((u) =>
      (u.payments?.captures ?? []).map((c) => ({
        id: c.id,
        status: c.status,
        amount: c.amount?.value ?? "0.00",
        currency: c.amount?.currency_code ?? "USD",
      })),
    ),
  };
}

// ---------- client ----------

export type PayPalResponse = { status: number; body: unknown; debugId: string | null; headers: Record<string, string> };

export type PayPalClient = {
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<PayPalResponse>;
  getOrder(orderId: string): Promise<PayPalResponse>;
};

export type PayPalClientOptions = {
  clientId: string;
  clientSecret: string;
  host?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export function createPayPalClient(opts: PayPalClientOptions): PayPalClient {
  const host = assertSandboxHost(opts.host);
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let token: { value: string; expiresAt: number } | null = null;

  async function getToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt > Date.now()) return token.value;
    const res = await doFetch(`${host}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`PayPal token request failed with ${res.status}`);
    const json = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await res.json());
    // cache until expires_in − 300 s (docs/07 §2)
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 300) * 1000 };
    return token.value;
  }

  async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, retried = false): Promise<PayPalResponse> {
    if (!match(CLIENT_ROUTES, method, path)) throw new Error(`PayPal path not allowed: ${method} ${path}`);
    const res = await doFetch(`${host}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await getToken(retried)}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 && !retried) return request(method, path, body, headers, true);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return {
      status: res.status,
      body: parsed,
      debugId: res.headers.get("paypal-debug-id"),
      headers: Object.fromEntries(res.headers.entries()),
    };
  }

  return {
    request,
    getOrder: (orderId) => request("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`),
  };
}
