# Goes Local — Handoff to Claude Code

**Date:** 24 Sep 2026
**From:** Cowork session (Claude) → **To:** Claude Code
**Owner:** Eric Vance (dev1@mianrosystems.com), Mianro Systems
**Live version on both cities at handoff:** `v15.79-shared`
**The code:** one file, `worker.js` (~853 KB, ~10,600 lines). Git tag `v15.79-shared` is the live copy pulled from both Workers on 25 Sep 2026 (they were identical).

> **Status updates since the handoff** are tracked in `docs/DEPLOY.md` (deploy setup) and `changelog/`.

## Current status — 12 Nov 2026 (read this first)

- **Live:** Miami and Orlando on the shared worker (v17.02 live, 12 Nov).
  Miami ~17,800 listings, Orlando ~13,600. North Carolina (states branch) is up.
- **Switched off (maintenance page, 503):** Tampa and the NY/IL/GA/MA/PA state sites since 28 Oct — see
  `docs/MAINTENANCE.md`. Tampa's GHL sub-account is inactive after the 27–28 Oct sign-up flood (`changelog/v16.81.md`);
  a GHL refund ticket is open. Restore = deploy the real worker for that env, then /debug and a click-through.
- **Last full QA:** 11–12 Nov (`changelog/v16.99.md`): no page, link, admin or worker errors on either city.
- **Protection in place:** Tor POSTs refused + WAF rule (v16.81); sign-up honeypot, per-IP and site-wide email caps
  (v16.81); owner email + mobile verification before a new or claimed listing counts (v16.86–v16.97); D1 overload →
  spare page copy or 503 busy, never 500 (v16.98); out-of-area listings hidden (v16.99).
- **Data rules:** GHL contacts tagged `business` are the directory; duplicates are hidden on the site (`dup_hidden`,
  tagged `duplicate` in GHL from v16.99); competitors (`competitor_hidden`) and out-of-state addresses (`area_hidden`)
  are hidden; nothing is deleted from GHL by the site.
- **Waiting on Eric / outside:** Orlando's Meta Pixel ID (CITY_META_PIXEL) and videos (Admin → Content → Videos);
  Meta domain-verification code (CITY_META_DOMAIN_VERIFY); Tampa decision after the GHL ticket; Search Console
  "Validate fix" retry for the 5xx report; Miami's ADMIN_NOTIFY_EMAIL variable holds a number (fallback only).
- **Live QA rule:** never text a real phone (CLAUDE.md); phone codes are tested locally with BV_TEST_ECHO.
- **Removing a closed business** (Threshold Management, Miami, 12 Nov): in GHL remove the `business` tag, add
  `closed` and a note; delete its row from `businesses`; **also remove the `business` tag from any hidden duplicate
  copy** (`SELECT ghl_id FROM dup_hidden WHERE keep_id=<id>`) and delete those dup_hidden/slug_redirects rows —
  otherwise dedupeListings releases the copy on the next sync because its kept listing is gone, and the business
  reappears. Then rebuild biz_fts and bump the cache (any admin POST). The old address returns 404.
- **Live browser checks:** send the x-gl-check header only to our own domains (Playwright `context.route(/goeslocal\.com/)`);
  adding it to every request makes Google Fonts refuse the font files and pages look font-less in screenshots.
- **SEO:** the SEO team's audit (12 Nov) is handled in v17.00–v17.01 (robots, thin pages noindex, blog schema not
  doubled, fonts non-blocking, smaller photos, topic-based Related guides). Their open items are listed in
  changelog/v17.00.md.

---

## 0. The five rules that matter most

