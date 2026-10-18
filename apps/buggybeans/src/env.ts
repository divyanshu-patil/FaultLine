import { z } from "zod";

const FLAG_IDS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "INJECT"] as const;
export type Flags = Record<(typeof FLAG_IDS)[number], boolean>;

export function parseFlags(raw: string | undefined): Flags {
  const on = new Set((raw ?? "").split(",").map((s) => s.trim().toUpperCase()));
  return Object.fromEntries(FLAG_IDS.map((id) => [id, on.has(id)])) as Flags;
}

const Env = z.object({
  PORT: z.coerce.number().int().min(0).default(4200),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_URL: z.string().url().default("http://localhost:4200"),
  INSTANCE_ID: z.string().default("public"),
  SQLITE_PATH: z.string().default(":memory:"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_WEBHOOK_ID: z.string().default(""),
  PAYPAL_API_BASE: z.string().url(),
  PROBE_TOKEN: z.string().min(16),
  BUGS: z.string().default(""),
});

export function loadEnv(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    console.error(JSON.stringify({ msg: "invalid environment", issues: parsed.error.issues.map((i) => i.path.join(".")) }));
    process.exit(1);
  }
  return parsed.data;
}
