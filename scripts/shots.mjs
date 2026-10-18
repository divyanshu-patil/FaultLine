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
const runId = process.env.RUN_ID || await page.evaluate(async () => (await (await fetch("/api/runs?limit=1")).json())[0]?.id);
const findingId = process.env.FINDING_ID || (runId ? await page.evaluate(async (id) => (await (await fetch(`/api/runs/`)).json()).findings?.[0]?.id, runId) : null);

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
