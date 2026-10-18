import express, { type Express } from "express";
import { fileURLToPath } from "node:url";
import catalog from "./catalog.json" with { type: "json" };
import type { Db } from "./db.ts";
import type { Flags } from "./env.ts";
import type { PayPal } from "./paypal.ts";
import { orderRoutes } from "./routes/orders.ts";
import { pageRoutes } from "./routes/pages.ts";
import { probeRoutes } from "./routes/probe.ts";
import { webhookRoutes } from "./routes/webhooks.ts";

export type Item = (typeof catalog)[number];

export type Ctx = {
  db: Db;
  paypal: PayPal;
  flags: Flags;
  clientId: string;
  webhookId: string;
  probeToken: string;
  /** path prefix when served behind the FaultLine gateway, e.g. "/i/ab12cd" */
  base: string;
  catalog: Item[];
};

export const CATALOG: Item[] = catalog;

export function createApp(ctx: Ctx): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use("/static", express.static(fileURLToPath(new URL("../public", import.meta.url))));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use(pageRoutes(ctx));
  app.use(orderRoutes(ctx));
  app.use(webhookRoutes(ctx));
  app.use(probeRoutes(ctx));
  return app;
}
