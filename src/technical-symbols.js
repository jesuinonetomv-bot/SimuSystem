// Compact symbols retain the original terminal positions, rotation and scale.
export function renderInstrumentLinks(stage, diagram, selectedIds, E) {
  const center = o => o.x != null ? { x: o.x, y: o.y } : { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 };
  for (const id of selectedIds) {
    const o = diagram.items[id]; if (!o?.instrument) continue;
    const a = center(o);
    for (const targetId of Object.values(o.instrument)) {
      const target = diagram.items[targetId]; if (!target) continue;
      const b = center(target);
      stage.append(E("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "instrument-link", "aria-hidden": "true" }));
    }
  }
}
export function renderTechnicalSymbol(g, o, E) {
  if (o.type === "cable") {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * 2.5, ny = dx / length * 2.5;
    for (const side of [-1, 1]) g.append(E("line", { x1: o.x1 + side * nx, y1: o.y1 + side * ny,
      x2: o.x2 + side * nx, y2: o.y2 + side * ny, class: "wire cable-wire" }));
    for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]]) g.append(E("line", { x1: x - nx, y1: y - ny, x2: x + nx, y2: y + ny, class: "wire" }));
    g.append(E("line", { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke: "transparent", "stroke-width": 18, class: "symbol-hit" }),
      E("rect", { x: Math.min(o.x1, o.x2) - 9, y: Math.min(o.y1, o.y2) - 9, width: Math.abs(dx) + 18, height: Math.abs(dy) + 18, class: "sel" }));
    return true;
  }
  if (!["breaker", "disconnector", "transformer", "utility", "turbogenerator", "load", "capacitor", "relay", "ct", "vt", "cbct", "fuse", "motor", "surgeArrester", "ground"].includes(o.type)) return false;
  const z = o.scale || 1, r = o.rotation || 0;
  const inner = E("g", { transform: `translate(${o.x} ${o.y}) rotate(${r}) scale(${z})`, class: "technical-symbol" });
  const line = (x1, y1, x2, y2) => inner.append(E("line", { x1, y1, x2, y2, class: "wire" }));
  const text = (x, y, value) => inner.append(E("text", { x, y, class: "symbol-letter", "text-anchor": "middle" }, value));
  if (o.type === "breaker") {
    line(0, -22, 0, -8); line(0, 8, 0, 22);
    inner.append(E("rect", { x: -8, y: -8, width: 16, height: 16, class: "tech-shape tech-breaker" }));
    if (o.state !== "closed") line(-5, 5, 5, -5);
  } else if (o.type === "disconnector") {
    line(0, -22, 0, -8); line(0, 8, 0, 22);
    inner.append(E("circle", { cx: 0, cy: -8, r: 2, class: "tech-shape" }),
      E("circle", { cx: 0, cy: 8, r: 2, class: "tech-shape" }));
    line(0, 8, o.state === "closed" ? 0 : 11, -8);
  } else if (o.type === "transformer") {
    line(0, -44, 0, -21); line(0, 21, 0, 44);
    inner.append(E("circle", { cx: 0, cy: -9, r: 12, class: "tech-shape tf-ring" }),
      E("circle", { cx: 0, cy: 9, r: 12, class: "tech-shape tf-ring" }));
  } else if (o.type === "utility") {
    line(0, -52, 0, -33);
    inner.append(E("circle", { cx: 0, cy: -16, r: 17, class: "tech-shape" }));
    text(0, -11, "U");
  } else if (o.type === "turbogenerator") {
    line(18, -40, 18, -17);
    inner.append(E("circle", { cx: 18, cy: 0, r: 17, class: "tech-shape" }));
    text(18, 5, "G");
  } else if (o.type === "motor") {
    line(0, -34, 0, -16);
    inner.append(E("circle", { cx: 0, cy: 0, r: 16, class: "tech-shape" })); text(0, 5, "M");
  } else if (o.type === "fuse") {
    line(0, -22, 0, -12); line(0, 12, 0, 22);
    inner.append(E("rect", { x: -6, y: -12, width: 12, height: 24, class: "tech-shape" }));
    if (o.state === "closed") line(0, -12, 0, 12); else { line(0, -12, 0, -4); line(0, 4, 0, 12); }
  } else if (o.type === "relay") {
    inner.append(E("rect", { x: -27, y: -19, width: 54, height: 38, rx: 3, class: "tech-shape" }));
    const earth = o.electrical?.earthCurve && o.electrical.earthCurve !== "none", phase = o.electrical?.protectionCurve !== "none";
    if (earth && phase) { text(0, -2, "50/51"); text(0, 13, "50N/51N"); }
    else text(0, 5, earth ? "50N/51N" : "50/51");
  } else if (o.type === "ct" || o.type === "cbct") {
    inner.append(E("circle", { cx: 0, cy: 0, r: 14, class: "tech-shape" }));
    if (o.type === "cbct") inner.append(E("circle", { cx: 0, cy: 0, r: 10, class: "tech-shape" }));
    line(-20, 0, -14, 0); line(14, 0, 24, 0); text(0, 5, o.type === "ct" ? "TC" : "ΣI");
  } else if (o.type === "vt") {
    inner.append(E("circle", { cx: -7, cy: 0, r: 12, class: "tech-shape tf-ring" }), E("circle", { cx: 7, cy: 0, r: 12, class: "tech-shape tf-ring" }));
    text(0, 28, "TP");
  } else if (o.type === "ground") {
    line(0, -18, 0, 0); line(-14, 0, 14, 0); line(-9, 6, 9, 6); line(-4, 12, 4, 12);
  } else if (o.type === "surgeArrester") {
    line(0, -26, 0, -12); line(0, 12, 0, 25);
    inner.append(E("rect", { x: -7, y: -12, width: 14, height: 24, class: "tech-shape" }));
    line(-4, -7, 4, -2); line(4, -2, -4, 3); line(-4, 3, 4, 8);
    line(-12, 25, 12, 25); line(-8, 31, 8, 31); line(-3, 37, 3, 37);
  } else if (o.type === "load") {
    line(0, -34, 0, -9);
    inner.append(E("polygon", { points: "-11,-9 11,-9 0,13", class: "tech-shape tech-load" }));
  } else {
    line(0, -34, 0, -10); line(-12, -10, 12, -10); line(-12, -3, 12, -3); line(0, -3, 0, 15);
  }
  // A transparent target allows selection on touch screens without enlarging
  // the printed symbol. Gesture recognition still consumes the selection click.
  const bounds = o.type === "utility" ? [-25, -56, 50, 64] :
    o.type === "turbogenerator" ? [-7, -44, 50, 66] :
      o.type === "transformer" ? [-23, -46, 46, 92] :
        o.type === "breaker" || o.type === "disconnector" || o.type === "fuse" ? [-22, -24, 44, 48] : [-28, -36, 56, 76];
  const [x, y, width, height] = bounds;
  inner.append(E("rect", { x, y, width, height, fill: "transparent", stroke: "none", class: "symbol-hit" }),
    E("rect", { x: x - 3, y: y - 3, width: width + 6, height: height + 6, class: "sel" }));
  g.append(inner);
  return true;
}
