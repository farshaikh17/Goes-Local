# Maintenance mode (site switched off)

Since 28 Oct 2026 (Eric: "take the website down for maintenance, including all home services websites, apart from
North Carolina") these sites show a "We'll be back soon" page (503 + Retry-After) instead of the directory:

| Site | Worker | Real version when switched off | Restore from |
|---|---|---|---|
| tampagoeslocal.com | goes-local-tampa-api | v16.82-shared | this branch (`scripts/deploy.sh` or `wrangler deploy --env tampa`) |
| homeservicesinny.com | homeservices-ny-api | v16.76-shared | states branch `claude/dreamy-volta-s36nuw` (commit 876625f) |
| homeservicesinil.com | homeservices-il-api | v16.76-shared | states branch |
| homeservicesinga.com | homeservices-ga-api | v16.76-shared | states branch |
| homeservicesinma.com | homeservices-ma-api | v16.76-shared | states branch |
| homeservicesinpa.com | homeservices-pa-api | v16.76-shared | states branch |

Still up: Orlando, Miami, North Carolina (homeservices-nc-api).

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
