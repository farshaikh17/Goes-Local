# Undoing a bad bulk change to a site's database (D1 Time Travel)

Agreed with Eric 18 Nov. Cloudflare keeps every change to each site's D1 database for **30 days** (checked: bookmarks
29 days back work on Miami). A restore puts the whole database back to an exact moment.

## Before every bulk change (merge batch, import, migration, mass edit)
```
node scripts/d1-restore-point.mjs <city> "<what you are about to do>"
```
It prints the bookmark and adds it, with row counts, to `docs/D1-RESTORE-POINTS.md` — commit that file. Read-only.

## If the change damaged listing data
1. **Stop the job first** (merge: `POST /admin/merge?auto=0`; sync: wait or let the lock expire) so nothing writes
   during the restore.
2. Prefer a targeted fix when only a few rows are wrong — a restore also throws away everything real visitors did
   since the bookmark (claims, enquiries, sign-ins, reviews, owner edits). Check what happened since then first.
3. Restore (database name from wrangler.toml, bookmark from docs/D1-RESTORE-POINTS.md):
   ```
   npx wrangler d1 time-travel restore <database_name> --bookmark=<bookmark> --env <city>
   ```
   It answers with a "previous bookmark": that undoes the restore if needed — write it down.
4. After: `/debug` and `/admin/status` (listing count), open a few listing pages, run `bash scripts/deploy.sh`-style
   checks (`node scripts/migrate-verify.mjs <city> <version>`). Saved pages refresh on their own within the page cache
   time; the next sync pass re-reads GHL.

## What a restore does NOT undo
- Anything already done in **GHL** (merged/deleted contacts, tags, notes, emails sent). For merges, the removed
  contact's full record, notes and transcript are kept in the D1 table `merge_log` (contact_json, notes_json,
  transcript) — use it to rebuild a contact by hand. A D1 restore to before the merge would also remove that backup,
  so **copy the merge_log rows out before restoring** (`wrangler d1 export <db> --remote --table merge_log`).
- KV data (sessions, sync progress, rate limits) and Worker settings.

## Practice (drill)
- 18 Nov 2026: throwaway database `qa-restore-drill` — 3 listings written, bookmark taken, one deleted and one phone
  changed, restored with the bookmark (≈1 s), all 3 rows identical to before, database deleted. Repeat every few months.
