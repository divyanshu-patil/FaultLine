import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  POLL_MS: z.coerce.number().int().default(1500),
  LEASE_SECONDS: z.coerce.number().int().default(120),
  PAYPAL_BACKEND: z.enum(["simulated", "live"]).default("simulated"),
  OLLAMA_API_KEY: z.string().default(""),
  OLLAMA_HOST: z.string().default("https://ollama.com"),
  OLLAMA_MODEL: z.string().default("gemma4:31b"),
});

export type WorkerEnv = z.infer<typeof Env>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    console.error(JSON.stringify({ msg: "invalid worker environment", issues: parsed.error.issues.map((i) => i.path.join(".")) }));
    process.exit(1);
  }
  return parsed.data;
}
