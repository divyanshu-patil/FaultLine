import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, migrate } from "../src/index.ts";

describe("db (PGlite, same SQL as Postgres)", () => {
  const pg = new PGlite();
  const db = createDb(pg);
  let targetId = "";

  beforeAll(async () => {
    expect(await migrate(pg)).toEqual(["001_init.sql"]);
    expect(await migrate(pg)).toEqual([]);
    targetId = (await db.upsertTarget({ slug: "buggybeans:demo", kind: "buggybeans", name: "Demo", description: "", bugs: ["B1", "B3"] }))!.id;
  });

  it("creates a run with its job atomically and two workers claim different jobs", async () => {
    const s = (await db.createSession("hash", false, 12))!;
    const r1 = (await db.createRun({ targetId, sessionId: s.id, mode: "checklist", budget: { maxSteps: 1 }, allowedAttacks: ["A1"], model: null }))!;
    const r2 = (await db.createRun({ targetId, sessionId: s.id, mode: "agent", budget: {}, allowedAttacks: ["A1"], model: "gemma4:31b" }))!;
    expect((await db.getRun(r1.id))!.status).toBe("queued");
    expect((await db.activeRun(s.id))!.id).toBe(r2.id);
    const [a, b] = await Promise.all([db.claimJob("w1", 120), db.claimJob("w2", 120)]);
    expect(a!.payload.runId).not.toBe(b!.payload.runId);
    expect(await db.claimJob("w3", 120)).toBeNull();
    const runs = await db.listRuns(s.id, 10);
    expect(runs.map((r) => r.targetSlug)).toEqual(["buggybeans:demo", "buggybeans:demo"]);
  });

  it("orders events and reads them after an id", async () => {
    const run = (await db.createRun({ targetId, sessionId: null, mode: "checklist", budget: {}, allowedAttacks: ["A1"], model: null }))!;
    const e1 = await db.addEvent(run.id, "phase", { phase: "preparing" });
    const e2 = await db.addEvent(run.id, "phase", { phase: "attacking" });
    expect((await db.listEvents(run.id, e1)).map((e) => e.id)).toEqual([e2]);
    expect((await db.requestCancel(run.id))!.status).toBe("cancelled");
  });
});
