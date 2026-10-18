import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, migrate } from "@faultline/db";
import { executeRun } from "../src/run.ts";

// Checklist-mode orchestration over a real in-process engine + PGlite (no AI, no live PayPal).
describe("worker executeRun (T-WK-run)", () => {
  const pg = new PGlite();
  const db = createDb(pg);
  let targetId = "";

  beforeAll(async () => {
    await migrate(pg);
    targetId = (await db.upsertTarget({ slug: "buggybeans:demo", kind: "buggybeans", name: "Demo", description: "", bugs: ["B1", "B3", "B4", "B5", "B7"] }))!.id;
  });

  it("runs the demo preset, records the expected findings and a report, and skips A3/A4", async () => {
    const run = (await db.createRun({ targetId, sessionId: null, mode: "checklist", budget: {}, allowedAttacks: ["A1", "A3", "A4", "A5", "A7", "A8"], model: null }))!;
    await db.claimJob("test", 120);
    await executeRun(run.id, { db, ollama: null, backend: "simulated" });

    const detail = await db.getRun(run.id);
    expect(detail!.status).toBe("completed");

    const findings = await db.listFindings(run.id);
    const got = Object.fromEntries(findings.map((f) => [f.attackId, [...f.failedInvariants].sort()]));
    expect(got).toEqual({ A1: ["I2"], A5: ["I3"], A7: ["I7"], A8: ["I6"] });

    const report = await db.getReportForRun(run.id);
    expect(report).not.toBeNull();
    const events = await db.listEvents(run.id, 0);
    expect(events.some((e) => e.kind === "info" && String(e.payload.summary).includes("A3, A4"))).toBe(true);
  }, 30000);
});
