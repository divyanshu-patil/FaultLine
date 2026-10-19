// Capture README screenshots from the running web app (API on :4000, web on :3000).
// Usage: node scripts/shots.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const WEB = process.env.WEB_ORIGIN || "http://localhost:3000";
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// log in so the authed pages render (demo code)
await page.goto(`${WEB}/login`);
await page.fill('input[type="password"]', "demo");
await Promise.all([page.waitForURL(/\/runs\/new/), page.click("button.btn.ember")]);

const pinned = await (await fetch(`${WEB}/api/reports/pinned`)).json();

// Create a real agent run in this browser session (so run/finding shots are from a live run,
// not the pinned demo) and wait for it to finish. Agent output varies, so retry until a run
// produces a verified AI patch (for the before/after proof shot). Overridable with RUN_ID/FINDING_ID.
async function runOnce() {
  const created = await page.evaluate(async () => {
    const r = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json", "x-fl-csrf": "1" }, body: JSON.stringify({ targetId: "buggybeans:demo", mode: "agent" }) });
    return r.status === 202 ? await r.json() : { error: `${r.status} ${await r.text()}` };
  });
  if (created.error) throw new Error(`create run failed: ${created.error}`);
  for (let i = 0; i < 90; i++) {
    const run = await page.evaluate(async (id) => await (await fetch(`/api/runs/${id}`)).json(), created.runId);
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      const report = run.reportSlug ? await page.evaluate(async (s) => await (await fetch(`/api/reports/${s}`)).json(), run.reportSlug) : null;
      const verified = report?.findings?.find((f) => f.patch?.status === "verified");
      return { runId: created.runId, findingId: verified?.id ?? run.findings?.[0]?.id ?? null, hasVerified: !!verified };
    }
    await page.waitForTimeout(2000);
  }
  return { runId: created.runId, findingId: null, hasVerified: false };
}

async function captureRealRun() {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await runOnce();
    if (last.hasVerified) return last;
    console.log(`run ${last.runId} had no verified patch; retrying (${attempt + 1}/3)`);
  }
  return last;
}

const { runId, findingId } = process.env.RUN_ID
  ? { runId: process.env.RUN_ID, findingId: process.env.FINDING_ID ?? null }
  : await captureRealRun();
console.log(`run ${runId} finding ${findingId}`);

const shots = [
  ["home", `${WEB}/`, 2600],
  ["attacks", `${WEB}/attacks`, 2600],
  ["new-run", `${WEB}/runs/new`, 1400],
  ["report", `${WEB}/reports/${pinned.slug}`, 4200],
  ["about", `${WEB}/about`, 2200],
];
if (runId) shots.push(["run", `${WEB}/runs/${runId}`, 2200]);
if (runId && findingId) shots.push(["finding", `${WEB}/runs/${runId}/findings/${findingId}`, 3000]);

for (const [name, url] of shots) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`shot ${name} <- ${url}`);
}

await browser.close();
console.log("done");
