import { createPool, createDb } from "@faultline/db";
import { BUG_PRESETS, BUG_DESCRIPTIONS } from "@faultline/core";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const pool = await createPool(url);
const db = createDb(pool);

const describe = (bugs: readonly string[]) =>
  bugs.length ? `Seeded bugs (hidden from the AI): ${bugs.join(", ")}` : "Fixed store — expect every check to pass";

const presets: { slug: string; name: string; bugs: readonly string[] }[] = [
  { slug: "buggybeans:demo", name: "BuggyBeans — demo", bugs: BUG_PRESETS.demo },
  { slug: "buggybeans:all", name: "BuggyBeans — all bugs", bugs: BUG_PRESETS.all },
  { slug: "buggybeans:fixed", name: "BuggyBeans — fixed", bugs: BUG_PRESETS.none },
];

for (const p of presets) {
  await db.upsertTarget({ slug: p.slug, kind: "buggybeans", name: p.name, description: describe(p.bugs), bugs: [...p.bugs] });
}
console.log(`seeded ${presets.length} targets`);
void BUG_DESCRIPTIONS;
await pool.end();
