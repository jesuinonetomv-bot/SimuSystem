// Preview selected SVG groups once per frame; edit the model only on release.
// The caller can then recalculate and save one complete, undoable movement.
export function startItemDrag({ stage, event, items, ids, point,
  beforeCommit = () => {}, onFinish = () => {}, isCurrent = () => true,
  requestFrame = fn => stage.ownerDocument.defaultView.requestAnimationFrame(fn),
  cancelFrame = id => stage.ownerDocument.defaultView.cancelAnimationFrame(id) }) {
  const ownerWindow = stage.ownerDocument.defaultView, origin = point(event),
    copies = new Map([...ids].filter(id => items[id]).map(id => [id, { ...items[id] }])),
    nodes = [...stage.querySelectorAll(".item")].filter(node => copies.has(node.dataset.id)),
    transforms = new Map(nodes.map(node => [node, node.getAttribute("transform")]));
  let frame = null, active = true, moved = false, delta = { x: 0, y: 0 };

  function position(next) {
    const p = point(next);
    delta = { x: p.x - origin.x, y: p.y - origin.y };
    if (Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) >
        (event.pointerType === "touch" ? 10 : 6)) moved = true;
  }
  function paint() {
    frame = null;
    if (!active || !moved) return;
    for (const node of nodes)
      node.setAttribute("transform", `translate(${delta.x} ${delta.y}) ${transforms.get(node) || ""}`.trim());
  }
  function move(next) {
    if (next.pointerId !== event.pointerId) return;
    if (!isCurrent() || next.pointerType === "mouse" && next.buttons === 0) { finish(false); return; }
    next.preventDefault(); position(next);
    if (moved && frame === null) frame = requestFrame(paint);
  }
  function finish(commit, next = null) {
    if (!active) return;
    if (next) position(next);
    active = false;
    if (frame !== null) cancelFrame(frame);
    stage.removeEventListener("pointermove", move);
    stage.removeEventListener("pointerup", up);
    stage.removeEventListener("pointercancel", cancel);
    stage.removeEventListener("lostpointercapture", cancel);
    ownerWindow.removeEventListener("blur", cancel);
    ownerWindow.removeEventListener("keydown", keydown);
    if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    for (const node of nodes) {
      const original = transforms.get(node);
      if (original === null) node.removeAttribute("transform"); else node.setAttribute("transform", original);
    }
    const changed = !!(commit && isCurrent() && moved && (delta.x || delta.y) && copies.size);
    if (changed) {
      beforeCommit();
      for (const [id, copy] of copies) {
        const item = items[id]; if (!item) continue;
        if (copy.x != null && copy.y != null) {
          item.x = copy.x + delta.x; item.y = copy.y + delta.y;
        } else {
          item.x1 = copy.x1 + delta.x; item.y1 = copy.y1 + delta.y;
          item.x2 = copy.x2 + delta.x; item.y2 = copy.y2 + delta.y;
        }
      }
    }
    onFinish(changed);
  }
  function up(next) { if (next.pointerId === event.pointerId) finish(true, next); }
  function cancel(next) { if (!next || next.pointerId == null || next.pointerId === event.pointerId) finish(false); }
  function keydown(next) { if (next.key === "Escape") finish(false); }
  stage.addEventListener("pointermove", move, { passive: false });
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", cancel);
  stage.addEventListener("lostpointercapture", cancel);
  ownerWindow.addEventListener("blur", cancel);
  ownerWindow.addEventListener("keydown", keydown);
  stage.setPointerCapture(event.pointerId);
  return { cancel: () => finish(false) };
}
