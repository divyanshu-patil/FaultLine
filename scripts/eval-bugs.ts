// Offline bug-detection matrix: buggy vs fixed store, checker verdicts vs the expected matrix.
// Covers the attacks that need no operator forge/fault hook (A3, A4 are skipped by design).
import { mkdirSync, writeFileSync } from "node:fs";
import { OFFLINE_ATTACKS, runOffline } from "@faultline/engine";
import { EXPECTED_MATRIX, BUG_FOR_ATTACK, getAttack } from "@faultline/core";

const rows = [];
let ok = true;
for (const attackId of OFFLINE_ATTACKS) {
  const expected = [...EXPECTED_MATRIX.own[attackId]].sort();
  const buggy = await runOffline(attackId, BUG_FOR_ATTACK[attackId]);
  const fixed = await runOffline(attackId, "");
  const detected = buggy.failed.slice().sort();
  const pass = JSON.stringify(detected) === JSON.stringify(expected) && fixed.failed.length === 0;
  ok = ok && pass;
  rows.push({ attackId, name: getAttack(attackId).name, expected, detected, fixedClean: fixed.failed.length === 0, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${attackId}  ${getAttack(attackId).name}`);
  console.log(`      expected ${expected.join(",") || "-"} | buggy ${detected.join(",") || "-"} | fixed ${fixed.failed.join(",") || "clean"}`);
}
mkdirSync("eval/results", { recursive: true });
writeFileSync("eval/results/bugs.json", JSON.stringify({ at: new Date().toISOString(), skipped: ["A3", "A4"], rows }, null, 2) + "\n");
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} attacks matched the expected matrix. (A3, A4 skipped: need operator hooks.)`);
process.exit(ok ? 0 : 1);
