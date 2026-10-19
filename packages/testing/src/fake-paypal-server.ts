import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createFakePayPal, type FakePayPalOptions } from "./fake-paypal.ts";

// The fake only accepts URLs on the sandbox origin; requests are parsed, never fetched over the network.
const SANDBOX_ORIGIN = "https://api-m.sandbox.paypal.com";

export type FakePayPalServer = {
  url: string;
  fake: ReturnType<typeof createFakePayPal>;
  close: () => Promise<void>;
};

/**
 * Runs {@link createFakePayPal} as a real HTTP server so an external store (self-host integration) can point its
 * PayPal API base at FaultLine instead of the live sandbox. Every request is dispatched to the fake's own fetch.
 */
export async function startFakePayPalServer(opts: FakePayPalOptions = {}, host = "127.0.0.1", port = 0): Promise<FakePayPalServer> {
  const fake = createFakePayPal(opts);
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", async () => {
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v ?? "")]));
      try {
        const out = await fake.fetch(`${SANDBOX_ORIGIN}${req.url}`, { method: req.method, headers, body: body as BodyInit | undefined });
        const buf = Buffer.from(await out.arrayBuffer());
        out.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "content-length") res.setHeader(key, value);
        });
        res.statusCode = out.status;
        res.end(buf);
      } catch (err) {
        res.statusCode = 502;
        res.end(JSON.stringify({ name: "FAKE_PAYPAL_ERROR", message: String(err) }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const { port: boundPort } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${boundPort}`,
    fake,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
