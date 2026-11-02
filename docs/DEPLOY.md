# Deploying Goes Local

## What it needs
Two environment variables in the Claude Code cloud environment (never in the repo):

| Variable | What | Where it comes from |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Lets Wrangler deploy and read Worker settings | Cloudflare dash → My Profile → API Tokens → "Edit Cloudflare Workers" template, plus **D1: Edit** and **Zone: Workers Routes: Read**, scoped to account `024a5f4e0646920e7c4557bda6ed2075` and the two zones |
| `ADMIN_LOGIN_KEY` | Signs in to `/admin` to run the migration and read `/debug` | Same value as the Workers' `ADMIN_LOGIN_KEY` variable |

The environment's network access must also allow `api.cloudflare.com`, `miamigoeslocal.com`, `orlandogoeslocal.com` (and `sparrow.cloudflare.com` if you want Wrangler telemetry — not required).

## Commands
```
npm ci
npm run precheck           # syntax, duplicate routes, VERSION, leaked city values
npm run check-live         # wrangler.toml vs the live Workers: bindings, cron, domains, flags
scripts/deploy.sh          # precheck → check-live → orlando deploy+migrate+verify → miami deploy+migrate+verify
scripts/deploy.sh orlando  # one city only
npx wrangler rollback --env orlando   # undo the last deploy on one city
npm run browse-check -- orlando       # real headless-Chromium click-through + screenshots
```
`deploy.sh` refuses to run with uncommitted changes to `worker.js` or `wrangler.toml`, and stops at the first failure.

## How the config stays safe
- `keep_vars = true` — dashboard Variables (CITY_*, GHL tokens, keys) are left alone. Secrets are never touched by a deploy.
- `no_bundle = true` — `worker.js` is uploaded byte-for-byte as committed, so live code can be compared with git.
- `check-live` compares the live Worker's D1/KV bindings, compatibility date and flags, observability, cron, custom domains, zone routes and workers.dev settings with `wrangler.toml`, and fails on any difference. It also lists the live Variable and Secret names.

## Sandbox notes (Claude Code cloud)
- The token must have **no Client IP filtering** — the sandbox's outgoing IP changes.
- Token permissions in use: Account D1 Edit, Workers Scripts Edit, Workers KV Storage Edit, Account Settings Read, Workers Tail Read; Zone Read; User Details Read, Memberships Read. Not granted: Workers Observability (logs query API) — ask for it when investigating errors.
- `wrangler tail` doesn't connect from the sandbox (long-lived websocket through the proxy). To confirm cron still runs after a deploy, watch the `sync:progress` key in the city's SESSIONS KV namespace change.
- Headless Chromium must trust the egress proxy CA; `scripts/browse-check.mjs` passes its SPKI pin.
- The sandbox egresses from Google Cloud (ASN 396982), which the WAF challenges. Our scripts send `x-gl-check: <sha256("gl-check:"+ADMIN_LOGIN_KEY)[:32]>`, which the WAF rules exempt (see `scripts/security-rules.mjs`). Plain `curl` without that header gets a 403 challenge — add the header.
- Token also has Zone WAF / Bot Management / Firewall Services Edit (added 25 Sep).

