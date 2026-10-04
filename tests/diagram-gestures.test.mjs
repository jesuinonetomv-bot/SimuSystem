import test from "node:test";
import assert from "node:assert/strict";
import { attachDiagramGestures } from "../src/diagram-gestures.js";

function harness(pointerType = "mouse") {
  const ownerWindow = new EventTarget();
  const viewport = new EventTarget();
  const captured = new Set(), classes = new Set(), taps = [];
  let enabled = true;
  Object.assign(viewport, {
    ownerDocument: { defaultView: ownerWindow },
    scrollLeft: 100, scrollTop: 100,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  });
  const controller = attachDiagramGestures({
    viewport, enabled: () => enabled,
    itemId: (event) => event.itemId,
    onTap: (event, id) => taps.push(id),
  });
  function fire(type, properties = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType, isPrimary: true, button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: 100, clientY: 100, itemId: "dj-1", ...properties,
    });
    if (type === "pointerdown") {
      ownerWindow.dispatchEvent(event);
      viewport.dispatchEvent(event);
    } else if (["scroll", "lostpointercapture", "contextmenu"].includes(type)) {
      viewport.dispatchEvent(event);
    } else ownerWindow.dispatchEvent(event);
    return event;
  }
  return { fire, viewport, captured, classes, taps, controller,
    setEnabled(value) { enabled = value; } };
}

for (const type of ["mouse", "touch", "pen"]) {
  test(`${type}: opens once on release, never on initial contact`, () => {
    const h = harness(type);
    h.fire("pointerdown");
    assert.deepEqual(h.taps, []);
    assert.equal(h.captured.has(1), true);
    h.fire("pointerup");
    h.fire("pointerup");
    assert.deepEqual(h.taps, ["dj-1"]);
    assert.equal(h.captured.size, 0);
  });
}

test("small finger oscillation remains a tap and leaves native touch scrolling available", () => {
  const h = harness("touch");
  assert.equal(h.fire("pointerdown").defaultPrevented, false);
  assert.equal(h.fire("pointermove", { clientX: 104, clientY: 103 }).defaultPrevented, false);
  h.fire("pointerup", { clientX: 105, clientY: 104 });
  assert.deepEqual(h.taps, ["dj-1"]);
  assert.equal(h.viewport.scrollLeft, 100);
});

test("mouse drag starting on an equipment pans in both axes without selecting it", () => {
  const h = harness();
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 70, clientY: 80 });
  assert.equal(h.viewport.scrollLeft, 130);
  assert.equal(h.viewport.scrollTop, 120);
  assert.equal(h.classes.has("panning"), true);
  h.fire("pointerup", { clientX: 70, clientY: 80 });
  assert.deepEqual(h.taps, []);
  assert.equal(h.classes.size, 0);
});

test("an empty-background drag also pans; crossing an equipment cannot select it", () => {
  const h = harness();
  h.fire("pointerdown", { itemId: null });
  h.fire("pointermove", { clientX: 70 });
  h.fire("pointerup", { itemId: "dj-1", clientX: 70 });
  assert.equal(h.viewport.scrollLeft, 130);
  assert.deepEqual(h.taps, []);
});

test("a drag returning to its starting point remains a drag", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 70 });
  h.fire("pointermove");
  h.fire("pointerup");
  assert.deepEqual(h.taps, []);
});

test("release coordinates suppress selection even without a preceding move event", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointerup", { clientX: 70 });
  assert.deepEqual(h.taps, []);
});

for (const interrupt of ["pointercancel", "lostpointercapture", "blur", "contextmenu"]) {
  test(`${interrupt} cancels selection and the next tap still works`, () => {
    const h = harness("touch");
    h.fire("pointerdown");
    h.fire(interrupt);
    h.fire("pointerup");
    assert.deepEqual(h.taps, []);
    h.fire("pointerdown");
    h.fire("pointerup");
    assert.deepEqual(h.taps, ["dj-1"]);
  });
}

test("a second finger cancels selection for both fingers, including after zoom", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointerdown", { pointerId: 2, isPrimary: false });
  h.fire("pointerup", { pointerId: 2, isPrimary: false });
  h.fire("pointerup");
  assert.deepEqual(h.taps, []);
  h.fire("pointerdown");
  h.fire("pointerup");
  assert.deepEqual(h.taps, ["dj-1"]);
});

test("viewport scrolling during contact cannot open a faceplate", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.viewport.scrollLeft = 135;
  h.fire("scroll");
  h.viewport.scrollLeft = 100;
  h.fire("pointerup");
  assert.deepEqual(h.taps, []);
});

test("a scroll change at release is checked even before the scroll event fires", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.viewport.scrollTop = 125;
  h.fire("pointerup");
  assert.deepEqual(h.taps, []);
});

test("right click and non-primary touches cannot select equipment", () => {
  const h = harness();
  h.fire("pointerdown", { button: 2 });
  h.fire("pointerup", { button: 2 });
  h.fire("pointerdown", { isPrimary: false, pointerType: "touch" });
  h.fire("pointerup", { isPrimary: false, pointerType: "touch" });
  assert.deepEqual(h.taps, []);
});

test("editing mode keeps its own selection and equipment-drag controls", () => {
  const h = harness();
  h.setEnabled(false);
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 70 });
  h.fire("pointerup", { clientX: 70 });
  assert.equal(h.viewport.scrollLeft, 100);
  assert.equal(h.captured.size, 0);
  assert.deepEqual(h.taps, []);
});

test("a mode change during contact cannot open or edit a component on release", () => {
  const h = harness();
  h.fire("pointerdown");
  h.setEnabled(false);
  h.fire("pointerup");
  assert.deepEqual(h.taps, []);
});

test("a redraw may replace the touched SVG item without losing its stable identifier", () => {
  const h = harness("touch");
  h.fire("pointerdown", { itemId: "dj-before-redraw" });
  h.fire("pointerup", { itemId: null });
  assert.deepEqual(h.taps, ["dj-before-redraw"]);
});
