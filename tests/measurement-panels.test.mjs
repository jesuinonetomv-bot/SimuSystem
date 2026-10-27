import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSwitchingStudy, electricalTerminals } from "../src/switching-analysis.js";
import { calculateAnimatedFlow } from "../src/flow-animation.js";
import { bundledDiagram } from "../src/bundled-diagrams.js";
import { SE56A01_ID } from "../src/se56a-01-diagram.js";
import { createMeasurementContext, equivalentReadings, equipmentReadings, createMeasurementPanel,
  measurementPanelFor, panelReadings, panelDimensions, panelBounds, renderMeasurementPanel, remapPanelLinks } from "../src/measurement-panels.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
function fixture() {
  return { items: {
    bus: { type: "bus", x1: 0, y1: 0, x2: 200, y2: 0 },
    grid: { type: "utility", x: -1000, y: -1000, isSource: true, state: "running", topology: { terminalA: "bus" } },
    a: { type: "load", x: 3000, y: 1000, state: "active", topology: { terminalA: "bus" } },
    b: { type: "motor", x: 5000, y: 1000, state: "active", topology: { terminalA: "bus" } },
  } };
}
function readings(d, values = {}) {
  return new Map(Object.entries(d.items).map(([id]) => [id, { energized: true, voltageKV: 13.8, frequencyHz: 60,
    activeMW: ["a", "b"].includes(id) ? 1 : 2, reactiveMvar: id === "a" ? 1 : id === "b" ? -1 : 0, ...values[id] }]));
}
function context(d = fixture(), values = {}, results = readings(d, values)) {
  const network = createSwitchingStudy(d).network(), flow = calculateAnimatedFlow(network, results);
  return createMeasurementContext({ diagram: d, results, network, flow });
}
test("opposite reactive powers cancel vectorially instead of summing current magnitudes or averaging PF", () => {
  const ctx = context(), eq = equivalentReadings(ctx);
  close(eq.activeMW, 2); close(eq.reactiveMvar, 0); close(eq.apparentMVA, 2); close(eq.powerFactor, 1);
  close(eq.currentA, 2000 / (Math.sqrt(3) * 13.8)); close(eq.currentPhasorA.imaginary, 0);
  close(ctx.equivalent.demand.currentA, eq.currentA); assert.equal(ctx.equivalent.demand.frequencyHz, 60);
  const scalarSum = 2 * Math.sqrt(2) * 1000 / (Math.sqrt(3) * 13.8);
  assert.ok(eq.currentA < scalarSum); assert.equal(eq.frequencyHz, 60);
});
test("unequal load factors produce the complex-power equivalent, not a mean of individual factors", () => {
  const eq = equivalentReadings(context(fixture(), { a: { activeMW: 1, reactiveMvar: 0 }, b: { activeMW: .5, reactiveMvar: Math.sqrt(3) / 2 } }));
  close(eq.activeMW, 1.5); close(eq.reactiveMvar, Math.sqrt(3) / 2);
  close(eq.apparentMVA, Math.sqrt(3)); close(eq.powerFactor, Math.sqrt(3) / 2);
});
test("capacitor compensation enters Q once and can make the circuit capacitive", () => {
  const d = fixture(); d.items.cap = { type: "capacitor", x: 7000, y: 1000, state: "active", activeStages: 1, topology: { terminalA: "bus" } };
  const eq = equivalentReadings(context(d, { cap: { activeMW: 0, reactiveMvar: -2 } }));
  close(eq.activeMW, 2); close(eq.reactiveMvar, -2); close(eq.apparentMVA, Math.sqrt(8));
  assert.equal(eq.nature, "capacitivo"); assert.ok(eq.currentPhasorA.imaginary > 0);
});
test("transformers and intermediate readings are not counted as additional consumer demand", () => {
  const d = fixture(); d.items.low = { type: "bus", x1: 1000, y1: 0, x2: 1200, y2: 0 };
  d.items.tf = { type: "transformer", x: 500, y: 500, topology: { terminalA: "bus", terminalB: "low" }, electrical: { impedancePercent: null } };
  d.items.b.topology.terminalA = "low";
  const ctx = context(d, { a: { reactiveMvar: .75 }, b: { reactiveMvar: .75, voltageKV: 4.16 },
    low: { voltageKV: 4.16, activeMW: 100 }, tf: { activeMW: 100, voltagePrimaryKV: 13.8, voltageSecondaryKV: 4.16 } });
  const primary = equivalentReadings(ctx), secondary = equivalentReadings(ctx, { itemId: "tf", side: "secondary" });
  close(primary.activeMW, 2); close(primary.reactiveMvar, 1.5); close(primary.apparentMVA, 2.5);
  close(primary.currentA, 2500 / (Math.sqrt(3) * 13.8));
  close(secondary.currentA, 2500 / (Math.sqrt(3) * 4.16)); close(secondary.powerFactor, .8);
  assert.equal(ctx.equivalent.loads.length, 2);
  close(equipmentReadings(ctx, "tf", "primary").currentA, 1250 / (Math.sqrt(3) * 13.8));
  close(equipmentReadings(ctx, "tf", "secondary").currentA, 1250 / (Math.sqrt(3) * 4.16));
});
test("inactive and deenergized loads leave the live totals while missing readings stay pending", () => {
  const d = fixture(); d.items.b.state = "inactive";
  close(equivalentReadings(context(d)).activeMW, 1);
  d.items.b.state = "active";
  close(equivalentReadings(context(d, { b: { energized: false } })).activeMW, 1);
  const r = readings(d); r.delete("b"); const missing = equivalentReadings(context(d, {}, r));
  assert.equal(missing.activeMW, null); assert.equal(missing.currentA, null); assert.equal(missing.powerFactor, null);
});
test("independent electrical islands have no single current, frequency or PF equivalent", () => {
  const d = fixture(); d.items.low = { type: "bus", x1: 10000, y1: 0, x2: 10200, y2: 0 };
  d.items.grid2 = { type: "utility", x: 11000, y: -1000, isSource: true, state: "running", topology: { terminalA: "low" } };
  d.items.b.topology.terminalA = "low";
  const eq = equivalentReadings(context(d, { b: { frequencyHz: 50 }, grid2: { frequencyHz: 50 } }));
  close(eq.activeMW, 2); assert.equal(eq.frequencyHz, null); assert.equal(eq.currentA, null); assert.equal(eq.powerFactor, null);
  assert.match(eq.reason, /ilhas/);
});
test("a shared circuit with different source voltage bases needs an explicit current reference", () => {
  const d = fixture(); d.items.gen = { type: "turbogenerator", state: "running", x: 8000, y: 1000, topology: { terminalA: "bus" } };
  const ctx = context(d, { grid: { voltageKV: 230 }, gen: { voltageKV: 13.8, activeMW: .5, reactiveMvar: 0 } });
  assert.equal(equivalentReadings(ctx).currentA, null);
  assert.ok(equivalentReadings(ctx, { itemId: "bus" }).currentA > 0);
});
test("net balance subtracts generation while the separate load total remains unchanged", () => {
  const d = fixture(); d.items.gen = { type: "turbogenerator", state: "running", isSource: true, x: 8000, y: 1000, topology: { terminalA: "bus" } };
  const ctx = context(d, { b: { reactiveMvar: 0 }, gen: { activeMW: .5, reactiveMvar: .25 } });
  const load = equivalentReadings(ctx), net = equivalentReadings(ctx, {}, true);
  close(load.activeMW, 2); close(load.reactiveMvar, 1); close(net.activeMW, 1.5); close(net.reactiveMvar, .75);
  close(equipmentReadings(ctx, "gen").activeMW, .5);
});
test("unknown parallel source shares remain indefinite while the tab load equivalent is available", () => {
  const d = fixture(); d.items.grid2 = { ...d.items.grid, x: -2000 };
  const ctx = context(d), panel = createMeasurementPanel();
  assert.equal(equipmentReadings(ctx, "grid").activeMW, undefined);
  close(equivalentReadings(ctx).activeMW, 2); assert.ok(equivalentReadings(ctx).currentA > 0);
  panel.rows = [{ metric: "activeMW", origin: "item", targetId: "grid" }, { metric: "activeMW", origin: "tab" }];
  assert.equal(panelReadings(panel, ctx)[0].text, "Indef."); assert.equal(panelReadings(panel, ctx)[1].text, "2,00 MW");
});
test("zero demand is zero current with a pending factor, not an invented unity PF", () => {
  const d = fixture(); d.items.a.state = d.items.b.state = "inactive";
  const eq = equivalentReadings(context(d));
  assert.equal(eq.activeMW, 0); assert.equal(eq.apparentMVA, 0); assert.equal(eq.currentA, 0); assert.equal(eq.powerFactor, null);
});
test("a removed or electrically unrelated voltage reference cannot yield a false current", () => {
  const d = fixture(); d.items.remote = { type: "bus", x1: 50000, y1: 0, x2: 51000, y2: 0 };
  const ctx = context(d);
  assert.equal(equivalentReadings(ctx, { itemId: "remote" }).currentA, null);
  assert.equal(equivalentReadings(ctx, { itemId: "gone" }).currentA, null);
});
test("new panel rows choose independent quantities and origins and format pt-BR values", () => {
  const panel = createMeasurementPanel({ x: 30, y: 50 }, 7), ctx = context();
  assert.equal(panel.rows.length, 7);
  panel.rows = [{ metric: "activeMW", origin: "tab" }, { label: "Motor B", metric: "voltageKV", origin: "item", targetId: "b" },
    { metric: "frequencyHz", origin: "tab", digits: 1 }];
  assert.deepEqual(panelReadings(panel, ctx).map(row => row.text), ["2,00 MW", "13,80 kV", "60,0 Hz"]);
  assert.equal(panelReadings(panel, ctx)[1].label, "Motor B");
});
test("the photographed area/text panel converts without altering the saved diagram or its electrical objects", () => {
  const d = bundledDiagram(SE56A01_ID), snapshot = JSON.stringify(d), converted = measurementPanelFor(d, "abb-meter-i-value-2");
  assert.equal(converted.id, "abb-meter-i"); assert.equal(converted.item.name, "LINHA 1 · LT-I");
  assert.equal(converted.item.rows.length, 5); assert.equal(converted.item.rows[2].metric, "currentA");
  assert.ok(converted.item.rows.every(row => row.origin === "item" && row.targetId === "abb-source-lt-i"));
  assert.equal(converted.removeIds.length, 16); assert.equal(JSON.stringify(d), snapshot);
  for (const id of converted.removeIds) assert.ok(["area", "text"].includes(d.items[id].type));
  assert.equal(measurementPanelFor(d, "abb-tf-a"), null); assert.equal(measurementPanelFor(d, "abb-patio"), null);
});
test("copied and cross-tab panels remap bindings while retaining targets outside the copied selection", () => {
  const panel = createMeasurementPanel(); panel.reference = { itemId: "bus", side: "secondary" };
  panel.rows[0] = { metric: "activeMW", origin: "item", targetId: "a" };
  const copied = remapPanelLinks(panel, id => ({ a: "new-a" })[id] || id);
  assert.equal(copied.rows[0].targetId, "new-a"); assert.equal(copied.reference.itemId, "bus");
  const remote = remapPanelLinks(panel, id => "SE2::" + id);
  assert.equal(remote.rows[0].targetId, "SE2::a"); assert.equal(remote.reference.itemId, "SE2::bus");
  assert.equal(panel.rows[0].targetId, "a");
});
test("panel rendering keeps the compact HMI style and calculates bounds for movement and rotation", () => {
  const panel = createMeasurementPanel({ x: 30, y: 50 }, 3);
  const E = (tag, attrs = {}, text = "") => ({ tag, attrs, text, children: [], append(...children) { this.children.push(...children); } });
  const holder = E("g"); renderMeasurementPanel(holder, panel, context(), E);
  const flatten = node => [node, ...node.children.flatMap(flatten)], nodes = flatten(holder);
  assert.equal(nodes.filter(node => node.tag === "rect" && node.attrs.fill === "#17252d").length, 3);
  assert.ok(nodes.some(node => node.text === "2,00 MW"));
  const dimensions = panelDimensions(panel), bounds = panelBounds(panel);
  assert.equal(bounds.x2 - bounds.x1, dimensions.width); assert.equal(bounds.y2 - bounds.y1, dimensions.height);
  const rotated = panelBounds({ ...panel, rotation: 90 }); close(rotated.x2 - rotated.x1, dimensions.height);
});
test("the real 352-object tab totals its nine small loads and three boilers without double counting", () => {
  const d = bundledDiagram(SE56A01_ID), page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const geometry = page.slice(page.indexOf("      function terminals("), page.indexOf("      function transformerSequenceViolation("));
  const engine = page.slice(page.indexOf("      const isElectrical ="), page.indexOf("      function measurementLines("));
  const projection = page.slice(page.indexOf("      function projectPoint("), page.indexOf("      function flowAnalysis("));
  const r = new Function("diagram", "electricalTerminals", geometry + engine + projection + "\nreturn calculateElectricalState();")(d, electricalTerminals);
  const study = createSwitchingStudy(d), live = study.energizedItems();
  for (const [id, result] of r) if (!live.has(id)) result.energized = false;
  const ctx = context(d, {}, r), eq = equivalentReadings(ctx);
  close(eq.activeMW, 196.74); close(eq.reactiveMvar, 9 * 1.86 * Math.tan(Math.acos(.93)));
  close(eq.apparentMVA, Math.hypot(eq.activeMW, eq.reactiveMvar));
  close(eq.currentA, eq.apparentMVA * 1000 / (Math.sqrt(3) * 230));
  assert.equal(eq.frequencyHz, 60); assert.equal(ctx.equivalent.loads.length, 12);
});
