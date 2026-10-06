import test from "node:test";
import assert from "node:assert/strict";
import { createSwitchingStudy } from "../src/switching-analysis.js";
import { calculateAnimatedFlow, arrowPose, createFlowAnimator } from "../src/flow-animation.js";

const bus = (x) => ({ type: "bus", x1: x, y1: 0, x2: x + 200, y2: 0 });
const binding = (terminalA, terminalB) => ({ terminalA, ...(terminalB ? { terminalB } : {}) });
function radial() {
  return { items: {
    a: bus(0), b: bus(1000),
    grid: { type: "utility", x: -500, y: -500, isSource: true, state: "running", topology: binding("a") },
    tie: { type: "breaker", x: 600, y: 100, state: "closed", topology: binding("a", "b") },
    load: { type: "load", x: 1800, y: 500, state: "active", topology: binding("b") },
  } };
}
function measurements(diagram, values = {}) {
  return new Map(Object.keys(diagram.items).map((id) => [id, {
    energized: true, activeMW: id === "grid" || id === "load" ? 2 : 0,
    reactiveMvar: id === "grid" || id === "load" ? 1 : 0, ...values[id],
  }]));
}
const calculate = (d, values = {}) => calculateAnimatedFlow(createSwitchingStudy(d).network(), measurements(d, values));
const forItem = (result, id) => result.segments.filter((s) => s.itemId === id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("a closed radial feeder carries its load's active and reactive powers", () => {
  const r = calculate(radial());
  close(forItem(r, "tie")[0].activeMW, 2); close(forItem(r, "tie")[0].reactiveMvar, 1);
  close(forItem(r, "a")[0].activeMW, 2); close(forItem(r, "b")[0].activeMW, 2);
  assert.equal(r.invalidItems.size, 0); assert.equal(r.ambiguousItems.size, 0);
});
test("generation above local demand reverses the feeder toward the grid", () => {
  const d = radial();
  d.items.gen = { type: "turbogenerator", x: 1800, y: 1000, state: "running", isSource: true,
    controlMode: "manual", topology: binding("b") };
  const r = calculate(d, { grid: { activeMW: -2 }, gen: { activeMW: 4, reactiveMvar: 0 } });
  close(forItem(r, "tie")[0].activeMW, -2); close(forItem(r, "tie")[0].reactiveMvar, 1);
});
test("a capacitor can reverse Q while P continues feeding the load", () => {
  const d = radial();
  d.items.cap = { type: "capacitor", x: 1800, y: 1000, state: "active", activeStages: 1, topology: binding("b") };
  const r = calculate(d, { grid: { reactiveMvar: -1 }, cap: { activeMW: 0, reactiveMvar: -2 } });
  close(forItem(r, "tie")[0].activeMW, 2); close(forItem(r, "tie")[0].reactiveMvar, -1);
});
test("an open switch has no arrows and its dead side cannot show a flow", () => {
  const d = radial(); d.items.tie.state = "open";
  assert.equal(calculate(d).segments.length, 0);
});
test("a stopped source cannot supply even when old measurement values are present", () => {
  const d = radial(); d.items.grid.state = "stopped";
  assert.equal(calculate(d).segments.length, 0);
});
test("an energized network without demand has no moving arrows", () => {
  const d = radial(); d.items.load.state = "inactive";
  assert.equal(calculate(d, { grid: { activeMW: 0, reactiveMvar: 0 } }).segments.length, 0);
});
test("a capacitive load sends Q back to the source", () => {
  const r = calculate(radial(), { load: { reactiveMvar: -1 }, grid: { reactiveMvar: -1 } });
  close(forItem(r, "tie")[0].reactiveMvar, -1);
});
test("an ideal ring does not receive an invented split or direction", () => {
  const d = radial(); d.items.other = { ...d.items.tie, x: 600, y: 400 };
  const r = calculate(d);
  assert.equal(forItem(r, "tie").length, 0); assert.equal(forItem(r, "other").length, 0);
  assert.ok(r.ambiguousItems.has("tie")); assert.ok(r.ambiguousItems.has("other"));
  assert.ok(r.segments.some((s) => s.itemId === "a" && s.activeMW === 2));
});
test("opening one leg of an ideal ring restores a unique flow", () => {
  const d = radial(); d.items.other = { ...d.items.tie, x: 600, y: 400, state: "open" };
  const r = calculate(d); assert.equal(r.ambiguousItems.size, 0);
  close(forItem(r, "tie")[0].activeMW, 2);
});
test("configured impedances determine the lossless split between parallel lines", () => {
  const d = radial(); delete d.items.tie;
  const line = (y, resistanceOhm) => ({ type: "line", x1: 500, y1: y, x2: 700, y2: y,
    electrical: { nominalKV: 13.8, resistanceOhm, reactanceOhm: 0 }, topology: binding("a", "b") });
  d.items.l1 = line(100, 1); d.items.l2 = line(400, 2);
  const r = calculate(d);
  close(forItem(r, "l1")[0].activeMW, 4 / 3); close(forItem(r, "l2")[0].activeMW, 2 / 3);
  close(forItem(r, "l1")[0].reactiveMvar + forItem(r, "l2")[0].reactiveMvar, 1);
});
test("parallel transformer allocation respects rating and Z percent on a common base", () => {
  const d = radial(); delete d.items.tie;
  const transformer = (y, ratedMVA) => ({ type: "transformer", x: 600, y,
    electrical: { impedancePercent: 10, ratedMVA }, topology: binding("a", "b") });
  d.items.t1 = transformer(100, 20); d.items.t2 = transformer(400, 40);
  const r = calculate(d);
  close(forItem(r, "t1")[0].activeMW, 2 / 3); close(forItem(r, "t2")[0].activeMW, 4 / 3);
});
test("new measured powers update the flow without changing the input diagram or measurements", () => {
  const d = radial(), before = JSON.stringify(d), m = measurements(d, { load: { activeMW: 4 }, grid: { activeMW: 4 } });
  const saved = JSON.stringify([...m]);
  const r = calculateAnimatedFlow(createSwitchingStudy(d).network(), m);
  close(forItem(r, "tie")[0].activeMW, 4);
  assert.equal(JSON.stringify(d), before); assert.equal(JSON.stringify([...m]), saved);
});
test("a forced inconsistent interchange is not converted into imaginary generation", () => {
  const d = radial(); d.items.grid.electrical = { forcedCurrentA: -10 };
  const r = calculate(d, { grid: { activeMW: -3 } });
  assert.equal(r.segments.length, 0); assert.equal(r.unbalancedIslands, 1);
});
test("matching diagram connector groups carry power across distant tabs", () => {
  const d = radial(); delete d.items.tie;
  d.items.grid.x = 100; d.items.load.x = 1100;
  d.items.a.conductorGroupId = "global::BUS"; d.items.b.conductorGroupId = "global::BUS";
  const r = calculate(d);
  close(forItem(r, "a")[0].activeMW, -2); close(forItem(r, "b")[0].activeMW, 2);
});
test("a line drawn behind an open device is cut at the device terminals", () => {
  const d = { items: {
    grid: { type: "utility", x: 0, y: 0, state: "running", isSource: true },
    wire: { type: "line", x1: 0, y1: -52, x2: 0, y2: -320 },
    breaker: { type: "breaker", x: 0, y: -180, state: "open" },
    load: { type: "load", x: 0, y: -286, state: "active" },
  } };
  assert.equal(calculate(d).segments.length, 0);
});

const segment = { key: 1, itemId: "line", from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, activeMW: 2, reactiveMvar: -1 };
test("active and reactive arrows can move in opposite directions on the same segment", () => {
  const p0 = arrowPose(segment, "p", 0), p1 = arrowPose(segment, "p", 1000);
  const q0 = arrowPose(segment, "q", 0), q1 = arrowPose(segment, "q", 1000);
  assert.ok(p1.x > p0.x); assert.ok(q1.x < q0.x);
  close(p0.angle, 0); close(q0.angle, 180); assert.notEqual(p0.y, q0.y);
});
test("arrow position follows rotated geometry and reduced motion stays fixed", () => {
  const vertical = { ...segment, from: { x: 100, y: 200 }, to: { x: 100, y: 400 } };
  const pose = arrowPose(vertical, "p", 0, 0, 1, false);
  close(pose.angle, 90); close(pose.x, 100);
  assert.deepEqual(arrowPose(vertical, "p", 100, 0, 1, true, true), arrowPose(vertical, "p", 90000, 0, 1, true, true));
});

function animationHarness() {
  class Node {
    constructor(tag) { this.tag = tag; this.attributes = {}; this.children = []; this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(node) { node.remove(); this.children.push(node); node.parentNode = this; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((n) => n !== this); this.parentNode = null; }
    replaceChildren() { for (const child of [...this.children]) child.remove(); }
  }
  const page = new EventTarget(), media = new EventTarget(), stage = new Node("svg"), frames = new Map();
  let clock = 0, id = 0;
  page.hidden = false; page.createElementNS = (_, tag) => new Node(tag); media.matches = false;
  const animator = createFlowAnimator({ stage, page, ownerWindow: { matchMedia: () => media },
    now: () => clock, requestFrame: (fn) => { frames.set(++id, fn); return id; }, cancelFrame: (key) => frames.delete(key) });
  return { stage, page, media, animator, frames,
    update: (options = {}) => animator.update({ enabled: true, segments: [segment], ...options }),
    run(time) { clock = time; const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(time)); },
    arrows: () => stage.children.flatMap((layer) => layer.children) };
}
test("one animation loop updates both channels and reuses arrows after a diagram redraw", () => {
  const h = animationHarness(); h.update(); assert.equal(h.frames.size, 1);
  const arrow = h.arrows()[0], original = arrow.attributes.transform;
  h.run(1000); assert.notEqual(arrow.attributes.transform, original);
  h.stage.replaceChildren(); h.update(); assert.equal(h.arrows()[0], arrow);
  assert.equal(h.frames.size, 1); assert.equal(h.stage.children[0].attributes["pointer-events"], "none");
});
test("disabling the option removes arrows and cancels the rendering loop", () => {
  const h = animationHarness(); h.update(); h.update({ enabled: false });
  assert.equal(h.arrows().length, 0); assert.equal(h.frames.size, 0);
});
test("hidden pages suspend animation and resume with a single loop", () => {
  const h = animationHarness(); h.update();
  h.page.hidden = true; h.page.dispatchEvent(new Event("visibilitychange")); assert.equal(h.frames.size, 0);
  h.page.hidden = false; h.page.dispatchEvent(new Event("visibilitychange")); assert.equal(h.frames.size, 1);
});
test("reduced motion uses fixed arrows and does not start a frame loop", () => {
  const h = animationHarness(); h.media.matches = true; h.update();
  assert.equal(h.frames.size, 0); assert.equal(h.arrows().length, 2);
  const original = h.arrows()[0].attributes.transform; h.run(5000);
  assert.equal(h.arrows()[0].attributes.transform, original);
});
test("P and Q filters remove their own channel and zero power has no arrows", () => {
  const h = animationHarness(); h.update({ showActive: false });
  assert.equal(h.arrows().length, 1); assert.equal(h.arrows()[0].attributes["data-quantity"], "q");
  h.update({ segments: [{ ...segment, activeMW: 0, reactiveMvar: 0 }] });
  assert.equal(h.arrows().length, 0); assert.equal(h.frames.size, 0);
});
