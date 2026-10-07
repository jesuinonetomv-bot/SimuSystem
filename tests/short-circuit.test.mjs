import test from "node:test";
import assert from "node:assert/strict";
import { runShortCircuitCase, rlEstimates, voltageFactor } from "../src/short-circuit.js";
import { DEFAULT_FAULT_CASE, normalizeFaultCase, prepareFaultCase, saveFaultCases, loadFaultCases, faultReportCSV, faultReportText } from "../src/short-circuit-cases.js";
import { faultStudyExample, exampleStudyDiagram } from "../src/study-example.js";
import { solveDiagramPowerFlow } from "../src/power-flow.js";

const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const bus = (name, kv = 10, x = 0) => ({ type: "bus", name, x1: x, x2: x + 100, y1: 0, y2: 0, electrical: { nominalKV: kv } });
const link = (terminalA, terminalB) => ({ terminalA, ...(terminalB ? { terminalB } : {}) });
const grid = (at = "a", kv = 10) => ({ type: "utility", name: "Rede", x: -500, y: -500, state: "running", topology: link(at),
  electrical: { nominalKV: kv, shortCircuitMVA: 1000, shortCircuitMVAMin: 600, sourceXR: 10, sourceXRMin: 8 } });
const sourceOnly = () => ({ items: { a: bus("A"), grid: grid() } });
function feeder() {
  const d = sourceOnly(); d.items.b = bus("B", 10, 1000);
  d.items.line = { type: "line", name: "Linha", x1: 500, x2: 700, y1: 500, y2: 500, topology: link("a", "b"),
    electrical: { nominalKV: 10, resistanceOhm: 1, reactanceOhm: 2 } }; return d;
}
function transformer() {
  const d = sourceOnly(); d.items.b = bus("BT", .4, 1000);
  d.items.tf = { type: "transformer", name: "TF", x: 600, y: 700, topology: link("a", "b"),
    electrical: { primaryKV: 10, secondaryKV: .4, ratedMVA: 10, impedancePercent: 5, transformerXR: 10, tapPercent: 0 } }; return d;
}
function generator() {
  return { items: { a: bus("Gerador"), tg: { type: "turbogenerator", name: "TG", x: -500, y: -500, state: "running", topology: link("a"),
    electrical: { nominalKV: 10, generatorRatedMVA: 10, subtransientPercent: 20, transientPercent: 35, sourceXR: 10, generatorRatedPowerFactor: .8 } } } };
}
const runAt = (d, id, calculation = {}, extra = {}) => runShortCircuitCase(d, { calculation, ...extra }).results.find(b => b.busIds.includes(id));

