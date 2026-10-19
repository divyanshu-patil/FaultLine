import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG, createApp } from "buggybeans/src/app.ts";
import { openDb } from "buggybeans/src/db.ts";
import { parseFlags } from "buggybeans/src/env.ts";
import { createPayPal } from "buggybeans/src/paypal.ts";
import { EXPECTED_MATRIX, BUG_FOR_ATTACK } from "@faultline/core";
import { createExternalHarness, EXTERNAL_ATTACKS, listen, type ExternalHarness } from "../src/index.ts";

// Drives a real BuggyBeans HTTP server (the reference store) through the external harness: BuggyBeans talks to
// FaultLine's simulated PayPal over HTTP, and FaultLine disturbs the webhooks and runs the deterministic checker.
const PROBE = "probe-token-0123456789";

describe("external store harness (T-ENG-external)", () => {
  let harness: ExternalHarness;
  beforeAll(async () => {
    harness = await createExternalHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  async function startStore(bugs: string) {
    const flags = parseFlags(bugs);
    const store = createApp({
      db: openDb(":memory:", flags),
      paypal: createPayPal({ base: harness.paypalBase, clientId: "id", secret: "secret" }),
      flags,
      clientId: "id",
      webhookId: harness.webhookId,
      probeToken: PROBE,
      base: "",
      catalog: CATALOG,
    });
    return listen(store);
  }

  for (const attackId of EXTERNAL_ATTACKS) {
    it(`${attackId}: buggy store fails the expected invariants over HTTP, fixed store passes`, async () => {
      const buggySrv = await startStore(BUG_FOR_ATTACK[attackId]);
      const fixedSrv = await startStore("");
      try {
        const buggy = await harness.run(attackId, { base: `http://127.0.0.1:${buggySrv.port}`, probeToken: PROBE });
        const fixed = await harness.run(attackId, { base: `http://127.0.0.1:${fixedSrv.port}`, probeToken: PROBE });
        expect(buggy.failed.sort()).toEqual([...EXPECTED_MATRIX.own[attackId]].sort());
        expect(fixed.failed).toEqual([]);
      } finally {
        buggySrv.close();
        fixedSrv.close();
      }
    }, 25000);
  }
});
