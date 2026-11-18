#!/usr/bin/env node
// Weekly site report data (Eric, 18 Nov): visits, top pages, slow pages, where visitors come from, site errors,
// for all nine sites, from Cloudflare Web Analytics and Workers analytics. Totals only — no visitor-level data.
//   node scripts/weekly-report.mjs [outDir] [endDateUTC]     (end = the day AFTER the week; default today 00:00 UTC)
// Writes sites.json, pages.json, slow.json, sources.json as {rows, meta}; they are uploaded to the
// "Goes Local Weekly Report" dashboard. Needs CLOUDFLARE_API_TOKEN (read access to Analytics and Workers).
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "report-out";
const end = process.argv[3] ? new Date(process.argv[3] + "T00:00:00Z") : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const DAY = 864e5, start = new Date(+end - 7 * DAY), prevStart = new Date(+start - 7 * DAY);
const iso = d => d.toISOString().replace(".000", "");
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) { console.error("CLOUDFLARE_API_TOKEN is not set"); process.exit(1); }
const SLOW_MS = 2500, MIN_LOADS = 10;

// Sites: env name, worker name and domain from wrangler.toml (the custom-domain route).
const toml = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const SITES = [];
for (const part of toml.split(/\n(?=\[env\.)/)) {
  const m = /^\[env\.([a-z]+)\]\s*\nname = "([^"]+)"/.exec(part);
  const dom = /pattern = "([a-z0-9.-]+)", custom_domain = true/.exec(part);
  if (m && dom) SITES.push({ env: m[1], worker: m[2], host: dom[1].replace(/^www\./, "") });
}
const NAMES = { miami: "Miami", orlando: "Orlando", tampa: "Tampa", ny: "New York", il: "Illinois", ga: "Georgia", nc: "North Carolina", ma: "Massachusetts", pa: "Pennsylvania" };
const siteOf = host => SITES.find(s => s.host === String(host || "").replace(/^www\./, ""));

const api = async (p, init) => {
  const r = await fetch("https://api.cloudflare.com/client/v4" + p, { ...init, headers: { Authorization: "Bearer " + TOKEN, "content-type": "application/json" } });
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(p + ": " + JSON.stringify(j.errors).slice(0, 300));
  return j;
};
const acc = process.env.CLOUDFLARE_ACCOUNT_ID || (await api("/accounts")).result[0].id;
const gql = async q => (await api("/graphql", { method: "POST", body: JSON.stringify({ query: `{viewer{accounts(filter:{accountTag:"${acc}"}){${q}}}}` }) })).data.viewer.accounts[0];
const win = (a, b) => `datetime_geq:"${iso(a)}",datetime_lt:"${iso(b)}"`;
const noBot = `bot:0`;

// 1 page views and visits per site, this week and last
const views = async (a, b) => (await gql(`x:rumPageloadEventsAdaptiveGroups(limit:100,filter:{${win(a, b)},${noBot}}){count sum{visits} dimensions{requestHost}}`)).x;
const [thisWk, lastWk] = await Promise.all([views(start, end), views(prevStart, start)]);
// 2 page speed (largest content shown, 75th percentile; Cloudflare reports microseconds) and phone share per site
const vit = (await gql(`x:rumWebVitalsEventsAdaptiveGroups(limit:100,filter:{${win(start, end)},${noBot}}){count quantiles{largestContentfulPaintP75} dimensions{requestHost}}`)).x;
const dev = (await gql(`x:rumPageloadEventsAdaptiveGroups(limit:200,filter:{${win(start, end)},${noBot}}){count dimensions{requestHost deviceType}}`)).x;
// 3 top pages, page speed per page
const pg = (await gql(`x:rumPageloadEventsAdaptiveGroups(limit:2000,orderBy:[count_DESC],filter:{${win(start, end)},${noBot}}){count dimensions{requestHost requestPath}}`)).x;
const pgv = (await gql(`x:rumWebVitalsEventsAdaptiveGroups(limit:2000,orderBy:[count_DESC],filter:{${win(start, end)},${noBot}}){count quantiles{largestContentfulPaintP75} dimensions{requestHost requestPath}}`)).x;
// 4 where visitors come from
const ref = (await gql(`x:rumPageloadEventsAdaptiveGroups(limit:2000,orderBy:[sum_visits_DESC],filter:{${win(start, end)},${noBot}}){sum{visits} dimensions{requestHost refererHost}}`)).x;
// 5 site errors: requests the Worker failed to answer (exceptions), per site
const wk = (await gql(`x:workersInvocationsAdaptive(limit:100,filter:{${win(start, end)},scriptName_in:${JSON.stringify(SITES.map(s => s.worker))}}){sum{requests errors} dimensions{scriptName}}`)).x;

const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
const sum = (rows, f, g = r => r.count) => { const m = new Map(); for (const r of rows) { const s = siteOf(r.dimensions.requestHost); if (s) add(m, f(s, r), g(r)); } return m; };
const pv = sum(thisWk, s => s.env), pvPrev = sum(lastWk, s => s.env), vs = sum(thisWk, s => s.env, r => r.sum.visits);
const phone = sum(dev.filter(r => r.dimensions.deviceType === "mobile"), s => s.env), devAll = sum(dev, s => s.env);
const lcpBy = new Map();     // weighted by loads across apex + www
for (const r of vit) { const s = siteOf(r.dimensions.requestHost); if (!s) continue; const o = lcpBy.get(s.env) || { n: 0, w: 0 }; o.n += r.count; o.w += r.count * r.quantiles.largestContentfulPaintP75; lcpBy.set(s.env, o); }
const errBy = new Map(wk.map(r => [ r.dimensions.scriptName, r.sum ]));
const pct = (a, b) => b ? Math.round((a - b) / b * 1000) / 10 : null;

