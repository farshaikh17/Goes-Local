# CPU pilot — Orlando waits 60 min between full GHL syncs (v17.07)

Target: **goes-local-orlando-api only**. Miami (goes-local-miami-api) is the comparison and is not touched.
Source of truth: `worker.js` (one file for every site), config `wrangler.toml` [env.orlando], deploy `scripts/deploy.sh`.
Live before the pilot (checked 18 Nov 17:06 UTC): Orlando version **3b485c9a-e988-4466-be8e-47bc3db3ef84**
(v17.06-shared, commit 1d16f3d = repo HEAD then), Miami bfaefe58-fede-4669-8013-c75354224891 (v17.06). Both cron
`*/5 * * * *`; `check-live` matched. Orlando had no CITY_SYNC_COOLDOWN_MIN.

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
