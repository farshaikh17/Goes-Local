#!/usr/bin/env node
// Applies the Goes Local bot/scraper protection to one or more Cloudflare zones (free plan):
// 3 WAF custom rules + 1 rate-limiting rule. Webhooks, /admin and requests carrying our
// private x-gl-check header (derived from ADMIN_LOGIN_KEY) are always exempt.
// Bot Fight Mode is deliberately NOT used: on the free plan it can't have exceptions and
// would challenge GoHighLevel/Stripe webhooks and our own deploy checks.
// Usage: node scripts/security-rules.mjs miamigoeslocal.com orlandogoeslocal.com ...
// Needs CLOUDFLARE_API_TOKEN (Zone WAF Edit) and ADMIN_LOGIN_KEY.
import { createHash } from "node:crypto";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN, KEY = process.env.ADMIN_LOGIN_KEY;
if (!TOKEN || !KEY) { console.error("CLOUDFLARE_API_TOKEN and ADMIN_LOGIN_KEY are required."); process.exit(2); }
const CHECK = createHash("sha256").update("gl-check:" + KEY).digest("hex").slice(0, 32);
const zones = process.argv.slice(2);
if (!zones.length) { console.error("usage: security-rules.mjs <zone name> ..."); process.exit(2); }

const api = async (path, method = "GET", body) => {
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, { method, headers: { Authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`${method} ${path}: ${JSON.stringify(j.errors || j).slice(0, 400)}`);
  return j.result;
};

const AI_AGENTS = [ "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot", "bingbot", "DuckAssistBot", "MistralAI-User", "Amazonbot" ];
const EXEMPT = `not starts_with(http.request.uri.path, "/webhooks/") and not starts_with(http.request.uri.path, "/admin") and not http.request.uri.path in {"/robots.txt" "/llms.txt" "/sitemap.xml" "/sitemap-index.xml" "/sitemap-categories.xml" "/sitemap-locations.xml" "/sitemap-listings.xml" "/post-sitemap.xml" "/news-sitemap.xml" "/sitemap-best.xml" "/blog-sitemap.xml"} and not any(http.request.headers["x-gl-check"][*] eq "${CHECK}")`;
const NOT_AI = `not (${AI_AGENTS.map(a => `http.user_agent contains "${a}"`).join(" or ")})`;
const CLOUD_ASNS = "45102 16276 14061 24940 16509 14618 8075 396982 63949 20473";
const SEO_BOTS = [ "SemrushBot", "AhrefsBot", "MJ12bot", "DotBot", "PetalBot", "Bytespider" ];

const custom = [
  { description: "GL: block SEO scrapers", action: "block",
    expression: `(${SEO_BOTS.map(b => `http.user_agent contains "${b}"`).join(" or ")}) and not starts_with(http.request.uri.path, "/webhooks/")` },
  { description: "GL: challenge cloud-hosted clients (Alibaba, OVH, DigitalOcean, Hetzner, AWS, Azure, GCP, Linode, Vultr)", action: "managed_challenge",
    expression: `(ip.geoip.asnum in {${CLOUD_ASNS}}) and not cf.client.bot and ${NOT_AI} and ${EXEMPT}` },
  // Tampa, 27–28 Oct: ~149,000 fake sign-ups through Tor with real people's emails made GHL send ~81,000 code emails.
  // Nobody needs Tor to submit our forms, so any form submission (POST) from Tor is blocked.
  { description: "GL: block form submissions from Tor", action: "block",
    expression: `ip.src.country eq "T1" and http.request.method eq "POST" and ${EXEMPT}` },
  { description: "GL: challenge unverified filter-combination crawling", action: "managed_challenge",
    expression: `(http.request.uri.query contains "rating=" or http.request.uri.query contains "claim=" or http.request.uri.query contains "sort=") and not cf.client.bot and ${EXEMPT}` }
];
const ratelimit = [
  { description: "GL: max 60 requests / 10 s per IP", action: "block", expression: `not starts_with(http.request.uri.path, "/webhooks/") and not starts_with(http.request.uri.path, "/admin")`,
    ratelimit: { characteristics: [ "cf.colo.id", "ip.src" ], period: 10, requests_per_period: 60, mitigation_timeout: 10 } }
];

for (const name of zones) {
  const [zone] = await api(`/zones?name=${name}`);
  if (!zone) { console.error(`✗ ${name}: zone not found`); continue; }
  for (const [phase, rules] of [ [ "http_request_firewall_custom", custom ], [ "http_ratelimit", ratelimit ] ]) {
    let existing = [];
    try { existing = (await api(`/zones/${zone.id}/rulesets/phases/${phase}/entrypoint`)).rules || []; } catch {}
    const keep = existing.filter(r => !String(r.description || "").startsWith("GL: ")).map(({ id, version, last_updated, ref, ...r }) => r);
    await api(`/zones/${zone.id}/rulesets/phases/${phase}/entrypoint`, "PUT", { rules: [ ...keep, ...rules ] });
    console.log(`✓ ${name}: ${phase} — ${rules.length} Goes Local rule(s) set${keep.length ? `, ${keep.length} other rule(s) kept` : ""}`);
  }
  const bm = await api(`/zones/${zone.id}/bot_management`);
  if (bm.ai_bots_protection && bm.ai_bots_protection !== "disabled") {
    await api(`/zones/${zone.id}/bot_management`, "PUT", { ai_bots_protection: "disabled" });
    console.log(`✓ ${name}: Cloudflare "Block AI bots" turned off (it was blocking GPTBot/ClaudeBot — bad for AEO)`);
  }
  if (bm.is_robots_txt_managed) {
    await api(`/zones/${zone.id}/bot_management`, "PUT", { is_robots_txt_managed: false });
    console.log(`✓ ${name}: Cloudflare managed robots.txt turned off (the site serves its own, AI-friendly one)`);
  }
}
