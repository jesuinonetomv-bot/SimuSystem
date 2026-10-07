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
for (const id of ["cmd", "cmdOk", "cmdText", "alarmBox", "alarmMessage", "logout", "viewSettingsBtn", "viewSettingsBox", "viewSettingsClose", "viewScenario", "opZoomOut", "opFit", "opZoomIn", "flowAnimationBtn", "flowShowActive", "flowShowReactive", "flowAnimationNotice", "workModel", "workOperation", "workStudies", "showNameplates", "dataBlockResults", "clearViewStudy"])
  assert.equal(ids.filter((x) => x === id).length, 1, "Duplicate/missing ID: " + id);
assert.ok(!ids.includes("switchingAnalysis"), "Operator faceplate must not show the internal study");
const flowUI = readFileSync(new URL("src/load-flow-workbench.js", root), "utf8");
const shortUI = readFileSync(new URL("src/short-circuit-workbench.js", root), "utf8");
const uiIds = [...ids, ...[...shortUI.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]), ...[...flowUI.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1])];
for (const id of ["applyPowerFlow", "lfNetwork", "lfSavedCases", "lfSave", "lfTabConfig", "lfTabResults", "lfResultStats", "lfJSONText", "lfImportCase", "lfExportCSV", "lfPrintReport", "runPowerFlow", "powerFlowBusBody", "powerFlowBranchBody", "themeEditor", "saveTheme", "scNetwork", "scStandard", "scRun", "scTabResults", "scSources", "scExportCSV", "scApply", "scSave", "scRatingRows"])
  assert.equal(uiIds.filter(x => x === id).length, 1, "Duplicate/missing study or theme ID: " + id);

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
for (const name of ["power-flow.js", "study-network.js", "electrical-studies.js", "technical-symbols.js", "study-workbench.js", "workbench.css", "display-theme.js", "load-flow-workbench.js", "study-cases.js", "study-example.js", "short-circuit.js", "short-circuit-cases.js", "short-circuit-workbench.js"])
  assert.ok(sw.includes('"./src/' + name + '?v=46"'), "Missing study asset in offline cache: " + name);
for (const file of ["power-flow.js", "study-network.js", "electrical-studies.js", "study-workbench.js", "study-cases.js", "study-example.js", "load-flow-workbench.js", "display-theme.js", "short-circuit.js", "short-circuit-cases.js", "short-circuit-workbench.js"]) {
  const source = readFileSync(new URL("src/" + file, root), "utf8");
  for (const entry of source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) {
    assert.ok(existsSync(new URL(entry[1], new URL("src/", root))), "Missing nested import: " + entry[1]);
    assert.ok(sw.includes('"./src/' + entry[1].slice(2) + '"'), "Nested import missing from cache: " + entry[1]);
  }
}
console.log("Application syntax, module paths, command/alarm controls and offline asset list OK");
