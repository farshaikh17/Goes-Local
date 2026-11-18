// Local tests for the cron CPU changes (v17.07 sync wait per site; follow-ups A and B when present).
// Runs worker.js in Node with an in-memory SQLite standing in for D1, a Map for KV, and a FAKE GHL (globalThis.fetch is
// replaced: every outbound request is answered here; nothing reaches GHL or any other site, no real contact is used, no
// text or email is sent). Contacts are synthetic "QA Test Biz NNN". Each simulated site loads its own copy of
// worker.js, so in-memory caches don't leak between sites.
// Run: node --no-warnings scripts/qa/cron-cpu.test.mjs   (prints PASS/FAIL per check, exits 1 on any failure)
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKER = fileURLToPath(new URL("../../worker.js", import.meta.url));
const API = "https://services.leadconnectorhq.com";
const CRON = "*/5 * * * *";
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

// ---------- fake GHL ----------
function fakeGhl() {
  const g = {
    pages: 35, perPage: 5,              // 35 pages > 30 per tick, so a full pass takes two ticks
    contacts: new Map(),                // id -> contact
    order: [],
    calls: { customFields: 0, contactsPage: 0, put: [], other: 0 },
    failPage: null,                     // page number that answers 500 (simulates a GHL outage mid-pass)
    put429: false,
    noLeadField: false,
  };
  const mk = (i, extra = {}) => ({
    id: "qa" + String(i).padStart(4, "0"), companyName: `QA Test Biz ${String(i).padStart(3, "0")}`,
    firstName: "", lastName: "", email: "", phone: "+1555010" + String(1000 + i).slice(-4),
    address1: `${100 + i} Test St`, city: "Miami", state: "FL", postalCode: "33130", country: "US",
    tags: ["business"], customFields: [], source: "qa", dateAdded: "2026-01-01T00:00:00Z", ...extra,
  });
  g.reset = (n = g.pages * g.perPage) => { g.contacts.clear(); g.order = []; for (let i = 1; i <= n; i++) { const c = mk(i); g.contacts.set(c.id, c); g.order.push(c.id); } };
  g.reset();
  g.mk = mk;
  g.handler = async req => {
    const u = new URL(req.url);
    if (u.origin !== API) { g.calls.other++; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    if (/\/locations\/[^/]+\/customFields$/.test(u.pathname)) {
      g.calls.customFields++;
      const f = [{ id: "f_url", name: "Listing URL" }, { id: "f_lv", name: "Listing Verification" }];
      if (!g.noLeadField) f.push({ id: "f_lead", name: "Lead Category" });
      return J({ customFields: f });
    }
    if (u.pathname === "/contacts/" && req.method === "GET") {
      g.calls.contactsPage++;
      const pageNo = +(u.searchParams.get("qapage") || 1);
      if (g.failPage === pageNo) return J({ message: "simulated outage" }, 500);
      const ids = g.order.filter(id => g.contacts.has(id));
      const per = Math.ceil(ids.length / g.pages) || 1;
      const slice = ids.slice((pageNo - 1) * per, pageNo * per).map(id => g.contacts.get(id));
      const more = pageNo * per < ids.length;
      return J({ contacts: slice, meta: { nextPageUrl: more ? `${API}/contacts/?locationId=LOCQA&limit=100&qapage=${pageNo + 1}` : null } });
    }
    const m = /^\/contacts\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      g.calls.put.push({ id: m[1], body });
      if (g.put429) return J({ message: "rate limited" }, 429);
      return J({ contact: g.contacts.get(m[1]) || { id: m[1] } });
    }
    if (m && req.method === "GET") return g.contacts.has(m[1]) ? J({ contact: g.contacts.get(m[1]) }) : J({ message: "not found" }, 404);
    g.calls.other++;
    return J({});
  };
  return g;
}