1. **Nothing is "done" until it's confirmed live in a real browser.** Not `node --check`, not a test suite, not "the code looks right" — Eric has been burned repeatedly by code paths that report success and do nothing. Click through the real site.
2. **Deploy with Wrangler — Eric no longer copy-pastes.** A careless first deploy can wipe the live site's database connection, settings or 5-minute sync, so follow §7 exactly and prove it with an unchanged v15.79 before shipping anything new. After every deploy, check `/debug` (`VERSION:` line) on both cities.
3. **After any deploy that adds a table or column, run the migration on each city.** Deploys do *not* run migrations automatically — the v15.79 test failed on its very first save for exactly this reason. `scripts/deploy.sh` does it.
4. **One shared code file runs every city.** Miami and Orlando are the same bytes, deployed twice with different Cloudflare Variables. Never hardcode anything city-specific (names, prices, GA IDs, schema JSON, image URLs) into the file — it goes into that city's D1 or into a `CITY_*` variable. Miami leaked its GA IDs into Orlando this way once (fixed v15.77).
5. **Plain English with Eric, technical depth in documents.** He communicates in short direct messages, doesn't want jargon in chat, and wants UI changes mocked up before they're built. Put the technical detail in the changelog, not the chat.

---

## 1. What this is

A multi-city local business directory network under the "Goes Local" brand. Long-term target 100+ cities. Two are live:

| City | Domain | Cloudflare Worker | D1 database | KV namespace | GHL location |
|---|---|---|---|---|---|
| Miami | miamigoeslocal.com | `goes-local-miami-api` | `miami-directory-db` (`b0226c38-0b16-45d9-84bf-603435efa245`) | `GOES_LOCAL_SESSIONS` (`4355959c05424505953f2ccf725eee4c`) | `0a5ao5C3pqUq6QXdQHxe` |
| Orlando | orlandogoeslocal.com | `goes-local-orlando-api` | `orlando-directory-db` (`25894099-96cd-4431-8930-f21badead15b`) | `GOES_LOCAL_ORLANDO_SESSIONS` (`99679f634f624df0b542c1e2b21a2480`) | `WBkYBSVDnGUN7JKzWYtd` |

Cloudflare account `024a5f4e0646920e7c4557bda6ed2075`. The account also has `pulse-db` and `miami-directory` (12 KB, looks like an empty leftover) D1 databases that this project does not use. Tampa is next in line; the older `v14.27-tampa` build predates the shared-code approach — **ignore it**, a Tampa launch is a new deployment of the shared file (§8).

Miami: ~16,800 listings, 132 categories, 27 neighbourhoods. Orlando: ~14,500 listings, 8 categories, 37 neighbourhoods.

**People:** Eric = product owner and sole decision-maker. Eric's boss = design/UX feedback, owns the Google Cloud account. An SEO team sends briefs and structured-data snippets (admin-panel access, no code access). A colleague (eric.v@mianrosystems.com) tests. "Agents" = staff role with admin-panel access.

---

## 2. Architecture in one screen

```
Browser ──► Cloudflare Worker (worker.js, one file, server-rendered HTML)
                │
                ├── D1 (SQLite)  — per city: listings, posts, news, SEO, images, claims, everything
                ├── KV           — sessions, rate limits, sync lock
                ├── GoHighLevel  — per city sub-account: CRM + source of truth for listings,
                │                  outgoing email/SMS, payments (FastPayDirect)
                ├── Google Places API (New) — ratings/reviews backfill (shared key)
                └── Stripe       — shared account (webhook handler exists; GHL still does most payment flow)

Cron (every 5 min) ──► same Worker `scheduled()` : listing sync from GHL, bulk import batches,
                                                   Google reviews batch, Listing-URL write-back to GHL
```

- **Everything is in `worker.js`.** Public pages, owner dashboard (`/account`, `/manage`), admin panel (`/admin/*`), auth, cron, migrations, email templates, CSS. No build step, no framework. Template literals return HTML strings.
- **No comments in shipped code** — Eric's preference to keep the file small. (v15.77+ added a handful around city config; tolerated, don't add more.)
- **GHL's page builder is never used.** All SEO/pages/admin tooling is in this Worker. "The SEO thing in GHL" means the site's own `/admin` panel.
- **D1 binding is discovered, not named**: `getDB(env)` returns the first env binding with a `.prepare` function. KV likewise (`KVOF`). So binding names don't matter to the code, but there must be exactly one D1 bound.

### City configuration
Top of file: `const S = { city, st, county, brand, tagline, dom, tag, ttl: 900, gaIds: [] }` plus `AUTH = { SITE_URL, FROM_EMAIL, FROM_NAME, … }` and `FLAGS`. Defaults are Miami's values **except GA IDs, which default to empty**. At the bottom (`export default`), `env.CITY_*` variables override these before every request/cron:

