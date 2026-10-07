import test from "node:test";
import assert from "node:assert/strict";
import { buildStudyNetwork } from "../src/study-network.js";
import { calculateThreePhaseFault, protectionTime, compareProtection } from "../src/electrical-studies.js";
import { solveDiagramPowerFlow } from "../src/power-flow.js";

const close = (actual, expected, tol = 1e-6) => assert.ok(Math.abs(actual - expected) < tol, `${actual} != ${expected}`);
const bus = (x, name, kv = 10) => ({ type: "bus", name, x1: x, y1: 0, x2: x + 200, y2: 0, electrical: { nominalKV: kv } });
const link = (terminalA, terminalB) => ({ terminalA, ...(terminalB ? { terminalB } : {}) });
const grid = (at = "a", shortCircuitMVA = 1000, kv = 10) => ({ type: "utility", name: "Rede", x: -500, y: -500,
  state: "running", topology: link(at), electrical: { nominalKV: kv, shortCircuitMVA, sourceXR: 10, voltageSetpointPU: 1 } });
function feeder() {
  return { items: { a: bus(0, "A"), b: bus(1000, "B"), grid: grid(),
    line: { type: "line", name: "L1", x1: 500, y1: 500, x2: 700, y2: 500, topology: link("a", "b"),
      electrical: { nominalKV: 10, resistanceOhm: 1, reactanceOhm: 0 } },
    load: { type: "load", name: "Carga", x: 1800, y: 1000, state: "active", topology: link("b"),
      electrical: { nominalKV: 10, activePowerMW: 10, powerFactor: 1 } },
  } };
}
function transformed() {
  const d = feeder(); delete d.items.line; delete d.items.load;
  d.items.a.electrical.nominalKV = 13.8; d.items.b.electrical.nominalKV = .4;
  d.items.grid = grid("a", 100, 13.8);
  d.items.tf = { type: "transformer", name: "T1", x: 600, y: 800, topology: link("a", "b"),
    electrical: { primaryKV: 13.8, secondaryKV: .4, ratedMVA: 10, impedancePercent: 5, transformerXR: 10, tapPercent: 0 } };
  return d;
}
const faultAt = (d, id, options) => calculateThreePhaseFault(d, options).results.find((b) => b.busIds.includes(id));

