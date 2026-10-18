import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Ctx } from "../app.ts";

// The state probe FaultLine reads (docs/09 §3). Read-only; patches may never change this file.
export function probeRoutes(ctx: Ctx): Router {
  const r = Router();
  const expected = Buffer.from(`Bearer ${ctx.probeToken}`);

  r.use("/__crashtest", (req, res, next) => {
    const got = Buffer.from(req.get("authorization") ?? "");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return res.status(401).json({ error: "unauthorized" });
    next();
  });

  r.get("/__crashtest/state", (_req, res) => {
    res.json({ storeTime: new Date().toISOString(), ...ctx.db.snapshot() });
  });

  r.get("/__crashtest/catalog", (_req, res) => {
    res.json(ctx.catalog.map(({ sku, name, price, currency, creditsPerItem }) => ({ sku, name, price, currency, creditsPerItem })));
  });

  return r;
}
