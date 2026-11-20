# CPU pilot — Orlando waits 60 min between full GHL syncs (v17.07)

Target: **goes-local-orlando-api only**. Miami (goes-local-miami-api) is the comparison and is not touched.
Source of truth: `worker.js` (one file for every site), config `wrangler.toml` [env.orlando], deploy `scripts/deploy.sh`.
Live before the pilot (checked 18 Nov 17:06 UTC): Orlando version **3b485c9a-e988-4466-be8e-47bc3db3ef84**
(v17.06-shared, commit 1d16f3d = repo HEAD then), Miami bfaefe58-fede-4669-8013-c75354224891 (v17.06). Both cron
`*/5 * * * *`; `check-live` matched. Orlando had no CITY_SYNC_COOLDOWN_MIN.

## Live (Eric: "Go ahead, put v17.07 live on Orlando", 18 Nov)
- 17:4x UTC step 1: v17.07 code → version **43d5f414-c964-4eb0-9089-3103cc53a6e4** (wait still 10 min).
- 17:44 UTC step 2: CITY_SYNC_COOLDOWN_MIN=60 → version **eff5dfc9-fb65-4064-b276-75c072a4731b**. check-live OK (18
  Variables kept + new one). Browser check OK (home, category, best, blog, contact, search, a listing; no JS errors).
- Miami untouched (bfaefe58, v17.06). 48-h comparison window: 2026-11-18 18:00 → 2026-11-20 18:00 UTC.

## Baseline — 2026-11-16 17:00 → 2026-11-18 17:00 UTC (see changelog/v17.07.md)
Scheduled: Orlando 568 runs, 669,538 CPU ms, 1,178.8 ms/run, 0 failed · Miami 573, 895,728, 1,563.2, 0 failed.
HTTP (separate): Orlando 12,736 req / 339,790 ms · Miami 50,405 / 1,014,141. Source: GraphQL
`workersInvocationsAdaptive`, filter scriptName + datetime, split by `eventType` (cron vs fetch).
Orlando sync: 79 full passes, 963,000 contacts read, ~99% of scheduled CPU (Workers Observability, per invocation).

## Deploy (only after Eric's explicit go-ahead)
1. `bash scripts/deploy.sh orlando` — v17.07 code, Orlando only (check-live, deploy, migrate, /debug VERSION).
   Without the Variable the behaviour is the old 10 min; record the new version id.
2. `npx wrangler deploy --env orlando --var CITY_SYNC_COOLDOWN_MIN:60 --message "v17.07-shared d95a277 pilot 60m"`
   (keep_vars = true keeps every other Variable and Secret). Record this version id.
3. Check: within 10 min Orlando's logs show `cron: sync=… ` lines, and after the next completed pass
   `sync=skipped-cooldown — … wait 60 min`; site pages load; /debug shows v17.07-shared.

## Rollback
- Pilot off, keep the new code: `npx wrangler rollback <version id from step 1> --name goes-local-orlando-api --message "pilot off" -y`
  (that version has no CITY_SYNC_COOLDOWN_MIN → 10 min). Or delete the Variable in the dashboard.
- Everything back (code + config): `npx wrangler rollback 3b485c9a-e988-4466-be8e-47bc3db3ef84 --name goes-local-orlando-api --message "rollback CPU pilot" -y`.
  v17.07 adds no tables or columns, so no data step. The next normal deploy must not re-add the Variable.

## After 48 h
Same queries, same filters, windows aligned to the step-2 time: daily scheduled CPU, CPU/run, failures, completed
passes, contacts read (sum of `contacts read`), observed update delay (time between completed passes), Miami alongside.
Follow-ups A (v17.08, Lead Category idle skip) and B (v17.09, best-of index skip) are separate commits on
branch cpu-followups and are not part of this pilot.

Future design: webhook-first sync (GHL contact-changed webhook → refreshOne) with a periodic full reconciliation
(e.g. every few hours) for removals and anything a webhook missed.

## Result after 48 h (window 2026-11-18 18:00 → 2026-11-20 18:00 UTC, same sources and filters as the baseline)
| | Orlando baseline | Orlando pilot | change | Miami baseline | Miami same window | change |
|---|---|---|---|---|---|---|
| Scheduled runs | 568 | 587 | | 573 | 566 | |
| Scheduled CPU ms | 669,538 | 269,013 | **−59.8%** | 895,728 | 759,960 | −15.2% |
| CPU ms per run | 1,178.8 | 458.3 | −61.1% | 1,563.2 | 1,342.7 | −14.1% |
| Day 1 / day 2 CPU ms | 340,528 / 329,010 | 143,934 / 125,079 | | 459,490 / 436,238 | 389,611 / 370,349 | |
| Failed runs (Cloudflare) | 0 | 0 | | 0 | 0 | |
| Full passes completed | 79 | 34 | −57% | 41 | 57 | +39% |
| Contacts read | 963,000 | 475,118 | −51% | 1,122,000 | 1,232,845 | +10% |
| Time between completed passes | ~36 min | median 85, max 90 min | | | median 45, max 110 min | |
| HTTP CPU ms | 339,790 | 444,132 | +31% | 1,014,141 | 1,393,666 | +37% |
Sync ticks that logged a failure (the pass resumed next tick): Orlando 2 (one D1 "network connection lost", one
"sync already running"); Miami 18 (17 GHL 429, 1 D1 overload) — the duplicate merge was running on Miami in this window.
- Confounders: the other chat's duplicate merge ran 18–20 Nov (mostly Miami, ~10k GHL deletes, admin requests counted as
  HTTP), so Miami is not a clean control; Miami's contact count fell ~10k, which made its passes shorter (more of them).
  HTTP CPU rose on both sites for the same reason, not because of the pilot.
- Against Miami's own drift (−15%), the pilot's share of Orlando's drop is about −53% of scheduled CPU.
- Freshness: an ordinary GHL edit now reaches Orlando's site within one pass cycle (~85–90 min, about 45 min on average)
  instead of ~36 min; removals (two missed passes) ~3 h. No complaints or failures traced to it.
- Recommendation (20 Nov): keep Orlando at 60; extend to Miami with Eric's OK (expected about −45% of Miami's scheduled
  CPU, the largest single item); longer term, webhook-first sync with a periodic full reconciliation.
