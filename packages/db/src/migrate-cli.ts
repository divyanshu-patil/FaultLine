import { createPool, migrate } from "./index.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}
const pool = await createPool(url);
const applied = await migrate(pool);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "schema up to date");
await pool.end();