test("IEC grid impedance includes its c factor: supplied grid duty is not multiplied by c", () => {
  for (const kv of [.4, 10, 230]) for (const lvTolerance of [6, 10]) {
    const d = { items: { a: bus("A", kv), grid: grid("a", kv) } };
    close(runAt(d, "a", { lvTolerance }).currentKA, 1000 / (Math.sqrt(3) * kv));
    close(runAt(d, "a", { scenario: "min", lvTolerance }).currentKA, 600 / (Math.sqrt(3) * kv));
  }
});
test("IEC custom voltage calibrates the external grid impedance at its own bus", () => {
  const b = runAt(sourceOnly(), "a", { scenario: "custom", voltageFactor: 1.03 });
  close(b.currentKA, 1000 / (Math.sqrt(3) * 10)); close(b.voltageFactor, 1.03);
});
test("IEC voltage factors classify 1 kV as low voltage and retain c_max for correction factors", () => {
  const c = normalizeFaultCase({ calculation: { scenario: "min", lvTolerance: 6 } }).calculation;
  close(voltageFactor(1, c), .95); close(voltageFactor(1.001, c), 1); close(voltageFactor(1, c, true), 1.05);
});
test("IEC transformer correction is applied on its rated base with c_max at the low side", () => {
  const b = runAt(transformer(), "b", { lvTolerance: 6 });
  const kt = .95 * 1.05 / (1 + .6 * (.05 * 10 / Math.sqrt(101)));
  const zGrid = 1.1 * 100 / 1000, zTransformer = kt * .05 * 100 / 10;
  close(b.currentKA, 1.05 * 100 / (Math.sqrt(3) * .4 * (zGrid + zTransformer)));
  assert.equal(b.status, "calculated");
});
test("IEC generator K_G uses the nameplate power factor, not operating P/Q", () => {
  const d = generator(), b = runAt(d, "a"), kg = 1.1 / (1 + .2 * .6);
  close(b.contributions[0].correction, kg);
  close(b.currentKA, 1.1 * 100 / (Math.sqrt(3) * 10 * kg * Math.hypot(.2, 2)));
  d.items.tg.electrical.generationMW = -99; d.items.tg.electrical.generationMvar = "invalid";
  close(runAt(d, "a").currentKA, b.currentKA);
});
test("IEC corrections can be disabled explicitly; missing PF then does not invent K_G", () => {
  const d = generator(); delete d.items.tg.electrical.generatorRatedPowerFactor;
  assert.equal(runAt(d, "a").status, "missing");
  assert.match(runAt(d, "a").errors.join(" "), /fator de potência nominal/);
  const b = runAt(d, "a", { corrections: false }); assert.equal(b.status, "calculated"); close(b.contributions[0].correction, 1);
});
test("ANSI synchronous generator uses X″d in half cycle and interruption, X′d at 30 cycles", () => {
  const d = generator(), half = runAt(d, "a", { standard: "ansi" }), interruption = runAt(d, "a", { standard: "ansi", ansiStage: "interrupting" }),
    late = runAt(d, "a", { standard: "ansi", ansiStage: "30cycle" });
  close(half.currentKA, 100 / (Math.sqrt(3) * 10 * Math.hypot(.2, 2))); close(interruption.currentKA, half.currentKA);
  close(late.currentKA, 100 / (Math.sqrt(3) * 10 * Math.hypot(.2, 3.5)));
  close(late.resistanceOhm, half.resistanceOhm); assert.ok(late.currentKA < half.currentKA);
});
test("ANSI requires registered X′d for the 30-cycle network", () => {
  const d = generator(); delete d.items.tg.electrical.transientPercent;
  const b = runAt(d, "a", { standard: "ansi", ansiStage: "30cycle" });
  assert.equal(b.status, "missing"); assert.equal(b.currentKA, null); assert.match(b.errors.join(" "), /X′d/);
});
test("ANSI utility impedance stays unchanged across all three periods", () => {
  for (const ansiStage of ["momentary", "interrupting", "30cycle"]) close(runAt(sourceOnly(), "a", { standard: "ansi", ansiStage }).currentKA, 1000 / (Math.sqrt(3) * 10));
});
test("ANSI X/R comes from separate R and X networks in a counterexample with dissimilar sources", () => {
  const d = sourceOnly(); d.items.grid.electrical.shortCircuitMVA = 100 / Math.sqrt(101);
  d.items.grid2 = { ...grid(), x: -700, electrical: { nominalKV: 10, shortCircuitMVA: 100 / Math.sqrt(20), sourceXR: .5 } };
  const b = runAt(d, "a", { standard: "ansi" });
  // R1=1, X1=10, R2=4, X2=2 Ω; Req_R=.8 and Xeq_X=5/3 Ω.
  close(b.xr, (5 / 3) / .8); assert.ok(Math.abs(b.xr - b.reactanceOhm / b.resistanceOhm) > .1);
});
test("zero-reactance branches contract exactly in ANSI X-network", () => {
  const d = feeder(); d.items.line.electrical.reactanceOhm = 0;
  const b = runAt(d, "b", { standard: "ansi" }), r = .1 / Math.sqrt(101);
  close(b.xr, r * 10 / (r + 1));
});
test("nominal line fault includes complex line and source impedances", () => {
  const b = runAt(feeder(), "b", { standard: "nominal" }), r = .1 / Math.sqrt(101);
  close(b.resistanceOhm, r + 1); close(b.reactanceOhm, r * 10 + 2);
  close(b.currentKA, 10 / (Math.sqrt(3) * Math.hypot(r + 1, r * 10 + 2)));
});
test("fault impedance is in ohms at each fault bus, including the transformer low side", () => {
  const b = runAt(transformer(), "b", { standard: "nominal", faultRohm: .01, faultXohm: .02 });
  const zOhm = .6 * .4 ** 2 / 100, r = zOhm / Math.sqrt(101), x = r * 10;
  close(b.currentKA, .4 / (Math.sqrt(3) * Math.hypot(r + .01, x + .02)));
});
test("three-phase studies are independent of per-unit base MVA", () => {
  for (const standard of ["iec", "ansi", "nominal"]) close(runAt(transformer(), "b", { standard, baseMVA: 1 }).currentKA, runAt(transformer(), "b", { standard, baseMVA: 1000 }).currentKA);
});
test("complex source contributions sum as phasors, not magnitudes", () => {
  const d = sourceOnly(); d.items.grid2 = { ...grid(), x: -700, electrical: { ...grid().electrical, sourceXR: 1 } };
  const b = runAt(d, "a", { standard: "nominal" }), sources = b.contributions;
  close(Math.hypot(sources.reduce((a, s) => a + s.realFaultKA, 0), sources.reduce((a, s) => a + s.imaginaryFaultKA, 0)), b.currentKA);
  assert.ok(sources.reduce((a, s) => a + s.faultKA, 0) > b.currentKA + .1);
});
test("transformer-side source and branch currents are converted to their local voltage", () => {
  const b = runAt(transformer(), "b", { standard: "nominal" });
  close(b.contributions[0].faultKA, b.currentKA); close(b.contributions[0].localKA, b.currentKA * .4 / 10);
  close(b.branchCurrents[0].fromKA, b.currentKA * .4 / 10); close(b.branchCurrents[0].toKA, b.currentKA);
});
test("parallel transformers and meshed lines reduce by admittance, not by a selected route", () => {
  const d = transformer(); d.items.tf2 = { ...d.items.tf, y: 1000 };
  close(runAt(d, "b", { standard: "nominal" }).currentKA, 100 / (Math.sqrt(3) * .4 * .35));
  const m = feeder(); m.items.line2 = { ...m.items.line, y1: 900, y2: 900 };
  const r = .1 / Math.sqrt(101); close(runAt(m, "b", { standard: "nominal" }).currentKA, 10 / (Math.sqrt(3) * Math.hypot(r + .5, 10 * r + 1)));
});
test("study transformers use the nominal ratio without changing saved operational tap", () => {
  const d = transformer(), original = runAt(d, "b").currentKA;
  d.items.tf.electrical.tapPercent = 8; close(runAt(d, "b").currentKA, original); assert.equal(d.items.tf.electrical.tapPercent, 8);
  assert.match(runAt(d, "b").warnings.join(" "), /tap da operação/);
});
test("minimum IEC requires minimum grid duty, its X/R, and line temperature", () => {
  const d = feeder(); const min = { scenario: "min" };
  assert.match(runAt(d, "b", min).errors.join(" "), /temperatura/);
  delete d.items.grid.electrical.shortCircuitMVAMin;
  const b = runAt(d, "b", { ...min, lineEndTemperatureC: 80 });
  assert.equal(b.status, "missing"); assert.equal(b.peakKA, null); assert.match(b.errors.join(" "), /MVA de curto mínimo/);
  d.items.grid.electrical.shortCircuitMVAMin = 600; delete d.items.grid.electrical.sourceXRMin;
  assert.match(runAt(d, "b", { ...min, lineEndTemperatureC: 80 }).errors.join(" "), /X\/R da rede para o caso mínimo/);
});
test("minimum IEC line R is corrected by .004 per K from 20 °C", () => {
  const cold = runAt(feeder(), "b", { scenario: "min", lineEndTemperatureC: 20 }), hot = runAt(feeder(), "b", { scenario: "min", lineEndTemperatureC: 80 });
  close(hot.resistanceOhm - cold.resistanceOhm, .24); close(hot.reactanceOhm, cold.reactanceOhm); assert.ok(hot.currentKA < cold.currentKA);
});
test("a missing source X/R or transformer nameplate is pending, without assumed safe values", () => {
  const d = sourceOnly(); delete d.items.grid.electrical.sourceXR;
  assert.equal(runAt(d, "a").status, "missing");
  const t = transformer(); delete t.items.tf.electrical.ratedMVA;
  assert.equal(runAt(t, "b").status, "missing");
});
test("fault calculations ignore invalid load-flow P/Q, regulation and capacitor data", () => {
  const d = sourceOnly(), expected = runAt(d, "a").currentKA;
  d.items.grid.electrical.voltageSetpointPU = -1;
  d.items.load = { type: "load", x: 500, y: 500, state: "active", topology: link("a"), electrical: { nominalKV: 10, activePowerMW: -1, powerFactor: 5 } };
  d.items.cap = { type: "capacitor", x: 800, y: 500, topology: link("a"), electrical: { nominalKV: 10, capacitorStages: -4 } };
  close(runAt(d, "a").currentKA, expected); assert.throws(() => solveDiagramPowerFlow(d), /inválid/);
});
test("an open contact isolates the fault bus despite including the source in the case", () => {
  const d = feeder(); delete d.items.line;
  d.items.dj = { type: "breaker", x: 500, y: 500, state: "open", topology: link("a", "b") };
  const b = runAt(d, "b", {}, { sources: { grid: { participation: "include" } } });
  assert.equal(b.status, "dead"); assert.equal(b.currentKA, null); assert.equal(d.items.dj.state, "open");
});
test("source inclusion/exclusion changes only a clone; the operating model never receives case overrides", () => {
  const d = sourceOnly(), before = JSON.stringify(d);
  assert.equal(runAt(d, "a", {}, { sources: { grid: { participation: "exclude" } } }).status, "dead");
  close(runAt(d, "a", {}, { sources: { grid: { shortCircuitMVA: 2000 } } }).currentKA, 2000 / (Math.sqrt(3) * 10));
  assert.equal(JSON.stringify(d), before);
  d.items.grid.state = "stopped"; const stopped = JSON.stringify(d);
  assert.equal(runAt(d, "a", {}, { sources: { grid: { participation: "include" } } }).status, "calculated"); assert.equal(JSON.stringify(d), stopped);
});
test("closed ideal contacts merge bars and do not invent individual breaker currents", () => {
  const d = feeder(); delete d.items.line; d.items.dj = { type: "breaker", x: 500, y: 500, state: "closed", topology: link("a", "b") };
  const r = runShortCircuitCase(d); assert.equal(r.results.length, 1); assert.equal(r.results[0].busIds.length, 2);
  assert.equal(r.results[0].branchCurrents.length, 0);
});
test("a pending island does not prevent another island with complete data from calculating", () => {
  const d = sourceOnly(); d.items.b = bus("B", 10, 1000); d.items.grid2 = { ...grid("b"), x: -900, electrical: { nominalKV: 10 } };
  assert.equal(runAt(d, "a").status, "calculated"); assert.equal(runAt(d, "b").status, "missing");
});
test("fault selection filters actual busbars and rejects stale references", () => {
  const r = runShortCircuitCase(feeder(), { faultBusId: "b" }); assert.equal(r.results.length, 1); assert.deepEqual(r.results[0].busIds, ["b"]);
  assert.throws(() => runShortCircuitCase(feeder(), { faultBusId: "gone" }), /não está neste modelo/);
});
test("bar capacities are explicit; a breaker capacity is never assessed using total bus current", () => {
  const d = sourceOnly(); d.items.dj = { type: "breaker", x: 700, y: 800, state: "open", topology: link("a", "a"), electrical: { interruptingKA: 1 } };
  const r = runShortCircuitCase(d, { ratings: { a: { shortCircuitRatingKA: 50, peakWithstandKA: 100 } } });
  assert.ok(r.alertReport.alerts.some(a => a.severity === "critical")); assert.ok(r.alertReport.alerts.every(a => a.id === "a"));
  const missing = runShortCircuitCase(sourceOnly()); assert.equal(missing.alertReport.alerts.length, 0); assert.ok(missing.alertReport.pending.length >= 2);
});
test("minimum IEC and ANSI interruption/30-cycle cases do not evaluate momentary capacities", () => {
  for (const calculation of [{ scenario: "min" }, { standard: "ansi", ansiStage: "interrupting" }, { standard: "ansi", ansiStage: "30cycle" }]) {
    const r = runShortCircuitCase(sourceOnly(), { calculation, ratings: { a: { shortCircuitRatingKA: .1, peakWithstandKA: .1 } } });
    assert.equal(r.alertReport.alerts.length, 0); assert.match(r.alertReport.pending.join(" "), /não avalia/);
  }
});
test("R-L estimates have correct resistive/inductive limits and exponential DC decay", () => {
  const resistive = rlEstimates(10, 0, 60, 3, 1); close(resistive.peakKA, Math.sqrt(2) * 10, 1e-4); close(resistive.dcKA, 0); close(resistive.thermalKA, 10);
  const inductive = rlEstimates(10, 1e9, 60, .5, 1); close(inductive.peakKA, 2 * Math.sqrt(2) * 10, 1e-6); close(inductive.thermalKA, Math.sqrt(3) * 10, 1e-6);
  const e = rlEstimates(10, 10, 50, 1, .5); close(e.dcKA, Math.sqrt(2) * 10 * Math.exp(-2 * Math.PI / 10));
  assert.ok(e.peakKA > Math.sqrt(2) * 10 && e.peakKA < 2 * Math.sqrt(2) * 10);
});
test("case normalization rejects invalid enums, factors, ratings, JSON arrays and prototype keys", () => {
  for (const c of [{ calculation: { standard: "fake" } }, { calculation: { baseMVA: "" } }, { calculation: { corrections: "yes" } },
    { calculation: { frequencyHz: 55 } }, { alerts: { warningPercent: 100, criticalPercent: 95 } }, { sources: { g: { generatorRatedPowerFactor: 2 } } },
    { ratings: { a: { peakWithstandKA: -1 } } }, [], { version: 99 }, { kind: "powerFlow" }, JSON.parse('{"sources":{"__proto__":{"participation":"include"}}}')])
    assert.throws(() => normalizeFaultCase(c));
  assert.equal({}.participation, undefined);
});
test("case save/load and JSON round trip preserve settings and recover corrupt local entries", () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
  const config = normalizeFaultCase({ name: "Teste", calculation: { standard: "ansi", ansiStage: "30cycle" }, sources: { grid: { participation: "exclude" } } });
  saveFaultCases(storage, "cases", [config]); assert.deepEqual(loadFaultCases(storage, "cases"), [config]);
  assert.deepEqual(normalizeFaultCase(JSON.parse(JSON.stringify(config))), config);
  memory.set("cases", '{bad'); assert.deepEqual(loadFaultCases(storage, "cases"), []);
  assert.throws(() => saveFaultCases(storage, "cases", Array(41).fill(DEFAULT_FAULT_CASE)), /40/);
});
test("case preparation retains unknown equipment notices without changing the diagram", () => {
  const d = sourceOnly(), before = JSON.stringify(d), p = prepareFaultCase(d, { sources: { gone: { participation: "exclude" } }, ratings: { absent: { peakWithstandKA: 10 } } });
  assert.equal(p.warnings.length, 2); assert.equal(JSON.stringify(d), before);
});
test("reports include parameters, contributions, estimates and pending data with safe CSV escaping", () => {
  const r = runShortCircuitCase(faultStudyExample(), { name: '=SUM(1;2)', notes: 'a;"b"\nlinha' });
  const csv = faultReportCSV(r); assert.ok(csv.startsWith("\ufeff")); assert.ok(csv.includes("'=SUM(1;2)")); assert.ok(csv.includes('a;""b""\nlinha'));
  assert.match(faultReportText(r), /referida à barra de falta/); assert.match(faultReportText(r), /corrente de interrupção normativa/);
  const d = sourceOnly(); delete d.items.grid.electrical.sourceXR; const pending = runShortCircuitCase(d);
  assert.equal(pending.results[0].currentKA, null); assert.match(faultReportText(pending), /Dados pendentes/);
});
test("the short-circuit example is repeatable and leaves the load-flow example unchanged", () => {
  const a = faultStudyExample(); a.items.tg.electrical.subtransientPercent = 99;
  assert.equal(faultStudyExample().items.tg.electrical.subtransientPercent, 20);
  assert.equal(exampleStudyDiagram().items.tg.electrical.subtransientPercent, undefined);
  assert.ok(runShortCircuitCase(faultStudyExample()).results.every(b => b.status === "calculated"));
});
