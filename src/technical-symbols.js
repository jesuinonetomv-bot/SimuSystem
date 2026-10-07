// Compact symbols retain the original terminal positions, rotation and scale.
export function renderTechnicalSymbol(g, o, E) {
  if (!["breaker", "disconnector", "transformer", "utility", "turbogenerator", "load", "capacitor"].includes(o.type)) return false;
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
        o.type === "breaker" || o.type === "disconnector" ? [-22, -24, 44, 48] : [-22, -36, 44, 72];
  const [x, y, width, height] = bounds;
  inner.append(E("rect", { x, y, width, height, fill: "transparent", stroke: "none", class: "symbol-hit" }),
    E("rect", { x: x - 3, y: y - 3, width: width + 6, height: height + 6, class: "sel" }));
  g.append(inner);
  return true;
}
