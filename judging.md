# judging.md — rules, criteria and how FaultLine is judged

Sources: official rules at paypalaihackathon.devpost.com/rules and the Devpost overview, read 2026-10-17 and 2026-10-19 (✅). Re-read both before submitting; rules can change.

## 1. Official facts

**What to build** ✅: "build or update an application that integrates the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform of their choice." "Any AI tool works, as long as PayPal integration is central to the project." Overview: "There are no prescribed problem statements and no set of tracks." "The only fundamental requirement: your project must meaningfully use both PayPal and AI."

**Dates** ✅
- Submissions close **12 Nov 2026 12:00 pm PT = 13 Nov 2026 01:30 IST**.
- Judging **1 Dec 2:00 pm PT – 15 Dec 8:00 am PT**. Winners announced around 21 Dec (2:00 pm PT).

**Submission requirements** ✅
- Text description of features and functionality.
- Functional demo access: clear setup/run instructions in the repo **or** a hosted demo URL. "A design mockup, static prototype, or non-functional demo does not meet this requirement."
- Public repo (GitHub/GitLab/Bitbucket) with all source, assets and instructions; open-source licence file visible in the repo's About section.
- Demo video **under 3 minutes**, public on YouTube, showing the project functioning; no unlicensed third-party trademarks or copyrighted music.
- Testing access free until judging ends; include credentials/access codes and sandbox details needed. "Judges are not required to test the Project and may choose to judge based solely on the text description, images, and video."
- New project, or significantly updated after the submission period started.
- English materials.

**Judging** ✅
- **Stage One (pass/fail):** baseline viability; fits the theme; applies the required APIs/SDKs.
- **Stage Two:** five **equally weighted** criteria:
  1. **Technological Implementation** — "How thoroughly and skillfully does the project use PayPal Developer Platform and AI tool(s)?"
  2. **Design** — a "complete, coherent product experience" rather than just a technical proof of concept.
  3. **Potential Impact** — "a credible, specific case for solving a real problem for a real audience".
  4. **Innovation/Idea** — "How creative and novel is the concept and does the project differ from existing concepts?"
  5. **Presentation** — "Does the video clearly demonstrate the project working end-to-end?"
- **Ties:** broken by the highest score in the first criterion listed (Technological Implementation), then the next, then a judges' vote.