test("the utility alone reproduces its specified fault MVA and current", () => {
  const d = { items: { a: bus(0, "A"), grid: grid() } }, r = faultAt(d, "a");
  assert.equal(r.status, "calculated"); close(r.shortCircuitMVA, 1000); close(r.currentKA, 1000 / (Math.sqrt(3) * 10));
});
test("a line adds its complex impedance to the source Thevenin impedance", () => {
  const r = faultAt(feeder(), "b"), sourceR = .1 / Math.hypot(1, 10);
  close(r.resistanceOhm, 1 + sourceR); close(r.reactanceOhm, sourceR * 10);
  close(r.currentKA, 10 / (Math.sqrt(3) * Math.hypot(1 + sourceR, sourceR * 10)));
});
test("a transformer converts percent impedance from nameplate MVA to a common base", () => {
  const r = faultAt(transformed(), "b");
  close(r.shortCircuitMVA, 100 / 1.5); close(r.currentKA, (100 / 1.5) / (Math.sqrt(3) * .4));
});
test("the short circuit result is independent of the selected per-unit power base", () => {
  const d = transformed(); close(faultAt(d, "b", { baseMVA: 10 }).currentKA, faultAt(d, "b", { baseMVA: 1000 }).currentKA);
});
test("parallel transformers combine on the common base", () => {
  const d = transformed(); d.items.tf2 = { ...d.items.tf, name: "T2", y: 1200 };
  close(faultAt(d, "b").shortCircuitMVA, 100 / 1.25);
});
test("transformer tap is included in the fault driving-point admittance", () => {
  const d = transformed(); d.items.tf.electrical.tapPercent = 5;
  close(faultAt(d, "b").shortCircuitMVA, 100 / (1 / 1.05 ** 2 + .5));
});
test("a meshed feeder combines parallel lines rather than choosing one drawing path", () => {
  const d = feeder(); d.items.line2 = { ...d.items.line, y1: 1000, y2: 1000,
    electrical: { nominalKV: 10, resistanceOhm: 2, reactanceOhm: 0 } };
  const r = faultAt(d, "b"), sourceR = .1 / Math.hypot(1, 10);
  close(r.resistanceOhm, 2 / 3 + sourceR); close(r.reactanceOhm, sourceR * 10);
});
test("an open breaker isolates the dead bus in both fault and load flow", () => {
  const d = feeder(); delete d.items.line;
  d.items.dj = { type: "breaker", x: 600, y: 500, state: "open", topology: link("a", "b") };
  assert.equal(faultAt(d, "b").status, "dead");
  const r = solveDiagramPowerFlow(d); assert.ok(r.notCalculated.some((i) => i.names.includes("B")));
  assert.ok(!r.buses.some((b) => b.busIds.includes("b")));
});
test("closing a breaker contracts ideal contacts without an arbitrary tiny impedance", () => {
  const d = feeder(); delete d.items.line;
  d.items.dj = { type: "breaker", x: 600, y: 500, state: "closed", topology: link("a", "b") };
  close(faultAt(d, "b").shortCircuitMVA, 1000); assert.equal(buildStudyNetwork(d).branches.length, 0);
});
test("matching connector groups link remote buses", () => {
  const d = feeder(); delete d.items.line;
  d.items.a.conductorGroupId = "global::BUS"; d.items.b.conductorGroupId = "global::BUS";
  close(faultAt(d, "b").shortCircuitMVA, 1000);
});
test("a drawn line behind an open breaker cannot bypass the contact", () => {
  const d = { items: {
    grid: { ...grid(), x: 0, y: 0, topology: undefined },
    wire: { type: "line", x1: 0, y1: -52, x2: 0, y2: -400 },
    breaker: { type: "breaker", x: 0, y: -180, state: "open" },
    b: { type: "bus", name: "B", x1: -100, y1: -350, x2: 100, y2: -350, electrical: { nominalKV: 10 } },
  } };
  assert.equal(faultAt(d, "b").status, "dead");
});
test("an unconfigured drawn connection remains ideal and the assumption is disclosed", () => {
  const d = feeder(); delete d.items.line.electrical;
  close(faultAt(d, "b").shortCircuitMVA, 1000);
  assert.ok(calculateThreePhaseFault(d).warnings.some((w) => w.includes("R/X não cadastrados")));
});
test("a stopped utility contributes neither a short circuit source nor a load-flow reference", () => {
  const d = feeder(); d.items.grid.state = "stopped";
  assert.equal(faultAt(d, "b").status, "dead"); assert.throws(() => solveDiagramPowerFlow(d), /Sem fonte/);
});
test("missing source short circuit MVA blocks the supplied island instead of inventing grid strength", () => {
  const d = feeder(); delete d.items.grid.electrical.shortCircuitMVA;
  const r = faultAt(d, "b"); assert.equal(r.status, "missing"); assert.equal(r.currentKA, null);
  assert.ok(r.errors.some((e) => e.includes("potência de curto")));
});
test("all live source contributions are required in a shared island", () => {
  const d = feeder(); d.items.grid2 = { ...grid("b"), x: 2200 }; delete d.items.grid2.electrical.shortCircuitMVA;
  assert.equal(faultAt(d, "a").status, "missing");
});
test("an invalid source terminal position cannot silently remove its contribution", () => {
  const d = feeder(); d.items.grid2 = { ...grid("b"), x: NaN };
  assert.equal(faultAt(d, "a").status, "missing");
});
test("parallel sources both contribute to the bus fault", () => {
  const d = { items: { a: bus(0, "A"), grid: grid(), grid2: { ...grid(), x: 2000 } } };
  close(faultAt(d, "a").shortCircuitMVA, 2000);
});
test("generator X double prime d is used as reactance rather than impedance magnitude", () => {
  const d = { items: { a: bus(0, "A"), gen: { type: "turbogenerator", name: "G1", x: -500, y: 500,
    state: "running", topology: link("a"), electrical: { nominalKV: 10, generatorRatedMVA: 10,
      generationMW: 0, generationMvar: 0, subtransientPercent: 20, sourceXR: 10 } } } };
  close(faultAt(d, "a").shortCircuitMVA, 10 / Math.hypot(.2, .02));
  delete d.items.gen.electrical.subtransientPercent; assert.equal(faultAt(d, "a").status, "missing");
});
test("an invalid live source is not silently omitted", () => {
  for (const value of [0, -1, Infinity, NaN]) {
    const d = feeder(); d.items.grid.electrical.sourceXR = value;
    assert.equal(faultAt(d, "a").status, "missing");
  }
});
test("different nominal voltages on one ideal node require a model correction", () => {
  const d = feeder(); delete d.items.line.electrical;
  d.items.b.electrical.nominalKV = 13.8;
  assert.equal(faultAt(d, "b").status, "missing"); assert.throws(() => solveDiagramPowerFlow(d), /incompatíveis/);
});
test("a partial explicit terminal binding prevents calculation of the supplied island", () => {
  const d = feeder(); delete d.items.line.topology.terminalB;
  assert.equal(faultAt(d, "a").status, "missing");
});
test("fault calculations leave equipment states, parameters and metadata unchanged", () => {
  const d = transformed(), before = structuredClone(d); calculateThreePhaseFault(d);
  assert.deepEqual(d, before);
});
for (const method of ["newton", "gauss"]) {
  test(`AC ${method} agrees with the analytical resistive two-bus solution`, () => {
    const d = feeder();
    const r = solveDiagramPowerFlow(d, { method, tolerance: 1e-9, maxIterations: 600 });
    assert.equal(r.converged, true);
    const b = r.buses.find((b) => b.busIds.includes("b"));
    close(b.voltagePU, (1 + Math.sqrt(1 - .4)) / 2, 1e-7);
    close(b.pCalculatedMW, -10, 1e-5); close(b.qCalculatedMvar, 0, 1e-5);
    close(r.branches[0].pFromMW + r.branches[0].pToMW, r.totalLossMW);
  });
}
test("fast decoupled flow agrees with Newton on an inductive feeder", () => {
  const d = feeder(); d.items.line.electrical.resistanceOhm = .02; d.items.line.electrical.reactanceOhm = .2;
  d.items.load.electrical.activePowerMW = 1; d.items.load.electrical.powerFactor = .9;
  const a = solveDiagramPowerFlow(d, { method: "newton", tolerance: 1e-9 });
  const b = solveDiagramPowerFlow(d, { method: "decoupled", tolerance: 1e-9 });
  assert.equal(a.converged, true); assert.equal(b.converged, true);
  close(b.buses.find(b=>b.busIds.includes("b")).voltagePU, a.buses.find(b=>b.busIds.includes("b")).voltagePU, 1e-7);
});
test("an unsuitable high-resistance case reports nonconvergence for the decoupled method", () => {
  const d = feeder(); d.items.line.electrical.reactanceOhm = .1;
  assert.equal(solveDiagramPowerFlow(d, { method: "decoupled", maxIterations: 80 }).converged, false);
});
test("AC transformer no-load voltage and tap losses use the correct winding current", () => {
  const d = transformed(); d.items.tf.electrical.tapPercent = 5;
  const r = solveDiagramPowerFlow(d, { tolerance: 1e-9 });
  assert.equal(r.converged, true); close(r.buses.find(b => b.busIds.includes("b")).voltagePU, 1 / 1.05, 1e-7);
  close(r.totalLossMW, 0, 1e-7); close(r.totalLossMvar, 0, 1e-7);
});
test("AC loaded transformer losses equal R times the squared series winding current", () => {
  const d = transformed(); d.items.tf.electrical.tapPercent = 5;
  d.items.load = { ...feeder().items.load, electrical: { nominalKV: .4, activePowerMW: 1, powerFactor: .9 } };
  const r = solveDiagramPowerFlow(d, { tolerance: 1e-9 }); assert.equal(r.converged, true);
  const branch = r.branches[0], model = r.caseData.branches[0];
  const primaryPU = branch.currentA * Math.sqrt(3) * 13.8 / (100 * 1000);
  close(branch.lossMW, model.r * (primaryPU * model.tap) ** 2 * 100, 1e-7);
  assert.ok(branch.lossMW > 0);
});
test("a prescribed generator exports surplus power toward the utility in AC flow", () => {
  const d = feeder(); d.items.load.electrical.activePowerMW = 1;
  d.items.gen = { type: "turbogenerator", name: "G1", x: 2400, y: 1800, state: "running", topology: link("b"),
    electrical: { nominalKV: 10, generationMW: 2, generationMvar: 0, generatorRatedMVA: 10 } };
  const r = solveDiagramPowerFlow(d, { tolerance: 1e-9 }); assert.equal(r.converged, true);
  assert.ok(r.branches[0].pFromMW < 0); close(r.buses.find(b=>b.busIds.includes("b")).pCalculatedMW, 1, 1e-6);
});
test("load flow leaves source states and diagram metadata unchanged", () => {
  const d = feeder(), before = structuredClone(d); solveDiagramPowerFlow(d); assert.deepEqual(d, before);
});
test("model inputs reject invalid base power, tolerance and method", () => {
  for (const v of [0, -1, NaN, Infinity]) assert.throws(() => buildStudyNetwork(feeder(), { baseMVA: v }), /potência-base/);
  assert.throws(() => solveDiagramPowerFlow(feeder(), { tolerance: 0 }), /Tolerância/);
  assert.throws(() => solveDiagramPowerFlow(feeder(), { method: "invalid" }), /Método/);
});
const settings = (protectionCurve = "standard", extra = {}) => ({ protectionCurve, pickupA: 100,
  timeMultiplier: 1, definiteTime: .5, breakerTime: 0, instantaneousA: 0, instantaneousTime: .02, ...extra });
