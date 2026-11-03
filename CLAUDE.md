# Goes Local
One Cloudflare Worker file (`worker.js`) runs the whole directory for every city. Deployed with Wrangler as `goes-local-miami-api` and `goes-local-orlando-api`; city differences come only from dashboard Variables (CITY_*) and each city's own D1. Full context: docs/HANDOFF.md. Deploy how-to: docs/DEPLOY.md.

About Eric (read first): Eric is the owner but is NOT a developer and is new to Claude Code. Don't assume he knows technical terms (API, env var, deploy, repo, token, etc.). Do everything technical yourself. When he must do something, give numbered click-by-click steps saying exactly what to click and type, one small task at a time, and offer to walk him through it with screenshots. He shouldn't have to explain this again.

Rules:
- Never hardcode anything city-specific in worker.js (names, prices, GA IDs, image URLs, JSON-LD, links). Exception (Eric, 25 Sep): Miami's photos are the intended base-template fallback images for any city that hasn't set its own; leave them.
- Deploy Orlando first, then Miami. After each: run the migration, check /debug VERSION, click through the change live. Nothing is done until seen working in a browser.
- New table/column → idempotent `try { ALTER/CREATE } catch {}` in migrate().
- wrangler.toml must keep keep_vars = true and match the live D1/KV bindings, routes and cron exactly (`npm run check-live` proves it; `scripts/deploy.sh` runs it first).
- GHL API: update custom fields and native fields in two separate calls (combined calls silently drop custom fields and still return 200).
- Talk to Eric in short plain English, no jargon. Mock up UI changes before building.
- Before commit: `npm run precheck` (node --check, duplicate-route scan, one VERSION line, no leaked city values), bump `const BUILD` (the version).
- Deploy only committed code: `scripts/deploy.sh` (needs CLOUDFLARE_API_TOKEN and ADMIN_LOGIN_KEY). Add a `changelog/v15.xx.md` per release and tag it `v15.xx-shared`.
- Live QA must never send a text message to a real phone (Eric, 3 Nov: +1 307-240-9810 is his boss's — never use it). Test phone codes locally only (BV_TEST_ECHO); on the live site skip the texting step.
