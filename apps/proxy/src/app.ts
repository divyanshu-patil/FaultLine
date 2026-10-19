import express, { type Express, type Request as Req, type Response as Res } from "express";
import { SANDBOX_API_HOST, orderIdOfEvent } from "@faultline/paypal";
import { faultPassthrough, forgeNotProvided, type ForgeEvent, type InjectCaptureFault } from "./stubs.ts";

// `webhookUrl` targets an external store directly (self-host integration); otherwise deliveries go to the
// in-process instance at 127.0.0.1:<port>/webhooks/paypal.
export type Instance = { instanceId: string; port: number; runId: string; attackRowId: string | null; webhookUrl?: string };

/** How the store's own real, signed deliveries are disturbed on the way to it. None of these fabricate a signature. */
export type WebhookRule =
  | { kind: "passthrough" }
  | { kind: "duplicate"; times: number; gapMs: number } // A1: replay the real delivery N times
  | { kind: "hold_until"; hold: string; until: string } // A2: hold one real event type until another arrives, then release out of order
  | { kind: "drop" }; // A8: withhold every delivery

export type FaultRule = { operation: string; occurrence: number } | null; // A4, applied by the injected hook

type RunReg = { instance: Instance; webhook: WebhookRule; fault: FaultRule };

export type SavedDelivery = {
  eventId: string | null;
  eventType: string | null;
  orderId: string | null;
  runId: string | null;
  instanceId: string | null;
  raw: Buffer;
  headers: Record<string, string>;
  forged: boolean;
  outcome: "forwarded" | "withheld" | "held" | "duplicated";
};

export type ProxyDeps = {
  upstreamFetch?: typeof fetch;
  saveDelivery?: (d: SavedDelivery) => void | Promise<void>;
  recordCall?: (c: { instanceId: string; method: string; path: string; status: number }) => void;
  forgeEvent?: ForgeEvent;
  injectCaptureFault?: InjectCaptureFault;
  log?: { info: (o: object) => void; warn: (o: object) => void };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const headerObj = (req: Req) => Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v ?? "")]));
const PAYPAL_HOP = new Set(["host", "content-length", "connection", "accept-encoding"]);

/**
 * The FaultLine proxy: an instance gateway, a webhook disturbance proxy (replay/reorder/withhold of the store's real
 * signed deliveries) and a PayPal fault proxy (passthrough to the sandbox, with the operator's fault hook). The two
 * sensitive behaviours — forging an event (A3) and withholding a capture response (A4) — come from injected hooks.
 */
