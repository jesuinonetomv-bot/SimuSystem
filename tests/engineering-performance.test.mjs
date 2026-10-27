import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundledDiagram } from "../src/bundled-diagrams.js";
import { SE56A01_ID } from "../src/se56a-01-diagram.js";
import { electricalTerminals } from "../src/switching-analysis.js";
import { startItemDrag } from "../src/engineering-drag.js";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const geometry = page.slice(page.indexOf("      function terminals("), page.indexOf("      function transformerSequenceViolation("));
const projection = page.slice(page.indexOf("      function projectPoint("), page.indexOf("      function flowAnalysis("));
function appGeometry(diagram, probe = { pairs: 0, builds: 0 }) {
  const code = geometry.replace("function touching(a, b) {", "function touching(a, b) { probe.pairs++;")
    .replace("function itemConnectionGraph(entries) {", "function itemConnectionGraph(entries) { probe.builds++;");
  return new Function("diagram", "electricalTerminals", "probe", code + projection +
    "\nconst isElectrical = o => !['text','area','annotationLine'].includes(o.type); return {itemConnectionGraph,itemsConnected,transformerSwitches};")
    (diagram, electricalTerminals, probe);
}
function referenceGraph(entries, connected) {
  const graph = new Map(entries.map(([id]) => [id, []]));
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++)
    if (connected(...entries[i], ...entries[j])) {
      graph.get(entries[i][0]).push(entries[j][0]); graph.get(entries[j][0]).push(entries[i][0]);
    }
  return graph;
}
test("sparse graph preserves every original connection and breaker traversal order in the real diagram", () => {
  const d = bundledDiagram(SE56A01_ID), api = appGeometry(d);
  const entries = Object.entries(d.items).filter(([, o]) => !["text", "area", "annotationLine"].includes(o.type));
  assert.deepEqual(api.itemConnectionGraph(entries), referenceGraph(entries, api.itemsConnected));
});
test("explicit, partial, grouped and geometric connections keep their existing semantics", () => {
  const d = { items: {
    a: { type: "bus", x1: 0, y1: 0, x2: 100, y2: 0 },
    b: { type: "bus", x1: 1000, y1: 0, x2: 1100, y2: 0, conductorGroupId: "remote" },
    c: { type: "bus", x1: 2000, y1: 0, x2: 2100, y2: 0, conductorGroupId: "remote" },
    partial: { type: "breaker", x: 50, y: 22, topology: { terminalA: "b" } },
    explicit: { type: "breaker", x: 50, y: 22, topology: { terminalA: "b", terminalB: "c" } },
    onePort: { type: "load", x: 4000, y: 34, topology: { terminalA: "a" } },
    missing: { type: "breaker", x: 50, y: 22, topology: { terminalA: "gone", terminalB: "missing" } },
  } }, api = appGeometry(d), entries = Object.entries(d.items);
  const graph = api.itemConnectionGraph(entries);
  assert.deepEqual(graph, referenceGraph(entries, api.itemsConnected));
  assert.ok(graph.get("a").includes("partial")); assert.ok(!graph.get("a").includes("explicit"));
  assert.ok(graph.get("b").includes("c")); assert.deepEqual(graph.get("missing"), []);
});
test("one thousand explicit branches do not trigger a quadratic proximity scan", () => {
  const d = { items: {
    a: { type: "bus", x1: 0, y1: 0, x2: 100, y2: 0 },
    b: { type: "bus", x1: 1000, y1: 0, x2: 1100, y2: 0 },
  } };
  for (let i = 0; i < 1000; i++) d.items["dj" + i] = {
    type: "breaker", x: 400, y: i * 100, topology: { terminalA: "a", terminalB: "b" },
  };
  const probe = { pairs: 0, builds: 0 }, api = appGeometry(d, probe), graph = api.itemConnectionGraph(Object.entries(d.items));
  assert.equal(graph.get("a").length, 1000); assert.equal(graph.get("b").length, 1000);
  assert.equal(probe.pairs, 1);
});
test("transformer breaker lookup builds one graph per calculation and does not cache the next edit", () => {
  const d = bundledDiagram(SE56A01_ID), probe = { pairs: 0, builds: 0 }, api = appGeometry(d, probe);
  const transformers = Object.keys(d.items).filter(id => d.items[id].type === "transformer");
  const lookup = {};
  for (const id of transformers) api.transformerSwitches(id, lookup);
  assert.equal(probe.builds, 1);
  api.transformerSwitches(transformers[0], {}); assert.equal(probe.builds, 2);
});

