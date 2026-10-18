import { describe, expect, it } from "vitest";
import { applyPatch, diffFiles, extractDiff, guardPatch, parseUnifiedDiff, renderVariant } from "../src/index.ts";

const src = `import type { Ctx } from "../app.ts";

export function handler(ctx: Ctx) {
  let amount = price;
  if (ctx.flags.B5) {
    if (body.amount) {
      amount = body.amount; // "{ not a brace"
    }
  }
  if (ctx.flags.B1) {
    insert(event);
  } else {
    if (!once(event)) {
      return;
    }
  }
  if (ctx.flags.B6) {
    route("/fulfil");
  }
  return amount;
}
`;

describe("renderVariant (docs/10 §6, AC-42)", () => {
  it("keeps the fixed branch when bugs are off and leaves no switch behind", () => {
    const out = renderVariant(src, new Set());
    expect(out).not.toMatch(/flags\./);
    expect(out).toContain("  if (!once(event)) {\n    return;\n  }\n  return amount;");
    expect(out).not.toContain("body.amount");
    expect(out).not.toContain("/fulfil");
  });

  it("keeps the buggy branch when a bug is on", () => {
    const out = renderVariant(src, new Set(["B1", "B5", "B6"]));
    expect(out).not.toMatch(/flags\./);
    expect(out).toContain("  if (body.amount) {\n    amount = body.amount;");
    expect(out).toContain("  insert(event);\n");
    expect(out).toContain('  route("/fulfil");');
    expect(out).not.toContain("once(event)");
  });
});

const files = {
  "src/routes/webhooks.ts": "import { Router } from \"express\";\n\nexport function hooks() {\n  const r = Router();\n  r.post(\"/x\", (req, res) => {\n    grant(req.body);\n    res.json({ ok: true });\n  });\n  return r;\n}\n",
  "src/db.ts": "export const schema = `CREATE TABLE entitlements(order_id TEXT)`;\n",
  "src/routes/probe.ts": "export const probe = 1;\n",
};

const goodDiff = `Here is the fix:
\`\`\`diff
--- a/src/routes/webhooks.ts
+++ b/src/routes/webhooks.ts
@@ -40,3 +40,5 @@
   r.post("/x", (req, res) => {
+    if (seen.has(req.body.id)) return res.json({ ok: true });
+    seen.add(req.body.id);
     grant(req.body);
\`\`\`
`;

describe("diff apply", () => {
  it("applies by content even with wrong line numbers", () => {
    const patches = parseUnifiedDiff(extractDiff(goodDiff));
    const out = applyPatch(files, patches);
    expect(out["src/routes/webhooks.ts"]).toContain("    seen.add(req.body.id);\n    grant(req.body);");
  });

  it("round-trips a generated reference diff", () => {
    const after = { ...files, "src/db.ts": "export const schema = `CREATE TABLE entitlements(order_id TEXT UNIQUE)`;\n" };
    const diff = diffFiles(files, after);
    expect(diff).toContain("+export const schema = `CREATE TABLE entitlements(order_id TEXT UNIQUE)`;");
    expect(applyPatch(files, parseUnifiedDiff(diff))["src/db.ts"]).toBe(after["src/db.ts"]);
  });
});

function diffAdding(line: string, path = "src/routes/webhooks.ts") {
  return `--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,2 @@\n import { Router } from "express";\n+${line}\n`;
}

describe("patch guard (T-PATCH-guard, AC-53)", () => {
  const affected = ["src/routes/webhooks.ts"];

  it("accepts a small correct patch", () => {
    const r = guardPatch(extractDiff(goodDiff), files, affected);
    expect(r.reasons).toEqual([]);
    expect(r.passed).toBe(true);
  });

  const cases: [string, string, RegExp][] = [
    ["child_process", 'import { exec } from "child_process";', /child_process/],
    ["exec", "exec('ls');", /exec\(/],
    ["spawn", "spawn('sh');", /spawn\(/],
    ["eval", "eval(code);", /eval\(/],
    ["Function", "const f = new Function('x');", /Function constructor/],
    ["require", "const x = require('x');", /require\(/],
    ["env write", "process.env.PAYPAL_API_BASE = 'x';", /process.env assignment/],
    ["env read", "const k = process.env.OLLAMA_API_KEY;", /process.env read/],
    ["fs", 'import { rmSync } from "node:fs";', /filesystem/],
    ["net", 'import net from "node:net";', /raw sockets/],
    ["http.request", "https.request('x');", /http.request/],
    ["literal fetch", "await fetch('https://evil.example/x');", /literal host/],
    ["probe", "app.get('/__crashtest/state', h);", /probe route/],
    ["switches", "if (flags.B1) {}", /bug switches/],
    ["import", 'import axios from "axios";', /import not allowed/],
    ["relative import", 'import x from "./missing.ts";', /does not exist/],
  ];
  it.each(cases)("rejects %s", (_name, line, reason) => {
    const r = guardPatch(diffAdding(line), files, affected);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(" | ")).toMatch(reason);
  });

  it("rejects files outside the allowlist or the diagnosis", () => {
    expect(guardPatch(diffAdding("x", "src/routes/probe.ts"), files, affected).reasons.join()).toMatch(/file not allowed/);
    expect(guardPatch(diffAdding("x", "public/checkout.js"), { ...files, "public/checkout.js": 'import { Router } from "express";\n' }, affected).reasons.join()).toMatch(/affected files/);
  });

  it("allows db.ts even when the diagnosis did not list it", () => {
    const d = `--- a/src/db.ts\n+++ b/src/db.ts\n@@ -1 +1 @@\n-export const schema = \`CREATE TABLE entitlements(order_id TEXT)\`;\n+export const schema = \`CREATE TABLE entitlements(order_id TEXT UNIQUE)\`;\n`;
    expect(guardPatch(d, files, affected).passed).toBe(true);
  });

  it("rejects oversized, empty, unparseable and non-applying patches", () => {
    const big = `--- a/src/routes/webhooks.ts\n+++ b/src/routes/webhooks.ts\n@@ -1 +1 @@\n import { Router } from "express";\n${Array.from({ length: 121 }, (_, i) => `+const v${i} = ${i};`).join("\n")}\n`;
    expect(guardPatch(big, files, affected).reasons.join()).toMatch(/max 120/);
    expect(guardPatch("not a diff", files, affected).reasons.join()).toMatch(/does not parse/);
    const stale = `--- a/src/routes/webhooks.ts\n+++ b/src/routes/webhooks.ts\n@@ -1 +1,2 @@\n line that is not there\n+x();\n`;
    expect(guardPatch(stale, files, affected).reasons.join()).toMatch(/does not apply/);
    const created = `--- /dev/null\n+++ b/src/routes/webhooks.ts\n@@ -0,0 +1 @@\n+x\n`;
    expect(guardPatch(created, files, affected).passed).toBe(false);
  });
});
