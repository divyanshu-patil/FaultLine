import { cookies, headers } from "next/headers";


/** Server-side base URL for the API (same origin as the browser, resolved for server fetches). */
async function origin(): Promise<string> {
  if (process.env.API_ORIGIN) return process.env.API_ORIGIN;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function apiFetch(path: string, opts: { authed?: boolean; cache?: RequestCache } = {}): Promise<Response> {
  const url = `${await origin()}${path.startsWith("/api") ? path : `/api${path}`}`;
  const headerBag: Record<string, string> = {};
  if (opts.authed !== false) {
    const jar = await cookies();
    const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
    if (cookie) headerBag.cookie = cookie;
  }
  return fetch(url, { headers: headerBag, cache: opts.cache ?? "no-store" });
}

export async function getJson<T>(path: string, opts?: { authed?: boolean }): Promise<T | null> {
  const res = await apiFetch(path, opts);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export * from "./types";