test("IEC inverse curves match the published time-current equations at twice pickup", () => {
  close(protectionTime(settings(), 200), .14 / (2 ** .02 - 1));
  close(protectionTime(settings("very"), 200), 13.5);
  close(protectionTime(settings("extreme"), 200), 80 / 3);
});
test("TMS and circuit-breaker clearing time both affect the total operation time", () => {
  close(protectionTime(settings("very", { timeMultiplier: .2, breakerTime: .06 }), 200), 13.5 * .2 + .06);
});
test("pickup alone does not trip and zero current has no inverse-time operation", () => {
  assert.equal(protectionTime(settings(), 100), Infinity); assert.equal(protectionTime(settings(), 0), Infinity);
});
test("definite-time and instantaneous elements use the earliest relay response", () => {
  const s = settings("definite", { instantaneousA: 500, breakerTime: .06 });
  close(protectionTime(s, 400), .56); close(protectionTime(s, 500), .08);
  close(protectionTime(settings("very", { instantaneousA: 500, instantaneousTime: 100 }), 1000), 1.5);
});
test("the reported margin is the upstream time minus downstream time at the selected current", () => {
  const a = settings("definite", { definiteTime: .2 }), b = settings("definite", { definiteTime: .5 });
  close(compareProtection(a, b, 200).margin, .3); close(compareProtection(b, a, 200).margin, -.3);
  assert.equal(compareProtection(a, b, 100).margin, null);
});
test("invalid or missing protection settings are rejected instead of producing a curve", () => {
  for (const extra of [{ pickupA: 0 }, { timeMultiplier: -1 }, { protectionCurve: "none" },
    { instantaneousA: -1 }, { breakerTime: NaN }, { instantaneousTime: -1 }])
    assert.throws(() => protectionTime(settings("standard", extra), 200));
  assert.throws(() => protectionTime(settings(), -1));
});
