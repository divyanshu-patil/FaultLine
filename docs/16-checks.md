# 16. Checks — quality gates

Tick these lists literally. Each item is a yes/no question.

## 1. Every pull request

- [ ] Task ID and acceptance criteria IDs in the PR description.
- [ ] `pnpm check` green locally.
- [ ] New logic has tests at the right level (`docs/15` §3).
- [ ] No new PayPal endpoint, field, event or error code without `docs/07` updated (with mark).
- [ ] No secret in code, tests, fixtures or logs; fixtures redacted.
- [ ] zod validation on every new boundary.
- [ ] No production PayPal host; sandbox allowlist untouched or tightened.
- [ ] UI changes follow `docs/design.md`; loading/empty/error states present.
- [ ] Docs updated if routes, env vars, tables or behaviour changed.

## 2. CI (automatic)

- [ ] lint, typecheck, unit, integration, worker tests
- [ ] `check-no-prod-host.sh`
- [ ] gitleaks
- [ ] web bundle secret grep
- [ ] UI e2e (fakes) incl. axe
- [ ] `eval:bugs --offline` matrix = 0 deviations

## 3. End of each phase gate

- [ ] Gate criteria in `docs/13` met and written in `docs/18` (go/no-go record) with date.
- [ ] Any ⚠️/❓ settled by spikes updated in `docs/07` and `docs/06`.
- [ ] Cut decisions recorded.

## 4. Pre-demo (before recording and before submission)

- [ ] Hosted URLs load: web, report, public BuggyBeans.
- [ ] Engine health OK; engine not sleeping (paid instance).
- [ ] PayPal sandbox webhook URL = hosted engine `/hooks/paypal`; a test purchase produces correlated deliveries.
- [ ] Sandbox buyer login works (or FB1 state fresh).
- [ ] Ollama key valid; `OLLAMA_MODEL` responds; health probe OK.
- [ ] Supabase project active (not paused); migrations at head.
- [ ] `demo:rehearse --times 5` all green on hosted.
- [ ] Pinned demo report exists and opens without login.
- [ ] Access code for judges works; rate limits not too tight for judges.
- [ ] README instructions tested from a fresh clone.

## 5. Pre-submission (Wed 11 Nov)

- [ ] Repo public; LICENSE file; licence shown in GitHub About.
- [ ] README: what it is, how to run, how to test, real vs simulated, limitations, architecture diagram, sponsor tools used (Render), model used.
- [ ] Video < 3:00, public on YouTube, shows the project working end to end; no copyrighted music; no third-party trademarks beyond fair reference (rules ✅).
- [ ] Devpost: text description, video link, repo link, hosted demo URL, testing instructions with access code, built-with list, images.
- [ ] Explicit statement that the project is new (built after 1 Oct 2026).
- [ ] Eligibility re-checked against rules (country, age) ✅ excluded list in `judging.md`.
- [ ] All claims in text/video match measured results with dates (eval results file committed).
- [ ] No secrets in git history (gitleaks on full history).
- [ ] Submitted before Wed 11 Nov 18:00 IST; confirmation email received.

## 6. Judging window (1–15 Dec)

- [ ] 28–30 Nov: upgrade instances; rehearsal ×3.
- [ ] Daily: health check, one rehearsal run, Supabase active, Render credits remaining.
- [ ] Weekly: refresh buyer login state (if FB1).
- [ ] Incident note: if the demo breaks, the pinned report and the video still show the full loop.
