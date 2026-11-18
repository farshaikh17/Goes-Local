// Browser test for the owner photo pickers (v17.11). Needs a local `wrangler dev --env tampa --port 8792` with a claimed
// test listing qaTS1 (owner owner@qa-owner.example, owner_verified row) and KV session sess:qasid1; reads ADMIN_LOGIN_KEY
// from test.vars next to it. The upload step is answered by the test (the local copy has no real GHL).
const { chromium } = require('playwright'); const crypto=require('crypto'); const fs=require('fs');
const KEY=fs.readFileSync(__dirname+'/test.vars','utf8').match(/^ADMIN_LOGIN_KEY=(.*)$/m)[1].trim();
const sid="qasid1", sig=crypto.createHmac("sha256",KEY).update(sid).digest("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
const file={name:"spa.png",mimeType:"image/png",buffer:png};
const HUB="http://localhost:8792/manage/hub?id=qaTS1";const LOC=u=>"http://localhost:8792"+u;
let pass=0,fail=0;const ok=(c,n,x="")=>{c?pass++:fail++;console.log((c?"PASS ":"FAIL ")+n+(x?"  — "+x:""))};
(async()=>{const b=await chromium.launch();
async function page(slotReply){const c=await b.newContext();await c.addCookies([{name:"gl_sess",value:sid+"."+sig,url:"http://localhost:8792"}]);
 const p=await c.newPage();const log=[];p.on("pageerror",e=>log.push("JSERR "+e.message));
 await p.route("**/manage/edit/slot",async r=>{log.push("slot "+r.request().method());await r.fulfill({status:302,headers:{location:LOC(slotReply)}})});
 p.on("request",q=>{if(q.method()==="POST"&&/\/manage\/edit$/.test(q.url()))log.push("save")});
 const res=await p.goto(HUB,{waitUntil:"domcontentloaded"});return {c,p,log,status:res.status()}}
// A: nothing else changed -> picking a photo uploads it straight away
let {c,p,log,status}=await page("/manage/hub?id=qaTS1&lok=1");
ok(status===200 && await p.locator("#sec-photos").count()===1,"owner dashboard shows the photos section",String(status));
const inputs=p.locator('#sec-photos form[action="/manage/edit/slot"] input[type=file]');
ok(await inputs.count()>=2,"free listing has profile + cover photo pickers",String(await inputs.count()));
await Promise.all([p.waitForURL(/lok=1/,{timeout:15000}),inputs.nth(0).setInputFiles(file)]);
ok(log.includes("slot POST")&&!log.includes("save"),"picking a photo uploads it by itself (no Save press needed)",log.join(","));
await c.close();
// B: unsaved text edits + photo picked -> waits, then big Save uploads the photo first and saves the text
({c,p,log}=await page("/manage/hub?id=qaTS1&lok=1"));
await p.fill('#lsForm [name="descr"]',"Botox, fillers and facials in Tampa — new description");
const in2=p.locator('#sec-photos form[action="/manage/edit/slot"] input[type=file]').nth(1);
await in2.setInputFiles(file);await p.waitForTimeout(500);
const btn2=await p.locator('#sec-photos form[action="/manage/edit/slot"]').nth(1).locator("button").textContent();
ok(!log.includes("slot POST")&&/Will upload when you save/.test(btn2),"with unsaved edits, a picked photo waits for Save (edits not lost)",btn2+" | "+log.join(","));
await Promise.all([p.waitForNavigation({timeout:20000}).catch(()=>{}),p.locator("#lsForm button[type=submit], #lsForm button:not([type])").first().click()]);
await p.waitForTimeout(800);
ok(log.indexOf("slot POST")>=0&&log.indexOf("save")>log.indexOf("slot POST"),"big Save uploads the photo first, then saves the text",log.join(","));
await c.close();
// C: upload fails -> text is not saved, clear message
({c,p,log}=await page("/manage/hub?id=qaTS1&lerr=Upload+failed"));
await p.fill('#lsForm [name="descr"]',"Another edit");
await p.locator('#sec-photos form[action="/manage/edit/slot"] input[type=file]').nth(0).setInputFiles(file);
await p.locator("#lsForm button[type=submit], #lsForm button:not([type])").first().click();await p.waitForTimeout(1500);
const msg=await p.locator("#lsState").textContent();
ok(log.includes("slot POST")&&!log.includes("save")&&/couldn't be uploaded/.test(msg),"failed upload: nothing saved, owner told to try again",msg+" | "+log.join(","));
ok(!log.some(x=>/JSERR/.test(x)),"no page script errors",log.filter(x=>/JSERR/.test(x)).join(" "));
await c.close();await b.close();console.log(pass+" passed, "+fail+" failed")})();
