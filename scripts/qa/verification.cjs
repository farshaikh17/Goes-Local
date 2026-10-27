// QA suite for business verification (local wrangler dev on :8791, BV_TEST_ECHO=1, local D1/KV).
// How to run: start `npx wrangler dev --env tampa --local --test-scheduled --port 8791 --env-file <vars with ADMIN_LOGIN_KEY=localtestkey123, BV_TEST_ECHO=1> --persist-to <dir>/wstate` logging to <dir>/dev.log, run /admin/migrate, then run this file from <dir>.
const { execSync } = require("child_process");
const fs = require("fs");
const SP = __dirname, BASE = "http://localhost:8791", REPO = "/home/user/Goes-Local";
const LOG = SP + "/dev.log";
const W = `npx wrangler --cwd ${REPO}`;
const sql = q => {
  const out = execSync(`${W} d1 execute tampa-directory-db --env tampa --local --persist-to ${SP}/wstate --json --command ${JSON.stringify(q.replace(/\s+/g, " "))}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const j = JSON.parse(out.slice(out.indexOf("[")));
  return j[j.length - 1].results;
};
const kvList = prefix => {
  const out = execSync(`${W} kv key list --binding SESSIONS --env tampa --local --persist-to ${SP}/wstate --prefix ${prefix}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out.slice(out.indexOf("["))).map(k => k.name);
};
const lastCode = () => { const m = fs.readFileSync(LOG, "utf8").match(/BV TEST CODE (\d{6})/g); return m ? m[m.length - 1].slice(-6) : ""; };
const txt = h => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
let n = 0, fails = 0;
const ok = (cond, name, extra) => { n++; if (cond) console.log("PASS", name); else { fails++; console.log("FAIL", name, extra || ""); } };
const F = async (u, o) => { try { return await fetch(u, o); } catch (e) { await new Promise(r => setTimeout(r, 1500)); return fetch(u, o); } };
const post = async (path, body, ip) => {
  const r = await F(BASE + path, { method: "POST", redirect: "manual", body: new URLSearchParams(body), headers: { "cf-connecting-ip": ip || "1.1.1.1" } });
  return { status: r.status, loc: r.headers.get("location") || "", cookie: r.headers.get("set-cookie") || "", html: await r.text() };
};
const get = async path => { const r = await F(BASE + path, { redirect: "manual" }); return { status: r.status, html: await r.text() }; };
const refOf = loc => (loc.match(/ref=([a-f0-9]+)/) || [])[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (fn()) return true; } catch {} await sleep(3000); } return false; };
const claim = (id, email, ip) => post("/api/claim", { id, email, name: "QA Person", role: "Owner", phone: "8135550100", details: "qa" }, ip);

