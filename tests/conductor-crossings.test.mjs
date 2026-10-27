import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allowsCrossingTap, crossingPositions, createCrossingBridge, placeConductorCrossing,
  conductorCrossingPaths, renderCrossingMask, routeCrossingFlow } from "../src/conductor-crossings.js";
import { createSwitchingStudy, electricalTerminals } from "../src/switching-analysis.js";
import { buildStudyNetwork } from "../src/study-network.js";
import { calculateAnimatedFlow, arrowPose } from "../src/flow-animation.js";
import { GridDynamics } from "../src/grid-dynamics.js";

const line = (x1, y1, x2, y2, extra = {}) => ({ type: "line", x1, y1, x2, y2, ...extra });
function crossing() {
  return { items: {
    vertical: line(0, -200, 0, 200, { crossings: [.5] }),
    horizontal: line(-200, 0, 0, 0),
    continuation: line(0, 0, 200, 0),
    source: { type: "utility", x: 0, y: -148, isSource: true, state: "running",
      electrical: { nominalKV: 13.8, frequencyHz: 60, idealVoltageBoundary: true, gridMode: "rigid" } },
    ownLoad: { type: "load", x: 0, y: 234, state: "active", electrical: { activePowerMW: 2, powerFactor: 1 } },
    otherLoad: { type: "load", x: 200, y: 34, state: "active", electrical: { activePowerMW: 8, powerFactor: 1 } },
  } };
}
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function app(diagram) {
  const geometry = page.slice(page.indexOf("      function terminals("), page.indexOf("      function transformerSequenceViolation("));
  const engine = page.slice(page.indexOf("      const isElectrical ="), page.indexOf("      function measurementLines("));
  const projection = page.slice(page.indexOf("      function projectPoint("), page.indexOf("      function flowAnalysis("));
  return new Function("diagram", "electricalTerminals", "allowsCrossingTap", "gridDynamics", geometry + engine + projection +
    "\nreturn { calculateElectricalState, itemConnectionGraph, touchesPoint, buildElectricalZones };")(diagram, electricalTerminals, allowsCrossingTap, new GridDynamics());
}
test("a bridge preserves its two terminals and blocks taps in the crossing clearance", () => {
  const bridge = createCrossingBridge({ x: 100, y: 80 });
  assert.deepEqual(electricalTerminals(bridge), [{ x: 100, y: 20 }, { x: 100, y: 140 }]);
  assert.equal(allowsCrossingTap(bridge, { x: 100, y: 80 }), false);
  assert.equal(allowsCrossingTap(bridge, { x: 114, y: 80 }), false);
  assert.equal(allowsCrossingTap(bridge, { x: 100, y: 20 }), true);
  assert.equal(allowsCrossingTap(bridge, { x: 100, y: 140 }), true);
});
test("placing on an existing crossing prefers the selected wire, otherwise the vertical", () => {
  const items = { h: line(-200, 0, 200, 0), v: line(0, -200, 0, 200) }, initial = structuredClone(items);
  const a = placeConductorCrossing(items, { x: 0, y: 0 }, { hitId: "h" });
  assert.equal(a.id, "v"); assert.deepEqual(a.item.crossings, [.5]);
  const b = placeConductorCrossing(items, { x: 0, y: 0 }, { preferredId: "h" });
  assert.equal(b.id, "h"); assert.deepEqual(b.item.crossings, [.5]);
  assert.deepEqual(items, initial, "planning is immutable, so undo can capture the previous drawing");
});
test("a second click removes only that bridge and leaves other crossings and electrical settings", () => {
  const item = line(0, 0, 0, 600, { crossings: [.25, .75], electrical: { resistanceOhm: .12 },
    topology: { terminalA: "source", terminalB: "load" }, conductorGroupId: "feed" });
  const result = placeConductorCrossing({ wire: item }, { x: 0, y: 150 });
  assert.equal(result.added, false); assert.deepEqual(result.item.crossings, [.75]);
  assert.equal(result.item.electrical.resistanceOhm, .12); assert.deepEqual(result.item.topology, item.topology);
  assert.equal(result.item.conductorGroupId, "feed");
  const overArc = placeConductorCrossing({ wire: item, crossing: line(-100, 150, 100, 150) }, { x: 20, y: 150 });
  assert.equal(overArc.id, "wire"); assert.equal(overArc.added, false);
  assert.ok(placeConductorCrossing({ wire: item }, { x: 0, y: 5 }).error);
  assert.ok(placeConductorCrossing({ wire: item }, { x: 0, y: 195 }).error);
});
test("free insertion creates a vertical bridge and fractions survive translation, rotation and JSON", () => {
  const { item } = placeConductorCrossing({}, { x: 40, y: 60 });
  assert.deepEqual(crossingPositions(item), [.5]);
  const moved = { ...item, x1: item.x1 + 500, x2: item.x2 + 500 };
  assert.equal(allowsCrossingTap(moved, { x: 540, y: 60 }), false);
  const turned = JSON.parse(JSON.stringify(line(0, 0, 120, 0, { crossings: item.crossings })));
  assert.equal(allowsCrossingTap(turned, { x: 60, y: 0 }), false);
  assert.equal(allowsCrossingTap(turned, { x: 0, y: 0 }), true);
  for (const bad of [[null], [".5"], [NaN], [-1], [2]]) assert.deepEqual(crossingPositions({ ...item, crossings: bad }), []);
});
test("a crossing cannot energize the other wire even when its endpoints lie exactly on the bridge", () => {
  const d = crossing(), live = createSwitchingStudy(d).energizedItems();
  assert.ok(live.has("vertical")); assert.ok(live.has("ownLoad"));
  assert.ok(!live.has("horizontal")); assert.ok(!live.has("continuation")); assert.ok(!live.has("otherLoad"));
  delete d.items.vertical.crossings;
  assert.ok(createSwitchingStudy(d).energizedItems().has("otherLoad"), "removal restores the original junction");
});
test("the actual training graphs, zones and power totals keep the two circuits separate", () => {
  const d = crossing(), api = app(d), graph = api.itemConnectionGraph(Object.entries(d.items));
  assert.ok(!graph.get("vertical").includes("horizontal"));
  assert.ok(graph.get("horizontal").includes("continuation"));
  assert.equal(api.touchesPoint(d.items.vertical, { x: 0, y: 0 }), false);
  const zones = api.buildElectricalZones(Object.keys(d.items));
  assert.ok(!zones.zones.some(ids => ids.includes("vertical") && ids.includes("horizontal")));
  const r = api.calculateElectricalState();
  assert.equal(r.get("ownLoad").activeMW, 2); assert.equal(r.get("ownLoad").energized, true);
  assert.equal(r.get("otherLoad").energized, false); assert.equal(r.get("source").activeMW, 2);
});
test("the AC/short-circuit network and animated allocation use the same insulated topology", () => {
  const d = crossing(), study = buildStudyNetwork(d);
  assert.notEqual(study.busOfItem.get("ownLoad"), study.busOfItem.get("otherLoad"));
  const n = createSwitchingStudy(d).network(), readings = app(d).calculateElectricalState();
  const flow = calculateAnimatedFlow(n, readings);
  assert.ok(flow.segments.some(s => s.itemId === "vertical" && Math.abs(s.activeMW - 2) < 1e-8));
  assert.ok(!flow.segments.some(s => ["horizontal", "continuation"].includes(s.itemId)));
});
test("a load tap outside the insulated span remains connected", () => {
  const d = crossing();
  d.items.branch = line(0, 100, 200, 100);
  d.items.branchLoad = { type: "load", x: 200, y: 134, state: "active", electrical: { activePowerMW: 3, powerFactor: 1 } };
  assert.ok(createSwitchingStudy(d).energizedItems().has("branchLoad"));
  assert.equal(app(d).calculateElectricalState().get("source").activeMW, 5);
});
test("explicit references cannot silently turn the insulated center back into a junction", () => {
  const d = crossing();
  d.items.horizontal.topology = { terminalA: "otherLoad", terminalB: "vertical" };
  const s = createSwitchingStudy(d), network = s.network();
  assert.ok(!s.energizedItems().has("otherLoad"));
  assert.ok(network.issues.some(i => i.id === "horizontal"));
  assert.ok(!app(d).itemConnectionGraph(Object.entries(d.items)).get("vertical").includes("horizontal"));
});
test("a breaker over the insulated center does not cut or bypass the bridge", () => {
  const d = crossing(); d.items.accidental = { type: "breaker", x: 0, y: 0, state: "open" };
  assert.ok(createSwitchingStudy(d).energizedItems().has("ownLoad"));
});
test("a bus can carry a bridge and multiple independent crossing positions", () => {
  const d = crossing(); d.items.vertical.type = "bus";
  assert.ok(!createSwitchingStudy(d).energizedItems().has("otherLoad"));
  const paths = conductorCrossingPaths(line(0, 0, 0, 600, { crossings: [.25, .75] }));
  assert.equal((paths.arcs.match(/ A /g) || []).length, 2);
});
test("a transparent SVG mask clears the crossing without painting over area backgrounds", () => {
  const E = (tag, attrs = {}) => ({ tag, attrs, children: [], append(...nodes) { this.children.push(...nodes); } });
  const stage = E("svg");
  assert.equal(renderCrossingMask(stage, crossing().items, E), "url(#conductor-crossing-mask)");
  const mask = stage.children[0].children[0];
  assert.equal(mask.tag, "mask"); assert.equal(mask.children[0].attrs.fill, "white");
  assert.equal(mask.children[1].attrs.stroke, "black"); assert.ok(mask.attrs.width < 2000);
  assert.equal(renderCrossingMask(E("svg"), { wire: line(0, 0, 100, 0) }, E), null);
});
test("animated arrows follow the bridge curve in either direction without changing P or Q", () => {
  const wire = line(0, -100, 0, 100, { crossings: [.5] });
  const original = { itemId: "wire", from: { x: 0, y: -100 }, to: { x: 0, y: 100 }, activeMW: 2, reactiveMvar: .3 };
  const routed = routeCrossingFlow(original, wire);
  assert.equal(routed.activeMW, 2); assert.equal(routed.reactiveMvar, .3);
  assert.ok(routed.displayRoute.some(p => p.x > 13.9)); assert.ok(routed.displayLength > 200);
  const pose = arrowPose(routed, "p", 0, 0, 1, false, true);
  assert.ok(pose.x > 13.9); assert.ok(Math.abs(pose.y) < 1e-8); assert.ok(Math.abs(pose.angle - 90) < 6);
  const reversed = routeCrossingFlow({ ...original, from: original.to, to: original.from }, wire);
  assert.deepEqual(reversed.displayRoute, [...routed.displayRoute].reverse());
  const reversePose = arrowPose({ ...routed, activeMW: -2 }, "p", 0, 0, 1, false, true);
  assert.ok(reversePose.angle > 260 && reversePose.angle < 280);
  assert.equal(original.displayRoute, undefined); assert.equal(routeCrossingFlow(original, line(0, 0, 0, 300)), original);
});
test("the actual insertion handler saves one undoable edit and keeps engineering authorization", () => {
  const code = page.slice(page.indexOf("      function insertCrossing("), page.indexOf("      document\n        .querySelectorAll(\".tool\")", page.indexOf("      function insertCrossing(")));
  const initial = crossing(), before = structuredClone(initial), history = [], status = {};
  const api = new Function("initial", "placeConductorCrossing", "history", "status", `
    let eng=true,diagram=initial,selected='vertical',selectedIds=new Set(['vertical']),saves=0,tool='crossingBridge';
    const $=()=>status,pushHistory=()=>history.push(structuredClone(diagram)),newId=()=> 'new-bridge',
      choose=value=>{tool=value},local=()=>saves++;
    ${code}
    return {insertCrossing,locked:()=>{eng=false},state:()=>({diagram,selected,tool,saves})};
  `)(initial, placeConductorCrossing, history, status);
  api.insertCrossing({ x: 0, y: 0 });
  assert.equal(history.length, 1); assert.deepEqual(history[0], before);
  assert.deepEqual(api.state().diagram.items.vertical.crossings, []); assert.equal(api.state().saves, 1);
  assert.equal(api.state().tool, 'select'); assert.equal(api.state().selected, 'vertical');
  api.locked(); api.insertCrossing({ x: 0, y: 0 }); assert.equal(history.length, 1); assert.equal(api.state().saves, 1);
});
