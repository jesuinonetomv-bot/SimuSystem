// Classify the whole gesture before selecting an operating component.
// Distances use screen pixels, so diagram zoom does not change tap sensitivity.
export function attachDiagramGestures({ viewport, enabled, onTap,
  itemId = (event) => event.target.closest?.(".item")?.dataset.id ?? null }) {
  const ownerWindow = viewport.ownerDocument.defaultView;
  let gesture = null;

  function finish() {
    const previous = gesture;
    gesture = null;
    viewport.classList.remove("panning");
    if (previous && viewport.hasPointerCapture?.(previous.pointerId))
      viewport.releasePointerCapture(previous.pointerId);
    return previous;
  }

  function cancel() { finish(); }

  function moved(event) {
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > gesture.tolerance)
      gesture.moved = true;
  }

  function anotherPointer(event) {
    if (gesture && event.pointerId !== gesture.pointerId) cancel();
  }

  function down(event) {
    if (!enabled() || event.button !== 0 || event.isPrimary === false) return;
    cancel();
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      tolerance: event.pointerType === "touch" ? 10 : 6,
      item: itemId(event),
      moved: false,
      scrolled: false,
    };
    // Capture on the stable viewport: live measurements can redraw SVG items.
    // Touch remains available to the browser for native scrolling and zoom.
    viewport.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") event.preventDefault();
  }

  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!enabled() || (event.pointerType === "mouse" && event.buttons === 0)) {
      cancel();
      return;
    }
    moved(event);
    if (gesture.moved && gesture.pointerType === "mouse") {
      event.preventDefault();
      viewport.classList.add("panning");
      viewport.scrollLeft = gesture.scrollLeft - (event.clientX - gesture.x);
      viewport.scrollTop = gesture.scrollTop - (event.clientY - gesture.y);
    }
  }

  function scroll() {
    if (gesture && (viewport.scrollLeft !== gesture.scrollLeft || viewport.scrollTop !== gesture.scrollTop))
      gesture.scrolled = true;
  }

  function up(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    moved(event);
    scroll();
    const completed = finish();
    if (enabled() && !completed.moved && !completed.scrolled && completed.item !== null)
      onTap(event, completed.item);
  }

  function interrupted(event) {
    if (gesture && event.pointerId === gesture.pointerId) cancel();
  }

  viewport.addEventListener("pointerdown", down);
  viewport.addEventListener("scroll", scroll, { passive: true });
  viewport.addEventListener("lostpointercapture", interrupted);
  viewport.addEventListener("contextmenu", cancel);
  ownerWindow.addEventListener("pointerdown", anotherPointer, true);
  ownerWindow.addEventListener("pointermove", move, { capture: true, passive: false });
  ownerWindow.addEventListener("pointerup", up, true);
  ownerWindow.addEventListener("pointercancel", interrupted, true);
  ownerWindow.addEventListener("blur", cancel);

  return {
    cancel,
    destroy() {
      cancel();
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("scroll", scroll);
      viewport.removeEventListener("lostpointercapture", interrupted);
      viewport.removeEventListener("contextmenu", cancel);
      ownerWindow.removeEventListener("pointerdown", anotherPointer, true);
      ownerWindow.removeEventListener("pointermove", move, true);
      ownerWindow.removeEventListener("pointerup", up, true);
      ownerWindow.removeEventListener("pointercancel", interrupted, true);
      ownerWindow.removeEventListener("blur", cancel);
    },
  };
}
