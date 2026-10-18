import { DatabaseSync } from "node:sqlite";
import type { Flags } from "./env.ts";

export type Status = "created" | "approved" | "pending_capture" | "paid" | "fulfilled" | "failed" | "abandoned";
export type Order = {
  id: string;
  paypal_order_id: string;
  sku: string;
  qty: number;
  amount: string;
  currency: string;
  status: Status;
  capture_id: string | null;
  created_at: string;
  updated_at: string;
};

export function openDb(path: string, flags: Flags) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS orders(
    id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE, sku TEXT NOT NULL, qty INTEGER NOT NULL, amount TEXT NOT NULL,
    currency TEXT NOT NULL, status TEXT NOT NULL, capture_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  if (flags.B1) {
    db.exec(`CREATE TABLE IF NOT EXISTS entitlements(
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, credits INTEGER NOT NULL, source TEXT NOT NULL,
      ref TEXT, granted_at TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS webhook_events(
      event_id TEXT NOT NULL, type TEXT NOT NULL, received_at TEXT NOT NULL, outcome TEXT NOT NULL)`);
  } else {
    db.exec(`CREATE TABLE IF NOT EXISTS entitlements(
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL UNIQUE, credits INTEGER NOT NULL, source TEXT NOT NULL,
      ref TEXT, granted_at TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS webhook_events(
      event_id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TEXT NOT NULL, outcome TEXT NOT NULL)`);
  }

  const now = () => new Date().toISOString();

  return {
    insertOrder(o: { id: string; paypalOrderId: string; sku: string; qty: number; amount: string; currency: string }) {
      const t = now();
      db.prepare(`INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, 'created', NULL, ?, ?)`).run(o.id, o.paypalOrderId, o.sku, o.qty, o.amount, o.currency, t, t);
    },

    orderByPayPalId(paypalOrderId: string): Order | undefined {
      return db.prepare(`SELECT * FROM orders WHERE paypal_order_id = ?`).get(paypalOrderId) as Order | undefined;
    },

    setStatus(orderId: string, status: Status, captureId: string | null = null) {
      db.prepare(`UPDATE orders SET status = ?, capture_id = COALESCE(?, capture_id), updated_at = ? WHERE id = ?`).run(status, captureId, now(), orderId);
    },

    grantCredits(orderId: string, credits: number, source: "capture" | "webhook" | "fulfil", ref: string | null) {
      if (flags.B1) {
        db.prepare(`INSERT INTO entitlements (order_id, credits, source, ref, granted_at) VALUES (?, ?, ?, ?, ?)`).run(orderId, credits, source, ref, now());
      } else {
        db.prepare(
          `INSERT INTO entitlements (order_id, credits, source, ref, granted_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(order_id) DO NOTHING`,
        ).run(orderId, credits, source, ref, now());
      }
    },

    /** Records an event. Returns false when this event id was already recorded. */
    recordEvent(eventId: string, type: string, outcome: "processed" | "ignored" | "rejected"): boolean {
      const r = db.prepare(`INSERT OR IGNORE INTO webhook_events VALUES (?, ?, ?, ?)`).run(eventId, type, now(), outcome);
      return Number(r.changes) > 0;
    },

    totalCredits(): number {
      return Number((db.prepare(`SELECT COALESCE(SUM(credits), 0) AS c FROM entitlements`).get() as { c: number }).c);
    },

    recentOrders(limit = 10): Order[] {
      return db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit) as Order[];
    },

    snapshot() {
      const orders = db.prepare(`SELECT * FROM orders ORDER BY created_at`).all() as Order[];
      const ents = db.prepare(`SELECT * FROM entitlements ORDER BY id`).all() as { order_id: string; credits: number; source: string; ref: string | null; granted_at: string }[];
      const events = db.prepare(`SELECT * FROM webhook_events ORDER BY received_at`).all() as { event_id: string; type: string; received_at: string; outcome: string }[];
      return {
        orders: orders.map((o) => ({
          storeOrderId: o.id,
          paypalOrderId: o.paypal_order_id,
          sku: o.sku,
          qty: o.qty,
          status: o.status,
          captureId: o.capture_id,
          amount: o.amount,
          currency: o.currency,
          updatedAt: o.updated_at,
        })),
        entitlements: ents.map((e) => ({ storeOrderId: e.order_id, credits: e.credits, source: e.source, grantedAt: e.granted_at, ref: e.ref })),
        webhookEvents: events.map((e) => ({ eventId: e.event_id, type: e.type, receivedAt: e.received_at, outcome: e.outcome })),
      };
    },
  };
}

export type Db = ReturnType<typeof openDb>;
