import { describe, expect, it } from "vitest";
import { EXPECTED_MATRIX, BUG_FOR_ATTACK } from "@faultline/core";
import { OFFLINE_ATTACKS, runOffline } from "../src/offline.ts";

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
