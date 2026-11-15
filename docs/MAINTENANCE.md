# Maintenance mode (site switched off)

Since 28 Oct 2026 (Eric: "take the website down for maintenance, including all home services websites, apart from
North Carolina") — and since 15 Nov 2026 also Miami, Orlando and North Carolina (Eric: "lets stop all websites related to
Goes Local, even the states … just pause it"; he chose 503 "paused" over 404 to keep Google rankings) — these sites show a "We'll be back soon" page (503 + Retry-After) instead of the directory:

| Site | Worker | Real version when switched off | Restore from |
|---|---|---|---|
| miamigoeslocal.com | goes-local-miami-api | v17.04-shared (version bdbcad13-9e4d-4b4b-a9a1-08b3c4609f87) | this branch (`scripts/deploy.sh orlando miami`, which deploys the newest committed code — v17.05 at the time) |
| homeservicesinnc.com | homeservices-nc-api | v16.76-shared states build (version b1f481d8-fb13-4edc-b4a6-81e976f16ae3, deployed 23 Oct) | states branch `claude/dreamy-volta-s36nuw`, or `npx wrangler rollback b1f481d8-fb13-4edc-b4a6-81e976f16ae3 --name homeservices-nc-api` |
| tampagoeslocal.com | goes-local-tampa-api | v16.82-shared | this branch (`scripts/deploy.sh` or `wrangler deploy --env tampa`) |
| homeservicesinny.com | homeservices-ny-api | v16.76-shared | states branch `claude/dreamy-volta-s36nuw` (commit 876625f) |
| homeservicesinil.com | homeservices-il-api | v16.76-shared | states branch |
| homeservicesinga.com | homeservices-ga-api | v16.76-shared | states branch |
| homeservicesinma.com | homeservices-ma-api | v16.76-shared | states branch |
| homeservicesinpa.com | homeservices-pa-api | v16.76-shared | states branch |

Still up: Orlando — back on 15 Nov (Eric: "Lets make Orlando Live again") with `wrangler rollback` to its pre-pause version f6f994e6 (v17.04-shared); checked live: home, category, Best, blog, contact, search and a listing load, sync ran. Everything else is paused (15 Nov). While paused the 5-minute cron does nothing: no GHL sync, duplicate tagging or merges. The duplicate merge (v17.04/v17.05) had only run a preview; nothing was merged.

Why: Tampa's GHL sub-account was switched off ("Location is not active", since 28 Oct 05:43 UTC) after the sign-up
flood (changelog/v16.81.md); Eric keeps it off until GHL support resolves the tickets.

## How it works
- `scripts/maintenance/worker.js` is deployed in place of worker.js with the same env (routes, custom domains, D1,
  KV, cron, Variables — keep_vars). Nothing in D1/KV changes. Every request, including GHL webhooks, gets 503.
- Switch a site off: `npx wrangler deploy scripts/maintenance/worker.js --env <tampa|ny|il|ga|ma|pa>`
- Put a site back: deploy its real worker.js (Tampa: from this branch; the states: from the states branch, the version
  they were on, unless a newer one has been released for them), then open /debug and check VERSION, and click through.
  While a site is off, GHL webhooks (e.g. Listing Verified) are not processed; the 5-minute sync catches up the
  Listing Verification changes after it is back.
