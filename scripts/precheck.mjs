#!/usr/bin/env node
// Pre-deploy checks on worker.js: syntax, duplicate route handlers, VERSION line,
// and no city-specific values leaking into the shared file. Prints the VERSION.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("../worker.js", import.meta.url).pathname;
const src = readFileSync(file, "utf8");
let bad = 0;
const fail = m => { console.error("✗ " + m); bad++; };

try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
catch (e) { fail("node --check failed:\n" + e.stderr); }
// node --check treats the file as a script and misses module-level mistakes (v17.00: a duplicate `const res` passed it
// and only failed in Wrangler's build). Bundle it the way Wrangler does.
try { execFileSync(new URL("../node_modules/.bin/esbuild", import.meta.url).pathname, [file, "--bundle", "--format=esm", "--platform=neutral", "--outfile=/dev/null", "--log-level=error"], { stdio: "pipe" }); }
catch (e) { fail("esbuild (same build Wrangler runs) failed:\n" + (e.stderr || e.message)); }

const seen = {};
for (const m of src.matchAll(/if \((p\[1\] === "[a-z0-9-]+"|u\.pathname === "\/[^"]*")\)/g)) seen[m[1]] = (seen[m[1]] || 0) + 1;
for (const [k, n] of Object.entries(seen)) if (n > 1) fail(`duplicate route handler (${n}x): ${k}`);

const v = [...src.matchAll(/const BUILD = "(v[\d.]+-shared)";/g)].map(m => m[1]);
if (v.length !== 1) fail(`expected exactly one 'const BUILD = "v…-shared";' line, found ${v.length}`);
if (!src.includes('o.push("VERSION: " + BUILD)')) fail("/debug no longer prints VERSION from BUILD");

const leaks = [/G-6Q9XD0PSXP/, /G-4GYL8HMEGL/, /G-8ECDB32Y3W/, /orlandogoeslocal\.com/i, /WBkYBSVDnGUN7JKzWYtd/];
for (const re of leaks) if (re.test(src)) fail(`city-specific value hardcoded in worker.js: ${re.source}`);

if (bad) process.exit(1);
console.log(v[0]);
