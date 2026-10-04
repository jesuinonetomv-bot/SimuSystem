import { readFileSync, existsSync } from "node:fs";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(match, "Inline application module not found");
const code = match[1];
const withoutImports = code.replace(/^\s*import\s+[\s\S]*?\s+from\s+["'][^"']+["'];/gm, "");
new Script(withoutImports, { filename: "index.html" });
for (const entry of code.matchAll(/from\s+["'](\.\/[^"']+)["']/g))
  assert.ok(existsSync(new URL(entry[1], root)), "Missing local import: " + entry[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
for (const id of ["cmd", "cmdOk", "cmdText", "alarmBox", "alarmMessage", "logout"])
  assert.equal(ids.filter((x) => x === id).length, 1, "Duplicate/missing ID: " + id);
assert.ok(!ids.includes("switchingAnalysis"), "Operator faceplate must not show the internal study");
const sw = readFileSync(new URL("sw.js", root), "utf8");
new Script(sw, { filename: "sw.js" });
assert.ok(sw.includes('"./src/switching-analysis.js?v=38"'),
  "Switching analysis must be in the offline asset list");
assert.ok(sw.includes('"./src/diagram-gestures.js?v=39"'),
  "Diagram gestures must be in the offline asset list");
assert.ok(sw.includes('"./src/session-timeout.js?v=40"'),
  "Session timeout must be in the offline asset list");
console.log("Application syntax, module paths, command/alarm controls and offline asset list OK");
