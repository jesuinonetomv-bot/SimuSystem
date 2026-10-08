import test from "node:test";
import assert from "node:assert/strict";
import { calculatePointFault, normalizeSequenceCase } from "../src/fault-analysis.js";
import { simulateFaultSequence, sequenceExample, sequenceProtections, sequenceReportCSV, sequenceReportText } from "../src/fault-sequence.js";
import { runShortCircuitCase } from "../src/short-circuit.js";

const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const topology = (a, b) => ({ terminalA: a, ...(b ? { terminalB: b } : {}) });
const bus = (x, kv = 10) => ({ type: "bus", x1: x, x2: x + 100, y1: 0, y2: 0, electrical: { nominalKV: kv } });
const grid = (a, x = -500) => ({ type: "utility", name: "Rede", x, y: -500, state: "running", topology: topology(a),
  electrical: { nominalKV: 10, shortCircuitMVA: 100, sourceXR: 10, negativeSequenceModel: "same", sourceGrounding: "grounded", zeroResistanceOhm: .2, zeroReactanceOhm: 1.5 } });
function radial() {
  return { name: "Rede radial", items: { a: bus(0), b: bus(1000), grid: grid("a"),
    dj: { type: "breaker", name: "DJ", x: 500, y: 300, state: "closed", topology: topology("a", "line"), electrical: { nominalKV: 10, protectionCurve: "definite", pickupA: 100, definiteTime: .3, breakerTime: .06 } },
    line: { type: "line", name: "Trecho", x1: 1600, y1: 600, x2: 2000, y2: 600, topology: topology("dj", "b"), electrical: { nominalKV: 10, resistanceOhm: .1, reactanceOhm: .2, zeroResistanceOhm: .3, zeroReactanceOhm: .6 } },
  } };
}
const faultCase = (faultType = "LL", phases = "BC", itemId = "b", extra = {}) => ({ faultType, phases, location: { itemId, fraction: .5, port: 0 }, ...extra });
const rSource = 1 / Math.sqrt(101), xSource = 10 / Math.sqrt(101), voltage = 10000 / Math.sqrt(3);
const three = voltage / Math.hypot(rSource + .1, xSource + .2);