(async () => {
  sql("DELETE FROM claims");
  sql("DELETE FROM businesses WHERE ghl_id LIKE 'QA%'");
  sql(`INSERT INTO businesses(ghl_id,city,cat,cs,sub,slug,name,addr,ph,email,web,claimed,owner_email,updated_at) VALUES
    ('QA1','Tampa','Home Services','home-services','Plumber','qa-one','QA One Plumbing','1 St','(813) 555-0101','office@qaone.com','',0,NULL,1),
    ('QA2','Tampa','Home Services','home-services','Plumber','qa-two','QA Two Roofing','2 St','','','https://www.qatwo.com',0,NULL,1),
    ('QA3','Tampa','Home Services','home-services','Plumber','qa-three','QA Three HVAC','3 St','(813) 555-0103','','',1,'oldowner@qathree.com',1),
    ('QA4','Tampa','Home Services','home-services','Plumber','qa-four','QA Four Pools','4 St','(813) 555-0104','','',0,NULL,1),
    ('QA5','Tampa','Home Services','home-services','Plumber','qa-five','<script>alert(1)</script> Five','5 St','(813) 555-0105','','',0,NULL,1),
    ('QA6','Tampa','Home Services','home-services','Plumber','qa-six','QA Six Cleaners','6 St','(813) 555-0106','','',1,'same@qasix.com',1),
    ('QA7','Tampa','Home Services','home-services','Plumber','qa-seven','QA Seven Movers','7 St','(813) 555-0107','','',0,NULL,1),
    ('QA8','Tampa','Home Services','home-services','Plumber','qa-eight','QA Eight Bakery','8 St','(813) 555-0108','owner@qaeight.com','',0,NULL,1),
    ('QA9','Tampa','Home Services','home-services','Plumber','qa-nine','QA Nine Florist','9 St','(813) 555-0109','','',0,NULL,1)`);

  // T1 happy path claim (SMS) + wrong code + reuse
  let r = await claim("QA1", "t1@example.com", "10.0.0.1");
  let ref = refOf(r.loc);
  ok(r.status === 302 && ref, "T1 claim redirects to code page", r.status + " " + r.loc);
  let pg = await get("/verify-business?ref=" + ref);
  ok(/business phone ending 0101/.test(txt(pg.html)), "T1 page names phone ending 0101");
  ok(/Email the code to o•••@qaone\.com instead/.test(txt(pg.html)), "T1 offers email instead");
  r = await post("/verify-business", { ref, code: "000000" });
  ok(/doesn't match/.test(txt(r.html)), "T1 wrong code rejected");
  r = await post("/verify-business", { ref, code: lastCode() });
  ok(r.status === 200 && /You're verified/.test(txt(r.html)) && !/gl_sess/.test(r.cookie), "T1 right phone code → verified, NOT logged in (sign-in link emailed)", r.status + " " + r.loc);
  let row = sql("SELECT status,notes FROM claims WHERE ghl_id='QA1'")[0];
  ok(row.status === "approved" && /verified by text code to ending 0101/.test(row.notes), "T1 claims row approved with note", JSON.stringify(row));
  r = await post("/verify-business", { ref, code: lastCode() });
  ok(!/account/.test(r.loc) && !/You're verified/.test(txt(r.html)), "T1 reusing a finished code does not approve again", r.status + " " + r.loc);

  // T2 tier A: no phone/email on listing, claimant on website domain
  r = await claim("QA2", "boss@qatwo.com", "10.0.0.2");
  ref = refOf(r.loc);
  pg = ref ? await get("/verify-business?ref=" + ref) : { html: "" };
  ok(ref && /b•••@qatwo\.com/.test(txt(pg.html)), "T2 website-domain email gets a code", r.loc);
  // T2b gmail on the same listing → no instant route, old flow
  r = await claim("QA2", "someone@gmail.com", "10.0.0.3");
  ok(r.status === 200 && /Check your email/.test(txt(r.html)), "T2b no channel → old team flow", r.status);

  // T3 dispute → keep listing
  r = await claim("QA3", "newperson@example.com", "10.0.0.4");
  ref = refOf(r.loc);
  r = await post("/verify-business", { ref, code: lastCode() });
  ok(/Verified — almost there/.test(txt(r.html)) && !r.cookie.includes("gl_sess"), "T3 dispute: verified but not handed over", r.status);
  row = sql("SELECT id,status FROM claims WHERE ghl_id='QA3' AND email='newperson@example.com'")[0];
  ok(row && row.status === "transfer-pending", "T3 row is transfer-pending", JSON.stringify(row));
  const keeps = kvList("keep:");
  ok(keeps.length === 1, "T3 keep token stored", keeps.length);
  const kt = keeps[0].slice(5);
  pg = await get("/keep-listing?t=" + kt);
  ok(/Keep my listing/.test(pg.html) && sql(`SELECT status FROM claims WHERE id=${row.id}`)[0].status === "transfer-pending", "T3 GET keep-listing changes nothing");
  r = await post("/keep-listing?t=" + kt, {});
  ok(/Your listing stays with you/.test(txt(r.html)) && sql(`SELECT status FROM claims WHERE id=${row.id}`)[0].status === "disputed", "T3 POST keep-listing → disputed");
  r = await post("/keep-listing?t=" + kt, {});
  ok(/Nothing to do here/.test(txt(r.html)), "T3 keep link works once");

  // T4 dispute → no objection → hourly job moves it after 72h
  r = await claim("QA3", "second@example.com", "10.0.0.5");
  ref = refOf(r.loc);
  await post("/verify-business", { ref, code: lastCode() });
  sql(`UPDATE claims SET decided_at=${Date.now() - 73 * 3600e3} WHERE email='second@example.com'`);
  sql("DELETE FROM meta WHERE k='cron_hourly_at'");
  await get("/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  await until(() => sql("SELECT status FROM claims WHERE email='second@example.com'")[0].status === "approved", 150000);
  row = sql("SELECT status,notes FROM claims WHERE email='second@example.com'")[0];
  ok(row.status === "approved" && /no objection/.test(row.notes), "T4 transfer completes after 72h", JSON.stringify(row));

  // T5 owner re-claiming own listing → normal approve, no dispute
  r = await claim("QA6", "same@qasix.com", "10.0.0.6");
  ref = refOf(r.loc);
  r = await post("/verify-business", { ref, code: lastCode() });
  ok(/You're verified/.test(txt(r.html)) && !/almost there/.test(txt(r.html)), "T5 current owner re-verifying is approved directly (no dispute)", r.status);

  // T6 five wrong codes → the attempt stops quietly (no team), row stays pending until it expires
  r = await claim("QA4", "t6@example.com", "10.0.0.7");
  ref = refOf(r.loc);
  pg = await get("/verify-business?ref=" + ref);
  ok(!/Email the code/.test(txt(pg.html)), "T6 no email option when listing has no email");
  for (let i = 0; i < 4; i++) await post("/verify-business", { ref, code: "111111" });
  r = await post("/verify-business", { ref, code: "111111" });
  ok(/start again/i.test(txt(r.html)) && !/our team/.test(txt(r.html)), "T6 5th wrong code → attempt stops, owner can start again (nobody alerted)");
  ok(!/to-team/.test(sql("SELECT notes FROM claims WHERE email='t6@example.com'")[0].notes), "T6 lockout is not handed to anyone");
  r = await post("/verify-business", { ref, code: lastCode() });
  ok(!/account/.test(r.loc), "T6 right code after lockout does nothing", r.loc);
  ok(sql("SELECT status FROM claims WHERE email='t6@example.com'")[0].status === "pending", "T6 row stays pending (closes itself after 7 days)");

  // T7 resend limit (5 sends per request)
  r = await claim("QA7", "t7@example.com", "10.0.0.8");
  ref = refOf(r.loc);
  const last = await post("/verify-business/send", { ref, ch: "sms" });
  ok(/give it a minute/.test(txt(last.html)), "T7 resend within 60s is refused", last.status);

  // T8 double tap: two right codes at once → one approval
  sql("DELETE FROM claims WHERE ghl_id='QA7'");
  r = await claim("QA7", "t8@example.com", "10.0.0.9");
  ref = refOf(r.loc);
  const c8 = lastCode();
  const [a, b] = await Promise.all([post("/verify-business", { ref, code: c8 }), post("/verify-business", { ref, code: c8 })]);
  const wins = [a, b].filter(x => /You're verified/.test(txt(x.html))).length;
  ok(wins === 1, "T8 double tap approves exactly once", `${a.status} ${a.loc} | ${b.status} ${b.loc}`);

  // T9 XSS in business name is escaped
  r = await claim("QA5", "t9@example.com", "10.0.0.10");
  ref = refOf(r.loc);
  pg = await get("/verify-business?ref=" + ref);
  ok(!pg.html.includes("<script>alert(1)") && pg.html.includes("&lt;script&gt;alert(1)"), "T9 business name escaped on code page");

  // T10 hand to team
  r = await post("/verify-business/team", { ref });
  ok(/Sent to our team/.test(txt(r.html)), "T10 send-to-team page");
  pg = await get("/verify-business?ref=" + ref);
  ok(/expired/.test(txt(pg.html)), "T10 code page closed after hand-off");

  // T11 garbage refs/tokens never crash
  for (const pth of ["/verify-business?ref=../../x", "/verify-business?ref=", "/keep-listing?t=nope", "/verify-business/restart?t=%3Cx%3E"]) {
    pg = await get(pth);
    ok(pg.status < 500, "T11 bad link handled: " + pth, pg.status);
  }
  r = await post("/verify-business", { ref: "zzzzzzzzzzzz", code: "123456" });
  ok(r.status < 500, "T11 bad ref on POST handled", r.status);

  // T12 reminder email + restart link
  sql("DELETE FROM claims WHERE ghl_id='QA4'");
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,role,verify,notes,status,created_at) VALUES('QA4','QA Four Pools','R','rem@example.com','8135550100','Owner','','[code-sent]','pending',${Date.now() - 3 * 3600e3})`);
  sql("DELETE FROM meta WHERE k='cron_hourly_at'");
  await get("/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  await until(() => /\[reminded\]/.test(sql("SELECT notes FROM claims WHERE email='rem@example.com'")[0].notes || ""), 150000);
  row = sql("SELECT id,notes FROM claims WHERE email='rem@example.com'")[0];
  ok(/\[reminded\]/.test(row.notes || ""), "T12 reminder marked once", JSON.stringify(row));
  const rems = kvList("bvr:");
  ok(rems.length >= 1, "T12 restart token stored");
  const rt = rems[rems.length - 1].slice(4);
  pg = await get("/verify-business/restart?t=" + rt);
  ok(/Send me a new code/.test(pg.html), "T12 GET restart shows a button only");
  r = await post("/verify-business/restart?t=" + rt, {});
  ok(r.status === 302 && /verify-business\?ref=/.test(r.loc), "T12 POST restart sends a fresh code", r.status + " " + r.loc);
  sql("DELETE FROM meta WHERE k='cron_hourly_at'");
  await get("/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  await sleep(60000);
  ok((sql("SELECT notes FROM claims WHERE email='rem@example.com'")[0].notes.match(/\[reminded\]/g) || []).length === 1, "T12 no second reminder");

  // T13 add-a-business rate limit per visitor (4/hour) → then old flow
  let lastAdd;
  for (let i = 0; i < 5; i++) lastAdd = await post("/api/lead", { type: "add", business: "QA Add " + i, category: "Food", email: `add${i}@example.com`, phone: "81355502" + (10 + i), owner_name: "A" }, "10.9.9.9");
  ok(lastAdd.status === 200 && /got it/i.test(txt(lastAdd.html)), "T13 5th add from same visitor falls back to team", lastAdd.status + " " + lastAdd.loc);

  // T14 admin approve button still works (regression after extraction)
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,role,verify,notes,status,created_at) VALUES('QA4','QA Four Pools','Adm','adm@example.com','','Owner','','','pending',${Date.now()})`);
  const cid = sql("SELECT id FROM claims WHERE email='adm@example.com'")[0].id;
  const login = await F(BASE + "/admin/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ as: "admin", key: "localtestkey123" }) });
  const ck = (login.headers.get("set-cookie") || "").split(";")[0];
  const ap = await F(BASE + "/admin/claims/approve", { method: "POST", redirect: "manual", headers: { cookie: ck }, body: new URLSearchParams({ claimId: String(cid), ghlId: "QA4", email: "adm@example.com" }) });
  ok(ap.status === 302 && sql(`SELECT status FROM claims WHERE id=${cid}`)[0].status === "approved", "T14 admin Approve button still approves", ap.status);
  const cl = await F(BASE + "/admin/claims", { headers: { cookie: ck } });
  ok(cl.status === 200 && /QA Three HVAC/.test(await cl.text()), "T14 admin Claims page lists disputes", cl.status);


  // T15 email code to the claimant's own (listing) email → signed in
  r = await claim("QA8", "owner@qaeight.com", "10.0.0.15");
  ref = refOf(r.loc);
  pg = await get("/verify-business?ref=" + ref);
  ok(/o•••@qaeight\.com/.test(txt(pg.html)), "T15 listing-email match gets the code by email first");
  r = await post("/verify-business", { ref, code: lastCode() });
  ok(r.status === 302 && /account\?verified=1/.test(r.loc) && /gl_sess/.test(r.cookie), "T15 proven email → signed in", r.status + " " + r.loc);
  const ownerCookie = (r.cookie.match(/gl_sess=[^;]+/) || [""])[0];

  // T16 20 parallel wrong guesses → at most 5 count; the right code is then refused
  r = await claim("QA9", "t16@example.com", "10.0.0.16");
  ref = refOf(r.loc);
  const c16 = lastCode();
  await Promise.all(Array.from({ length: 20 }, (_, i) => post("/verify-business", { ref, code: String(100000 + i) }, "10.1.1." + i)));
  const tries = sql("SELECT bv_tries FROM claims WHERE email='t16@example.com'")[0].bv_tries;
  ok(tries <= 5, "T16 parallel guesses capped at 5", tries);
  r = await post("/verify-business", { ref, code: c16 });
  ok(!/You're verified/.test(txt(r.html)) && !/account/.test(r.loc), "T16 right code refused after the cap");

  // T17 backlog invites: dry run lists, POST marks [invited], restart sends a code, no instant team hand-off
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,role,verify,notes,status,created_at) VALUES
    ('QA7','QA Seven Movers','Old','old1@example.com','','Owner','','','pending',${Date.now() - 20 * 864e5}),
    ('QA7','QA Seven Movers','Old','old1@example.com','','Owner','','','pending',${Date.now() - 21 * 864e5}),
    ('QA2','QA Two Roofing','Old','old2@gmail.com','','Owner','','','pending',${Date.now() - 20 * 864e5}),
    ('QA4','Test Bakery','T','t@example.com','','Owner','','','pending',${Date.now() - 20 * 864e5})`);
  const login2 = await F(BASE + "/admin/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ as: "admin", key: "localtestkey123" }) });
  const ck2 = (login2.headers.get("set-cookie") || "").split(";")[0];
  let dr = await (await F(BASE + "/admin/verify-invites", { headers: { cookie: ck2 } })).text();
  ok(/SEND\s+#\d+\s+pending\s+QA Seven Movers\s+<old1@example.com>/.test(dr), "T17 dry run will email old1 once", dr.slice(0, 300));
  ok(/duplicate of a newer request/.test(dr) && /no phone or email on the listing/.test(dr) && /looks like a test/.test(dr), "T17 dry run skips duplicate, no-channel and test rows");
  const before = sql("SELECT count(*) n FROM claims WHERE notes LIKE '%[invited]%'")[0].n;
  ok(before === 0, "T17 dry run sent nothing");
  const sendRes = await (await F(BASE + "/admin/verify-invites", { method: "POST", headers: { cookie: ck2 } })).text();
  ok(/Sent \d+ of/.test(sendRes), "T17 POST sends a batch", sendRes);
  const inv = sql("SELECT id FROM claims WHERE email='old1@example.com' AND notes LIKE '%[invited]%'");
  ok(inv.length === 1, "T17 exactly one old1 row marked invited", inv.length);
  dr = await (await F(BASE + "/admin/verify-invites", { headers: { cookie: ck2 } })).text();
  ok(!/SEND\s+#\d+\s+pending\s+QA Seven Movers/.test(dr), "T17 second dry run won't email old1 again");
  const bvr = kvList("bvr:");
  let restarted = false;
  for (const k of bvr) {
    const pg2 = await post("/verify-business/restart?t=" + k.slice(4), {}, "10.17.0.1");
    if (/verify-business\?ref=/.test(pg2.loc)) { restarted = true; break; }
  }
  ok(restarted, "T17 invite button sends a fresh code");
  sql("DELETE FROM meta WHERE k='cron_hourly_at'");
  await get("/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*");
  await sleep(45000);
  const n17 = sql("SELECT notes FROM claims WHERE id=" + inv[0].id)[0].notes;
  ok(!/to-team/.test(n17) && !/reminded/.test(n17), "T17 no instant reminder/team hand-off after a fresh code", n17);

  // T18 colleague (same company domain, and the listing's website is that domain) claiming an owned listing → approved, no dispute
  sql("UPDATE businesses SET claimed=1, owner_email='boss@qaten.com', email='', ph='(813) 555-0110', web='https://www.qaten.com/' WHERE ghl_id='QA1'");
  r = await claim("QA1", "colleague@qaten.com", "10.0.0.18");
  ref = refOf(r.loc);
  r = await post("/verify-business", { ref, code: lastCode() });
  const st18 = sql("SELECT status FROM claims WHERE email='colleague@qaten.com' ORDER BY id DESC LIMIT 1")[0].status;
  ok(st18 === "approved" && !/almost there/.test(txt(r.html)), "T18 colleague claim approved without a dispute", st18);
  // T19 owner whose sign-in email = business email can save edits (Sun Kissed case)
  sql("UPDATE businesses SET claimed=1, owner_email='owner@qaeight.com', email='owner@qaeight.com' WHERE ghl_id='QA8'");
  const ed = await F(BASE + "/manage/edit", { method: "POST", redirect: "manual", headers: { cookie: ownerCookie }, body: new URLSearchParams({ id: "QA8", bizname: "QA Eight Bakery", bizemail: "owner@qaeight.com", services: "Bread, cakes", hours: "Mon 9-5" }) });
  const edLoc = ed.headers.get("location") || "";
  ok(ed.status === 302 && !/Business%20email/i.test(edLoc), "T19 business email = sign-in email no longer blocks the save (local copy has no GHL, so only the CRM step fails)", ed.status + " " + edLoc);
  // T20 colleague access to the account: sign in as colleague via a fresh email code on QA8? use ownedIds through /manage/edit GET
  sql("UPDATE businesses SET owner_email='owner@qaeight.com' WHERE ghl_id='QA8'");
  const pg20 = await F(BASE + "/manage/hub?id=QA8", { headers: { cookie: ownerCookie } });
  ok(pg20.status === 200 && /Services you offer/.test(await pg20.text()), "T20 owner can open the edit form (Your listing tab of Manage listing)");
  const ed20 = await F(BASE + "/manage/edit?id=QA8&ok=1&err=x", { redirect: "manual", headers: { cookie: ownerCookie } });
  ok(ed20.status === 302 && /\/manage\/hub\?id=QA8&lerr=x&lok=1$/.test(ed20.headers.get("location") || ""), "T20 old Edit links open the one Manage listing page", ed20.status + " " + ed20.headers.get("location"));
  // T21 team access: a colleague on the listing's own website domain gets in; a shared corporate domain does not
  const canEdit = async id => (await F(BASE + "/manage/hub?id=" + id, { redirect: "manual", headers: { cookie: ownerCookie } })).status === 200;
  sql("UPDATE businesses SET claimed=1, owner_email='boss@qaeight.com', web='https://qaeight.com' WHERE ghl_id='QA9'");
  ok(await canEdit("QA9"), "T21 colleague at the business's own website domain can manage it");
  sql("UPDATE businesses SET web='https://www.qaeight.com/agents/boss' WHERE ghl_id='QA9'");
  ok(!(await canEdit("QA9")), "T21 shared corporate domain (website is a sub-page) gives no access");
  sql("UPDATE businesses SET web='https://boss.qaeight.com' WHERE ghl_id='QA9'");
  ok(!(await canEdit("QA9")), "T21 agent sub-site on the same domain gives no access");
  sql("UPDATE businesses SET web='https://qaeight.com/?location=12' WHERE ghl_id='QA9'");
  ok(!(await canEdit("QA9")), "T21 brand home page with a location query gives no access");
  sql("UPDATE businesses SET web='https://bossbakery.com' WHERE ghl_id='QA9'");
  ok(!(await canEdit("QA9")), "T21 same email domain but a different website gives no access");
  // T24 corporate colleague claiming another agent's listing is a dispute, not an instant hand-over
  sql("UPDATE businesses SET claimed=1, owner_email='agent1@qacorp.com', email='', ph='(813) 555-0124', web='https://www.qacorp.com/agents/one' WHERE ghl_id='QA4'");
  r = await claim("QA4", "agent2@qacorp.com", "10.0.0.24");
  r = await post("/verify-business", { ref: refOf(r.loc), code: lastCode() });
  ok(/almost there/.test(txt(r.html)), "T24 same corporate domain, different agent → dispute notice to the owner", r.status);
  // T22 "Add another location" fills the email in, also for emails containing the letter s (live bug in v16.49)
  const ad = await (await F(BASE + "/add?email=sales%40mrsclean.com")).text();
  const rx = (ad.match(/get\("email"\);if\(e&&(\/.*?\/)\.test\(e\)/) || [])[1] || "";
  let fills = false; try { fills = new Function("return " + rx)().test("sales@mrsclean.com"); } catch {}
  ok(fills, "T22 add form email fill-in accepts an email with an s in it", rx);
  // T23 extra details saved with a new listing request (copied onto the listing when it is created at publish time)
  await F(BASE + "/api/lead", { method: "POST", redirect: "manual", body: new URLSearchParams({ type: "add", business: "QA Extra Co", category: "Other", email: "extra@qaextra.com", owner_name: "Ex Tra", address: "1 Extra Rd", zip: "33602", website: "qaextra.com", services: "Thing one, Thing two", hood: "Downtown", yrs: "2001", details: "We do extra things." }) });
  const ex = sql("SELECT extra FROM claims WHERE email='extra@qaextra.com' ORDER BY id DESC LIMIT 1");
  const exj = (() => { try { return JSON.parse(ex[0].extra); } catch { return {}; } })();
  ok(exj.services === "Thing one, Thing two" && exj.website === "qaextra.com" && exj.hood === "Downtown" && exj.yrs === "2001", "T23 website, services, area and year are kept with the request", JSON.stringify(ex));
  // T25 an owner adding a second location while the first is still waiting does not overwrite the first
  for (const nm of ["QA Loc One", "QA Loc Two"]) await F(BASE + "/api/lead", { method: "POST", redirect: "manual", body: new URLSearchParams({ type: "add", business: nm, category: "Other", email: "multi@qamulti.com", owner_name: "Mul Ti", address: "1 Multi Rd", zip: "33602", details: "x" }) });
  const locs = sql("SELECT business FROM claims WHERE email='multi@qamulti.com' ORDER BY id").map(x => x.business);
  ok(locs.length === 2 && locs[0] === "QA Loc One" && locs[1] === "QA Loc Two", "T25 two locations from one owner stay two separate requests", JSON.stringify(locs));
  // T26 sending the same business twice is still treated as a repeat (no duplicate)
  await F(BASE + "/api/lead", { method: "POST", redirect: "manual", body: new URLSearchParams({ type: "add", business: "QA Loc Two", category: "Other", email: "multi@qamulti.com", owner_name: "Mul Ti", address: "1 Multi Rd", zip: "33602", details: "x" }) });
  ok(sql("SELECT count(*) n FROM claims WHERE email='multi@qamulti.com'")[0].n === 2, "T26 the same business sent twice is updated, not duplicated");
  // T27 location A, then B, then A again: A's details land on A's request, not B's
  await F(BASE + "/api/lead", { method: "POST", redirect: "manual", body: new URLSearchParams({ type: "add", business: "QA Loc One", category: "Other", email: "multi@qamulti.com", owner_name: "Mul Ti", address: "1 Multi Rd", zip: "33611", website: "loc-one.com", details: "x" }) });
  const ex27 = sql("SELECT business, extra FROM claims WHERE email='multi@qamulti.com' ORDER BY id");
  const ofb = nm => { try { return JSON.parse((ex27.find(x => x.business === nm) || {}).extra || "{}"); } catch { return {}; } };
  ok(ofb("QA Loc One").website === "loc-one.com" && ofb("QA Loc Two").website !== "loc-one.com", "T27 resubmitted location keeps its own details", JSON.stringify(ex27));
  // T28–T33 no people: duplicates close, never-coded requests get an invite, no-channel ones reach the dev team, old ones expire
  const hourlyRun = async () => { sql("DELETE FROM meta WHERE k='cron_hourly_at'"); await get("/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"); };
  const ago = Date.now() - 2 * 3600e3;
  sql("UPDATE businesses SET claimed=1, owner_email='dup@qadup.com' WHERE ghl_id='QA2'");
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,status,notes,created_at) VALUES('QA2','QA Two Roofing','Dup','dup@qadup.com','','pending-listing','already mine',${ago})`);
  sql("UPDATE businesses SET claimed=0, owner_email=NULL WHERE ghl_id='QA7'");
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,status,notes,created_at) VALUES('QA7','QA Seven Movers','Ann','ann@qaann.com','8135550177','pending','no code yet',${ago})`);
  sql("UPDATE businesses SET ph='', email='', web='' WHERE ghl_id='QA5'");
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,status,notes,created_at) VALUES('QA5','QA Five','Nochan','nochan@qanochan.com','','pending','no channel',${ago})`);
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,status,notes,created_at) VALUES('QA4','QA Four Pools','Fresh','fresh@qafresh.com','','pending','just now',${Date.now()})`);
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,status,notes,created_at,decided_at) VALUES('QA9','QA Nine Florist','Old','old@qaold.com','','pending-listing','[code-sent]',${Date.now() - 9 * 864e5},${Date.now() - 8 * 864e5})`);
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,status,notes,created_at) VALUES('QA8','QA Eight Bakery','Inv','inv@qainv.com','','pending','[invited]',${Date.now() - 20 * 864e5})`);
  sql(`INSERT INTO claims(ghl_id,business,name,email,phone,status,notes,created_at) VALUES('QA8','QA Eight Bakery','Held','held@qaheld.com','','pending-listing','[invited]\n[held: looks like spam]',${Date.now() - 20 * 864e5})`);
  await hourlyRun();
  await until(() => sql("SELECT status FROM claims WHERE email='old@qaold.com'")[0].status === "expired" && sql("SELECT status FROM claims WHERE email='dup@qadup.com'")[0].status === "listed", 120000);
  ok(sql("SELECT status FROM claims WHERE email='dup@qadup.com'")[0].status === "listed", "T28 duplicate request for a business the person already owns closes by itself");
  await until(() => /\[invited\]/.test(sql("SELECT notes FROM claims WHERE email='ann@qaann.com'")[0].notes), 60000);
  ok(/\[invited\]/.test(sql("SELECT notes FROM claims WHERE email='ann@qaann.com'")[0].notes), "T29 a request that never got a code is invited to verify automatically");
  ok(/\[dev: no phone or email/.test(sql("SELECT notes FROM claims WHERE email='nochan@qanochan.com'")[0].notes), "T30 a claim with no way to send a code goes to the dev team");
  ok(!/invited|dev:/.test(sql("SELECT notes FROM claims WHERE email='fresh@qafresh.com'")[0].notes || ""), "T31 a brand-new request is left alone for 30 minutes");
  ok(sql("SELECT status FROM claims WHERE email='old@qaold.com'")[0].status === "expired", "T32 a request never verified within 7 days closes by itself");
  await hourlyRun();
  await sleep(4000);
  ok((sql("SELECT notes FROM claims WHERE email='ann@qaann.com'")[0].notes.match(/\[invited\]/g) || []).length === 1, "T33 the invite goes out only once");
  const inv34 = sql("SELECT status,decided_at FROM claims WHERE email='inv@qainv.com'")[0];
  ok(inv34.status === "pending" && inv34.decided_at > Date.now() - 3600e3, "T34 an old backlog invite starts its 7 days now instead of expiring at once", JSON.stringify(inv34));
  ok(sql("SELECT status FROM claims WHERE email='held@qaheld.com'")[0].status === "rejected", "T34 a request held back as likely spam is closed");
  // T35 sub-category spellings that differ only in capitals or spaces merge on migrate; others stay as they are
  sql("DELETE FROM businesses WHERE ghl_id LIKE 'SC%'");
  sql(`INSERT INTO businesses(ghl_id,city,cat,cs,sub,slug,name,addr,claimed,updated_at) VALUES
    ('SC1','Tampa','Home Services','home-services','General Contractor','sc-1','SC One','1 St',0,1),
    ('SC2','Tampa','Home Services','home-services','General contractor','sc-2','SC Two','2 St',0,1),
    ('SC3','Tampa','Home Services','home-services','general  contractor ','sc-3','SC Three','3 St',0,1),
    ('SC4','Tampa','Home Services','home-services','Unique sub','sc-4','SC Four','4 St',0,1)`);
  const lg = await F(BASE + "/admin/login", { method: "POST", redirect: "manual", body: new URLSearchParams({ as: "admin", key: "localtestkey123" }) });
  await F(BASE + "/admin/migrate", { headers: { cookie: (lg.headers.get("set-cookie") || "").split(";")[0] } });
  const subs = sql("SELECT ghl_id,sub FROM businesses WHERE ghl_id LIKE 'SC%' ORDER BY ghl_id").map(r => r.sub);
  ok(subs.slice(0, 3).every(x => x === "General Contractor") && subs[3] === "Unique sub", "T35 look-alike sub-categories merge into one spelling", JSON.stringify(subs));
  // T36 a listing named exactly like a sub-category moves off that address, so the sub-category page shows
  sql(`INSERT INTO businesses(ghl_id,city,cat,cs,sub,slug,name,addr,claimed,updated_at) VALUES ('SC5','Tampa','Home Services','home-services','General Contractor','general-contractor','General Contractor','5 St',0,1)`);
  await F(BASE + "/admin/migrate", { headers: { cookie: (lg.headers.get("set-cookie") || "").split(";")[0] } });
  const sl36 = sql("SELECT slug FROM businesses WHERE ghl_id='SC5'")[0].slug;
  const pg36 = await get("/home-services/general-contractor");
  ok(sl36 === "general-contractor-2" && pg36.status === 200 && /SC One/.test(pg36.html), "T36 sub-category page wins over a listing with the same name", sl36 + " " + pg36.status);
  // T37 two listings on the same Google listing (same CID) become one; the hidden one's address goes to the kept one
  sql(`INSERT INTO businesses(ghl_id,city,cat,cs,sub,slug,name,addr,map,rev,claimed,updated_at) VALUES
    ('GC1','Tampa','Home Services','home-services','Plumber','gc-best','GC Best Plumbing','9 St','https://www.google.com/maps?cid=123456789',50,0,1),
    ('GC2','Tampa','Home Services','home-services','Plumber','gc-copy','GC Best Plumbing LLC','10 Ave','https://www.google.com/maps?cid=123456789',3,0,1),
    ('GC3','Tampa','Home Services','home-services','Plumber','gc-own','GC Different Business','11 St','https://www.google.com/maps?cid=123456789',3,0,1)`);
  await F(BASE + "/admin/duplicates", { headers: { cookie: (lg.headers.get("set-cookie") || "").split(";")[0] } });
  const left37 = sql("SELECT ghl_id FROM businesses WHERE ghl_id LIKE 'GC%' ORDER BY ghl_id").map(r => r.ghl_id).join(",");
  const r37 = await F(BASE + "/home-services/gc-copy", { redirect: "manual" });
  ok(left37 === "GC1,GC3" && r37.status === 301 && /gc-best/.test(r37.headers.get("location") || ""), "T37 same Google listing + same name shows once (copy forwards); a different name on that link stays", left37 + " " + r37.status);
  // T38 a sales-held listing: the owner confirms email, name and phone on /manage/confirm before it counts as claimed
  sql(`INSERT INTO owner_pending(ghl_id,email,tier,created_at) VALUES('QA8','owner@qaeight.com','verified',1) ON CONFLICT(ghl_id) DO UPDATE SET email='owner@qaeight.com', activated_at=NULL`);
  require("fs").writeFileSync(SP + "/owner-cookie.txt", ownerCookie);
  const a38 = await F(BASE + "/account", { redirect: "manual", headers: { cookie: ownerCookie } });
  const c38 = await F(BASE + "/manage/confirm", { headers: { cookie: ownerCookie } });
  const c38h = await c38.text();
  const bad38 = await F(BASE + "/manage/confirm", { method: "POST", redirect: "manual", headers: { cookie: ownerCookie }, body: new URLSearchParams({ email: "other@x.com", name: "Pat Baker", phone: "8135550100" }) });
  const bad38h = await bad38.text();
  const ok38 = await F(BASE + "/manage/confirm", { method: "POST", redirect: "manual", headers: { cookie: ownerCookie }, body: new URLSearchParams({ email: "Owner@QAEight.com", name: "Pat Baker", phone: "8135550100" }) });
  const act38 = sql(`SELECT activated_at FROM owner_pending WHERE ghl_id='QA8'`)[0] || {};
  const a38b = await F(BASE + "/account", { redirect: "manual", headers: { cookie: ownerCookie } });
  ok(/\/manage\/confirm/.test(a38.headers.get("location") || "") && /QA Eight Bakery/.test(c38h) && /same email you signed in with/.test(bad38h) && ok38.status === 302 && /claimed=1/.test(ok38.headers.get("location") || "") && act38.activated_at > 0 && a38b.status === 200, "T38 held listing: owner confirms email + name + phone, then it's claimed", [ a38.status, c38.status, bad38.status, ok38.status, act38.activated_at, a38b.status ].join(" "));
  sql("DELETE FROM businesses WHERE ghl_id LIKE 'GC%'"); sql("DELETE FROM dup_hidden WHERE ghl_id LIKE 'GC%'"); sql("DELETE FROM slug_redirects WHERE ghl_id LIKE 'GC%'");
  sql("DELETE FROM businesses WHERE ghl_id LIKE 'SC%'");
  console.log(`\n${n - fails}/${n} passed`);
})().catch(e => { console.log("CRASH", e); process.exit(1); });
