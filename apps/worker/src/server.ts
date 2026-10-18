import { createPool, createDb } from "@faultline/db";
import { createOllama } from "@faultline/agent";
import { loadEnv } from "./env.ts";
import { executeRun } from "./run.ts";

const env = loadEnv();
const pool = await createPool(env.DATABASE_URL);
const db = createDb(pool);
const ollama = env.OLLAMA_API_KEY ? createOllama({ host: env.OLLAMA_HOST, apiKey: env.OLLAMA_API_KEY, model: env.OLLAMA_MODEL }) : null;

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

console.log(JSON.stringify({ msg: "worker up", id: env.WORKER_ID, backend: env.PAYPAL_BACKEND, ai: !!ollama }));

while (!stopping) {
  const job = await db.claimJob(env.WORKER_ID, env.LEASE_SECONDS);
  if (!job) {
    await new Promise((r) => setTimeout(r, env.POLL_MS));
    continue;
  }
  const runId = String(job.payload.runId);
  const renew = setInterval(() => void db.renewJob(job.id, env.LEASE_SECONDS), (env.LEASE_SECONDS * 1000) / 3);
  try {
    console.log(JSON.stringify({ msg: "run start", runId }));
    await executeRun(runId, { db, ollama, backend: env.PAYPAL_BACKEND });
    await db.finishJob(job.id, "done");
    console.log(JSON.stringify({ msg: "run done", runId }));
  } catch (e) {
    console.error(JSON.stringify({ msg: "run failed", runId, error: String(e) }));
    await db.updateRun(runId, { status: "failed", phase: "done", finished: true, error: { message: String(e) } }).catch(() => undefined);
    await db.addEvent(runId, "error", { message: String(e) }).catch(() => undefined);
    await db.finishJob(job.id, "failed");
  } finally {
    clearInterval(renew);
  }
}
await pool.end();
