#!/usr/bin/env node
// Record a D1 "undo point" (Time Travel bookmark) before a bulk change — merge batch, import, migration.
//   node scripts/d1-restore-point.mjs <city> "<why>"        e.g.  node scripts/d1-restore-point.mjs miami "merge batch 2"
// Prints the bookmark and appends it, with a few row counts, to docs/D1-RESTORE-POINTS.md (commit that file).
// Needs CLOUDFLARE_API_TOKEN. Restoring is in docs/D1-RECOVERY.md. Read-only: it changes nothing in the database.
import fs from "node:fs";

const [city, why = ""] = process.argv.slice(2);
if (!city) { console.error("usage: node scripts/d1-restore-point.mjs <city> \"<why>\""); process.exit(1); }
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) { console.error("CLOUDFLARE_API_TOKEN is not set"); process.exit(1); }
const root = new URL("../", import.meta.url);
const toml = fs.readFileSync(new URL("wrangler.toml", root), "utf8");
const sec = toml.split(/\n(?=\[)/).filter(s => s.startsWith(`[[env.${city}.d1_databases]]`))[0];
if (!sec) { console.error(`no [[env.${city}.d1_databases]] in wrangler.toml`); process.exit(1); }
const dbName = /database_name\s*=\s*"([^"]+)"/.exec(sec)[1], dbId = /database_id\s*=\s*"([^"]+)"/.exec(sec)[1];
const api = async (path, init) => {
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, { ...init, headers: { Authorization: "Bearer " + TOKEN, "content-type": "application/json" } });
  const j = await r.json();
  if (!j.success) throw new Error(path + ": " + JSON.stringify(j.errors));
  return j.result;
};
const acc = process.env.CLOUDFLARE_ACCOUNT_ID || (await api("/accounts"))[0].id;
const bm = (await api(`/accounts/${acc}/d1/database/${dbId}/time_travel/bookmark`)).bookmark;
const counts = (await api(`/accounts/${acc}/d1/database/${dbId}/query`, { method: "POST", body: JSON.stringify({ sql: "SELECT (SELECT COUNT(*) FROM businesses) listings, (SELECT COUNT(*) FROM dup_hidden) hidden_copies, (SELECT COUNT(*) FROM claims) claims, (SELECT COUNT(*) FROM merge_log) merged" }) }))[0].results[0];
const at = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
const line = `| ${at} | ${city} | ${dbName} | \`${bm}\` | ${String(why).replace(/\|/g, "/")} | ${counts.listings} / ${counts.hidden_copies} / ${counts.claims} / ${counts.merged} |\n`;
const file = new URL("docs/D1-RESTORE-POINTS.md", root);
if (!fs.existsSync(file)) fs.writeFileSync(file, "# D1 undo points\n\nWritten by `scripts/d1-restore-point.mjs` before bulk changes. How to restore: docs/D1-RECOVERY.md.\nCounts: listings / hidden duplicate copies / claims / merge_log rows at that moment.\n\n| When | Site | Database | Bookmark | Why | Counts |\n|---|---|---|---|---|---|\n");
fs.appendFileSync(file, line);
console.log(`${city} (${dbName}) undo point ${bm}\n  at ${at} — ${why}\n  listings ${counts.listings}, hidden copies ${counts.hidden_copies}, claims ${counts.claims}, merge_log ${counts.merged}\n  saved to docs/D1-RESTORE-POINTS.md`);