## Live settings worth knowing (read 2026-09-25)
- Orlando Variables: ADMIN_LOGIN_KEY (plain text — visible in the dashboard, unlike Miami's Secret), CITY_BRAND, CITY_COUNTY, CITY_DOMAIN, CITY_FROM_EMAIL, CITY_FROM_NAME, CITY_GA_IDS, CITY_NAME, CITY_STATE, CITY_TAGLINE. Secrets: GHL_API_TOKEN, GHL_LOCATION_ID.
  Missing vs Miami: GOOGLE_PLACES_API_KEY (no Google ratings refresh), GHL_PRIVATE_TOKEN_AGENT (agent logins), ADMIN_NOTIFY_EMAIL, PAYMENT_WEBHOOK_KEY, CITY_VALID_ZIPS. (STATUS_WEBHOOK_KEY added 29 Sep; the Orlando GHL workflow "Auto Listing Verification" posts to /webhooks/ghlstatus. Tested end to end with CFL Counseling.)
- Optional on every city (v16.89): CITY_META_DOMAIN_VERIFY = Meta domain-verification code (meta-tag option).
- Optional on every city (v16.86): CITY_META_PIXEL = the Meta (Facebook) Pixel ID, digits only. Miami's Pixel: 1893063295472643 — added by Eric as a dashboard Variable on 2 Nov; checked live (PageView + Lead code on the page).
- Miami Variables: ADMIN_NOTIFY_EMAIL, CITY_GA_IDS (one ID only), GOOGLE_PLACES_API_KEY, PAYMENT_WEBHOOK_KEY, STATUS_WEBHOOK_KEY. Secrets: ADMIN_LOGIN_KEY, GHL_API_TOKEN, GHL_LOCATION_ID, GHL_PRIVATE_TOKEN_AGENT, GHL_PRIVATE_TOKEN_SALES. Miami sets no CITY_* except GA — it runs on the code defaults.
- Tampa (live 2 Oct 2026, worker `goes-local-tampa-api`): Variables CITY_NAME, CITY_BRAND, CITY_COUNTY, CITY_STATE, CITY_DOMAIN, CITY_FROM_EMAIL, CITY_FROM_NAME, CITY_TAGLINE, CITY_GA_IDS (G-PTHWYG1QQW, added 6 Oct); Secrets ADMIN_LOGIN_KEY, GHL_API_TOKEN, GHL_LOCATION_ID. STATUS_WEBHOOK_KEY added 6 Oct (Eric). GOOGLE_PLACES_API_KEY copied from Miami to Tampa and Orlando on 7 Oct (Google rating/review refresh for claimed listings). Still missing: PAYMENT_WEBHOOK_KEY and per-city Stripe payment links (Eric is setting up Stripe in each GHL account).

## First-time setup status (2026-09-25)
- [x] Live code pulled from both Workers — identical, committed and tagged `v15.79-shared`.
- [x] `wrangler.toml` written with the known D1 and KV ids; dry-run bundles both cities correctly.
- [x] `wrangler.toml` filled from the live Workers (compat dates, binding names, cron, custom domains, workers.dev on, logs on); `check-live` passes for both.
- [x] Orlando: no-change v15.79 deploy on 2026-09-25 15:34Z — settings identical before/after, migrate + /debug OK, browser click-through OK, full sync completed 15:45Z.
- [x] Miami: no-change v15.79 deploy on 2026-09-25 15:47Z — same checks passed; new sync pass started 15:50Z.

## Home-services sites (2026-10-06)
- `ny`, `il`, `ga` first deployed 6 Oct on this branch's v16.19 (renumbered v16.32 after merging main), Variables set (see `changelog/v16.34-states.md`), `ADMIN_LOGIN_KEY` secret set, migrated, `seed/home-services-categories.sql` loaded, `scripts/security-rules.mjs` applied to all three zones. Reachable at `homeservices-{ny,il,ga}-api.dev1-024.workers.dev`.
- **Custom domains not attached yet:** each zone has an old proxied A record on the apex (the site behind it returned 522) and the token can't edit DNS. Once Eric deletes those records, re-run `npx wrangler deploy --env <ny|il|ga>` (or PUT /workers/domains) to attach, then `npm run check-live -- ny il ga`. Plain-http requests were also being 302'd to `www.` by a rule the token can't read; check it after the domains attach.
- Still to add once GHL exists: `GHL_LOCATION_ID`, `GHL_API_TOKEN` (Secret), `CITY_FROM_EMAIL`, `CITY_FROM_NAME`, optionally `CITY_GA_IDS`, `ADMIN_NOTIFY_EMAIL`, `GOOGLE_PLACES_API_KEY`, `STATUS_WEBHOOK_KEY`.
- 6 Oct (later): `ny`, `il`, `ga` deployed on v16.32-shared (main merged in), migrated, Miami starter hero slides / content images cleared and re-seeded without photos. Then (7 Oct, Eric's OK): `CITY_FREE_ONLY` removed on all three, so Pricing shows; v16.33 deployed. `CITY_LICENSE` not set (Eric: not needed); the About page gives generic license advice instead. Checkout stays off until each site has `PAYMENT_WEBHOOK_KEY`.
- 7 Oct: GHL secrets present on all three. First `/admin/sync`: **NY** "GHL 403: The token does not have access to this location" (token and GHL_LOCATION_ID RLxBG8BwCpBiNcLbHVFE don't match); **IL/GA** connect but "no contacts tagged 'business'". v16.35 deployed. IL/GA photos imported (see changelog/v16.35-states.md); NY photos wait on its token. Custom domains still blocked by the old apex A records (error 100117; token has no DNS edit). Also missing on all three: CITY_FROM_EMAIL / CITY_FROM_NAME (emails would otherwise go out from Miami's default sender), CITY_GA_IDS, payment links, STATUS_WEBHOOK_KEY.
- 7 Oct (later): NY's new token had been saved into GHL_LOCATION_ID; moved it to GHL_API_TOKEN and set GHL_LOCATION_ID back to RLxBG8BwCpBiNcLbHVFE (token checked: reads 3,244 contacts). Namecheap parking records (apex A + www CNAME) deleted on all three zones (token now has DNS edit); apex and www custom domains attached (www 301s to the apex via the v16.31 code). `check-live ny il ga` passes. CITY_FROM_EMAIL `noreply@lc.homeservicesin{ny,il,ga}.com` and CITY_FROM_NAME set (GHL sending subdomain `lc.` is in DNS). NY photos imported and wired like IL/GA. **Blocking listings:** every contact in all three accounts (NY 3,244 · IL 2,652 · GA 2,428) is tagged only `untouched`; the sync needs the `business` tag.
- 7 Oct (evening): all three live with listings (NY 3,244 · IL 2,652 · GA 2,424), v16.38. Live click-through (home, categories, search, a city page, pricing, blog, admin login) passed on all three domains with no JS errors or 5xx. Open (optional): city photos for the biggest towns, appliance-repair / water-treatment / new category photos, GA IDs, payment links, STATUS_WEBHOOK_KEY, GOOGLE_PLACES_API_KEY, logo upload; non-home-service contacts (drug stores etc.) are filed under Other — Eric may want them untagged in GHL.
- 8 Oct: **NC, MA, PA** launched the same way (envs `nc`, `ma`, `pa`; D1 `homeservices-{nc,ma,pa}-db` in eastern North America; apex + www custom domains attached straight away, no parking records). Variables as NY/IL/GA plus CITY_FROM_EMAIL `noreply@lc.homeservicesin{nc,ma,pa}.com` (MA has no GHL `lc.` sending records in DNS yet). ADMIN_LOGIN_KEY set, migrated, all three category seeds loaded, bot rules applied, `check-live nc ma pa` passes, v16.39. Waiting on Eric for GHL_API_TOKEN and GHL_LOCATION_ID secrets; then sync, photos (`img/plan.json` picks; state banners still to choose), and click-through.
- 8 Oct (later): MA (2,286 listings, 356 cities, 18 categories) and PA (2,333 listings, 528 cities, 17 categories) synced twice, category round 4 (`seed/home-services-categories-4.sql`, sends non-home business types to Other) loaded on all six state sites, category photos + state banners (Boston, Philadelphia/Pittsburgh) imported, hero/promo slots wired, shell_v1 + cache_gen cleared, browse-check clean. NC has GHL_API_TOKEN but still needs GHL_LOCATION_ID before its first sync; banners for NC are already chosen in `plan.json` (Charlotte, porch house, Edenton lighthouse).
- 8 Oct (evening): NC got GHL_LOCATION_ID; synced (2,531 listings, 306 cities), photos imported and wired, browse-check clean. Round 5 (`seed/home-services-categories-5.sql`, NC long tail) loaded on all six state sites.
- 9 Oct: state sites renamed to full state names (CITY_BRAND / CITY_FROM_NAME = "Home Services in Georgia" etc.). v16.42-shared, one shared code for all nine sites, deployed Orlando → Miami → Tampa → ny il ga nc ma pa, all verified.
- 13 Oct: v16.44-shared (includes the phone-width short name, "Home Services in NC") deployed to the six state sites only; the cities were already on it. browse-check clean on all six.
- 14 Oct: state sites updated to v16.52 (instant code verification, automatic invites/expiry, owner checklist), then v16.53 (own app name on phones). browse-check clean on all six. GA had one waiting claim (Mama Bear Dryer Vent Cleaning), which autoHourly invites by email. Still needed per state GHL account: email sending domain, a texting number (LC Phone + A2P) for SMS codes, CITY_PAY_* links, CITY_GA_IDS.
- 15 Oct: state sites on v16.54, then v16.55 with CITY_AUTO_APPROVE=1 on all six (claims and new listings approved straight away; Eric). CITY_PAY_* set to Miami's four fastpaydirect links (temporary). The Pro/Plus buttons stay hidden until PAYMENT_WEBHOOK_KEY is set per state site; payments land in Miami's GHL account, so state upgrades are switched on by hand.
- 19 Oct: PAYMENT_WEBHOOK_KEY secret (random, per site) set on all six state sites (Eric: "Yes, add the payment keys"), so the Plus/Pro buttons on /manage/upgrade now use the CITY_PAY_* links. Nothing in GHL posts to it yet, so paid upgrades are still switched on by hand.
- 20 Oct: state sites merged and deployed on main's v16.57 (sync catches Listing Verified contacts; invite goes to Owner Email). STATUS_WEBHOOK_KEY (Text Variable, random per site) set on all six; `/webhooks/ghlstatus?key=…` answers each with its own key and refuses a wrong one (401). The keys are in each worker's Variables; Eric pastes the URL into each state account's "Auto Listing Verification" workflow.
- 20 Oct (later): state sites on v16.60 (homepage counts, 'listings in N cities'), category round 6 (shops/suppliers to Other), photos for General Contractors, Home Inspection, Appliance Repair, Water Treatment; then v16.61 (merged from main; the state sites had no look-alike sub-categories, so no data changed). browse-check clean on all six.
- 21 Oct: merged main (v16.62 sub-category pages win over look-alike listing slugs, v16.63 homepage counts main categories) and deployed v16.63 to the six state sites. No listing sits on a sub-category address. Counters unchanged (states already counted main categories). browse-check clean on all six.
- 22 Oct: state sites on v16.65 (main's v16.64 Google-listing duplicates, v16.65 sitemap lastmod + Best-of sitemap exempt). /admin/duplicates run on all six: nothing new to hide (GA keeps its 4 earlier), no mismatched Google links. Sitemaps return 200 without the check header, with real lastmod dates. browse-check clean. v16.66/67 (email templates, rep sender) not on the state sites; on the cities they await Eric's OK.
- 22 Oct (later): state sites on v16.67 (v16.66 email template columns + placeholders; v16.67 business emails sent as the assigned GHL rep). Live test on all six (QA contact → Listing Verified): each invite went out as "Rob Smith | Home Services in {State}" from noreply@lc.homeservicesin{xx}.com, so every state token can read users. Test contacts deleted. browse-check clean.
- 23 Oct: v16.68 to v16.70 on the six state sites (qa-contact Demo names, email status; insertOne/refreshOne load towns first). North Carolina sales demo business "Demo Carolina Pro Plumbing" (GHL contact 848C6vezOzOtVnHiwWc9, tagged qa-test, owner dev1+ncdemo-owner@mianrosystems.com) left live for Eric's presentation. Delete it with /admin/qa-contact action=delete when done. Full flow QA'd: GHL lead → unclaimed listing → Owner Email + Listing Verified → webhook → claimed + invite (delivered) → owner sign-in → hours, badges, photo saved to GHL and site → customer enquiry delivered to owner from the rep.
- 23 Oct (later): state sites on v16.72 (main: owner area redesign, sign-in emails from site sender), then v16.73 (listing checklist counts slot photos; found with the NC demo). browse-check clean on all six; NC demo owner sees the new Your Profile and Manage listing tabs, and "Your listing is complete".
- 23 Oct (later): v16.74 (profile greets by Owner Name) on the six state sites; NC demo owner sees "Good afternoon, Dana". browse-check clean.
- 23 Oct (night): state sites on v16.75 (held sales Verified) and v16.76 (Owner Email invites keep the rep sender). Both tested live on NC; test contacts deleted.
