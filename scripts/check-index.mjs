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
for (const id of ["cmd", "cmdOk", "cmdText", "alarmBox", "alarmMessage", "logout", "viewSettingsBtn", "viewSettingsBox", "viewSettingsClose", "viewScenario", "opZoomOut", "opFit", "opZoomIn", "flowAnimationBtn", "flowShowActive", "flowShowReactive", "flowAnimationNotice", "workModel", "workOperation", "workStudies", "showNameplates", "dataBlockResults", "applyPowerFlow", "clearViewStudy"])
  assert.equal(ids.filter((x) => x === id).length, 1, "Duplicate/missing ID: " + id);
assert.ok(!ids.includes("switchingAnalysis"), "Operator faceplate must not show the internal study");
const sw = readFileSync(new URL("sw.js", root), "utf8");
new Script(sw, { filename: "sw.js" });
assert.ok(sw.includes('"./src/switching-analysis.js?v=41"'),
  "Switching analysis must be in the offline asset list");
assert.ok(sw.includes('"./src/diagram-gestures.js?v=42"'),
  "Diagram gestures must be in the offline asset list");
assert.ok(sw.includes('"./src/session-timeout.js?v=40"'),
  "Session timeout must be in the offline asset list");
assert.ok(sw.includes('"./src/flow-animation.js?v=41"'),
  "Animated flow must be in the offline asset list");
for (const name of ["power-flow.js", "study-network.js", "electrical-studies.js", "technical-symbols.js", "study-workbench.js", "workbench.css"])
  assert.ok(sw.includes('"./src/' + name + '?v=44.1"'), "Missing study asset in offline cache: " + name);
console.log("Application syntax, module paths, command/alarm controls and offline asset list OK");
