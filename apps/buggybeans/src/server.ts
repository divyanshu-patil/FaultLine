import type { AddressInfo } from "node:net";
import { CATALOG, createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { loadEnv, parseFlags } from "./env.ts";
import { createPayPal } from "./paypal.ts";

const env = loadEnv();
const flags = parseFlags(env.BUGS);

const app = createApp({
  db: openDb(env.SQLITE_PATH, flags),
  paypal: createPayPal({ base: env.PAYPAL_API_BASE, clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET }),
  flags,
  clientId: env.PAYPAL_CLIENT_ID,
  webhookId: env.PAYPAL_WEBHOOK_ID,
  probeToken: env.PROBE_TOKEN,
  base: new URL(env.PUBLIC_URL).pathname.replace(/\/+$/, ""),
  catalog: CATALOG,
});

const server = app.listen(env.PORT, env.HOST, () => {
  const { port } = server.address() as AddressInfo;
  console.log(JSON.stringify({ msg: "listening", port, instance: env.INSTANCE_ID }));
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
