import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSwitching } from "../src/switching-analysis.js";

const bus = (x, y, name, source = false) => ({
  type: "bus", x1: x, y1: y, x2: x + 100, y2: y, name, isSource: source,
});
const tie = () => ({
  type: "breaker", name: "DJ-TIE", x: 50, y: 50, state: "open",
  topology: { terminalA: "a", terminalB: "b", role: "bus_coupler" },
});
const basic = (sourceA = true, sourceB = false) => ({
  items: { a: bus(0, 0, "BARRA-A", sourceA), b: bus(0, 100, "BARRA-B", sourceB),
    tie: tie() },
});
const transformer = (name, x, a, b) => ({
  type: "transformer", name, x, y: 50,
  topology: { terminalA: a, terminalB: b },
  electrical: { primaryKV: 230, secondaryKV: 13.8, impedancePercent: 10 },
});
const parallelTransformers = () => {
  const d = basic(false);
  d.items.hv = bus(1000, -200, "BARRA-230", true);
  d.items.t1 = transformer("TF-1", 400, "hv", "a");
  d.items.t2 = transformer("TF-2", 700, "hv", "b");
  return d;
};
const closedOther = () => ({ ...tie(), name: "DJ-OUTRO", x: 150, state: "closed" });

test("one live side energizes a dead bus without a ring or source parallelism", () => {
  const r = analyzeSwitching(basic(), "tie");
  assert.equal(r.type, "energization");
  assert.equal(r.ring, false);
  assert.equal(r.energizedA, true);
  assert.equal(r.energizedB, false);
});
test("two independent live islands require source synchronism rather than ring classification", () => {
  const r = analyzeSwitching(basic(true, true), "tie");
  assert.equal(r.type, "source_parallel");
  assert.equal(r.ring, false);
  assert.equal(r.requiresSynchronism, true);
});
test("matching source names do not silently connect independent islands", () => {
  const d = basic(true, true);
  d.items.a.name = d.items.b.name = "ELETRONORTE";
  assert.equal(analyzeSwitching(d, "tie").type, "source_parallel");
});
test("two dead sides are a dead interconnection", () => {
  assert.equal(analyzeSwitching(basic(false, false), "tie").type, "deenergized_connection");
});
test("an existing ideal route forms a ring without series impedance", () => {
  const d = basic();
  d.items.other = closedOther();
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "ring_without_impedance");
  assert.equal(r.hasImpedance, false);
  assert.equal(r.requiresSynchronism, false);
  assert.ok(r.path.includes("other"));
});
test("an open alternate breaker cannot create a ring", () => {
  const d = basic();
  d.items.other = { ...closedOther(), state: "open" };
  assert.equal(analyzeSwitching(d, "tie").type, "energization");
});
test("common transformer primary and newly coupled secondaries form transformer parallelism", () => {
  const r = analyzeSwitching(parallelTransformers(), "tie");
  assert.equal(r.type, "transformer_parallel");
  assert.equal(r.ring, true);
  assert.equal(r.hasImpedance, true);
  assert.deepEqual(r.parallelTransformers.sort(), ["t1", "t2"]);
});
test("transformers in series are not parallel transformers", () => {
  const d = basic();
  d.items.mid = bus(1000, 0, "INTERMEDIARIA");
  d.items.t1 = transformer("TF-1", 400, "a", "mid");
  d.items.t2 = transformer("TF-2", 700, "mid", "b");
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "ring_with_impedance");
  assert.deepEqual(r.parallelTransformers, []);
});
test("line R and X form a ring with impedance without implying transformer parallelism", () => {
  const d = basic();
  d.items.line = { type: "line", name: "LT", x1: 400, y1: 0, x2: 400, y2: 100,
    topology: { terminalA: "a", terminalB: "b" },
    electrical: { resistanceOhm: 0.1, reactanceOhm: 0.2 } };
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "ring_with_impedance");
  assert.ok(r.components.some((c) => c.kind === "line" && c.hasImpedance));
  assert.deepEqual(r.parallelTransformers, []);
});
test("explicit zero line R and X are preserved rather than replaced by defaults", () => {
  const d = basic();
  d.items.line = { type: "line", name: "CONEXAO", x1: 400, y1: 0, x2: 400, y2: 100,
    topology: { terminalA: "a", terminalB: "b" },
    electrical: { resistanceOhm: 0, reactanceOhm: 0 } };
  assert.equal(analyzeSwitching(d, "tie").type, "ring_without_impedance");
});
test("an ideal alternate path takes precedence even when a shorter impedance route exists", () => {
  const d = parallelTransformers();
  d.items.other = closedOther();
  assert.equal(analyzeSwitching(d, "tie").type, "ring_without_impedance");
});
test("a dead loop is still a topological ring", () => {
  const d = basic(false, false);
  d.items.other = closedOther();
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "deenergized_ring");
  assert.equal(r.ring, true);
});
test("a line drawn behind an open breaker does not bypass its two contacts", () => {
  const d = { items: {
    wire: { type: "line", x1: 0, y1: 0, x2: 0, y2: 240,
      electrical: { resistanceOhm: 0, reactanceOhm: 0 } },
    source: { type: "utility", x: 0, y: 52, state: "running" },
    tie: { type: "breaker", x: 0, y: 120, state: "open" },
  } };
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "energization");
  assert.equal(r.ring, false);
});
test("transformer ports stay separate when a continuous line is drawn behind it", () => {
  const d = { items: {
    wire: { type: "line", x1: 0, y1: 0, x2: 0, y2: 400,
      electrical: { resistanceOhm: 0, reactanceOhm: 0 } },
    source: { type: "utility", x: 0, y: 52, state: "running" },
    t1: { type: "transformer", x: 0, y: 120, electrical: { impedancePercent: 10 } },
    tie: { type: "breaker", x: 500, y: 50, state: "open",
      topology: { terminalA: "source", terminalB: "load" } },
    load: { type: "load", x: 0, y: 434, state: "active" },
  } };
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "ring_with_impedance");
  assert.ok(r.path.includes("t1"));
});
test("explicit transformer secondary role overrides which winding happens to be nearer", () => {
  const d = { items: {
    a: bus(0, 0, "A", true), b: bus(1000, 0, "B"),
    t1: { type: "transformer", x: 500, y: 100,
      electrical: { impedancePercent: 10 } },
    primary: { type: "breaker", x: 500, y: 144, state: "closed",
      topology: { terminalA: "a", terminalB: "t1", role: "transformer_primary" } },
    tie: { type: "breaker", x: 500, y: 56, state: "open",
      topology: { terminalA: "t1", terminalB: "b", role: "transformer_secondary" } },
    bypass: { type: "breaker", x: 1500, y: 0, state: "closed",
      topology: { terminalA: "a", terminalB: "b" } },
  } };
  assert.equal(analyzeSwitching(d, "tie").type, "ring_with_impedance");
});
test("shared connector groups let the alternate route cross tabs", () => {
  const d = basic();
  d.items.a.conductorGroupId = "global::ELETRONORTE";
  d.items.remote = { ...bus(100000, 100000, "ABA-2"),
    conductorGroupId: "global::ELETRONORTE" };
  d.items.remoteSwitch = { ...closedOther(),
    topology: { terminalA: "remote", terminalB: "b" } };
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "ring_without_impedance");
  assert.ok(r.path.includes("remoteSwitch"));
});
test("coincident drawing coordinates cannot override disconnected explicit terminals", () => {
  const d = basic();
  d.items.tie.x = 2000;
  d.items.tie.y = 3000;
  assert.equal(analyzeSwitching(d, "tie").type, "energization");
});
test("bad terminal references return indeterminate rather than a safe-looking result", () => {
  const d = basic();
  d.items.tie.topology.terminalB = "missing";
  assert.equal(analyzeSwitching(d, "tie").type, "indeterminate");
});
test("an incomplete explicit topology does not silently revert to a visual connection", () => {
  const d = basic();
  delete d.items.tie.topology.terminalB;
  assert.equal(analyzeSwitching(d, "tie").type, "indeterminate");
});
test("a stopped source is not an energized island", () => {
  const d = basic(true, true);
  d.items.b.state = "stopped";
  assert.equal(analyzeSwitching(d, "tie").type, "energization");
});
test("invalid impedance does not imply an impedance-free ring", () => {
  const d = parallelTransformers();
  d.items.t1.electrical.impedancePercent = -10;
  const r = analyzeSwitching(d, "tie");
  assert.equal(r.type, "ring_unknown_impedance");
  assert.equal(r.hasImpedance, null);
});
test("the commanded closed switch is removed for the study and input state is unchanged", () => {
  const d = basic(true, true);
  d.items.tie.state = "closed";
  const before = JSON.stringify(d);
  assert.equal(analyzeSwitching(d, "tie").type, "source_parallel");
  assert.equal(JSON.stringify(d), before);
});
test("a disconnected terminal gives an indeterminate topology", () => {
  const d = { items: { tie: { type: "breaker", x: 0, y: 50, state: "open" } } };
  assert.equal(analyzeSwitching(d, "tie").type, "indeterminate");
});
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function extract(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return html.slice(a, b);
}
function appAdapter(initial, remoteStates = []) {
  return new Function("initial", "remoteStates", "analyzeSwitching",
    'let diagram=initial, operatorSession={}, eng=false, currentDiagramId="current";' +
    'const operatorDiagramStates=new Map(remoteStates);' +
    'const cleanDiagram=(value=diagram)=>JSON.parse(JSON.stringify(value));' +
    'const nodes=new Map(); const $=(id)=>{if(!nodes.has(id))nodes.set(id,' +
      '{hidden:false,dataset:{},textContent:""});return nodes.get(id);};' +
    extract("      function terminals(o) {", "      function d2(") +
    extract("      function electricalDefaults(o) {", "      function buildElectricalZones(") +
    extract("      function globalConnectorCode(group) {", "      function addConductorGroupLabels(") +
    extract("      function switchingAnalysisFor(", "      function alarmCommand(") +
    'return {switchingAnalysisFor,updateSwitchingPreview,switchingControlValue,nodes};'
  )(initial, remoteStates, analyzeSwitching);
}
test("the real app adapter follows connector codes and prefixed topology across tabs", () => {
  const current = basic();
  current.conductorGroups = { hv: { globalConnectorCode: "eletronorte" },
    return: { globalConnectorCode: "retorno" } };
  current.items.a.conductorGroupId = "hv";
  current.items.b.conductorGroupId = "return";
  const remote = {
    conductorGroups: { hv: { globalConnectorCode: " ELETRONORTE " },
      return: { globalConnectorCode: "RETORNO" } },
    items: {
      ra: { ...bus(0, 0, "REMOTA-A"), conductorGroupId: "hv" },
      rb: { ...bus(0, 100, "REMOTA-B"), conductorGroupId: "return" },
      rsw: { ...closedOther(), topology: { terminalA: "ra", terminalB: "rb" } },
    },
  };
  const r = appAdapter(current, [["current", current], ["second", remote]])
    .switchingAnalysisFor("tie");
  assert.equal(r.type, "ring_without_impedance");
  assert.ok(r.path.includes("second::rsw"));
});
test("the actual faceplate shows transformer impedance and path before closing", () => {
  const app = appAdapter(parallelTransformers());
  assert.equal(app.updateSwitchingPreview("tie").type, "transformer_parallel");
  assert.equal(app.nodes.get("#switchingAnalysis").hidden, false);
  assert.ok(app.nodes.get("#switchingPath").textContent.includes("TF-1"));
  assert.ok(app.nodes.get("#switchingImpedance").textContent.includes("Z=10%"));
});
test("preview and Control Building values track current state without creating errors", () => {
  const d = basic();
  d.items.other = closedOther();
  const app = appAdapter(d);
  assert.equal(app.switchingControlValue("tie", "ringClosed"), false);
  d.items.tie.state = "closed";
  assert.equal(app.switchingControlValue("tie", "ringClosed"), true);
  assert.equal(app.switchingControlValue("tie", "sourceParallel"), false);
  assert.equal(app.updateSwitchingPreview("tie"), null);
  assert.equal(app.nodes.get("#switchingAnalysis").hidden, true);
});
test("Control Building distinguishes a closed source parallel from a closed transformer parallel", () => {
  const independent = basic(true, true);
  independent.items.tie.state = "closed";
  const app = appAdapter(independent);
  assert.equal(app.switchingControlValue("tie", "sourceParallel"), true);
  assert.equal(app.switchingControlValue("tie", "transformerParallel"), false);
  const d = parallelTransformers();
  d.items.tie.state = "closed";
  assert.equal(appAdapter(d).switchingControlValue("tie", "transformerParallel"), true);
});
test("unknown topology is undefined to Control Building, never a confirmed absence of an anel", () => {
  const d = basic();
  d.items.tie.state = "closed";
  d.items.tie.topology.terminalB = "missing";
  assert.equal(appAdapter(d).switchingControlValue("tie", "ringClosed"), undefined);
});
test("an unknown analysis cannot trigger comparison rules even with different-from", () => {
  const compare = new Function(
    extract("      function normalizedRuleValue(", "      const numericControlVariables") +
    "return compareRuleValue;"
  )();
  assert.equal(compare(undefined, "neq", "sim"), false);
  assert.equal(compare(null, "eq", "não"), false);
  assert.equal(compare(true, "eq", "sim"), true);
  assert.equal(compare(false, "eq", "não"), true);
});
