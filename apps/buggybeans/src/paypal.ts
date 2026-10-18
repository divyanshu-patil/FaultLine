// BuggyBeans' own small PayPal REST client, like a typical third-party store would write.

export type PayPalResult = { status: number; ok: boolean; timedOut: boolean; body: any };

export function createPayPal(opts: { base: string; clientId: string; secret: string; timeoutMs?: number; fetch?: typeof fetch }) {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value;
    const res = await doFetch(`${opts.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${opts.clientId}:${opts.secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`token request failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 300) * 1000 };
    return token.value;
  }

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<PayPalResult> {
    try {
      const res = await doFetch(`${opts.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { status: res.status, ok: res.ok, timedOut: false, body: parsed };
    } catch {
      return { status: 0, ok: false, timedOut: true, body: null };
    }
  }

  return {
    createOrder: (referenceId: string, amount: string) =>
      call("POST", "/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{ reference_id: referenceId, amount: { currency_code: "USD", value: amount } }],
      }),

    capture: (orderId: string, requestId?: string) =>
      call("POST", `/v2/checkout/orders/${orderId}/capture`, {}, requestId ? { "PayPal-Request-Id": requestId } : {}),

    getOrder: (orderId: string) => call("GET", `/v2/checkout/orders/${orderId}`),

    async verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown, webhookId: string): Promise<boolean> {
      const h = (name: string) => String(headers[name] ?? "");
      const r = await call("POST", "/v1/notifications/verify-webhook-signature", {
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      });
      return r.ok && r.body?.verification_status === "SUCCESS";
    },
  };
}

export type PayPal = ReturnType<typeof createPayPal>;

export function captureOf(body: any): { id: string; status: string } | undefined {
  return body?.purchase_units?.[0]?.payments?.captures?.[0];
}

export function issueOf(body: any): string | undefined {
  return body?.details?.[0]?.issue;
}
