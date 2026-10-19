// FaultLine CLI: crash-test an external store that implements the integration contract (docs/21).
// Built to a standalone bundle for `npx` (see package.json "build"); run from source in dev.
import { getAttack } from "@faultline/core";
import { createExternalHarness, EXTERNAL_ATTACKS } from "@faultline/engine/external";
import type { AttackId, CatalogItem } from "@faultline/schemas";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    }
  }
  return out;
}

const HELP = `faultline — crash-test a PayPal checkout integration (sandbox only)

Usage:
  faultline test --store <url> --probe-token <token> [options]
  faultline attacks

Options for 'test':
  --store <url>          Base URL of your store (implements the contract in docs/21)
  --probe-token <token>  Bearer token your store's state probe expects
  --attacks <ids>        Comma-separated subset (default: ${EXTERNAL_ATTACKS.join(",")})
  --host <host>          Host FaultLine binds its simulated PayPal + proxy to (default 127.0.0.1)
  --paypal-port <n>      Stable port for the simulated PayPal (default: ephemeral)
  --proxy-port <n>       Stable port for the webhook proxy (default: ephemeral)
  --sku <sku>            SKU the buyer purchases (default: house-blend)
  --json                 Emit JSON instead of a table
  --fail-on-findings     Exit non-zero if any bug is found (for CI gates)

Point your store's PAYPAL_API_BASE at the simulated-PayPal URL this prints, send
its webhooks to <that URL>/.. via the proxy, and expose the state probe. Verdicts
come from deterministic checks, never from an AI. Sandbox only.`;

async function main() {
  // Drop a leading `--` that `pnpm run <script> -- <args>` forwards verbatim.
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") return void console.log(HELP);

  if (cmd === "attacks") {
    for (const id of EXTERNAL_ATTACKS) {
      const a = getAttack(id);
      console.log(`${id}  ${a.name}  (checks: ${a.invariants.join(", ")})`);
    }
    return;
  }

  if (cmd !== "test") {
    console.error(`unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(2);
  }

  const args = parseArgs(rest);
  const store = args.store as string;
  const probeToken = args["probe-token"] as string;
  if (!store || !probeToken) {
    console.error("error: --store and --probe-token are required\n");
    console.log(HELP);
    process.exit(2);
  }
  const requested = (args.attacks ? String(args.attacks).split(",") : EXTERNAL_ATTACKS).map((s) => s.trim().toUpperCase()) as AttackId[];
  const unknown = requested.filter((a) => !EXTERNAL_ATTACKS.includes(a));
  if (unknown.length) {
    console.error(`error: ${unknown.join(", ")} not runnable against an external store (offline set: ${EXTERNAL_ATTACKS.join(", ")})`);
    process.exit(2);
  }

  const harness = await createExternalHarness({
    host: (args.host as string) ?? "127.0.0.1",
    paypalPort: args["paypal-port"] ? Number(args["paypal-port"]) : undefined,
    proxyPort: args["proxy-port"] ? Number(args["proxy-port"]) : undefined,
  });

  if (!args.json) {
    console.log(`\nSimulated PayPal (sandbox): ${harness.paypalBase}`);
    console.log(`Webhook id:                 ${harness.webhookId}`);
    console.log(`Point your store's PAYPAL_API_BASE at the URL above. Checker verdicts only — never the AI.\n`);
  }

  const item: CatalogItem | undefined = args.sku ? { sku: String(args.sku), name: String(args.sku), price: "12.00", currency: "USD", creditsPerItem: 100 } : undefined;
  const results: { attackId: AttackId; failed: string[]; error?: string }[] = [];
  for (const attackId of requested) {
    try {
      const r = await harness.run(attackId, { base: store, probeToken, item });
      results.push({ attackId, failed: r.failed });
    } catch (err) {
      results.push({ attackId, failed: [], error: (err as Error).message });
    }
  }
  await harness.close();

  if (args.json) {
    console.log(JSON.stringify({ store, backend: "simulated", results }, null, 2));
  } else {
    console.log("ATTACK  RESULT");
    for (const r of results) {
      if (r.error) console.log(`${r.attackId.padEnd(6)}  error: ${r.error}`);
      else if (r.failed.length) console.log(`${r.attackId.padEnd(6)}  BUG — failed ${r.failed.join(", ")}  (${getAttack(r.attackId).name})`);
      else console.log(`${r.attackId.padEnd(6)}  ok — no invariant failed`);
    }
    const bugs = results.filter((r) => r.failed.length).length;
    const errored = results.filter((r) => r.error).length;
    console.log(`\n${bugs} bug${bugs === 1 ? "" : "s"} found, ${errored} attack${errored === 1 ? "" : "s"} errored, of ${results.length} run. Sandbox only.`);
  }

  const bugs = results.filter((r) => r.failed.length).length;
  const errored = results.filter((r) => r.error).length;
  if (errored) process.exit(1);
  if (args["fail-on-findings"] && bugs) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
