import test from "node:test";
import assert from "node:assert/strict";
import { attachDiagramGestures } from "../src/diagram-gestures.js";

function harness(pointerType = "mouse", onTap = () => {}) {
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
    onTap: (event, id) => { taps.push(id); onTap(event, id); },
  });
  function fire(type, properties = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType, isPrimary: true, button: 0,
      buttons: ["pointerup", "click"].includes(type) ? 0 : 1,
      detail: type === "click" ? 1 : 0,
      clientX: 100, clientY: 100, itemId: "dj-1", ...properties,
    });
    if (type === "pointerdown") {
      ownerWindow.dispatchEvent(event);
      if (properties.inViewport !== false) viewport.dispatchEvent(event);
    } else if (["scroll", "lostpointercapture", "contextmenu"].includes(type)) {
      viewport.dispatchEvent(event);
    } else ownerWindow.dispatchEvent(event);
    return event;
  }
  function release(properties = {}) {
    const event = fire("pointerup", properties);
    fire("click", properties);
    return event;
  }
  return { fire, release, viewport, ownerWindow, captured, classes, taps, controller,
    setEnabled(value) { enabled = value; } };
}

for (const type of ["mouse", "touch", "pen"]) {
  for (const initialState of ["open", "closed"])
  test(`${type}: selecting a ${initialState} breaker cannot click through to its command`, () => {
    const dialog = { open: false }, equipment = { state: initialState };
    let commands = 0;
    const h = harness(type, () => { dialog.open = true; });
    h.ownerWindow.addEventListener("click", (event) => {
      if (dialog.open && event.hit === "command") {
        equipment.state = equipment.state === "closed" ? "open" : "closed";
        commands++;
        dialog.open = false;
      }
    });
    h.fire("pointerdown");
    h.fire("pointerup");
    h.fire("click", { hit: "command" });
    assert.equal(dialog.open, true, "The faceplate must stay open for confirmation");
    assert.equal(equipment.state, initialState);
    assert.equal(commands, 0);
    h.fire("pointerdown", { inViewport: false, itemId: null });
    h.fire("pointerup");
    h.fire("click", { hit: "command" });
    assert.equal(equipment.state, initialState === "closed" ? "open" : "closed",
      "A separate click on the command still works");
    assert.equal(commands, 1);
  });
}

test("release waits for the selection click; implicit capture loss cannot discard it", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointerup");
  assert.deepEqual(h.taps, []);
  assert.equal(h.captured.size, 0);
  h.fire("lostpointercapture");
  const click = h.fire("click");
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(h.taps, ["dj-1"]);
  h.fire("click");
  assert.deepEqual(h.taps, ["dj-1"]);
});

test("a legacy touch click without a pointer ID still opens the faceplate once", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointerup");
  h.fire("click", { pointerId: undefined, pointerType: undefined });
  assert.deepEqual(h.taps, ["dj-1"]);
});

test("redrawing between release and click preserves the equipment selected by the press", () => {
  const h = harness("touch");
  h.fire("pointerdown", { itemId: "original-dj" });
  h.fire("pointerup");
  h.fire("click", { itemId: null });
  assert.deepEqual(h.taps, ["original-dj"]);
});

test("another press clears a release that did not generate a selection click", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointerup");
  h.fire("pointerdown", { inViewport: false, itemId: null });
  assert.equal(h.fire("click").defaultPrevented, false);
  assert.deepEqual(h.taps, []);
});

test("keyboard activation is preserved and cannot reuse a pending touch selection", () => {
  const h = harness("touch");
  let activations = 0;
  h.ownerWindow.addEventListener("click", () => activations++);
  h.fire("pointerdown");
  h.fire("pointerup");
  h.fire("keydown", { key: "Enter" });
  const click = h.fire("click", { detail: 0, pointerType: "", pointerId: -1 });
  assert.equal(click.defaultPrevented, false);
  assert.equal(activations, 1);
  assert.deepEqual(h.taps, []);
});

test("a modal or mode change between release and click cancels the selection", () => {
  const h = harness();
  h.fire("pointerdown");
  h.fire("pointerup");
  h.setEnabled(false);
  h.fire("click");
  assert.deepEqual(h.taps, []);
});

test("a click from a different pointer cannot complete the selection", () => {
  const h = harness();
  h.fire("pointerdown");
  h.fire("pointerup");
  h.fire("click", { pointerId: 2 });
  assert.deepEqual(h.taps, []);
});