function harness() {
  const ownerWindow = new EventTarget(), stage = new EventTarget(), frames = new Map(), captured = new Set();
  let frameId = 0;
  const items = { dj: { type: "breaker", x: 100, y: 200 }, wire: { type: "line", x1: 100, y1: 100, x2: 100, y2: 200 }, other: { type: "breaker", x: 800, y: 800 } };
  const nodes = Object.keys(items).map(id => ({ dataset: { id }, attrs: {},
    getAttribute(key) { return this.attrs[key] ?? null; }, setAttribute(key, value) { this.attrs[key] = String(value); },
    removeAttribute(key) { delete this.attrs[key]; }, classList: { toggle() {} },
  }));
  ownerWindow.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  ownerWindow.cancelAnimationFrame = id => frames.delete(id);
  Object.assign(stage, { ownerDocument: { defaultView: ownerWindow },
    querySelectorAll: selector => selector === ".item" ? nodes : [],
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id),
  });
  const event = ({ type = "pointerdown", ...properties }) => Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0, buttons: 1, button: 0, isPrimary: true, ...properties,
  });
  const point = e => ({ x: Math.round(e.clientX / 20) * 20, y: Math.round(e.clientY / 20) * 20 });
  return { ownerWindow, stage, frames, captured, items, nodes, event, point,
    fire(type, properties = {}) { const e = event({ type, ...properties }); stage.dispatchEvent(e); return e; },
    paint() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
  };
}
test("drag previews coalesce into one frame and commit the release position once with undo data intact", () => {
  const h = harness(), initial = structuredClone(h.items), completed = []; let histories = 0;
  startItemDrag({ ...h, event: h.event({}), ids: ["dj", "wire"],
    beforeCommit: () => { histories++; assert.deepEqual(h.items, initial); }, onFinish: changed => completed.push(changed) });
  for (let i = 1; i <= 1000; i++) h.fire("pointermove", { clientX: i / 10, clientY: 40 });
  assert.equal(h.frames.size, 1); assert.equal(histories, 0); assert.deepEqual(h.items, initial);
  h.paint(); assert.equal(h.nodes[0].attrs.transform, "translate(100 40)");
  assert.equal(h.nodes[1].attrs.transform, "translate(100 40)"); assert.equal(h.nodes[2].attrs.transform, undefined);
  h.fire("pointerup", { clientX: 120, clientY: 60 });
  assert.equal(h.items.dj.x, 220); assert.equal(h.items.dj.y, 260);
  assert.equal(h.items.wire.x1, 220); assert.equal(h.items.wire.y2, 260);
  assert.deepEqual(h.items.other, initial.other); assert.equal(histories, 1); assert.deepEqual(completed, [true]);
  assert.equal(h.frames.size, 0); assert.equal(h.captured.size, 0); assert.equal(h.nodes[0].attrs.transform, undefined);
});
for (const reason of ["pointercancel", "lostpointercapture", "blur", "Escape"])
test(`${reason} cancels a drag without changing or saving component positions`, () => {
  const h = harness(), original = structuredClone(h.items), finished = [];
  const controller = startItemDrag({ ...h, event: h.event({}), ids: ["dj"], beforeCommit: () => assert.fail("cancel must not create history"), onFinish: changed => finished.push(changed) });
  h.fire("pointermove", { clientX: 100 }); h.paint();
  if (reason === "Escape") h.ownerWindow.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  else if (reason === "blur") h.ownerWindow.dispatchEvent(new Event("blur"));
  else h.fire(reason);
  controller.cancel(); h.fire("pointerup", { clientX: 200 });
  assert.deepEqual(h.items, original); assert.deepEqual(finished, [false]);
  assert.equal(h.nodes[0].attrs.transform, undefined); assert.equal(h.frames.size, 0); assert.equal(h.captured.size, 0);
});
test("selection taps, other pointers and a changed draft cannot commit accidental movements", () => {
  const h = harness(), initial = structuredClone(h.items), finished = []; let current = true;
  startItemDrag({ ...h, event: h.event({}), ids: ["dj"], isCurrent: () => current, onFinish: changed => finished.push(changed) });
  h.fire("pointermove", { pointerId: 2, clientX: 100 }); assert.equal(h.frames.size, 0);
  h.fire("pointerup", { clientX: 4 }); assert.deepEqual(finished, [false]); assert.deepEqual(h.items, initial);
  startItemDrag({ ...h, event: h.event({}), ids: ["dj"], isCurrent: () => current, onFinish: changed => finished.push(changed) });
  h.fire("pointermove", { clientX: 100 }); current = false;
  h.fire("pointerup", { clientX: 100 }); assert.deepEqual(finished, [false, false]); assert.deepEqual(h.items, initial);
});
test("the actual engineering selection and drag handlers perform no full redraw until a completed move", () => {
  const h = harness(), counters = { redraws: 0, histories: 0, fields: 0 };
  const code = page.slice(page.indexOf("      function down(e, k)"), page.indexOf("      function itemBounds(o)"));
  const api = new Function("h", "startItemDrag", "counters", `
    const stage=h.stage, diagram={items:h.items}, pt=h.point, $=()=>({hidden:false,textContent:''}),
      pushHistory=()=>counters.histories++, local=()=>counters.redraws++, draw=()=>counters.redraws++,
      properties=()=>counters.fields++, renderInstrumentLinks=()=>{}, E=()=>{};
    let eng=true, selected=null, selectedIds=new Set(), multiSelectMode=false,
      formatPainterActive=false, tool='select', engineeringDrag=null, engineeringDrawPending=false;
    ${code}
    return {down};`)(h, startItemDrag, counters);
  api.down(h.event({}), "dj"); assert.equal(counters.redraws, 0); assert.equal(counters.histories, 0);
  for (let i = 0; i < 300; i++) h.fire("pointermove", { clientX: 100 + i });
  h.paint(); assert.equal(counters.redraws, 0); assert.equal(counters.fields, 1);
  h.fire("pointerup", { clientX: 400 }); assert.equal(counters.redraws, 1); assert.equal(counters.histories, 1);
  api.down(h.event({ ctrlKey: true }), "other"); assert.equal(counters.redraws, 1);
});
