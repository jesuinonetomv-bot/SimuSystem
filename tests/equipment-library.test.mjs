import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EQUIPMENT_CATALOG, createEquipment, cableEquivalent, instrumentLinkIssues, remapInstrumentLinks, relayCoordinationProfile, instrumentReadout } from "../src/equipment-library.js";
import { createSwitchingStudy } from "../src/switching-analysis.js";
import { buildStudyNetwork } from "../src/study-network.js";
import { solveDiagramPowerFlow } from "../src/power-flow.js";
import { runShortCircuitCase } from "../src/short-circuit.js";
import { prepareStudyCase, runStudyCase } from "../src/study-cases.js";
import { analyzeCoordination, coordinationExample } from "../src/protection-coordination.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const bus = (x) => ({ type: "bus", x1: x, x2: x + 100, y1: 0, y2: 0, electrical: { nominalKV: 10 } });
const topology = (terminalA, terminalB) => ({ terminalA, ...(terminalB ? { terminalB } : {}) });
function feeder() {
  const cable = createEquipment("cable", { x: 300, y: 500 }, { x: 600, y: 500 });
  cable.electrical = { ...cable.electrical, nominalKV: 10, lengthM: 1000, resistanceOhmPerKm: 1, reactanceOhmPerKm: 2, ampacityPerRunA: 100 };
  cable.topology = topology("a", "b");
  const motor = createEquipment("motor", { x: 1000, y: 500 });
  motor.topology = topology("b"); motor.electrical.nominalKV = 10;
  return { items: { a: bus(0), b: bus(1000), cable, motor,
    grid: { type: "utility", x: -500, y: -500, state: "running", topology: topology("a"), electrical: { nominalKV: 10, shortCircuitMVA: 1000, sourceXR: 10 } } } };
}

test("cable equivalent uses electrical length and identical parallel circuits", () => {
  const z = cableEquivalent({ lengthM: 250, parallelRuns: 2, resistanceOhmPerKm: .8, reactanceOhmPerKm: .16, ampacityPerRunA: 180 });
  assert.equal(z.known, true); close(z.resistanceOhm, .1); close(z.reactanceOhm, .02); assert.equal(z.ampacityA, 360);
});
test("blank cable R/X stays pending rather than becoming an ideal connection", () => {
  const o = createEquipment("cable", { x: 0, y: 0 }, { x: 100, y: 100 });
  assert.equal(cableEquivalent(o.electrical).known, false); assert.equal(cableEquivalent(o.electrical).resistanceOhm, null);
  const d = feeder(); d.items.cable.electrical.reactanceOhmPerKm = null;
  assert.throws(() => solveDiagramPowerFlow(d), /impedância/);
  assert.ok(buildStudyNetwork(d).islands.some(i => i.errors.some(e => /impedância/.test(e))));
});
for (const [field, value] of [["lengthM", 0], ["lengthM", -1], ["parallelRuns", 1.5], ["parallelRuns", 0], ["resistanceOhmPerKm", -1], ["reactanceOhmPerKm", ""]])
  test(`invalid cable ${field}=${value} is rejected by the equivalent`, () => assert.equal(cableEquivalent({ ...feeder().items.cable.electrical, [field]: value }).known, false));
