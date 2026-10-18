import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import type { Ctx } from "../app.ts";
import type { Order } from "../db.ts";
import { captureOf, issueOf, type PayPalResult } from "../paypal.ts";

const CreateOrder = z.object({
  sku: z.string(),
  qty: z.coerce.number().int().min(1).max(10).default(1),
  amount: z.string().optional(),
});

export function orderRoutes(ctx: Ctx): Router {
  const r = Router();
  const { db, paypal } = ctx;
  const creditsFor = (order: Order) => order.qty * (ctx.catalog.find((c) => c.sku === order.sku)?.creditsPerItem ?? 0);

  r.post("/api/orders", async (req, res) => {
    const body = CreateOrder.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Invalid order" });
    const item = ctx.catalog.find((c) => c.sku === body.data.sku);
    if (!item) return res.status(404).json({ error: "Unknown product" });

    let amount = (Number(item.price) * body.data.qty).toFixed(2);
    if (ctx.flags.B5) {
      if (body.data.amount) {
        amount = body.data.amount;
      }
    }

    const storeOrderId = `o_${randomUUID().slice(0, 8)}`;
    const created = await paypal.createOrder(storeOrderId, amount);
    if (!created.ok || !created.body?.id) return res.status(502).json({ error: "Could not start PayPal checkout" });
    db.insertOrder({ id: storeOrderId, paypalOrderId: created.body.id, sku: item.sku, qty: body.data.qty, amount, currency: "USD" });
    res.json({ id: created.body.id });
  });

  r.post("/api/orders/:id/capture", async (req, res) => {
    const order = db.orderByPayPalId(req.params.id);
    if (!order) return res.status(404).json({ status: "ERROR", message: "Order not found" });
    if (order.status === "paid" || order.status === "fulfilled") return res.json({ status: "COMPLETED" });

    if (ctx.flags.B4) {
      const result = await paypal.capture(order.paypal_order_id);
      if (result.timedOut || result.status >= 500) {
        db.setStatus(order.id, "failed");
        return res.status(502).json({ status: "ERROR", message: "Payment failed. Please try again." });
      }
      return finishCapture(order, result, res);
    } else {
      // The same PayPal-Request-Id on every attempt makes retries safe.
      let result = await paypal.capture(order.paypal_order_id, `capture-${order.paypal_order_id}`);
      for (let attempt = 1; attempt < 3 && (result.timedOut || result.status >= 500); attempt++) {
        result = await paypal.capture(order.paypal_order_id, `capture-${order.paypal_order_id}`);
      }
      if (result.timedOut || result.status >= 500 || issueOf(result.body) === "ORDER_ALREADY_CAPTURED") {
        return reconcile(order, res);
      }
      return finishCapture(order, result, res);
    }
  });

  function finishCapture(order: Order, result: PayPalResult, res: Response) {
    const capture = captureOf(result.body);
    if (ctx.flags.B7) {
      markPaid(order, capture?.id ?? null);
      return res.json({ status: "COMPLETED" });
    } else {
      if (result.ok && result.body?.status === "COMPLETED" && capture?.status === "COMPLETED") {
        markPaid(order, capture.id);
        return res.json({ status: "COMPLETED" });
      }
      if (issueOf(result.body) === "INSTRUMENT_DECLINED") {
        return res.status(422).json({ status: "DECLINED", restart: true, message: "Payment declined. Please try another payment method." });
      }
      return res.status(502).json({ status: "ERROR", message: "Payment could not be completed." });
    }
  }

  async function reconcile(order: Order, res: Response) {
    const truth = await paypal.getOrder(order.paypal_order_id);
    const done = (truth.body?.purchase_units?.[0]?.payments?.captures ?? []).find((c: { status: string }) => c.status === "COMPLETED");
    if (truth.ok && done) {
      markPaid(order, done.id);
      return res.json({ status: "COMPLETED" });
    }
    return res.status(502).json({ status: "ERROR", message: "Payment could not be confirmed." });
  }

  function markPaid(order: Order, captureId: string | null) {
    db.setStatus(order.id, "paid", captureId);
    if (ctx.flags.B1) {
      // Credits are granted by the webhook handler when PayPal confirms the capture.
    } else {
      if (ctx.flags.B8) {
        // Credits are granted by the webhook handler when PayPal confirms the capture.
      } else {
        db.grantCredits(order.id, creditsFor(order), "capture", captureId);
      }
    }
  }

  if (ctx.flags.B6) {
    r.post("/api/orders/:id/fulfil", (req, res) => {
      const order = db.orderByPayPalId(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      db.grantCredits(order.id, creditsFor(order), "fulfil", null);
      db.setStatus(order.id, "fulfilled");
      res.json({ status: "fulfilled" });
    });
  }

  return r;
}
