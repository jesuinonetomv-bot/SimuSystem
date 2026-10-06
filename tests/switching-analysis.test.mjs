import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSwitching, createSwitchingStudy } from "../src/switching-analysis.js";

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
  return new Function("initial", "remoteStates", "createSwitchingStudy",
    'let diagram=initial, operatorSession={}, eng=false, currentDiagramId="current";' +
    'const operatorDiagramStates=new Map(remoteStates);' +
    'const maintenance={};' +
    'const cleanDiagram=(value=diagram)=>JSON.parse(JSON.stringify(value));' +
    'const nodes=new Map(); const $=(id)=>{if(!nodes.has(id))nodes.set(id,' +
      '{hidden:false,dataset:{},textContent:""});return nodes.get(id);};' +
    extract("      function terminals(o) {", "      function d2(") +
    extract("      function electricalDefaults(o) {", "      function buildElectricalZones(") +
    extract("      function globalConnectorCode(group) {", "      function addConductorGroupLabels(") +
    extract("      function switchingAnalysisFor(", "      function alarmCommand(") +
    'return {switchingAnalysisFor,switchingCommandFor,ringAlarmMessage,switchingControlValue,nodes};'
  )(initial, remoteStates, createSwitchingStudy);
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
test("the faceplate contains no technical report or preview evaluation", () => {
  assert.ok(!html.includes('id="switchingAnalysis"'));
  assert.ok(!html.includes("updateSwitchingPreview"));
  assert.ok(!html.includes("ANÁLISE ELÉTRICA DO FECHAMENTO"));
});
test("internal analysis and Control Building values track current state", () => {
  const d = basic();
  d.items.other = closedOther();
  const app = appAdapter(d);
  assert.equal(app.switchingControlValue("tie", "ringClosed"), false);
  d.items.tie.state = "closed";
  assert.equal(app.switchingControlValue("tie", "ringClosed"), true);
  assert.equal(app.switchingControlValue("tie", "sourceParallel"), false);
  assert.equal(app.switchingCommandFor("tie", "open").canOpenInRing, true);
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

const load = (name, target, x = 800) => ({ type: "load", name, x, y: 200,
  state: "active", topology: { terminalA: target } });
const transformerTransfer = () => {
  const d = basic(false, false);
  d.items.tie.state = "closed";
  d.items.hv = bus(1000, -200, "BARRA-230", true);
  for (let n = 1; n <= 2; n++) {
    const p = "p" + n, s = "s" + n, t = "t" + n, b = n === 1 ? "a" : "b";
    d.items[t] = transformer("TF-" + n, n * 400, p, s);
    d.items[p] = { type: "breaker", name: "DJ-P" + n, x: n * 400, y: -100,
      state: "closed", topology: { terminalA: "hv", terminalB: t,
        role: "transformer_primary" } };
    d.items[s] = { type: "breaker", name: "DJ-S" + n, x: n * 400, y: 150,
      state: "closed", topology: { terminalA: t, terminalB: b,
        role: "transformer_secondary" } };
  }
  d.items.la = load("CARGA-A", "a");
  d.items.lb = load("CARGA-B", "b", 1200);
  return d;
};
test("unconfigured drawing connections cannot masquerade as an impedance", () => {
  const d = basic();
  d.items.connection = { type: "line", x1: 500, y1: 0, x2: 500, y2: 100,
    topology: { terminalA: "a", terminalB: "b" } };
  assert.equal(analyzeSwitching(d, "tie").type, "ring_without_impedance");
  assert.equal(appAdapter(d).switchingCommandFor("tie", "closed").analysis.type,
    "ring_without_impedance");
});
test("a secondary opening transfers both loads through the other transformer", () => {
  const d = transformerTransfer(), before = JSON.stringify(d);
  const command = createSwitchingStudy(d).command("s1", "open");
  assert.equal(command.valid, true);
  assert.equal(command.canOpenInRing, true);
  assert.deepEqual(command.lostLoads, []);
  assert.deepEqual(command.reverseTransformers, []);
  assert.equal(JSON.stringify(d), before);
});
test("without a closed tie the same secondary opening loses its load", () => {
  const d = transformerTransfer();
  d.items.tie.state = "open";
  const command = createSwitchingStudy(d).command("s1", "open");
  assert.equal(command.canOpenInRing, false);
  assert.deepEqual(command.lostLoads.map((item) => item.id), ["la"]);
});
test("a ring does not authorize opening a feeder outside the ring", () => {
  const d = transformerTransfer();
  d.items.feeder = { ...closedOther(), name: "DJ-CARGA",
    topology: { terminalA: "a", terminalB: "la", role: "load_feeder" } };
  d.items.la.topology.terminalA = "feeder";
  const command = createSwitchingStudy(d).command("feeder", "open");
  assert.equal(command.canOpenInRing, false);
  assert.deepEqual(command.lostLoads.map((item) => item.id), ["la"]);
});
test("opening the primary in a transformer ring computes the secondary protection trip", () => {
  const command = createSwitchingStudy(transformerTransfer()).command("p1", "open");
  assert.equal(command.canOpenInRing, false);
  assert.deepEqual(command.lostLoads, []);
  assert.deepEqual(command.reverseTransformers.map((item) => item.id), ["t1"]);
  assert.deepEqual(command.reverseTransformers[0].tripBreakers, ["s1"]);
});
test("reverse source calculation also works when closing a secondary onto a dead primary", () => {
  const d = transformerTransfer();
  d.items.p1.state = d.items.s1.state = "open";
  const command = createSwitchingStudy(d).command("s1", "closed");
  assert.deepEqual(command.reverseTransformers.map((item) => item.id), ["t1"]);
  assert.deepEqual(command.reverseTransformers[0].tripBreakers, ["s1"]);
});
test("a closing disconnector is included in the prospective secondary trip path", () => {
  const d = transformerTransfer();
  d.items.p1.state = "open";
  d.items.t1.topology.terminalB = "cs";
  d.items.s1.topology.terminalA = "cs";
  d.items.cs = { type: "disconnector", x: 2500, y: 1000, state: "open",
    topology: { terminalA: "t1", terminalB: "s1", role: "transformer_secondary" } };
  const command = createSwitchingStudy(d).command("cs", "closed");
  assert.deepEqual(command.reverseTransformers.map((item) => item.id), ["t1"]);
  assert.deepEqual(command.reverseTransformers[0].tripBreakers, ["s1"]);
});
test("ring opening candidates exclude primary trips and unrelated load feeders", () => {
  const d = transformerTransfer();
  d.items.tie.state = "open";
  const candidates = createSwitchingStudy(d).openingCandidates("tie");
  assert.deepEqual(candidates.map((item) => item.id).sort(), ["s1", "s2", "tie"]);
});
test("a candidate must remove every ideal alternate route, not merely the shortest one", () => {
  const d = basic();
  d.items.other = closedOther();
  d.items.third = { ...closedOther(), name: "DJ-TERCEIRO", x: 250 };
  assert.deepEqual(createSwitchingStudy(d).openingCandidates("tie", { onlyIdeal: true })
    .map((item) => item.id), ["tie"]);
});
test("correcting an already existing reverse feed does not cause a new reverse trip", () => {
  const d = transformerTransfer();
  d.items.p1.state = "open";
  const command = createSwitchingStudy(d).command("s1", "open");
  assert.deepEqual(command.reverseTransformers, []);
  assert.deepEqual(command.lostLoads, []);
});
test("energization cannot jump a conductor drawn behind an open breaker", () => {
  const d = { items: {
    wire: { type: "line", x1: 0, y1: 0, x2: 0, y2: 240 },
    utility: { type: "utility", x: 0, y: 52, state: "running" },
    breaker: { type: "breaker", x: 0, y: 120, state: "open" },
    load: { type: "load", x: 0, y: 274, state: "active" },
  } };
  const live = createSwitchingStudy(d).energizedItems();
  assert.ok(live.has("utility"));
  assert.ok(!live.has("load"));
});
test("a stopped utility does not energize a load even if isSource was left true", () => {
  const d = basic(false);
  d.items.utility = { type: "utility", x: 500, y: 500, state: "stopped", isSource: true,
    topology: { terminalA: "a" } };
  d.items.load = load("CARGA", "a");
  assert.ok(!createSwitchingStudy(d).energizedItems().has("load"));
});
test("unknown topology never produces calculated opening candidates", () => {
  const d = transformerTransfer();
  d.items.s1.topology.terminalB = "missing";
  const command = createSwitchingStudy(d).command("s1", "open");
  assert.equal(command.valid, false);
  assert.equal(command.canOpenInRing, null);
  assert.deepEqual(createSwitchingStudy(d).openingCandidates("s1"), []);
});

function operationAdapter(initial, { remoteStates = [], rules = [], maint = {} } = {}) {
  return new Function("initial", "remoteStates", "rules", "maint", "createSwitchingStudy",
    'let diagram=initial, operatorSession={errors:0}, eng=false, currentDiagramId="current";' +
    'let pending=null, suppressAlarmUntil=0, alarmTotal=0;' +
    'const sessionTimeout={check:()=>true};' +
    'const operatorDiagramStates=new Map(remoteStates), maintenance=maint, calls={draws:[],commands:0};' +
    'const cleanDiagram=(value=diagram)=>JSON.parse(JSON.stringify(value));' +
    'const nodes=new Map(); const $=(id)=>{if(!nodes.has(id))nodes.set(id,' +
      'Object.assign(new EventTarget(), {open:false,textContent:"",' +
      'close(){this.open=false;this.dispatchEvent(new Event("close"));},' +
      'showModal(){this.open=true;}}));return nodes.get(id);};' +
    'const registerCommand=()=>calls.commands++; const persistOperatorSession=()=>{};' +
    'const draw=(...args)=>calls.draws.push(args); const commandAttemptRules=()=>rules;' +
    'const commandBlockingRule=()=>null, controlRuleCoversTransition=()=>false;' +
    'const disconnectorUnderLoad=()=>false;' +
    extract("      function terminals(o) {", "      function d2(") +
    extract("      function electricalDefaults(o) {", "      function buildElectricalZones(") +
    extract("      function globalConnectorCode(group) {", "      function addConductorGroupLabels(") +
    extract("      function switchingAnalysisFor(", "      function controlRules(") +
    extract("      function transformerSequenceViolation(", "      function disconnectorUnderLoad(") +
    extract("      function applyAutomaticCommand(", "      function intendedCommandState(") +
    extract('      $("#cmdOk").onclick =', '      $("#busCancel").onclick =') +
    'return {execute(id,{open=true}={}){pending=id; $("#cmd").open=open; $("#cmdOk").onclick();},' +
      'select(id){pending=id; $("#cmd").showModal();}, confirm(){$("#cmdOk").onclick();},' +
      'diagram,nodes,calls,operatorSession,operatorDiagramStates};'
  )(initial, remoteStates, rules, maint, createSwitchingStudy);
}
for (const state of ["open", "closed"])
test(`the real command handler cannot toggle a ${state} breaker with a closed faceplate`, () => {
  const d = basic(); d.items.tie.state = state;
  const app = operationAdapter(d);
  app.execute("tie", { open: false });
  assert.equal(d.items.tie.state, state);
  assert.equal(app.calls.commands, 0);
  assert.equal(app.calls.draws.length, 0);
  assert.equal(app.operatorSession.errors, 0);
});
test("native Escape cancellation clears the command even before the dialog closes", () => {
  const d = basic(), app = operationAdapter(d);
  app.select("tie");
  app.nodes.get("#cmd").dispatchEvent(new Event("cancel"));
  app.confirm();
  assert.equal(d.items.tie.state, "open");
  assert.equal(app.calls.commands, 0);
});
test("closing a faceplate clears its pending equipment before a delayed activation", () => {
  const d = basic(), app = operationAdapter(d);
  app.select("tie");
  app.nodes.get("#cmd").close();
  app.nodes.get("#cmd").showModal();
  app.confirm();
  assert.equal(d.items.tie.state, "open");
  assert.equal(app.calls.commands, 0);
});
test("a queued close event cannot clear a newly reopened faceplate", () => {
  const d = basic(false, false), app = operationAdapter(d);
  app.select("tie");
  app.nodes.get("#cmd").dispatchEvent(new Event("close"));
  app.confirm();
  assert.equal(d.items.tie.state, "closed");
  assert.equal(app.calls.commands, 1);
});
test("the real command handler alarms and records a no-impedance closure after performing it", () => {
  const d = basic();
  d.items.other = closedOther();
  d.items.load = load("CARGA-A", "a");
  const app = operationAdapter(d);
  app.execute("tie");
  assert.equal(d.items.tie.state, "closed");
  assert.equal(app.operatorSession.errors, 1);
  assert.equal(app.nodes.get("#alarmBox").open, true);
  const message = app.nodes.get("#alarmMessage").textContent;
  assert.match(message, /anel sem impedância/);
  assert.match(message, /DJ-TIE/);
  assert.match(message, /DJ-OUTRO/);
  assert.ok(!message.includes("→"));
});
test("the real command handler accepts transformer parallel closure and subsequent secondary transfer", () => {
  const d = transformerTransfer();
  d.items.tie.state = "open";
  const app = operationAdapter(d);
  app.execute("tie");
  app.execute("s1");
  assert.equal(d.items.tie.state, "closed");
  assert.equal(d.items.s1.state, "open");
  assert.equal(app.operatorSession.errors, 0);
  assert.ok(!app.nodes.has("#alarmMessage"));
  assert.match(app.nodes.get("#status").textContent, /alimentação mantida/);
});
test("the real command handler leaves a deenergized ring free of the energized-ring alarm", () => {
  const d = basic(false, false);
  d.items.other = closedOther();
  const app = operationAdapter(d);
  app.execute("tie");
  assert.equal(d.items.tie.state, "closed");
  assert.equal(app.operatorSession.errors, 0);
});
test("the real command handler trips the computed secondary after primary reverse energization", () => {
  const d = transformerTransfer(), app = operationAdapter(d);
  app.execute("p1");
  assert.equal(d.items.p1.state, "open");
  assert.equal(d.items.s1.state, "open");
  assert.equal(d.items.s2.state, "closed");
  assert.equal(app.operatorSession.errors, 1);
  assert.match(app.nodes.get("#alarmMessage").textContent, /proteção abriu DJ-S1/);
  assert.deepEqual(app.calls.draws[0], [true, true]);
});
test("the real command handler alarms for load loss when no alternate feed remains", () => {
  const d = transformerTransfer();
  d.items.tie.state = "open";
  const app = operationAdapter(d);
  app.execute("s1");
  assert.equal(app.operatorSession.errors, 1);
  assert.match(app.nodes.get("#alarmMessage").textContent, /CARGA-A/);
  assert.deepEqual(app.calls.draws[0], [true, true]);
});
test("maintenance and the existing Control Building alarm inhibition are honored", () => {
  const d = transformerTransfer();
  d.items.tie.state = "open";
  const maintained = operationAdapter(d, { maint: { la: true } });
  maintained.execute("s1");
  assert.equal(maintained.operatorSession.errors, 0);
  const ideal = basic();
  ideal.items.other = closedOther();
  const inhibited = operationAdapter(ideal, { rules: [{ inhibitAlarm: true, alarm: false,
    registerError: false }] });
  inhibited.execute("tie");
  assert.equal(ideal.items.tie.state, "closed");
  assert.equal(inhibited.operatorSession.errors, 0);
  assert.ok(!inhibited.nodes.get("#alarmBox")?.open);
});
test("a remote secondary protection trip updates the other tab's operator state", () => {
  const d = transformerTransfer();
  d.conductorGroups = { hv: { globalConnectorCode: "hv" },
    a: { globalConnectorCode: "a" }, b: { globalConnectorCode: "b" } };
  d.items.hv.conductorGroupId = "hv";
  d.items.a.conductorGroupId = "a";
  d.items.b.conductorGroupId = "b";
  const remote = { conductorGroups: d.conductorGroups, items: {
    hv: { ...d.items.hv, isSource: false }, a: d.items.a, b: d.items.b,
    s1: d.items.s1, t1: d.items.t1,
  } };
  d.items.p1.topology.terminalB = "primaryConnector";
  d.items.primaryConnector = { ...bus(2000, 0, "TERMINAL-P1"), conductorGroupId: "p1" };
  d.conductorGroups.p1 = { globalConnectorCode: "p1" };
  remote.conductorGroups = JSON.parse(JSON.stringify(d.conductorGroups));
  remote.items.primaryConnector = { ...d.items.primaryConnector };
  remote.items.t1 = { ...d.items.t1, topology: { terminalA: "primaryConnector", terminalB: "s1" } };
  delete d.items.s1;
  delete d.items.t1;
  const app = operationAdapter(d, { remoteStates: [["current", d], ["remote", remote]] });
  app.execute("p1");
  assert.equal(remote.items.s1.state, "open");
  assert.equal(d.items.s2.state, "closed");
  assert.equal(app.operatorSession.errors, 1);
});