test("explicit zero cable R/X is recognized as an ideal ring", () => {
  const d = feeder(); d.items.cable.electrical.resistanceOhmPerKm = d.items.cable.electrical.reactanceOhmPerKm = 0;
  d.items.tie = { type: "breaker", x: 800, y: 500, state: "open", topology: topology("a", "b") };
  assert.equal(createSwitchingStudy(d).analyze("tie").type, "ring_without_impedance");
});
test("configured cable gives a ring with series impedance", () => {
  const d = feeder(); d.items.tie = { type: "breaker", x: 800, y: 500, state: "open", topology: topology("a", "b") };
  const r = createSwitchingStudy(d).analyze("tie"); assert.equal(r.type, "ring_with_impedance"); assert.ok(r.components.some(c => c.kind === "cable"));
});
test("a cable body does not accept a new power tap", () => {
  const d = { items: { cable: createEquipment("cable", { x: 0, y: 0 }, { x: 1000, y: 0 }), motor: { type: "motor", x: 500, y: 34, state: "active" },
    grid: { type: "utility", x: 0, y: 52, state: "running" } } };
  assert.equal(createSwitchingStudy(d).energizedItems().has("motor"), false);
});
test("cable and motor match a line of the same impedance and a load of the same power", () => {
  const d = feeder(), reference = structuredClone(d);
  reference.items.cable.type = "line"; reference.items.cable.electrical = { nominalKV: 10, resistanceOhm: 1, reactanceOhm: 2, ampacityA: 100 };
  reference.items.motor.type = "load";
  const a = solveDiagramPowerFlow(d), b = solveDiagramPowerFlow(reference);
  assert.equal(a.converged, true); assert.equal(b.converged, true); close(a.totalLossMW, b.totalLossMW);
  for (let i = 0; i < a.buses.length; i++) close(a.buses[i].voltagePU, b.buses[i].voltagePU);
});
test("cable impedance enters the three-phase short-circuit result", () => {
  const d = feeder(), reference = structuredClone(d); reference.items.cable.type = "line";
  reference.items.cable.electrical = { nominalKV: 10, resistanceOhm: 1, reactanceOhm: 2 };
  const a = runShortCircuitCase(d).results.find(r => r.busIds.includes("b")), b = runShortCircuitCase(reference).results.find(r => r.busIds.includes("b"));
  close(a.currentKA, b.currentKA); assert.ok(a.currentKA > 0);
});
test("study case scales cable R/X and motor demand without changing the original model", () => {
  const d = feeder(), r = prepareStudyCase(d, { adjustments: { resistancePercent: 120, reactancePercent: 90, loadPercent: 50 } });
  close(r.model.items.cable.electrical.resistanceOhmPerKm, 1.2); close(r.model.items.cable.electrical.reactanceOhmPerKm, 1.8);
  close(r.model.items.motor.electrical.activePowerMW, .5); assert.equal(d.items.motor.electrical.activePowerMW, 1);
});
test("cable loading uses the saved ampacity and missing limits stay pending", () => {
  const d = feeder(), a = runStudyCase(d, {}); assert.ok(a.branches.find(b => b.type === "cable").loadingPercent > 0);
  d.items.cable.electrical.ampacityPerRunA = null; const b = runStudyCase(d, {});
  assert.equal(b.branches.find(b => b.type === "cable").loadingPercent, null); assert.ok(b.alertReport.pending.some(p => /limite nominal/.test(p)));
});
test("instruments and earth symbols cannot bypass an open breaker or act as sources", () => {
  const d = { items: { a: bus(0), b: bus(1000), tie: { type: "breaker", x: 400, y: 100, state: "open", topology: topology("a", "b") },
    grid: { type: "utility", x: -500, y: 400, state: "running", topology: topology("a") } } };
  for (const type of ["relay", "ct", "vt", "cbct", "ground", "surgeArrester"]) d.items[type] = { ...createEquipment(type, { x: 400, y: 100 }), isSource: true, topology: topology("a", "b"), instrument: { measuredId: "b" } };
  const s = createSwitchingStudy(d); assert.equal(s.energizedItems().has("b"), false);
  for (const type of ["relay", "ct", "vt", "cbct", "ground", "surgeArrester"]) assert.equal(s.network().ports.has(type), false);
});
test("an open fuse removes its power path and is not an opening candidate", () => {
  const d = feeder(); delete d.items.cable;
  d.items.fuse = { ...createEquipment("fuse", { x: 400, y: 500 }), topology: topology("a", "b") };
  assert.ok(createSwitchingStudy(d).energizedItems().has("motor")); d.items.fuse.state = "open";
  assert.equal(createSwitchingStudy(d).energizedItems().has("motor"), false);
  assert.equal(createSwitchingStudy(d).command("fuse", "closed").valid, false);
});
test("instrument references reject wrong sensor types and self references", () => {
  const ct = createEquipment("ct", { x: 0, y: 0 }), relay = createEquipment("relay", { x: 100, y: 0 });
  relay.instrument = { ctId: "toroid", breakerId: "relay" };
  assert.equal(instrumentLinkIssues(relay, { relay, toroid: createEquipment("cbct", { x: 0, y: 0 }), ct }, "relay").length, 2);
});
test("instrument references remap for copy, deletion and diagrams in other tabs", () => {
  const o = { type: "relay", instrument: { ctId: "ct", vtId: "deleted", breakerId: "dj" } };
  assert.deepEqual(remapInstrumentLinks(o, id => id === "deleted" ? null : "tab::" + id).instrument, { ctId: "tab::ct", breakerId: "tab::dj" });
  assert.equal(o.instrument.ctId, "ct");
});
test("relay copies the linked phase CT ratio and linked breaker time", () => {
  const items = feeder().items;
  items.ct = { ...createEquipment("ct", { x: 0, y: 100 }), instrument: { measuredId: "cable" } };
  items.dj = { type: "breaker", state: "closed", electrical: { breakerTime: .08 } };
  items.relay = { ...createEquipment("relay", { x: 0, y: 200 }), instrument: { ctId: "ct", breakerId: "dj" } };
  items.ct.electrical.ctPrimary = 400; items.ct.electrical.ctSecondary = 5;
  const p = relayCoordinationProfile(items.relay, items); assert.equal(p.ctPrimary, 400); assert.equal(p.ctSecondary, 5); assert.equal(p.breakerTime, .08); assert.equal(p.inputBasis, "secondary");
  assert.equal(p.nominalKV, 10);
  items.relay.instrument.ctId = "missing"; assert.throws(() => relayCoordinationProfile(items.relay, items), /TC de fase/);
});
test("coordination accepts linked relays and rejects two devices on the same breaker", () => {
  const config = coordinationExample(), items = feeder().items;
  items.ct = { ...createEquipment("ct", { x: 0, y: 100 }), instrument: { measuredId: "cable" } };
  items.dj = { type: "breaker", state: "closed" };
  items.relay = { ...createEquipment("relay", { x: 0, y: 200 }), instrument: { ctId: "ct", breakerId: "dj" } };
  config.devices[0].equipmentId = "relay"; assert.ok(analyzeCoordination(config, { items }).pairs.length);
  config.devices[1].equipmentId = "dj"; assert.throws(() => analyzeCoordination(config, { items }), /mesmo disjuntor/);
});
test("CT and TP show ideal secondary values but toroidal residual is never inferred", () => {
  const items = feeder().items, r = new Map([["cable", { currentA: 600, voltageKV: 13.8 }]]);
  const ct = { ...createEquipment("ct", { x: 0, y: 0 }), instrument: { measuredId: "cable" } };
  assert.ok(instrumentReadout(ct, items, r)[0].includes("1 A"));
  const vt = { ...createEquipment("vt", { x: 0, y: 0 }), instrument: { measuredId: "cable" } };
  assert.ok(instrumentReadout(vt, items, r)[0].includes("110 V"));
  const toroid = { ...createEquipment("cbct", { x: 0, y: 0 }), instrument: { measuredId: "cable" } };
  assert.match(instrumentReadout(toroid, items, r)[0], /não calculada/);
});
test("actual app terminals agree with the new fuse and motor symbols at 90 degrees", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8"), a = html.indexOf("      function terminals(o) {"), b = html.indexOf("      function d2(", a);
  const terminals = new Function(html.slice(a, b) + ";return terminals;")();
  const fuse = { ...createEquipment("fuse", { x: 100, y: 100 }), rotation: 90 };
  close(terminals(fuse)[0].x, 122); close(terminals(fuse)[1].x, 78);
  const motor = { ...createEquipment("motor", { x: 100, y: 100 }), rotation: 90 }; close(terminals(motor)[0].x, 134);
  for (const type of Object.keys(EQUIPMENT_CATALOG).filter(t => !["cable", "fuse", "motor"].includes(t))) assert.deepEqual(terminals(createEquipment(type, { x: 0, y: 0 })), []);
});
test("transformer instrument reads and relay voltage use the selected winding", () => {
  const items = { tf: { type: "transformer", electrical: { primaryKV: 230, secondaryKV: 13.8 } }, dj: { type: "breaker" } };
  const r = new Map([["tf", { energized: true, currentA: 1000, voltageKV: 13.8, voltagePrimaryKV: 230, voltageSecondaryKV: 13.8 }]]);
  items.ct = { ...createEquipment("ct", { x: 0, y: 0 }), instrument: { measuredId: "tf" } };
  items.ct.electrical.measurementSide = "primary";
  assert.ok(instrumentReadout(items.ct, items, r)[0].includes("0,1 A"));
  const relay = { ...createEquipment("relay", { x: 0, y: 0 }), instrument: { ctId: "ct", breakerId: "dj" } };
  assert.equal(relayCoordinationProfile(relay, items).nominalKV, 230);
  const vt = { ...createEquipment("vt", { x: 0, y: 0 }), instrument: { measuredId: "tf" } };
  Object.assign(vt.electrical, { measurementSide: "primary", primaryV: 230000, secondaryV: 110 });
  assert.ok(instrumentReadout(vt, items, r)[0].includes("110 V"));
});
test("a TC at a contact with no pass-through solution does not display a false zero", () => {
  const ct = { ...createEquipment("ct", { x: 0, y: 0 }), instrument: { measuredId: "dj" } };
  const items = { dj: { type: "breaker" } }, r = new Map([["dj", { energized: true, currentA: 0 }]]);
  assert.match(instrumentReadout(ct, items, r)[0], /não determinada/);
  r.get("dj").energized = false; assert.match(instrumentReadout(ct, items, r)[0], /0 A/);
});
