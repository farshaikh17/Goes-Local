// Temporary "down for maintenance" page, deployed in place of worker.js on a site that is switched off
// (Eric, 28 Oct: Tampa and five state sites while Tampa's GHL account is off after the sign-up flood).
// Uses only the site's own dashboard Variables (CITY_BRAND, CITY_LOGO_URL), so nothing city-specific lives here.
// D1, KV, routes and Variables are untouched; putting the real site back is a normal deploy of worker.js.
// Every request — pages, forms, webhooks — gets 503 + Retry-After, which tells search engines it is temporary.
const E = s => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export default {
  async fetch(req, env) {
    const brand = env.CITY_BRAND || new URL(req.url).hostname.replace(/^www\./, "");
    const logo = env.CITY_LOGO_URL || "";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Down for maintenance | ${E(brand)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FBF5EA;font-family:Inter,Arial,sans-serif;color:#1B2A3A;padding:24px;box-sizing:border-box}
.c{max-width:520px;text-align:center}img{height:44px;width:auto;margin:0 auto 26px;display:block}
h1{font-family:Georgia,serif;color:#12263F;font-size:32px;line-height:1.2;margin:0 0 14px}p{color:#5D6F82;font-size:16px;line-height:1.6;margin:0}</style></head>
<body><div class="c">${logo ? `<img src="${E(logo)}" alt="${E(brand)}">` : `<p style="font-weight:700;color:#12263F;margin-bottom:22px">${E(brand)}</p>`}
<h1>We'll be back soon</h1><p>${E(brand)} is down for scheduled maintenance. Thanks for your patience — please check back shortly.</p></div></body></html>`;
    return new Response(html, { status: 503, headers: { "content-type": "text/html;charset=UTF-8", "retry-after": "86400", "cache-control": "no-store" } });
  },
  async scheduled() {}
};
