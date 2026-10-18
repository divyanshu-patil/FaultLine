# 12. Security and safety

FaultLine is an attack tool. Its safety case rests on four things: **sandbox only**, **owned targets only**, **AI never judges**, **AI code runs only in throwaway copies**.

## 1. Threat model (summary)

| Asset | Threat | Control |
| --- | --- | --- |
| Third-party stores | FaultLine used to attack a store the user does not own | hosted mode: BuggyBeans only; selfhost: ownership token (§3); SSRF guard |
| Real money | accidental production calls | sandbox host allowlist at boot and per request; CI grep; no production credentials accepted (client IDs are validated by calling the sandbox token endpoint at boot) |
| PayPal/Ollama/DB secrets | leakage to browser, logs, reports, model | server-only env; redaction; CI bundle grep; reports built from redacted summaries |
| FaultLine host | AI-written patch runs malicious code | patch guard (§5), throwaway instance with minimal env, time limits |
| Agent integrity | prompt injection from store code/trace | untrusted tags, closed tool set, arg allowlists, verdicts never model-controlled (`docs/06` §10) |
| Budget | strangers burning Ollama/PayPal quota | access codes, rate limits, one active run per session, budgets |
| Judges' trust | overclaiming | real-vs-simulated labels; template/reference labels; evidence validation |

## 2. Sandbox-only rule

- `@faultline/paypal/allowlist`: `PAYPAL_API_HOST` must equal `https://api-m.sandbox.paypal.com`; otherwise the process exits with a clear error.
- The fault proxy builds upstream URLs only through the allowlist; paths are matched against `docs/07` §8.
- `scripts/check-no-prod-host.sh` in CI.
- The UI always shows the SANDBOX ONLY badge.

## 3. Target ownership (self-host mode)

1. Only enabled when `FAULTLINE_MODE=selfhost` and `ALLOW_EXTERNAL_TARGETS=true`.
2. Verification token: 32 random bytes, shown once, stored hashed; served by the target at `/.well-known/faultline-verify.txt`.
3. SSRF guard: resolve the host; refuse private, loopback, link-local and metadata ranges unless the host is literally `localhost` in selfhost mode; refuse redirects to other hosts during verification.
4. Rate limits per target: max 1 run at a time; attacks generate a handful of requests (no load testing).
5. The target's own sandbox app and webhook must point at the FaultLine engine; FaultLine never asks for the target's PayPal credentials.

## 4. Secrets handling

- Env only; `.env` git-ignored; `.env.example` has names only.
- Redaction applied before any DB write of traces (`Authorization`, `client_secret`, `access_token`, `password`, cookies, `PAYPAL-TRANSMISSION-SIG` hashed).
- The sandbox buyer password is used only by the Playwright buyer, never logged; screenshots of the PayPal login page are **not** stored (the buyer masks the step: screenshot taken after login).
- Patched and baseline BuggyBeans instances receive only: their port, URLs, `BUGS`, SQLite path, the BuggyBeans sandbox app credentials, `PAYPAL_WEBHOOK_ID`, `PROBE_TOKEN`. Never `DATABASE_URL`, `OLLAMA_API_KEY`, `SESSION_SECRET`, buyer credentials.
- Model prompts never include secrets; `validatePromptNoSecrets()` scans for known secret values before sending (defence in depth).

## 5. Patch guard and execution

Guard (`@faultline/patch/guard`), all must pass:
1. Diff parses; applies cleanly to the rendered variant source.
2. Files ⊆ `affected_files ∪ {db.ts}` ⊆ BuggyBeans allowlist (`routes/*.ts`, `db.ts`, `public/checkout.js`).
3. ≤ 120 changed lines; no binary; no new files except none (MVP).
4. Imports only from `express`, `better-sqlite3`, `zod`, `node:crypto`, and existing relative modules.
5. Forbidden tokens: `child_process`, `exec`, `spawn`, `eval`, `new Function`, `Function(`, `require(` (ESM only), `process.env.` assignments, `fs.` writes/removes, `net.`, `dgram`, `http.request`/`https.request`/`fetch(` to any literal host other than the existing PayPal client base, `__crashtest` route edits, `BUGS`.
6. Must not change `src/probe.ts` (probe stays honest).

Execution: patched source is compiled and started as a child process with the minimal env (§4), `--max-old-space-size=256`, wall-clock limit 10 minutes, killed after verification. Temp directories removed. Log output captured (first 20 KB).

Residual risk (stated in README): the guard is a deny/allow list, not a sandbox; for the hosted demo the only patched code is generated against BuggyBeans by our own agent, and the container holds no long-lived secrets beyond the sandbox app and DB URL. A container-level sandbox (gVisor, Firecracker) is future work.

## 6. Web security

- Session cookie httpOnly, Secure, SameSite=Lax, signed; same-origin via rewrite.
- CSRF: state-changing routes require the custom header `x-fl-csrf: 1` (set by `lib/api.ts`) and same-origin `Origin` check.
- `helmet` defaults; CSP on `apps/web` (no inline scripts except Next's nonce).
- Report pages are public but contain only redacted data; slugs are unguessable.

## 7. Data minimisation

- Only sandbox data. No real customer data is ever processed.
- Webhook raw bodies are kept for replay; shown in the UI only with signatures hashed.

## 8. Responsible-use note (README)

"FaultLine sends unusual but low-volume traffic to stores you own, in PayPal's sandbox. Do not point it at stores you do not own or at production."