test("three-phase point fault matches the existing nominal short-circuit engine", () => {
  const d = radial(), f = calculatePointFault(d, faultCase("3P", "ABC"));
  const old = runShortCircuitCase(d, { faultBusId: "b", calculation: { standard: "nominal" } }).results[0];
  close(f.currentA, three); close(f.currentA / 1000, old.currentKA); close(f.residualA, 0);
  for (const a of f.phaseA) close(a, three);
});
for (const [phases, healthy] of [["AB", 2], ["BC", 0], ["CA", 1]]) test("line-line " + phases + " has zero healthy-phase and residual current", () => {
  const f = calculatePointFault(radial(), faultCase("LL", phases));
  close(f.currentA, three * Math.sqrt(3) / 2); close(f.phaseA[healthy], 0); close(f.residualA, 0);
  close(Math.max(...f.measurements.get("dj")[0].phaseA), f.currentA);
});
for (const [phase, index] of [["A", 0], ["B", 1], ["C", 2]]) test("phase-earth " + phase + " matches the series sequence formula", () => {
  const f = calculatePointFault(radial(), faultCase("LG", phase, "b", { faultRohm: .5, faultXohm: .1 }));
  const expected = 3 * voltage / Math.hypot(2 * (rSource + .1) + .2 + .3 + 1.5, 2 * (xSource + .2) + 1.5 + .6 + .3);
  close(f.phaseA[index], expected); close(f.residualA, expected);
  for (let i = 0; i < 3; i++) if (i !== index) close(f.phaseA[i], 0);
  close(f.measurements.get("dj")[0].residualA, expected);
});
test("custom source Z2 changes the line-line current without changing Z1", () => {
  const d = radial(); Object.assign(d.items.grid.electrical, { negativeSequenceModel: "custom", negativeResistanceOhm: .4, negativeReactanceOhm: .8 });
  const f = calculatePointFault(d, faultCase()); close(f.currentA, 10000 / Math.hypot(rSource + .1 + .4 + .1, xSource + .2 + .8 + .2));
});
test("source neutral enters the earth-fault equivalent as 3Zn", () => {
  const d = radial(); d.items.grid.electrical.neutralResistanceOhm = 2;
  const f = calculatePointFault(d, faultCase("LG", "A"));
  close(f.currentA, 3 * voltage / Math.hypot(2 * (rSource + .1) + .2 + .3 + 6, 2 * (xSource + .2) + 1.5 + .6));
});
test("positive-sequence contraction does not erase a nonzero line Z0", () => {
  const d = radial(); Object.assign(d.items.line.electrical, { resistanceOhm: 0, reactanceOhm: 0 });
  const f = calculatePointFault(d, faultCase("LG", "A")); close(f.currentA, 3 * voltage / Math.hypot(2 * rSource + .2 + .3, 2 * xSource + 1.5 + .6));
});
test("missing sequence data stays pending, and line-line needs no earth data", () => {
  const d = radial(); delete d.items.grid.electrical.negativeSequenceModel;
  assert.throws(() => calculatePointFault(d, faultCase()), /declare Z₂/);
  d.items.grid.electrical.negativeSequenceModel = "same"; delete d.items.grid.electrical.sourceGrounding;
  assert.doesNotThrow(() => calculatePointFault(d, faultCase()));
  assert.throws(() => calculatePointFault(d, faultCase("LG", "A")), /retorno de terra/);
  d.items.grid.electrical.sourceGrounding = "grounded"; delete d.items.line.electrical.zeroResistanceOhm;
  assert.throws(() => calculatePointFault(d, faultCase("LG", "A")), /R₀ e X₀/);
});
test("isolated grounding is not reported as a safely cleared or deenergized fault", () => {
  const d = radial(); d.items.grid.electrical.sourceGrounding = "isolated";
  const r = simulateFaultSequence(d, faultCase("LG", "A")); assert.equal(r.status, "noReturn"); assert.equal(r.clearedAt, null); close(r.initial.currentA, 0); assert.deepEqual(r.openedIds, []);
  assert.match(r.warnings.join(" "), /capacit|Capacit/);
});
test("open breaker isolates the point before fault, even with missing upstream sequence data", () => {
  const d = radial(); d.items.dj.state = "open"; d.items.grid.electrical = {};
  const r = simulateFaultSequence(d, faultCase("LG", "A")); assert.equal(r.status, "dead"); close(r.initial.currentA, 0); assert.deepEqual(r.openedIds, []);
});
test("mid-cable faults use the selected electrical fraction and preserve the saved cable", () => {
  const d = radial(), original = d.items.line;
  d.items.line = { ...original, type: "cable", electrical: { nominalKV: 10, lengthM: 1000, parallelRuns: 1, resistanceOhmPerKm: .1, reactanceOhmPerKm: .2, zeroResistanceOhmPerKm: .3, zeroReactanceOhmPerKm: .6 } };
  const snapshot = JSON.stringify(d);
  for (const fraction of [0, .25, .5, 1]) {
    const f = calculatePointFault(d, faultCase("3P", "ABC", "line", { location: { itemId: "line", fraction } }));
    close(f.currentA, voltage / Math.hypot(rSource + .1 * fraction, xSource + .2 * fraction));
    close(f.point.x, 1600 + 400 * fraction); close(f.point.y, 600);
  }
  assert.equal(JSON.stringify(d), snapshot);
});
test("a fault inside a line splits its impedance and ideal contact currents obey KCL", () => {
  const f = calculatePointFault(radial(), faultCase("LL", "BC", "line"));
  close(f.currentA, 10000 / Math.hypot(2 * (rSource + .05), 2 * (xSource + .1)));
  close(Math.max(...f.measurements.get("dj")[0].phaseA), f.currentA);
  close(Math.max(...f.measurements.get("line")[1].phaseA), 0);
});
function transformerModel(p = "D", s = "Yg", clock = 11) {
  const d = radial(); d.items.a.electrical.nominalKV = 20; d.items.grid.electrical.nominalKV = 20; d.items.grid.electrical.shortCircuitMVA = 1000;
  d.items.dj.topology = topology("a", "tf"); d.items.dj.electrical.nominalKV = 20;
  delete d.items.line;
  d.items.tf = { type: "transformer", name: "TF", x: 1500, y: 600, topology: topology("dj", "b"), electrical: { primaryKV: 20, secondaryKV: 10, ratedMVA: 10, impedancePercent: 10,
    transformerXR: 10, vectorClock: clock, primaryConnection: p, secondaryConnection: s, zeroImpedancePercent: 10, zeroTransformerXR: 10 } };
  return d;
}
test("D/Yg blocks high-side residual and applies the vector shift to phase currents", () => {
  const d = transformerModel(); delete d.items.grid.electrical.sourceGrounding; delete d.items.grid.electrical.zeroResistanceOhm;
  const f = calculatePointFault(d, faultCase("LG", "A"));
  const expected = 3 * voltage / (3.2 * 1); close(f.currentA, expected); // Z1=1.1 pu, Z2=1.1 pu, Z0=1 pu on 100 MVA/10 kV.
  close(f.measurements.get("tf")[1].residualA, expected); close(f.measurements.get("tf")[0].residualA, 0);
  const primary = f.measurements.get("tf")[0].phaseA; close(Math.max(...primary), expected * 10 / 20 / Math.sqrt(3));
  close(Math.min(...primary), 0); close(Math.max(...f.measurements.get("dj")[0].phaseA), Math.max(...primary));
});
test("D/Yg transformer neutral resistance limits the low-side earth current", () => {
  const d = transformerModel(); d.items.tf.electrical.secondaryNeutralResistanceOhm = 1;
  const f = calculatePointFault(d, faultCase("LG", "B")); close(f.currentA, 3 * voltage / Math.hypot(3.2 / Math.sqrt(101) + 3, 3.2 * 10 / Math.sqrt(101)));
});
test("Yg/Yg transfers source Z0 and D/D has no conductive earth return", () => {
  const d = transformerModel("Yg", "Yg", 0); Object.assign(d.items.grid.electrical, { zeroResistanceOhm: .4, zeroReactanceOhm: 4 });
  const f = calculatePointFault(d, faultCase("LG", "A"));
  // Grid Z0 referred from 20 kV to 10 kV is one quarter its ohmic value.
  close(f.currentA, 3 * voltage / Math.hypot(3.2 / Math.sqrt(101) + .1, 3.2 * 10 / Math.sqrt(101) + 1));
  const dd = transformerModel("D", "D", 0); assert.equal(calculatePointFault(dd, faultCase("LG", "A")).status, "noReturn");
});
test("unknown/unsupported transformer grounding is explicitly pending", () => {
  const d = transformerModel(); delete d.items.tf.electrical.vectorClock;
  assert.throws(() => calculatePointFault(d, faultCase()), /grupo horário/);
  d.items.tf.electrical.vectorClock = 11; delete d.items.tf.electrical.secondaryConnection;
  assert.throws(() => calculatePointFault(d, faultCase("LG", "A")), /ligação primária e secundária/);
  d.items.tf.electrical.secondaryConnection = "Yg"; d.items.tf.electrical.primaryConnection = "Y"; d.items.tf.electrical.vectorClock = 0;
  assert.throws(() => calculatePointFault(d, faultCase("LG", "A")), /magnetização/);
});
test("phase-earth trips earth protection first and suppresses later upstream pickup", () => {
  const d = sequenceExample(), before = JSON.stringify(d), r = simulateFaultSequence(d, faultCase("LG", "A", "loadBus"));
  assert.equal(r.status, "cleared"); close(r.clearedAt, .18); assert.deepEqual(r.openedIds, ["feeder"]);
  assert.deepEqual(r.events.filter(e => e.type === "relay").map(e => e.element), ["51N"]);
  assert.equal(r.protections.find(p => p.id === "relayGeneral:earth").status, "cancelled"); assert.equal(JSON.stringify(d), before);
});
test("line-line cannot activate residual earth elements and logs relay plus breaker time", () => {
  const r = simulateFaultSequence(sequenceExample(), faultCase("LL", "AB", "loadBus"));
  close(r.clearedAt, .36); assert.deepEqual(r.events.filter(e => e.type === "relay").map(e => e.element), ["51"]);
  for (const p of r.protections.filter(p => p.channel === "earth")) { close(p.currentA, 0); assert.equal(p.status, "belowPickup"); }
});
test("a trip command already issued remains latched after downstream clearance", () => {
  const d = sequenceExample(); d.items.relayGeneral.electrical.definiteTime = .32;
  const r = simulateFaultSequence(d, faultCase("LL", "BC", "loadBus")); close(r.clearedAt, .36);
  assert.deepEqual(r.events.filter(e => e.type === "open").map(e => [e.itemId, +e.timeSeconds.toFixed(3)]), [["feeder", .36], ["general", .38]]);
});
test("a relay tie with downstream breaker opening is retained as a non-selective command", () => {
  const d = sequenceExample(); d.items.relayGeneral.electrical.definiteTime = .36;
  const r = simulateFaultSequence(d, faultCase("LL", "BC", "loadBus")); assert.ok(r.openedIds.includes("general"));
  close(r.events.find(e => e.itemId === "general" && e.type === "open").timeSeconds, .42);
});
test("50/50N elements win over slower inverse or definite elements", () => {
  for (const earth of [false, true]) {
    const d = sequenceExample(), e = d.items.relayFeeder.electrical;
    if (earth) Object.assign(e, { earthInstantaneousA: .5, earthInstantaneousTime: .02 }); else Object.assign(e, { instantaneousA: 1, instantaneousTime: .02 });
    const r = simulateFaultSequence(d, faultCase(earth ? "LG" : "LL", earth ? "C" : "CA", "loadBus"));
    close(r.clearedAt, .08); assert.equal(r.events.find(e => e.type === "relay").element, earth ? "50N" : "50");
  }
});
test("toroid relation and channel are separate from phase CT settings", () => {
  const d = sequenceExample(); d.items.toroid = { type: "cbct", name: "Toroidal", x: 700, y: 700, instrument: { measuredId: "cable" }, electrical: { ctPrimary: 100, ctSecondary: 1 } };
  d.items.relayFeeder.instrument.cbctId = "toroid"; Object.assign(d.items.relayFeeder.electrical, { earthSensor: "cbct", earthPickupA: .3 });
  const p = sequenceProtections(d).functions.find(p => p.id === "relayFeeder:earth"); close(p.settings.pickupA, 30); assert.equal(p.measuredId, "cable");
  assert.equal(simulateFaultSequence(d, faultCase("LG", "A", "loadBus")).events.find(e => e.type === "relay").element, "51N");
  d.items.toroid.electrical.ctPrimary = null; assert.match(sequenceProtections(d).pending.find(p => p.id === "relayFeeder:earth").reason, /relação/);
});
function parallel() {
  const d = radial(); delete d.items.a; delete d.items.grid; delete d.items.dj; delete d.items.line;
  for (const [i, delay] of [[1, .1], [2, .5]]) {
    d.items["a" + i] = bus(-1000 * i); d.items["grid" + i] = grid("a" + i, -3000 * i);
    d.items["dj" + i] = { type: "breaker", name: "DJ " + i, x: 3000 * i, y: 3000, state: "closed", topology: topology("a" + i, "line" + i), electrical: { nominalKV: 10, protectionCurve: "definite", pickupA: 100, definiteTime: delay, breakerTime: .06 } };
    d.items["line" + i] = { type: "line", x1: 10000 * i, x2: 10000 * i + 400, y1: 10000, y2: 10000, topology: topology("dj" + i, "b"), electrical: { nominalKV: 10, resistanceOhm: .1, reactanceOhm: .2, zeroResistanceOhm: .3, zeroReactanceOhm: .6 } };
  }
  return d;
}
test("parallel feeders use their own branch current and recalculate after each opening", () => {
  const d = parallel(), c = faultCase("3P", "ABC", "b", { faultRohm: 1 }), f = calculatePointFault(d, c);
  const before = voltage / Math.hypot(rSource + .1 + 2, xSource + .2), after = voltage / Math.hypot(rSource + .1 + 1, xSource + .2);
  close(f.currentA, 2 * before); close(Math.max(...f.measurements.get("dj1")[0].phaseA), before); close(Math.max(...f.measurements.get("dj2")[0].phaseA), before);
  const r = simulateFaultSequence(d, c); assert.equal(r.status, "cleared"); close(r.clearedAt, .56);
  close(r.events.find(e => e.type === "relay" && e.itemId === "dj2").currentA, after);
});
test("inverse timer retains its integrated progress when the branch current changes", () => {
  const d = parallel(); Object.assign(d.items.dj2.electrical, { protectionCurve: "very", pickupA: 1000, timeMultiplier: .2 });
  const c = faultCase("3P", "ABC", "b", { faultRohm: 1 });
  const before = voltage / Math.hypot(rSource + .1 + 2, xSource + .2), after = voltage / Math.hypot(rSource + .1 + 1, xSource + .2);
  const tBefore = .2 * 13.5 / (before / 1000 - 1), tAfter = .2 * 13.5 / (after / 1000 - 1), expected = .16 + (1 - .16 / tBefore) * tAfter;
  const r = simulateFaultSequence(d, c); close(r.events.find(e => e.type === "relay" && e.itemId === "dj2").timeSeconds, expected);
});
test("ideal parallel contacts do not receive invented current shares or trips", () => {
  const d = radial(); delete d.items.line; d.items.dj.topology = topology("a", "b"); d.items.other = { ...structuredClone(d.items.dj), name: "Outro DJ", x: 12000, y: 12000 };
  const r = simulateFaultSequence(d, faultCase()); assert.equal(r.status, "notCleared"); assert.deepEqual(r.openedIds, []);
  assert.ok(r.protections.every(p => p.status === "pending")); assert.match(r.protections[0].reason, /ideais paralelos/);
});
test("wrong CT target or absent breaker link is pending rather than a false operation", () => {
  const d = sequenceExample(); d.items.ctFeeder.instrument.measuredId = "loadBus";
  const r = simulateFaultSequence(d, faultCase("LL", "BC", "loadBus")); assert.equal(r.protections.find(p => p.id === "relayFeeder:phase").status, "pending");
  delete d.items.relayGeneral.instrument.breakerId; assert.match(sequenceProtections(d).pending.find(p => p.id === "relayGeneral:phase").reason, /disjuntor/);
});
test("case duration and normalization reject invalid types, phases, points and numbers", () => {
  const c = faultCase();
  for (const change of [{ faultType: "fake" }, { phases: "ACG" }, { faultRohm: -1 }, { baseMVA: 0 }, { maxSeconds: 121 }, { location: { itemId: "b", fraction: 2 } }, { location: { itemId: "__proto__" } }]) assert.throws(() => normalizeSequenceCase({ ...c, ...change }));
  const r = simulateFaultSequence(radial(), { ...c, maxSeconds: .1 }); assert.equal(r.status, "notCleared"); assert.deepEqual(r.openedIds, []);
  assert.deepEqual(normalizeSequenceCase(JSON.parse(JSON.stringify(normalizeSequenceCase(c)))), normalizeSequenceCase(c));
});
test("report preserves currents, actual and prospective times, pending data and CSV formula escaping", () => {
  const d = sequenceExample(); d.items.relayFeeder.name = "=cmd()";
  const r = simulateFaultSequence(d, faultCase("LG", "A", "loadBus")), csv = sequenceReportCSV(r), text = sequenceReportText(r);
  assert.match(csv, /'\=cmd\(\)/); assert.match(csv, /0,18/); assert.match(text, /51N/); assert.match(text, /Falta eliminada antes de atuar/);
  assert.match(text, /Z₀/); assert.match(text, /tempo do disjuntor fixo/);
});