| Variable | Overrides | Notes |
|---|---|---|
| `CITY_NAME` | `S.city` | Also gates Miami-only seed data: `!env.CITY_NAME \|\| env.CITY_NAME==="Miami"` |
| `CITY_STATE`, `CITY_COUNTY`, `CITY_BRAND`, `CITY_TAGLINE` | `S.*` | |
| `CITY_DOMAIN` | `S.dom` **and** `AUTH.SITE_URL` | With `https://` |
| `CITY_GA_IDS` | `S.gaIds` | Comma-separated. Miami = `G-6Q9XD0PSXP,G-4GYL8HMEGL`, Orlando = `G-8ECDB32Y3W`. **Unset = no analytics** (deliberate, v15.77). |
| `CITY_FROM_EMAIL`, `CITY_FROM_NAME` | `AUTH.*` | Sending domain must be verified in that city's GHL or every email bounces |
| `CITY_VALID_ZIPS` | zip allow-list | Miami's list is hardcoded in `CITY_VALID_ZIPS.Miami`; other cities supply theirs |

Other env vars: `GHL_LOCATION_ID`, `GHL_API_TOKEN`, `GHL_PRIVATE_TOKEN_AGENT`, `ADMIN_LOGIN_KEY` (same key across all cities — deliberate), `ADMIN_NOTIFY_EMAIL` (fallback only; real recipients in `/admin/emailtemplates`), `GOOGLE_PLACES_API_KEY`, `PAYMENT_WEBHOOK_KEY` (**must be Text type, not Secret** — Secret failed to persist), `STATUS_WEBHOOK_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `RESEND_API_KEY`.

### D1 tables (all created by `migrate()`)
`businesses` (listings; `ghl_id` unique; FTS5 shadow `biz_fts`), `meta`, `claims`, `posts`, `news`, `reviews`, `follows`, `photos`, `comments`, `updates`, `events`, `review_requests`, `import_batches`/`import_rows`, `cancellations`, `deletion_requests`, `slug_redirects`, `ad_requests`, `ad_slots`/`ad_slot_queue`, `category_banners`/`category_banner_images`, `category_faqs`, `hoods`/`hood_zips`/`hood_pending`/`hood_faqs`, `hero_slides`, `content_images`, `email_templates`, `site_seo`, `pending_email_invites`, `page_schema` (**unused leftover** — safe to drop from `migrate()`).

`migrate(DB, env)` is a sequence of `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` each in its own `try{}catch{}` — idempotent. It runs **only** on `/admin/migrate`, `/admin/sync`, `/admin/urlsync` — not on deploy, requests or cron. Pattern:

```js
try { await DB.prepare("ALTER TABLE site_seo ADD COLUMN custom_schema TEXT DEFAULT ''").run(); } catch {}
```

### Caching
- Homepage and most public pages: edge-cached up to 5 min. `/debug` and anything `cache-control: no-store` is instant — **use `/debug` to confirm a deploy**, never the homepage.
- In-isolate caches keyed on `S.ttl` (900 s): `C` (listings shell), `SEOC` (site_seo), content images. A DB change can take up to 15 min to show; not a bug.

---

## 3. Route map

**Public:** `/`, `/search`, `/categories`, `/{category-slug}`, `/{category-slug}/{business-slug}`, `/neighbourhoods`, `/neighbourhood/{slug}`, `/blog`, `/blog/{slug}`, `/news`, `/news/{slug}`, `/about`, `/pricing`, `/add`, `/claim`, `/claimed`, `/featured`, `/advertise`, `/privacy`, `/terms`, `/sitemap*.xml`, `/robots.txt`.

**Owner auth/dashboard:** `/login`, `/signup`, `/verify`, `/code`, `/auth`, `/forgot`, `/reset`, `/logout`, `/account`, `/manage`.

**Admin panel** (`/admin/*`, cookie session, roles `admin` | `agent`; `agent` can't run migrate/sync/import):

| Dropdown | Pages |
|---|---|
| Listings | pending, claims, cancellations, deletions, adrequests, businesses |
| Content | comments, hero, images, banner-images, hoods, ads, banners, claiminvites |
| **SEO** (v15.79) | seo, blog, news, faqs, hoodfaqs |
| Admin (admin only) | status, import, sync, urlsync, emailtemplates, migrate, debug |

Not in the nav: `/admin/login`, `/admin/logout`, `/admin/whoami?email=`, `/admin/fields` (dumps raw GHL custom fields — use first when "field not found"), `/admin/emailtest` & `/admin/testmail`, `/admin/googlereviews`, `/admin/insertone?id={ghl_contact_id}`, `/admin/start`.

`ADMINNAV(path, role)` builds the nav from `listingItems` / `contentItems` / `seoItems` / `adminOnlyItems` via `drop(label, items)`. Add a page = add a `[path, label]` pair + handle `p[1] === "yourpage"` in the admin router.

**Webhooks:** payment (GHL → Worker, keyed by `PAYMENT_WEBHOOK_KEY`, expects `biz` param), Stripe, status.

**`/debug`** (admin): `VERSION`, GHL token/location, D1/KV found, `FLAGS`, GA IDs, listing/category counts, last sync, first row.

---

## 4. The SEO system (v15.78 / v15.79)

Per-city JSON-LD for fixed pages lives in D1, not code.

- **Data:** `site_seo(page_key PK, title, desc, custom_schema, updated_at)`. Loaded by `seoOverrides(DB)` into `SEOC`.
- `SEO_PAGES` (`home, categories, add, about, pricing, neighbourhoods, news, blog`), `SEO_FALLBACK()`, `SEOTXT(key, …)`, `SEOLD(key)` → `customSchemaLd(raw)` (also used by `posts.custom_schema` / `news.custom_schema`).
- Page builders pass `ld:` into `PAGE(d, o)`; one object or an array, each becomes a `<script type="application/ld+json">`.
- Admin: `ADMINSEO`, `GET /admin/seo`, `POST /admin/seo/save` (JSON validated, upsert), `GET /admin/seo/reset?page=`.
- v15.78 removed the 5,000-char cap on the blog/news schema box.
- Tested live on Miami 22–24 Sep. Both cities migrated. Nothing pending — SEO team uses **Admin → SEO → SEO**. Miami's Homepage row has a custom meta description from the team — leave it alone.

---

## 5. Open work, in priority order

> Sections 5a–5c are done: 5a (sync writes only changed rows, fingerprint `FP`), 5b (the /blog 500s were D1
> contention; v16.98 serves a spare copy or 503 instead), 5c (resolved 25 Sep).

### 5a. D1 write cost — sync writes every listing every 5 minutes (approved)
$26 in one cycle, 100% D1 Rows Written (75.8M; 50M free). The cron sync does a full `INSERT … ON CONFLICT(ghl_id) DO UPDATE` for every business every pass. Two near-identical copies: the bulk loop in `syncStep()` and the single-record helper behind `/admin/insertone`.
**Fix:** fingerprint the fields (cheap hash), store in a new `sync_hash TEXT` column, skip unchanged. Precedent: Listing-URL sync only writes rows whose `url_synced_path` changed. Done = steady-state pass writes ~0 rows. Needs migrate.

### 5b. Intermittent 500 on `/blog` index (approved)
~1 in 6 requests failed. Likely why Search Console reported "could not fetch". Hypothesis: D1 contention during sync bursts. **First step:** Observability → Events on the Miami Worker → path `/blog` → read the exception. Don't guess. Re-test with 10–20 rapid hits after 5a; tell the SEO team to re-request a fetch.

### 5c. Code drift between canonical and live Orlando — **resolved 25 Sep 2026**: both live Workers byte-identical.

### 5d. Tampa launch (infrastructure) — see §8.

### 5e. Roadmap (scoped, not scheduled)
Structured hours + "Currently Open" badge (needs a "Structured Hours" GHL text field); named photo slots (partially exists as `slots` JSON column); ownership badges; consumer accounts; Follow Business notifications; private SEO keyword landing pages; blog-as-a-service; internal admin hierarchy; annual plan; Google API refresh for paid/claimed; GHL-style analytics dashboard (deferred).

### 5f. Housekeeping
- Drop the unused `page_schema` CREATE from `migrate()`.
- Audit "success message" code paths for silent failures (§6).
- GHL: payment workflow should pass the `biz` URL parameter.
- A pending listing with explicit content ("Escort"/Chery) flagged 17 Sep — check it's gone.
- Miami-hosted fallback images (`HERO_IMG`, `CAT_IMG` ~line 524) are hardcoded in the shared file; they're only defaults when a city's `content_images` is empty, but they are Miami assets.

---

## 6. Hard-won gotchas

**GoHighLevel**
- Contact-update API **silently drops custom-field changes when bundled with native fields** in the same PUT, returns 200. Always two separate calls.
- Eventual consistency: a re-sync can overwrite D1 with stale GHL data right after a write. Don't remove the KV sync lock.
- Conversations view is useless for verifying email; use `/admin/emailtest`.
- Custom-field search sometimes returns nothing for fields that exist; check a contact detail page.
- Phone-number dedupe reuses existing contacts; since v15.76 the form writes Business Name/address onto it.

**Silent success**
- Past bugs: GHL email 200 with no send; forms showing "thanks" while the write failed; background sync reverting edits; the Tier A/B auto-verify fast path that created a duplicate listing. Any claim fast-path must route through `/admin/pending`.
- Automated form submits sometimes silently fail. `fetch()` from devtools bypasses the real form flow. When in doubt, ask Eric to click it by hand.

**Cloudflare**
- `/admin/migrate` after every schema change. Safe to repeat.
- Observability → Events shows exact exception text including D1 SQL errors.
- The in-browser D1 console silently blocks some writes. Use the D1 API / MCP `d1_database_query`.
- `PAYMENT_WEBHOOK_KEY` must be a Text variable, not Secret.

**Images / multi-city data**
- Category tiles come from `content_images` in **that city's** D1. New cities start blank. Copy Miami's rows and **verify the `image_url` values landed** (a prior copy left them empty). Skip `brand_logo`, `mega_promo`, `owner_cta`.
- `hero_slides` likewise per-city; the 10 current photos are clean (no baked-in text). Always open an image and check for baked-in text before reusing.

**Browser automation**
- Confirm tab IDs before navigating. GHL iframes block DOM tools. `/admin/seo/reset` can make a tab report "frozen" ~30 s though the request succeeded — re-navigate, don't retry.

---

## 7. Deploying — see `docs/DEPLOY.md`

Release routine:
1. Edit `worker.js` (one file for every city).
2. `npm run precheck`; bump `const BUILD = "v15.xx-shared"`.
3. Commit; add `changelog/v15.xx.md`.
4. `scripts/deploy.sh` → Orlando deploy → migrate → `/debug` check → Miami, same. Click through the changed feature live.
5. Tell Eric in plain English what changed and that it's live. Tag `v15.xx-shared`.
6. UI changes: mockup and a yes **before** building.
7. Rollback: `npx wrangler rollback --env <city>` or redeploy the previous tag.

History: v15.76 CRM Business Name on existing contacts → v15.77 GA IDs to `CITY_GA_IDS` → v15.78 schema box limit removed → v15.79 SEO nav tab + per-page JSON-LD.

## 8. Launching the next city

**Tampa went live 2 Oct 2026 (v16.18)** following these steps: Worker `goes-local-tampa-api`, D1 `tampa-directory-db`, KV `GOES_LOCAL_TAMPA_SESSIONS`, starter content `seed/tampa.sql`, 25 neighbourhoods, bot rules applied. The custom domain only attaches once the zone's old A/CNAME record for the apex is deleted (error 100117). Until then, check the city with `BASE=https://<worker>.workers.dev node scripts/migrate-verify.mjs <city> <ver>`. Still open for Tampa: logo upload, GA ID, neighbourhood photos, geocoding (maps stay blank until lat/lng is filled), STATUS_WEBHOOK_KEY / PAYMENT_WEBHOOK_KEY.

Steps for the next city:

1. GHL: clone a sub-account from the Miami snapshot; verify the sending domain.
2. Buy domain, add to Cloudflare.
3. Create a D1 and KV namespace, add `[env.tampa]` to wrangler.toml, `npx wrangler deploy --env tampa`.
4. Set Variables: all `CITY_*`, plus `GHL_LOCATION_ID`, `GHL_API_TOKEN`, `GHL_PRIVATE_TOKEN_AGENT`, `ADMIN_LOGIN_KEY`, `ADMIN_NOTIFY_EMAIL`, `PAYMENT_WEBHOOK_KEY`, `GOOGLE_PLACES_API_KEY`, `CITY_VALID_ZIPS`.
5. `/admin/migrate`, then `/debug` to confirm bindings.
6. Copy Miami's `content_images` rows and verify URLs; copy the 10 `hero_slides` URLs matched to Tampa titles and enable them.
7. Neighbourhoods via `/admin/hoods` (Downtown, Ybor City, Hyde Park, South Tampa, Seminole Heights, Carrollwood, New Tampa, Brandon).
8. Point the domain, `/admin/sync`, check `/categories` and homepage visually.
8b. **Bot protection (required):** `node scripts/security-rules.mjs <newcity>goeslocal.com` — adds the scraper block, cloud-network challenge, filter-crawl challenge and rate limit, with webhooks/admin exempt. Do **not** turn on Bot Fight Mode (free plan can't exempt webhooks).
9. **Payment links decision first:** the four FastPayDirect links (`FEATURED_PAY_URL`, `FEATURED_PAY_URL_ANNUAL`, `PREMIUM_PAY_URL`, `PREMIUM_PAY_URL_ANNUAL`, ~line 3493) are hardcoded and shared — Orlando currently sends upgrades through Miami's links, and Orlando has no `PAYMENT_WEBHOOK_KEY`. Either intended (one merchant) or they become `CITY_PAY_*` variables. Ask Eric.

Decision on record: once a new city is proven on the shared setup, Miami stays on it too — no separate Miami branch.

## Duplicate listings (since v15.91)
Listings with the same name + phone + address show once on the site: the kept copy is chosen claimed → Plus → paid → most reviews. The other copies are hidden (table `dup_hidden`), and their old URLs 301 to the kept one. This runs after every sync pass. You can also run it now at `/admin/duplicates`. `/admin/duplicates?csv=1` downloads the list so the CRM team can merge or delete copies in GoHighLevel. Claimed or paid copies are never hidden. First run on 25 Sep: Orlando hid 837 copies, Miami 3,003.

## Listing data cleanup (v15.92–v15.93)
- **Wrong or dead pictures.** Some listing pictures are images shared by many unrelated businesses (Instagram's icon, a booking site's logo…); others no longer load. Both are hidden at display time, and those listings show their category photo instead. `/admin/logos` shows the counts; about 120 images are checked every hour (table `logo_check`).
- **Junk emails and websites.** Scraped addresses that aren't the business's (error trackers, template placeholders, font credits, platform support addresses), the literal "No Website", and bare platform home pages are hidden. Claim invites are never sent to junk emails. The CRM still holds the bad values, so the team can clean them there.
- **Neighbourhood queue.** For Orlando (no `CITY_VALID_ZIPS`), only zips whose first 3 digits cover at least 5% of the city's listings can enter the queue. Aventura, Kendall, Miami Gardens and Westchester were removed from Orlando on 25 Sep.
- **Missing zip codes.** Most listings without a zip have no address at all: service-area businesses that Google shows without an address. This is expected.

## SEO tools (since v15.97)
- **Admin → SEO → "Any other page":** set a custom Google title, description and extra JSON-LD for any single page by pasting its link. Stored in `site_seo` as `path:/…` and applied by `PAGESEO` inside `PAGE`.
- **Blog/news editor image gallery:** shows every image uploaded to the site (`media` table). Alt text is made from the file name and can be edited. Pictures in posts with no alt text get the post title.
- **Main category pages** show a row of that category's blog posts (matched on `posts.blog_cat`) under the FAQ.
- **Best-of pages** `/best…` (v15.95). **Unclaimed listings always show `DEFAULT_LISTING_IMG`** (v15.96).

## Coverage (Eric, 29 Sep)
- Each site covers its whole county plus nearby businesses: Miami covers Miami-Dade and nearby Broward, and Orlando covers Orange County and nearby Seminole, Osceola, Lake, Polk and Brevard. **Never hide nearby businesses.** Give them a neighbourhood instead.
- Neighbourhoods added on 29 Sep:
  - Miami: Allapattah (33142), Silver Bluff (33145), Pinecrest (33156), Opa-locka (33054), Hollywood (33019–33024), Hallandale Beach (33009), Miramar (33025/27/29), Pembroke Pines (33026/28).
  - Orlando: Titusville (32780/32796/32754).
- Wrong zip mappings removed: 33142 from Wynwood, 33145 from Coconut Grove, 33156 from Coral Gables.

## Lead-source tag (since v16.05)
- **`seoinbound`:** added in the CRM to every website lead that found us through a search engine or AI assistant. That covers "List your business" and "Claim a listing".
- **Who tags what (Eric, 6 Oct 2026):** the website is the only thing that adds `seoinbound`; GHL workflows add only `emailreplied`. The site never adds `seoinbound` to a contact with `emailreplied`, never for clicks from webmail or mail apps (`WEBMAIL_SRC`: mail.google.com, the Gmail Android app, Outlook, Yahoo Mail…), and never for paid ads. Each sync pass removes `seoinbound` from any contact that also has `emailreplied`.
- **Older leads:** the 17 contacts tagged by the 29 Sep backfill with no recorded source keep their tag, by Eric's decision. `/admin/seotags?audit=1` lists every tagged contact by evidence; `&fix=1` only removes the emailreplied and webmail groups.
- **Where it goes:** on a claim, both the person claiming and the business contact get the tag. On a pending listing, it's added again when the listing is published.
- **Never removed.** Email is tracked in GHL by `emailreplied`, so the site adds no email tag. `emailinbound` from v16.04 was dropped.
- **`/admin/seotags`** adds the tag to past leads. It's safe to re-run.
- **Where the rules live:** `leadChannelTag()` in worker.js.

## Statewide trade sites (since v16.18)
The same code can run a statewide directory for one trade (first planned: Florida plumbers), on its own Worker, D1, KV and GHL sub-account, set up like a new city (§8). Extra Variables, all optional: `CITY_AREA_WORD=City` (pages at `/city/{slug}`, `/cities`), `CITY_AREAS_FROM=city` (listings are grouped by their own town; towns are added automatically during sync), `CITY_VALID_ZIPS=32,33,34` (zip starts allowed), `CITY_HEADLINE`, `CITY_NOUN=Plumbers`, `CITY_SEARCH_HINT`. Suggested core values: `CITY_NAME=Florida`, `CITY_STATE=FL`, `CITY_COUNTY=Florida`. Load `seed/home-services-categories.sql` into its D1 after the first migrate. See `changelog/v16.34-states.md`.

**Live (6 Oct 2026):** homeservicesinny.com, homeservicesinil.com, homeservicesinga.com: envs `ny`, `il`, `ga`, free listings only (`CITY_FREE_ONLY=1`, see `changelog/v16.34-states.md`). Deploy them with `scripts/deploy.sh ny il ga nc ma pa` after Orlando and Miami. NC, MA and PA were added 8 Oct the same way.

**One code (9 Oct 2026, v16.42-shared):** Eric asked for the city and state code to be merged into one. From v16.42 every site (Orlando, Miami, Tampa, NY, IL, GA, NC, MA, PA) runs this same worker.js from branch `claude/goes-local-deployment-u2h1bx`; version numbers are shared. State changelogs that collided with main's numbers are kept as `changelog/v16.3x-states.md`. Who deploys what (Eric, 13 Oct): the Home Services chat deploys only the six state sites (`scripts/deploy.sh ny il ga nc ma pa`) unless Eric asks otherwise; the Goes Local chat deploys Orlando, Miami and Tampa. Both share one version sequence, and each chat fast-forwards to the other's latest commit before releasing.
