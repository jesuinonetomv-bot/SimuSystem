import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStudyCase, prepareStudyCase, runStudyCase, saveStudyCases, loadStudyCases, studyReportCSV, csvCell } from "../src/study-cases.js";
import { solveDiagramPowerFlow } from "../src/power-flow.js";
import { calculateThreePhaseFault } from "../src/electrical-studies.js";
import { DEFAULT_THEME, normalizeTheme, readTheme } from "../src/display-theme.js";
import { exampleStudyDiagram } from "../src/study-example.js";
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const store = () => { const m = new Map(); return { getItem: key => m.get(key) ?? null, setItem: (key, value) => m.set(key, value) }; };
function pvFeeder() {
  const d = exampleStudyDiagram();
  delete d.items.hv; delete d.items.tf; delete d.items.loadA;
  d.items.grid.topology.terminalA = "lv"; d.items.grid.electrical.nominalKV = 13.8;
  d.items.cable.electrical.resistanceOhm = 0; d.items.cable.electrical.reactanceOhm = 13.8 ** 2 / 100;
  d.items.loadB.electrical.activePowerMW = 10; d.items.loadB.electrical.powerFactor = 1;
  d.items.tg.electrical.generationMW = 5;
  return d;
}
test("study scenarios leave the operating model and contact states untouched", () => {
  const d = exampleStudyDiagram(), before = structuredClone(d);
  const r = runStudyCase(d, { adjustments: { loadPercent: 120, generationPercent: 80, tapDeltaPercent: 2 } });
  assert.equal(r.converged, true); assert.deepEqual(d, before);
  near(r.sources.find(s => s.id === "tg").powerMW, 3.2);
  const prepared = prepareStudyCase(d, { adjustments: { loadPercent: 120 }, loads: { loadB: { percent: 50 } } });
  near(prepared.model.items.loadB.electrical.activePowerMW, 3.6);
});
test("higher demand raises current and active losses in the same physical model", () => {
  const d = exampleStudyDiagram(), a = runStudyCase(d, {}), b = runStudyCase(d, { adjustments: { loadPercent: 150 } });
  assert.ok(a.converged && b.converged); assert.ok(b.totalLossMW > a.totalLossMW);
  assert.ok(b.branches.find(x => x.itemId === "tf").currentA > a.branches.find(x => x.itemId === "tf").currentA);
});
test("individual and global demand factors preserve time-profile scaling", () => {
  const d = exampleStudyDiagram(); d.items.loadB.runtimeScale = .4;
  const r = runStudyCase(d, { adjustments: { loadPercent: 125 }, loads: { loadB: { percent: 50 } } });
  near(r.caseData.buses.find(b => b.busIds.includes("feeder")).loadMW, 6 * .4 * 1.25 * .5);
});
for (const method of ["newton", "gauss", "decoupled"]) {
  test(`${method}: a PV generator holds voltage and satisfies the lossless two-bus analytic solution`, () => {
    const d = pvFeeder(), r = runStudyCase(d, { calculation: { method, maxIterations: 300, tolerance: 1e-8 },
      generators: { tg: { mode: "pv", voltagePU: 1.02 } } });
    assert.equal(r.converged, true); const b = r.buses.find(b => b.busIds.includes("feeder")), g = r.sources.find(s => s.id === "tg");
    near(b.voltagePU, 1.02); near(g.powerMW, 5);
    const angle = -Math.asin(.05 / 1.02);
    near(b.angleDeg, angle * 180 / Math.PI, 1e-4);
    near(g.reactiveMvar, (1.02 ** 2 - 1.02 * Math.cos(angle)) * 100, 1e-4);
  });
  test(`${method}: Q maximum changes PV to PQ and recalculates voltage`, () => {
    const r = runStudyCase(pvFeeder(), { calculation: { method, maxIterations: 300, tolerance: 1e-8 },
      generators: { tg: { mode: "pv", voltagePU: 1.02, qMinMvar: -.5, qMaxMvar: .5 } } });
    assert.equal(r.converged, true); const g = r.sources.find(s => s.id === "tg");
    near(g.reactiveMvar, .5, 1e-4); assert.equal(g.qLimited, true); assert.equal(g.mode, "PQ (limite Q)");
    assert.ok(r.buses.find(b => b.busIds.includes("feeder")).voltagePU < 1.02);
    assert.ok(r.alertReport.alerts.some(a => a.category === "reactive" && a.severity === "warning"));
  });
}
test("PV reactive limits are generator limits rather than net bus injection limits", () => {
  const d = pvFeeder(); d.items.loadB.electrical.powerFactor = .8;
  const r = runStudyCase(d, { generators: { tg: { mode: "pv", voltagePU: 1.02, qMinMvar: -2, qMaxMvar: 2 } } });
  assert.ok(r.converged); near(r.sources.find(s => s.id === "tg").reactiveMvar, 2, 1e-4);
  const b = r.buses.find(b => b.busIds.includes("feeder")); near(b.qCalculatedMvar, 2 - 7.5, 1e-4);
});
test("Q minimum is enforced for a PV generator absorbing vars", () => {
  const r = runStudyCase(pvFeeder(), { generators: { tg: { mode: "pv", voltagePU: .97, qMinMvar: -.5, qMaxMvar: .5 } } });
  assert.ok(r.converged); const g = r.sources.find(s => s.id === "tg"); near(g.reactiveMvar, -.5, 1e-4); assert.ok(g.qLimited);
});
test("a fixed P/Q generator stays fixed with the grid and does not acquire voltage control", () => {
  const r = runStudyCase(pvFeeder(), { generators: { tg: { mode: "pq", pMW: 7, qMvar: 1 } } });
  assert.ok(r.converged); const s = r.sources.find(s => s.id === "tg"); near(s.powerMW, 7); near(s.reactiveMvar, 1); assert.equal(s.mode, "PQ");
});
test("islanded generators need a reference and explicit PQ does not silently become Slack", () => {
  const d = pvFeeder(); d.items.grid.state = "stopped";
  assert.throws(() => runStudyCase(d, { generators: { tg: { mode: "pq" } } }), /referência/);
  const r = runStudyCase(d, { generators: { tg: { mode: "slack" } } });
  assert.ok(r.converged); near(r.sources[0].powerMW, 10); assert.equal(r.sources[0].mode, "Slack");
});
test("a generator cannot take Slack control while an external grid supplies the same island", () => {
  assert.throws(() => runStudyCase(pvFeeder(), { generators: { tg: { mode: "slack" } } }), /referência/);
});
test("multiple ideal sources at one node keep individual contributions undetermined", () => {
  const d = pvFeeder(); d.items.grid2 = { ...structuredClone(d.items.grid), name: "Rede 2", x: -2000 };
  const r = runStudyCase(d, {});
  assert.equal(r.sources.find(s => s.id === "grid").powerMW, null);
  assert.ok(r.alertReport.pending.some(s => s.includes("contribuição individual")));
});
test("sources, demand and branch losses satisfy active and reactive power balance", () => {
  const r = runStudyCase(exampleStudyDiagram(), {});
  const demandP = r.caseData.buses.reduce((n, b) => n + b.loadMW, 0), demandQ = r.caseData.buses.reduce((n, b) => n + b.loadMvar - b.capacitorMvar, 0);
  near(r.sources.reduce((n, s) => n + s.powerMW, 0) - demandP, r.totalLossMW, 1e-4);
  near(r.sources.reduce((n, s) => n + s.reactiveMvar, 0) - demandQ, r.totalLossMvar, 1e-4);
});
test("transformer currents are reported on each winding's voltage base", () => {
  const r = runStudyCase(exampleStudyDiagram(), {}), tf = r.branches.find(b => b.itemId === "tf");
  const from = r.buses[tf.from], to = r.buses[tf.to];
  near(tf.currentA, Math.hypot(tf.pFromMW, tf.qFromMvar) * 1e3 / (Math.sqrt(3) * from.kv * from.voltagePU));
  near(tf.currentToA, Math.hypot(tf.pToMW, tf.qToMvar) * 1e3 / (Math.sqrt(3) * to.kv * to.voltagePU));
});
test("thermal alerts require the actual line ampacity instead of an application default", () => {
  const d = exampleStudyDiagram(); delete d.items.cable.electrical.ampacityA;
  const r = runStudyCase(d, {}, { electricalData: o => ({ ampacityA: 1000, ...o.electrical }) });
  assert.equal(r.branches.find(b => b.itemId === "cable").loadingPercent, null);
  assert.ok(r.alertReport.pending.some(s => s.includes("Cabo exemplo") && s.includes("não cadastrado")));
});
test("critical thermal and voltage alerts identify equipment without commanding it", () => {
  const d = exampleStudyDiagram(); d.items.tf.electrical.ratedMVA = 10;
  const before = structuredClone(d), r = runStudyCase(d, { adjustments: { loadPercent: 200 } });
  assert.ok(r.converged); assert.ok(r.alertReport.alerts.some(a => a.category === "loading" && a.id === "tf"));
  assert.ok(r.alertReport.alerts.some(a => a.category === "voltage")); assert.deepEqual(d, before);
});
test("non-converged results are labelled provisional and do not report normal equipment", () => {
  const r = runStudyCase(exampleStudyDiagram(), { calculation: { maxIterations: 1, tolerance: 1e-10 } });
  assert.equal(r.converged, false); assert.equal(r.alertReport.alerts.length, 0);
  assert.ok(r.alertReport.pending.some(s => s.includes("Sem convergência")));
});
test("drawn connections without impedance remain ideal under scenario R/X adjustments", () => {
  const d = exampleStudyDiagram(); delete d.items.cable.electrical;
  const p = prepareStudyCase(d, { adjustments: { resistancePercent: 150, reactancePercent: 150 } });
  assert.equal(p.model.items.cable.electrical, undefined);
});
test("load flow control selection does not alter short circuit availability", () => {
  const d = pvFeeder(); d.items.grid.state = "stopped";
  Object.assign(d.items.tg.electrical, { studyGeneratorMode: "pq", subtransientPercent: 20, sourceXR: 10 });
  const r = calculateThreePhaseFault(d); assert.ok(r.results.some(b => b.status === "calculated"));
});
test("cases persist independently per diagram and survive a JSON round trip", () => {
  const s = store(), a = normalizeStudyCase({ name: "Ponta", generators: { tg: { mode: "pv", qMinMvar: -2, qMaxMvar: 3 } } });
  saveStudyCases(s, "diagramA", [a]); assert.deepEqual(loadStudyCases(s, "diagramA"), [a]); assert.deepEqual(loadStudyCases(s, "diagramB"), []);
});
test("corrupt case storage skips invalid cases without failing the simulator", () => {
  const s = store(); s.setItem("bad", '{oops'); assert.deepEqual(loadStudyCases(s, "bad"), []);
  s.setItem("bad", JSON.stringify([{ name: "Válido" }, { name: "Inválido", calculation: { method: "bogus" } }]));
  assert.equal(loadStudyCases(s, "bad").length, 1);
});
test("invalid thresholds, partial Q limits, unsupported imports and blank values are rejected", () => {
  for (const input of [{ version: 2 }, { calculation: { baseMVA: "" } }, { calculation: { maxIterations: 1.1 } },
    { alerts: { voltageCriticalLow: 1 } }, { adjustments: { loadPercent: -10 } },
    { generators: { tg: { mode: "pv", qMinMvar: 1 } } }, { generators: { tg: { mode: "pv", qMinMvar: 2, qMaxMvar: 1 } } }])
    assert.throws(() => normalizeStudyCase(input));
});
test("removed scenario equipment is reported instead of being treated as an active load", () => {
  const r = runStudyCase(exampleStudyDiagram(), { loads: { missing: { percent: 50 } } });
  assert.ok(r.warnings.some(s => s.includes("não está mais")));
});
test("CSV export contains the case, convergence, losses, source values and pending assumptions", () => {
  const r = runStudyCase(exampleStudyDiagram(), { name: '=HYPERLINK("evil")' }), csv = studyReportCSV(r);
  assert.ok(csv.startsWith("\ufeff")); assert.ok(csv.includes("Convergiu")); assert.ok(csv.includes("TG exemplo")); assert.ok(csv.includes("Parâmetros do caso"));
  assert.ok(csv.includes("'=HYPERLINK")); assert.equal(csvCell("@SUM(1)"), '"\'@SUM(1)"'); assert.equal(csvCell(-1), '"-1"');
});
test("invalid or injected theme values cannot become CSS declarations", () => {
  assert.throws(() => normalizeTheme({ energized: "red; background:url(evil)" }));
  const s = store(); s.setItem("simuDisplayTheme", '{"energized":"not a color"}'); assert.deepEqual(readTheme(s), DEFAULT_THEME);
});
test("the ETAP-inspired default distinguishes live, dead, selected, alarm and warning colors", () => {
  assert.equal(DEFAULT_THEME.energized, "#000000"); assert.equal(DEFAULT_THEME.deenergized, "#c0c0c0");
  assert.equal(DEFAULT_THEME.selected, "#ff0000"); assert.equal(DEFAULT_THEME.warning, "#ff00ff");
});
