// A bridge is a normal conductor with insulated crossing positions. Fractions
// survive moving, rotating, copying and saving the original conductor.
const RADIUS = 14, CLEARANCE = 32, END_MARGIN = 40;
const conductive = o => ["line", "bus"].includes(o?.type);
const lengthOf = o => Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
export function crossingPositions(o) {
  if (!conductive(o) || !Array.isArray(o.crossings)) return [];
  const length = lengthOf(o);
  if (!Number.isFinite(length) || length < 2 * END_MARGIN) return [];
  return [...new Set(o.crossings.filter(t => typeof t === "number" && Number.isFinite(t) &&
    t * length >= END_MARGIN && (1 - t) * length >= END_MARGIN))].sort((a, b) => a - b)
    .filter((t, i, all) => !i || (t - all[i - 1]) * length >= 2 * CLEARANCE);
}
export function crossingProjection(o, p) {
  const dx = o.x2 - o.x1, dy = o.y2 - o.y1, length = Math.hypot(dx, dy);
  const t = length ? Math.max(0, Math.min(1, ((p.x - o.x1) * dx + (p.y - o.y1) * dy) / length ** 2)) : 0;
  const x = o.x1 + t * dx, y = o.y1 + t * dy;
  return { x, y, t, length, distance: Math.hypot(p.x - x, p.y - y) };
}
export function allowsCrossingTap(o, p) {
  if (!o?.crossings?.length) return true;
  const positions = crossingPositions(o);
  if (!positions.length) return true;
  const q = crossingProjection(o, p);
  return !positions.some(t => Math.abs(t - q.t) * q.length < CLEARANCE);
}
export function createCrossingBridge(p) {
  return { type: "line", name: "", x1: p.x, y1: p.y - 60,
    x2: p.x, y2: p.y + 60, crossings: [.5], fontSize: 12 };
}
export function placeConductorCrossing(items, p, { preferredId = null, hitId = null } = {}) {
  const candidates = Object.entries(items).filter(([, o]) => conductive(o)).map(([id, o]) =>
    ({ id, o, q: crossingProjection(o, p) })).filter(({ q }) => q.distance <= 24);
  const chosen = candidates.find(c => c.id === preferredId) ||
    candidates.find(c => crossingPositions(c.o).some(t => Math.abs(t - c.q.t) * c.q.length < CLEARANCE)) ||
    candidates.sort((a, b) => a.q.distance - b.q.distance ||
      // At a crossing, use the vertical wire unless a selected wire was given.
      Math.abs(a.o.x2 - a.o.x1) / a.q.length - Math.abs(b.o.x2 - b.o.x1) / b.q.length ||
      Number(b.id === hitId) - Number(a.id === hitId))[0];
  if (!chosen) return { item: createCrossingBridge(p), added: true };
  const { id, o, q } = chosen;
  if (!q.length || q.t * q.length < END_MARGIN || (1 - q.t) * q.length < END_MARGIN)
    return { error: "Coloque a ponte no meio da conexão, afastada das pontas." };
  const previous = crossingPositions(o), existing = previous.find(t => Math.abs(t - q.t) * q.length < CLEARANCE);
  if (existing === undefined && previous.some(t => Math.abs(t - q.t) * q.length < 2 * CLEARANCE))
    return { error: "Deixe espaço entre as pontes para manter os cruzamentos separados." };
  return { id, item: { ...o, crossings: existing === undefined ? [...previous, q.t].sort((a, b) => a - b) :
    previous.filter(t => t !== existing) }, added: existing === undefined };
}
function frame(o) {
  const length = lengthOf(o), ux = (o.x2 - o.x1) / length, uy = (o.y2 - o.y1) / length;
  return { length, point: (s, n = 0) => ({ x: o.x1 + ux * s + uy * n, y: o.y1 + uy * s - ux * n }) };
}
const xy = p => `${p.x} ${p.y}`;
export function conductorCrossingPaths(o) {
  const positions = crossingPositions(o);
  if (!positions.length) return null;
  const { length, point } = frame(o), arcs = [];
  let path = `M ${o.x1} ${o.y1}`;
  for (const t of positions) {
    const start = point(t * length - RADIUS), end = point(t * length + RADIUS);
    const arc = `A ${RADIUS} ${RADIUS} 0 0 1 ${xy(end)}`;
    path += ` L ${xy(start)} ${arc}`;
    arcs.push(`M ${xy(start)} ${arc}`);
  }
  return { path: path + ` L ${o.x2} ${o.y2}`, arcs: arcs.join(" ") };
}
export function renderCrossingMask(stage, items, E) {
  const paths = Object.values(items).map(conductorCrossingPaths).filter(Boolean);
  if (!paths.length) return null;
  const coordinates = Object.values(items).flatMap(o => [
    { x: o.x1 ?? o.x, y: o.y1 ?? o.y }, { x: o.x2 ?? o.x, y: o.y2 ?? o.y },
  ]).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const x = Math.min(...coordinates.map(p => p.x)) - 200, y = Math.min(...coordinates.map(p => p.y)) - 200,
    width = Math.max(...coordinates.map(p => p.x)) - x + 200, height = Math.max(...coordinates.map(p => p.y)) - y + 200;
  const defs = E("defs", {}), mask = E("mask", { id: "conductor-crossing-mask", maskUnits: "userSpaceOnUse",
    x, y, width, height, "mask-type": "luminance" });
  mask.append(E("rect", { x, y, width, height, fill: "white" }));
  for (const { arcs } of paths) mask.append(E("path", { d: arcs, fill: "none", stroke: "black", "stroke-width": 9 }));
  defs.append(mask); stage.append(defs);
  return "url(#conductor-crossing-mask)";
}
// Display routes only: electrical values and edge direction remain unchanged.
export function routeCrossingFlow(segment, o) {
  const positions = crossingPositions(o);
  if (!positions.length) return segment;
  const { length, point } = frame(o), a = crossingProjection(o, segment.from).t * length,
    b = crossingProjection(o, segment.to).t * length, lo = Math.min(a, b), hi = Math.max(a, b);
  const route = [point(lo)];
  for (const t of positions) {
    const center = t * length;
    if (center - RADIUS <= lo || center + RADIUS >= hi) continue;
    for (let i = 0; i <= 16; i++) {
      const angle = i * Math.PI / 16;
      route.push(point(center - RADIUS * Math.cos(angle), RADIUS * Math.sin(angle)));
    }
  }
  route.push(point(hi));
  if (route.length === 2) return segment;
  if (a > b) route.reverse();
  const lengths = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.y - route[i].y));
  return { ...segment, displayRoute: route, displayLengths: lengths, displayLength: lengths.reduce((sum, l) => sum + l, 0) };
}
