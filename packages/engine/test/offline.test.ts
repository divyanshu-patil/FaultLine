import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPECTED_MATRIX, BUG_FOR_ATTACK } from "@faultline/core";
import { parseBugList, renderVariant } from "@faultline/patch";
import { OFFLINE_ATTACKS, runOffline, verifyOffline } from "../src/offline.ts";

// End-to-end: real BuggyBeans + FakePayPal + proxy + the real checker, buggy vs fixed store.
describe("offline attack runner (T-ENG-offline)", () => {
  for (const attackId of OFFLINE_ATTACKS) {
    it(`${attackId}: buggy store fails the expected invariants, fixed store passes`, async () => {
      const bug = BUG_FOR_ATTACK[attackId];
      const buggy = await runOffline(attackId, bug);
      const fixed = await runOffline(attackId, "");
      expect(buggy.failed.sort()).toEqual([...EXPECTED_MATRIX.own[attackId]].sort());
      expect(fixed.failed).toEqual([]);
    }, 20000);
  }
});

// Patch verification: re-run the same attack on a store built from patched source (A5/B5 lives only in orders.ts).
describe("offline patch verification (T-ENG-verify)", () => {
  const srcDir = dirname(fileURLToPath(import.meta.resolve("buggybeans/src/app.ts")));
  const fixedOrders = () => renderVariant(readFileSync(join(srcDir, "routes/orders.ts"), "utf8"), parseBugList(""));

  it("rejects a no-op patch: the bug still fails on re-run", async () => {
    const r = await verifyOffline("A5", "B5", {});
    expect(r.verified).toBe(false);
    expect(r.failed).toContain("I3");
  }, 20000);

  it("verifies a real fix: the patched store passes every invariant", async () => {
    const r = await verifyOffline("A5", "B5", { "src/routes/orders.ts": fixedOrders() });
    expect(r.verified).toBe(true);
    expect(r.failed).toEqual([]);
  }, 20000);
});