// ---------- D1 / KV stand-ins ----------
function d1(sqlite) {
  const conv = a => { if (a === undefined) throw new Error("D1_TYPE_ERROR: undefined bind"); return typeof a === "boolean" ? (a ? 1 : 0) : a; };
  const plain = r => r ? { ...r } : r;
  class Stmt {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...a) { return new Stmt(this.sql, a.map(conv)); }
    _p() { return sqlite.prepare(this.sql); }
    async first(col) { const r = plain(this._p().all(...this.args)[0]) ?? null; return col && r ? r[col] : r; }
    async all() { return { results: this._p().all(...this.args).map(plain), success: true, meta: {} }; }
    async raw() { return this._p().all(...this.args).map(r => Object.values(r)); }
    async run() { const x = this._p().run(...this.args); return { success: true, meta: { changes: Number(x.changes), last_row_id: Number(x.lastInsertRowid) } }; }
    _sync() { return /^\s*(select|with)\b/i.test(this.sql) || /\breturning\b/i.test(this.sql) ? { results: this._p().all(...this.args).map(plain), success: true } : (this._p().run(...this.args), { results: [], success: true }); }
  }
  return {
    prepare: sql => new Stmt(sql),
    async batch(list) { sqlite.exec("BEGIN"); try { const out = list.map(s => s._sync()); sqlite.exec("COMMIT"); return out; } catch (e) { sqlite.exec("ROLLBACK"); throw e; } },
    async exec(sql) { sqlite.exec(sql); return { count: 1 }; },
  };
}
function kv() {
  const m = new Map();
  return {
    async get(k, t) { const v = m.has(k) ? m.get(k) : null; return v != null && (t === "json" || t && t.type === "json") ? JSON.parse(v) : v; },
    async getWithMetadata(k, t) { return { value: await this.get(k, t), metadata: null }; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list(o = {}) { return { keys: [...m.keys()].filter(k => !o.prefix || k.startsWith(o.prefix)).map(name => ({ name })), list_complete: true }; },
  };
}

let siteNo = 0;
const realFetch = globalThis.fetch, realLog = console.log;
globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => false }, open: async () => globalThis.caches.default };
async function site(vars = {}) {
  const g = fakeGhl();
  const logs = [];
  // a private copy of worker.js per site, so module-level caches start empty
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glqa-"));
  const copy = path.join(dir, "worker.mjs");
  fs.copyFileSync(WORKER, copy);
  const mod = await import(pathToFileURL(copy).href + "?s=" + (++siteNo));
  const sqlite = new DatabaseSync(":memory:");
  const DB = d1(sqlite), KV = kv();
  const env = { "qa-directory-db": DB, SESSIONS: KV, GHL_LOCATION_ID: "LOCQA", GHL_API_TOKEN: "qa-fake-token", ADMIN_LOGIN_KEY: "localtestkey123", ...vars };
  const run = async fn => {                       // fake GHL + captured logs only while this site's code runs
    globalThis.fetch = (i, init) => g.handler(new Request(i, init));
    console.log = (...a) => logs.push(a.map(String).join(" "));
    const waits = [];
    try { const r = await fn({ waitUntil: p => waits.push(p), passThroughOnException() {} }); await Promise.allSettled(waits); return r; }
    finally { globalThis.fetch = realFetch; console.log = realLog; }
  };
  const req = (p, init = {}) => new Request("https://qa.example" + p, { ...init, headers: { "cf-connecting-ip": "127.0.0.1", "user-agent": "qa", ...(init.headers || {}) } });
  const login = await run(ctx => mod.default.fetch(req("/admin/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ as: "admin", key: "localtestkey123" }) }), env, ctx));
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const admin = async p => run(async ctx => (await mod.default.fetch(req(p, { headers: { cookie } }), env, ctx)).text());
  const mig = await admin("/admin/migrate");
  if (!/migrat|ok|done|table/i.test(mig)) throw new Error("migrate failed: " + mig.slice(0, 200));
  const tick = async () => {
    const before = logs.length;
    await run(ctx => mod.default.scheduled({ cron: CRON, scheduledTime: Date.now() }, env, ctx));
    return logs.slice(before).filter(l => /cron|sync/.test(l));
  };
  const mf = { dispose: async () => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
  const meta = async k => ((await DB.prepare("SELECT v FROM meta WHERE k=?1").bind(k).first()) || {}).v;
  const setMeta = (k, v) => DB.prepare("INSERT INTO meta(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2").bind(k, String(v)).run();
  const count = async (sql = "SELECT COUNT(*) n FROM businesses", ...b) => ((await DB.prepare(sql).bind(...b).first()) || {}).n;
  const syncLine = ls => ls.find(l => /cron: sync=/.test(l)) || "";
  return { mf, g, DB, KV, admin, tick, meta, setMeta, count, syncLine, logs };
}

const MIN = 6e4;

// ================= v17.07: sync wait per site =================
{
  console.log("\n== Orlando-style site (CITY_SYNC_COOLDOWN_MIN=60)");
  const s = await site({ CITY_SYNC_COOLDOWN_MIN: "60" });
  // first sync ever: no synced_at -> starts a pass straight away
  let l = await s.tick();
  check("first sync starts with no previous pass", /sync=started/.test(s.syncLine(l)), s.syncLine(l));
  check("first tick does not mark the pass complete", !(await s.meta("synced_at")));
  check("pass in progress is saved", !!(await s.KV.get("sync:progress")));
  l = await s.tick();
  check("next tick resumes and completes the pass", /sync=completed \(pass resumed\)/.test(s.syncLine(l)), s.syncLine(l));
  check("all 175 synthetic listings published", (await s.count()) === 175, String(await s.count()));
  check("aggregate counts only in the sync line (no names/emails/phones)", !/QA Test Biz|@|\+1555/.test(l.join("\n")));
  const done1 = +(await s.meta("synced_at"));
  check("completed pass writes synced_at", done1 > Date.now() - MIN);

  // recently completed -> skip, but every other job of the tick still runs
  await s.DB.prepare("INSERT INTO lead_cat_fix(ghl_id,cat,created_at) VALUES('qa0001','Plumbing',1)").run();
  await s.setMeta("cron_hourly_at", Date.now() - 2 * 3600e3);
  await s.DB.prepare("DELETE FROM meta WHERE k='best_index'").run();
  const pagesBefore = s.g.calls.contactsPage, putsBefore = s.g.calls.put.length;
  l = await s.tick();
  check("recent completion (0 min) -> skipped-cooldown", /sync=skipped-cooldown — last full pass completed 0 min ago, wait 60 min/.test(s.syncLine(l)), s.syncLine(l));
  check("skipped tick fetches no GHL contacts", s.g.calls.contactsPage === pagesBefore);
  check("skipped tick: Lead Category job still ran (queued row written + removed)", s.g.calls.put.slice(putsBefore).some(p => p.id === "qa0001") && (await s.count("SELECT COUNT(*) n FROM lead_cat_fix")) === 0);
  check("skipped tick: hourly jobs still ran (hourly stamp + best-of index)", +(await s.meta("cron_hourly_at")) > Date.now() - MIN && !!(await s.meta("best_index")));

  await s.setMeta("synced_at", Date.now() - 59 * MIN);
  l = await s.tick();
  check("59 min after completion -> still skipped", /skipped-cooldown/.test(s.syncLine(l)), s.syncLine(l));
  await s.setMeta("synced_at", Date.now() - 61 * MIN);
  l = await s.tick();
  check("61 min after completion -> new pass starts", /sync=started/.test(s.syncLine(l)), s.syncLine(l));

  // a pass in progress resumes even when the last completion is very recent
  await s.setMeta("synced_at", Date.now());
  l = await s.tick();
  check("in-progress pass resumes although last completion is 0 min old", /sync=completed \(pass resumed\)/.test(s.syncLine(l)), s.syncLine(l));

  // ordinary GHL edit reaches the right listing on the next completed pass
  s.g.contacts.get("qa0007").phone = "+15550109999";
  const otherBefore = (await s.DB.prepare("SELECT ph FROM businesses WHERE ghl_id='qa0008'").first()).ph;
  await s.setMeta("synced_at", Date.now() - 61 * MIN);
  l = [...await s.tick(), ...await s.tick()];
  const row7 = await s.DB.prepare("SELECT ph FROM businesses WHERE ghl_id='qa0007'").first();
  check("GHL edit (phone) lands on that listing after the next pass", /9999/.test(row7.ph || ""), row7.ph);
  check("…and no other listing changed", (await s.DB.prepare("SELECT ph FROM businesses WHERE ghl_id='qa0008'").first()).ph === otherBefore);
  const changed = l.map(x => /(\d+) listings changed/.exec(x)).filter(Boolean).reduce((a, m) => a + +m[1], 0);
  check("'listings changed' counts only real changes (1 edit -> 1)", changed === 1, String(changed));

  // failure mid-pass: not marked complete, nothing removed, retried next tick
  const listed = await s.count(), doneBefore = await s.meta("synced_at");
  await s.setMeta("synced_at", Date.now() - 61 * MIN);
  const doneStale = await s.meta("synced_at");
  s.g.failPage = 32;
  l = await s.tick();                                  // pages 1-30 OK
  l = await s.tick();                                  // page 32 -> 500
  check("GHL outage mid-pass -> sync=failed (resumed)", /sync=failed \(resumed\) — GHL 500/.test(s.syncLine(l)), s.syncLine(l));
  check("failed pass is not marked complete", (await s.meta("synced_at")) === doneStale);
  check("failed pass removes no listings", (await s.count()) === listed);
  check("failed pass keeps its place for a retry", !!(await s.KV.get("sync:progress")));
  s.g.failPage = null;
  await s.KV.delete("sync:lock");
  l = await s.tick();
  check("retry next tick resumes and completes (no wait after a failure)", /sync=completed \(pass resumed\)/.test(s.syncLine(l)), s.syncLine(l));
  void doneBefore;

  // partial pass (70% guard): a pass that sees far fewer contacts removes nothing
  for (const id of s.g.order.slice(0, 100)) s.g.contacts.delete(id);
  await s.setMeta("synced_at", Date.now() - 61 * MIN);
  l = [...await s.tick(), ...await s.tick()];
  check("pass that sees only 75 of 175 removes nothing (safety guard)", (await s.count()) === 175, String(await s.count()));
  s.g.reset();

  // approved claim stays published; merged contact: the kept (claimed) contact stays listed
  s.g.contacts.get("qa0010").tags = ["business", "consumer", "claimed"];   // approved claim that started as a login contact
  s.g.contacts.delete("qa0011");                                             // merged away in GHL…
  s.g.contacts.get("qa0012").tags = ["business", "owner-account", "claimed"]; // …into this one (kept, claimed)
  // the sync never removes a row written in the last 10 minutes; age the rows as if the passes were an hour apart
  for (let k = 0; k < 2; k++) { await s.DB.prepare("UPDATE businesses SET updated_at=?1").bind(Date.now() - 3600e3).run(); await s.setMeta("synced_at", Date.now() - 61 * MIN); await s.tick(); await s.tick(); }
  check("approved claim (claimed + consumer) stays published after 2 passes", (await s.count("SELECT COUNT(*) n FROM businesses WHERE ghl_id='qa0010'")) === 1);
  check("merged contact: the kept claimed contact stays published", (await s.count("SELECT COUNT(*) n FROM businesses WHERE ghl_id='qa0012'")) === 1);
  check("merged contact: the merged-away contact is removed after its 2nd missed pass", (await s.count("SELECT COUNT(*) n FROM businesses WHERE ghl_id='qa0011'")) === 0);

  // manual sync ignores the wait
  await s.setMeta("synced_at", Date.now());
  const pb = s.g.calls.contactsPage;
  const out = await s.admin("/admin/sync");
  check("manual Run sync works during the wait", s.g.calls.contactsPage > pb && /sync/i.test(out), out.split("\n")[0].slice(0, 90));
  await s.mf.dispose();
}
{
  console.log("\n== Miami-style site (no CITY_SYNC_COOLDOWN_MIN -> 10 min, unchanged)");
  const s = await site({});
  await s.tick(); await s.tick();
  await s.setMeta("synced_at", Date.now() - 9 * MIN);
  let l = await s.tick();
  check("9 min after completion -> skipped (wait 10)", /skipped-cooldown — last full pass completed 9 min ago, wait 10 min/.test(s.syncLine(l)), s.syncLine(l));
  await s.setMeta("synced_at", Date.now() - 11 * MIN);
  l = await s.tick();
  check("11 min after completion -> new pass starts", /sync=started/.test(s.syncLine(l)), s.syncLine(l));
  await s.mf.dispose();
  for (const bad of ["abc", "2", "99999", " "]) {
    const t = await site({ CITY_SYNC_COOLDOWN_MIN: bad });
    await t.tick(); await t.tick();
    await t.setMeta("synced_at", Date.now() - 11 * MIN);
    const l2 = await t.tick();
    check(`invalid value ${JSON.stringify(bad)} falls back to 10 min`, /sync=started/.test(t.syncLine(l2)), t.syncLine(l2));
    await t.mf.dispose();
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