const period = `${start.toISOString().slice(0, 10)} to ${new Date(+end - DAY).toISOString().slice(0, 10)} (UTC)`;
const code = fs.readFileSync(new URL(import.meta.url), "utf8");
const meta = what => [ { label: "Week", value: period }, { label: "What", value: what }, { label: "Made by", value: "scripts/weekly-report.mjs (Goes-Local repository)" }, { label: "weekly-report.mjs", value: code, type: "code", lang: "javascript" } ];

const sites = SITES.map(s => {
  const w = errBy.get(s.worker) || { requests: 0, errors: 0 }, l = lcpBy.get(s.env);
  return {
    site: NAMES[s.env] || s.env, domain: s.host, page_views: pv.get(s.env) || 0, page_views_prev_week: pvPrev.get(s.env) || 0,
    change_pct: pct(pv.get(s.env) || 0, pvPrev.get(s.env) || 0), visits: vs.get(s.env) || 0,
    page_speed_p75_s: l && l.n ? Math.round(l.w / l.n / 1e5) / 10 : null, phone_share_pct: devAll.get(s.env) ? Math.round(100 * (phone.get(s.env) || 0) / devAll.get(s.env)) : null,
    server_requests: w.requests, server_errors: w.errors,
  };
}).sort((a, b) => b.page_views - a.page_views);

const pageMap = new Map();
for (const r of pg) { const s = siteOf(r.dimensions.requestHost); if (!s) continue; const k = s.env + " " + r.dimensions.requestPath; const o = pageMap.get(k) || { site: NAMES[s.env], domain: s.host, page: r.dimensions.requestPath, page_views: 0, loads_timed: 0, w: 0 }; o.page_views += r.count; pageMap.set(k, o); }
for (const r of pgv) { const s = siteOf(r.dimensions.requestHost); if (!s) continue; const o = pageMap.get(s.env + " " + r.dimensions.requestPath); if (o) { o.loads_timed += r.count; o.w += r.count * r.quantiles.largestContentfulPaintP75; } }
const allPages = [ ...pageMap.values() ].map(o => ({ site: o.site, domain: o.domain, page: o.page, page_views: o.page_views, loads_timed: o.loads_timed, page_speed_p75_s: o.loads_timed ? Math.round(o.w / o.loads_timed / 1e5) / 10 : null }));
const pages = [];
for (const s of SITES) pages.push(...allPages.filter(p => p.domain === s.host).sort((a, b) => b.page_views - a.page_views).slice(0, 10));
const slow = allPages.filter(p => p.loads_timed >= MIN_LOADS && p.page_speed_p75_s * 1000 > SLOW_MS).sort((a, b) => b.page_views - a.page_views).slice(0, 25);

const srcMap = new Map();
const kind = h => { h = String(h || "").replace(/^www\./, ""); if (!h) return "Direct (typed or bookmarked)"; if (/google\./.test(h)) return "Google"; if (/bing\.com|duckduckgo|yahoo|ecosia|brave/.test(h)) return "Other search engines"; if (/chatgpt|openai|perplexity|claude\.ai|gemini|copilot/.test(h)) return "AI assistants"; if (/facebook|instagram|fb\.|t\.co$|twitter|x\.com|linkedin|tiktok|youtube|reddit|pinterest/.test(h)) return "Social media"; if (siteOf(h) || /goeslocal\.com|homeservicesin/.test(h)) return "Within the site"; return "Other websites"; };
for (const r of ref) { const s = siteOf(r.dimensions.requestHost); if (!s) continue; const k = s.env + "|" + kind(r.dimensions.refererHost); const o = srcMap.get(k) || { site: NAMES[s.env], domain: s.host, source: kind(r.dimensions.refererHost), visits: 0 }; o.visits += r.sum.visits; srcMap.set(k, o); }
const sources = [ ...srcMap.values() ].filter(o => o.source !== "Within the site").sort((a, b) => a.site < b.site ? -1 : a.site > b.site ? 1 : b.visits - a.visits);

fs.mkdirSync(OUT, { recursive: true });
const w = (f, rows, what) => fs.writeFileSync(path.join(OUT, f), JSON.stringify({ rows, meta: meta(what) }));
w("sites.json", sites, "Per site: page views (this week and the week before, from Cloudflare Web Analytics, bots excluded), visits, page speed = 75th-percentile time until the main content shows, share of page views on phones, and server requests/errors (Cloudflare Workers analytics; sampled).");
w("pages.json", pages, "Top 10 pages per site by page views, with their page speed (75th percentile).");
w("slow.json", slow, `Pages with at least ${MIN_LOADS} timed loads whose main content took longer than ${SLOW_MS / 1000} s for 1 visit in 4 (75th percentile), most viewed first.`);
w("sources.json", sources, "Visits per site by where the visitor came from (the previous page's website, grouped). Clicks between pages of the same site are left out.");
console.log(`week ${period}: ${sites.length} sites, ${pages.length} top pages, ${slow.length} slow pages, ${sources.length} source rows → ${OUT}/`);
console.log(sites.map(s => `  ${s.site}: ${s.page_views} views (${s.change_pct ?? "–"}%), speed ${s.page_speed_p75_s ?? "–"} s, errors ${s.server_errors}`).join("\n"));