**Prizes** ✅
- Grand: $12,000 / $8,000 / $5,000.
- Honorable Mentions ($5,000 each): Most Creative, Most Impactful, Best Demo Delivery, **Best Use of PayPal + AI**, Best Use of Agentic Commerce.
- Sponsor prizes (only for submissions using that sponsor's tools): **AG Grid** $5,000 / $2,000 / $1,000; **APIMatic** $1,000 + 6-month business subscription (×3); **Bryntum** $1,000 (×3); **Channel3** $1,500 (×1); **Render** $1,000 / $750 / $500 in credits.
- "A project can only win up to one (1) Grand Prize and one (1) Sponsor Prize OR one (1) Honorable Mention Prize and one (1) Sponsor Prize."
- KERNEL, Postman, Zapier, Elastic, Astropods are listed sponsor tools but have **no sponsor prize** in the rules ✅.

**Eligibility** ✅: age of majority where you live; residents of Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea and other comprehensively OFAC-sanctioned places are excluded; sponsor/administrator staff, judges and conflicted persons excluded. Confirm your own eligibility.

## 2. How FaultLine scores on each criterion

Self-assessment is the author's judgement. It is not a prediction.

| Criterion | What judges will see | Evidence we provide | Main risk | How to push it up |
| --- | --- | --- | --- | --- |
| Technological Implementation (tie-break) | Real Orders v2 purchases, real signed webhooks recorded and replayed, signature verification, `PayPal-Request-Id`, negative testing; an agent with tools, budgets and validation; patched instances verified by re-run | architecture diagram, eval results file, timeline with evidence IDs | looks like "just tests" | show the agent choosing attacks from code suspicion; show evidence validation rejecting an invented ID (eval stat) |
| Design | Live run view with swimlanes, finding page with proof cards, public report | hosted app, screenshots | dev-tool UIs look raw | apply `design.md`; one clear story per screen; mobile-friendly report |
| Potential Impact | Every PayPal integration with webhooks faces these hazards (PayPal docs) | documented hazards with sources; measured detection on seeded bugs | no market statistic | name the user precisely (small-team developers integrating PayPal Checkout); show the costs concretely (customer charged, no goods; credits doubled) without invented numbers |
| Innovation/Idea | An AI that attacks a payment integration and proves fixes | rival check notes (below) | PayPal's own AI upgrade assistant; webhook testing tools exist | stress "proves the fix by re-running the attack against PayPal's own record" |
| Presentation | 3-minute video of the full loop | storyboard in `docs/19` | trying to show too much | one bug end to end (A4: charged but no coffee), then a montage of the others |

**Rival check (2026-10-19):** PayPal offers a beta AI upgrade assistant for JS SDK v5→v6 in VS Code (code migration, not runtime attack testing) ✅. Webhook testing guides and tools exist (e.g. FetchSandbox) ⚠️ (search results only). No PayPal-specific AI attack-and-prove tool was found in one search. That is not proof none exists. Re-check the Devpost gallery when it is published.

## 3. Prize strategy

- **Primary:** Grand Prize (all criteria) and the Honorable Mention **Best Use of PayPal + AI** (natural fit: PayPal is the system under test and the source of truth; AI plans, explains and fixes).
- **Also plausible:** **Best Demo Delivery** (red → green proof is visual); **Most Creative**.
- **Weak fit:** Best Use of Agentic Commerce (FaultLine is agentic AI on payment rails, not an AI shopping for a consumer). Do not stretch the pitch to fit it; the buyer agent is a test actor.
- **Sponsor prize (one at most):**
  - **Render** — FaultLine is hosted on Render (web, API, engine). Eligible by using Render ✅. Judging criteria beyond use are unpublished ❓.
  - **AG Grid (optional, bigger prize)** — using AG Grid (community edition ⚠️ licence) for the trace explorer and invariant board would make FaultLine eligible for the AG Grid prize. AG Grid's published interests (custom widgets, theming/layout, Studio agent framework ✅ 2026-10-17) mean a token grid is unlikely to win; only do this if UI time allows (Could). Decide by G3.

## 4. Stage One checklist (must all be yes)

- [ ] Uses the PayPal developer platform in the sandbox, centrally (Orders v2, webhooks, verification).
- [ ] Uses an AI model meaningfully (Gemma 4 31B on Ollama Cloud: planning, diagnosis, patches).
- [ ] Working demo: hosted URL with access code **and** README run instructions.
- [ ] Public repo with licence visible.
- [ ] Video < 3 min, public, shows it working.
- [ ] Text description explains features.
- [ ] New project (built from 19 Oct 2026; commit history shows it).

## 5. What judges can verify, and where

| Claim | Where to verify |
| --- | --- |
| Real PayPal sandbox calls | evidence drawer shows PayPal order/capture IDs and debug IDs; report lists them |
| Real signed webhooks | webhook evidence with event IDs and transmission IDs (signature hashed) |
| AI never decides pass/fail | `packages/core/invariants` source; UI labels; README |
| Fixes are proven | finding page proof cards; report "after" verdicts |
| Detection numbers | `eval/results/*.json` committed, with date and model ID |
| Safety | `docs/12`, sandbox badge, allowlist code, CI grep |

Judges may judge from text and video only, so the README and the video must each show the full loop without requiring a run.

## 6. Likely judge questions (prepare honest answers)

1. *Is the AI needed?* Checklist mode exists and is the baseline; the agent decides what to test from the code and writes and proves fixes. Show eval: attacks used and patches verified.
2. *Are these bugs real-world?* The hazards are documented by PayPal and webhook vendors; BuggyBeans seeds them on purpose so results are measurable. Say it plainly.
3. *Could this attack someone else's store?* Hosted: only built-in stores. Self-hosted: ownership token, sandbox only.
4. *What if the model invents evidence?* Rejected by code; shown in eval as raw vs accepted validity.
5. *What happens with production?* Not supported, by design.

## 7. Claims policy

- Allowed: measured numbers with date and model ID; documented PayPal behaviours with sources.
- Not allowed: "secure", "guaranteed", "first", "only", market sizes or bug prevalence without a source, any claim about winning.