export function createProxy(deps: ProxyDeps = {}) {
  const upstream = deps.upstreamFetch ?? globalThis.fetch;
  const forge = deps.forgeEvent ?? forgeNotProvided;
  const injectFault = deps.injectCaptureFault ?? faultPassthrough;
  const log = deps.log ?? { info: () => undefined, warn: () => undefined };

  const runs = new Map<string, RunReg>(); // runId -> registration
  const byOrder = new Map<string, string>(); // paypal order id -> runId
  const byInstance = new Map<string, string>(); // instanceId -> runId
  const held = new Map<string, { headers: Record<string, string>; raw: Buffer }>(); // runId -> stashed event
  const faultCount = new Map<string, number>(); // instanceId:operation -> seen count

  function registerRun(runId: string, instance: Instance, webhook: WebhookRule = { kind: "passthrough" }, fault: FaultRule = null) {
    runs.set(runId, { instance, webhook, fault });
    byInstance.set(instance.instanceId, runId);
  }
  function mapOrder(orderId: string, runId: string) {
    byOrder.set(orderId, runId);
  }

  async function forwardToStore(reg: RunReg, headers: Record<string, string>, raw: Buffer, outcome: SavedDelivery["outcome"], forged = false) {
    const fwd = Object.fromEntries(Object.entries(headers).filter(([k]) => !PAYPAL_HOP.has(k.toLowerCase())));
    const target = reg.instance.webhookUrl ?? `http://127.0.0.1:${reg.instance.port}/webhooks/paypal`;
    try {
      const res = await upstream(target, { method: "POST", headers: fwd, body: raw as BodyInit });
      log.info({ msg: "forwarded webhook", instance: reg.instance.instanceId, status: res.status, outcome });
    } catch (e) {
      log.warn({ msg: "forward failed", instance: reg.instance.instanceId, error: String(e) });
    }
  }

  async function handleWebhook(req: Req, res: Res) {
    const raw = req.body as Buffer;
    let event: unknown = null;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      /* leave null */
    }
    const headers = headerObj(req);
    const orderId = event ? orderIdOfEvent(event) : null;
    const eventType = (event as { event_type?: string } | null)?.event_type ?? null;
    const eventId = (event as { id?: string } | null)?.id ?? null;
    const runId = orderId ? byOrder.get(orderId) ?? null : null;
    const reg = runId ? runs.get(runId) ?? null : null;

    // Always 200 the real PayPal transmission quickly so it is not retried upstream.
    res.status(200).json({ received: true });
    if (!reg) {
      log.warn({ msg: "webhook with no registered run", orderId });
      return;
    }

    const save = (outcome: SavedDelivery["outcome"], forged = false) =>
      deps.saveDelivery?.({ eventId, eventType, orderId, runId, instanceId: reg.instance.instanceId, raw, headers, forged, outcome });

    const rule = reg.webhook;
    if (rule.kind === "drop") {
      await save("withheld");
      return;
    }
    if (rule.kind === "hold_until") {
      if (eventType === rule.hold) {
        held.set(runId!, { headers, raw });
        await save("held");
        return;
      }
      if (eventType === rule.until) {
        await forwardToStore(reg, headers, raw, "forwarded");
        await save("forwarded");
        const stash = held.get(runId!);
        if (stash) {
          held.delete(runId!);
          await forwardToStore(reg, stash.headers, stash.raw, "forwarded");
        }
        return;
      }
    }
    if (rule.kind === "duplicate") {
      await forwardToStore(reg, headers, raw, "forwarded");
      await save("forwarded");
      for (let i = 1; i < rule.times; i++) {
        await sleep(rule.gapMs);
        await forwardToStore(reg, headers, raw, "duplicated");
        await save("duplicated");
      }
      return;
    }
    await forwardToStore(reg, headers, raw, "forwarded");
    await save("forwarded");
  }

  // --- PayPal fault proxy: store's PayPal base points here; we pass through to the sandbox. ---
  async function handlePayPal(req: Req, res: Res) {
    const instanceId = String(req.params.instanceId);
    const rest = (Array.isArray(req.params.splat) ? req.params.splat.join("/") : (req.params.splat ?? ""));
    const url = `${SANDBOX_API_HOST}/${rest}`;
    const method = req.method;
    const headers = Object.fromEntries(Object.entries(headerObj(req)).filter(([k]) => !PAYPAL_HOP.has(k.toLowerCase())));
    const body = method === "GET" || method === "HEAD" ? undefined : (req.body as Buffer);

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await upstream(url, { method, headers, body: body as BodyInit | undefined });
    } catch (e) {
      log.warn({ msg: "paypal upstream failed", error: String(e) });
      res.status(502).json({ name: "PROXY_UPSTREAM_ERROR" });
      return;
    }

    const isCapture = /\/capture$/.test(rest) && method === "POST";
    const runId = byInstance.get(instanceId);
    const fault = runId ? runs.get(runId)?.fault ?? null : null;

    let out = upstreamRes;
    if (isCapture && fault && fault.operation === "capture") {
      const key = `${instanceId}:capture`;
      const n = (faultCount.get(key) ?? 0) + 1;
      faultCount.set(key, n);
      if (n === fault.occurrence) out = await injectFault({ operation: "capture", occurrence: n, instanceId }, upstreamRes);
    }

    const buf = Buffer.from(await out.arrayBuffer());
    // learn order id -> run mapping from a create-order response so webhooks can be routed
    if (/v2\/checkout\/orders$/.test(rest) && method === "POST" && runId) {
      try {
        const id = (JSON.parse(buf.toString("utf8")) as { id?: string }).id;
        if (id) mapOrder(id, runId);
      } catch {
        /* ignore */
      }
    }
    deps.recordCall?.({ instanceId, method, path: `/${rest}`, status: out.status });
    out.headers.forEach((v, k) => {
      if (!PAYPAL_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-encoding") res.setHeader(k, v);
    });
    res.status(out.status).send(buf);
  }

  // --- instance gateway: /i/:instanceId/* -> the BuggyBeans child process ---
  async function handleGateway(req: Req, res: Res) {
    const instanceId = String(req.params.instanceId);
    const runId = byInstance.get(instanceId);
    const reg = runId ? runs.get(runId) : undefined;
    if (!reg) {
      res.status(404).json({ error: "unknown instance" });
      return;
    }
    const rest = (Array.isArray(req.params.splat) ? req.params.splat.join("/") : (req.params.splat ?? ""));
    const search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const headers = Object.fromEntries(Object.entries(headerObj(req)).filter(([k]) => !PAYPAL_HOP.has(k.toLowerCase())));
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : (req.body as Buffer);
    try {
      const up = await upstream(`http://127.0.0.1:${reg.instance.port}/${rest}${search}`, { method: req.method, headers, body: body as BodyInit | undefined });
      const buf = Buffer.from(await up.arrayBuffer());
      up.headers.forEach((v, k) => {
        if (!PAYPAL_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-encoding") res.setHeader(k, v);
      });
      res.status(up.status).send(buf);
    } catch {
      res.status(502).json({ error: "instance unreachable" });
    }
  }

  const app: Express = express();
  app.disable("x-powered-by");
  app.use(express.raw({ type: "*/*", limit: "2mb" }));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.post("/webhooks/paypal", handleWebhook);
  app.all("/pp/:instanceId/*splat", handlePayPal);
  app.all("/i/:instanceId/*splat", handleGateway);

  return { app, registerRun, mapOrder, forge, _runs: runs };
}

export type Proxy = ReturnType<typeof createProxy>;