test("destroy releases capture and removes the pending selection and listeners", () => {
  const h = harness();
  h.fire("pointerdown");
  h.controller.destroy();
  h.release();
  h.fire("pointerdown");
  h.release();
  assert.equal(h.captured.size, 0);
  assert.deepEqual(h.taps, []);
});

for (const type of ["mouse", "touch", "pen"]) {
  test(`${type}: opens once after the completed click, never on initial contact`, () => {
    const h = harness(type);
    h.fire("pointerdown");
    assert.deepEqual(h.taps, []);
    assert.equal(h.captured.has(1), true);
    h.release();
    h.release();
    assert.deepEqual(h.taps, ["dj-1"]);
    assert.equal(h.captured.size, 0);
  });
}

test("small finger oscillation remains a tap and leaves native touch scrolling available", () => {
  const h = harness("touch");
  assert.equal(h.fire("pointerdown").defaultPrevented, false);
  assert.equal(h.fire("pointermove", { clientX: 104, clientY: 103 }).defaultPrevented, false);
  h.release({ clientX: 105, clientY: 104 });
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
  h.release({ clientX: 70, clientY: 80 });
  assert.deepEqual(h.taps, []);
  assert.equal(h.classes.size, 0);
});

test("an empty-background drag also pans; crossing an equipment cannot select it", () => {
  const h = harness();
  h.fire("pointerdown", { itemId: null });
  h.fire("pointermove", { clientX: 70 });
  h.release({ itemId: "dj-1", clientX: 70 });
  assert.equal(h.viewport.scrollLeft, 130);
  assert.deepEqual(h.taps, []);
});

test("a drag returning to its starting point remains a drag", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 70 });
  h.fire("pointermove");
  h.release();
  assert.deepEqual(h.taps, []);
});

test("release coordinates suppress selection even without a preceding move event", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.release({ clientX: 70 });
  assert.deepEqual(h.taps, []);
});

for (const interrupt of ["pointercancel", "lostpointercapture", "blur", "contextmenu"]) {
  test(`${interrupt} cancels selection and the next tap still works`, () => {
    const h = harness("touch");
    h.fire("pointerdown");
    h.fire(interrupt);
    h.release();
    assert.deepEqual(h.taps, []);
    h.fire("pointerdown");
    h.release();
    assert.deepEqual(h.taps, ["dj-1"]);
  });
}

test("a second finger cancels selection for both fingers, including after zoom", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.fire("pointerdown", { pointerId: 2, isPrimary: false });
  h.release({ pointerId: 2, isPrimary: false });
  h.release();
  assert.deepEqual(h.taps, []);
  h.fire("pointerdown");
  h.release();
  assert.deepEqual(h.taps, ["dj-1"]);
});

test("viewport scrolling during contact cannot open a faceplate", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.viewport.scrollLeft = 135;
  h.fire("scroll");
  h.viewport.scrollLeft = 100;
  h.release();
  assert.deepEqual(h.taps, []);
});

test("a scroll change at release is checked even before the scroll event fires", () => {
  const h = harness("touch");
  h.fire("pointerdown");
  h.viewport.scrollTop = 125;
  h.release();
  assert.deepEqual(h.taps, []);
});

test("right click and non-primary touches cannot select equipment", () => {
  const h = harness();
  h.fire("pointerdown", { button: 2 });
  h.release({ button: 2 });
  h.fire("pointerdown", { isPrimary: false, pointerType: "touch" });
  h.release({ isPrimary: false, pointerType: "touch" });
  assert.deepEqual(h.taps, []);
});

test("editing mode keeps its own selection and equipment-drag controls", () => {
  const h = harness();
  h.setEnabled(false);
  h.fire("pointerdown");
  h.fire("pointermove", { clientX: 70 });
  h.release({ clientX: 70 });
  assert.equal(h.viewport.scrollLeft, 100);
  assert.equal(h.captured.size, 0);
  assert.deepEqual(h.taps, []);
});

test("a mode change during contact cannot open or edit a component on release", () => {
  const h = harness();
  h.fire("pointerdown");
  h.setEnabled(false);
  h.release();
  assert.deepEqual(h.taps, []);
});

test("a redraw may replace the touched SVG item without losing its stable identifier", () => {
  const h = harness("touch");
  h.fire("pointerdown", { itemId: "dj-before-redraw" });
  h.release({ itemId: null });
  assert.deepEqual(h.taps, ["dj-before-redraw"]);
});
