// Lossless P/Q allocation for the training display, using the simulator's
// measured injections and switching graph. This is not the AC study solver.
// Unresolved cycles use a separate topology-only illustration; those arrows
// never become transformer readings or numerical electrical-study results.
export const FLOW_EPSILON = 1e-4;
const finite = (value) => value !== null && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : 0;

function disjointSet(keys) {
  const parent = new Map(keys.map((key) => [key, key]));
  const root = (key) => {
    let r = key;
    while (parent.get(r) !== r) r = parent.get(r);
    while (key !== r) { const next = parent.get(key); parent.set(key, r); key = next; }
    return r;
  };
  return { root, join(a, b) { a = root(a); b = root(b); if (a !== b) parent.set(b, a); } };
}

// Removing a bridge leaves one possible P/Q balance, even when its impedance
// has not been entered. Source counts also identify unfixed multi-grid shares.
function bridgeFlows(nodes, adjacency, injections, accepts = () => true, unfixed = new Map()) {
  const flows = new Map(), order = new Map(), low = new Map(); let clock = 0;
  function visit(n, parentEdge = null) {
    order.set(n, ++clock); low.set(n, clock);
    const sum = { ...injections.get(n), unfixedSources: unfixed.get(n) || 0 };
    for (const e of adjacency.get(n)) {
      if (!accepts(e) || e.key === parentEdge) continue;
      const next = e.a === n ? e.b : e.a;
      if (order.has(next)) { low.set(n, Math.min(low.get(n), order.get(next))); continue; }
      const child = visit(next, e.key);
      low.set(n, Math.min(low.get(n), low.get(next)));
      sum.p += child.p; sum.q += child.q; sum.unfixedSources += child.unfixedSources;
      if (low.get(next) > order.get(n)) {
        const sign = e.a === n ? -1 : 1;
        flows.set(e.key, { p: sign * child.p, q: sign * child.q, unfixedSources: child.unfixedSources });
      }
    }
    return sum;
  }
  for (const n of nodes) if (!order.has(n)) visit(n);
  return flows;
}

function unresolvedCycleEdges(nodes, adjacency) {
  const order = new Map(), low = new Map(), stack = [], unresolved = new Set(); let clock = 0;
  function visit(n, parent = null) {
    order.set(n, ++clock); low.set(n, clock);
    for (const e of adjacency.get(n)) {
      if (e.key === parent) continue;
      const next = e.a === n ? e.b : e.a;
      if (!order.has(next)) {
        stack.push(e); visit(next, e.key); low.set(n, Math.min(low.get(n), low.get(next)));
        if (low.get(next) >= order.get(n)) {
          const block = []; let edge;
          do { edge = stack.pop(); block.push(edge); } while (edge.key !== e.key);
          if (block.length > 1 && block.some(link => link.known === false))
            block.forEach(link => unresolved.add(link.key));
        }
      } else if (order.get(next) < order.get(n)) {
        stack.push(e); low.set(n, Math.min(low.get(n), order.get(next)));
      }
    }
  }
  for (const n of nodes) if (!order.has(n)) visit(n);
  return unresolved;
}

function solveAllocation(nodes, edges, injections) {
  if (nodes.length <= 1) return new Map(nodes.map((n) => [n, 0]));
  const index = new Map(nodes.slice(1).map((n, i) => [n, i])), size = index.size;
  const links = edges.map((e) => ({ a: index.get(e.a), b: index.get(e.b), w: e.weight }));
  const diagonal = new Float64Array(size);
  for (const e of links) {
    if (e.a !== undefined) diagonal[e.a] += e.w;
    if (e.b !== undefined) diagonal[e.b] += e.w;
  }
  const apply = (x) => {
    const out = new Float64Array(size);
    for (const e of links) {
      const delta = e.w * ((e.a === undefined ? 0 : x[e.a]) - (e.b === undefined ? 0 : x[e.b]));
      if (e.a !== undefined) out[e.a] += delta;
      if (e.b !== undefined) out[e.b] -= delta;
    }
    return out;
  };
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const x = new Float64Array(size), r = Float64Array.from(nodes.slice(1), (n) => injections.get(n) || 0);
  let z = Float64Array.from(r, (value, i) => value / diagonal[i]), p = z.slice(), rz = dot(r, z);
  const tolerance = Math.max(1e-9, Math.hypot(...r) * 1e-8);
  for (let iteration = 0; iteration < Math.max(40, size * 4); iteration++) {
    if (Math.hypot(...r) < tolerance) break;
    const ap = apply(p), denominator = dot(p, ap);
    if (!(denominator > 0)) return null;
    const alpha = rz / denominator;
    for (let i = 0; i < size; i++) { x[i] += alpha * p[i]; r[i] -= alpha * ap[i]; }
    z = Float64Array.from(r, (value, i) => value / diagonal[i]);
    const next = dot(r, z), beta = next / rz;
    for (let i = 0; i < size; i++) p[i] = z[i] + beta * p[i];
    rz = next;
  }
  if (Math.hypot(...r) > tolerance * 10 || [...x].some((v) => !Number.isFinite(v))) return null;
  return new Map([[nodes[0], 0], ...nodes.slice(1).map((n, i) => [n, x[i]])]);
}

// Unit graph weights choose a balanced illustration when impedances do not
// determine the real split. Work on residual components so already determined
// branch powers remain unchanged. No electrical input is filled or persisted.
function illustrativeAllocation(nodes, edges, injections) {
  const groups = disjointSet(nodes), regions = new Map(), result = new Map();
  for (const e of edges) groups.join(e.a, e.b);
  for (const n of nodes) {
    const root = groups.root(n);
    if (!regions.has(root)) regions.set(root, []);
    regions.get(root).push(n);
  }
  for (const [root, region] of regions) {
    const links = edges.filter(e => groups.root(e.a) === root).map(e => ({ ...e, weight: 1 }));
    if (!links.length) continue;
    const pInput = new Map(region.map(n => [n, injections.get(n).p]));
    const qInput = new Map(region.map(n => [n, injections.get(n).q]));
    const balanced = input => Math.abs([...input.values()].reduce((a, b) => a + b, 0))
      <= Math.max(1e-7, [...input.values()].reduce((sum, value) => sum + Math.abs(value), 0) * 1e-7);
    if (!balanced(pInput) || !balanced(qInput)) continue;
    const p = solveAllocation(region, links, pInput), q = solveAllocation(region, links, qInput);
    if (!p || !q) continue;
    for (const e of links) result.set(e.key, { p: p.get(e.a) - p.get(e.b), q: q.get(e.a) - q.get(e.b) });
  }
  return result;
}

export function calculateAnimatedFlow(network, measurements, { electricalData = (o) => o.electrical || {} } = {}) {
  const { items, points, ports, sources } = network;
  const contact = disjointSet([...points.keys()]);
  for (const e of network.edges) if (e.id === null) contact.join(e.a, e.b);
  const nodes = [...new Set([...points.keys()].map(contact.root))];
  const injection = new Map(nodes.map((key) => [key, { p: 0, q: 0 }]));
  const sourceNodes = new Map(), references = new Map(), invalidItems = new Set(network.issues.map((issue) => issue.id));
  const pendingImpedanceItems = new Set();
  const edges = [];
  for (const [i, raw] of network.edges.entries()) {
    if (raw.id === null) continue;
    const a = contact.root(raw.a), b = contact.root(raw.b), o = items[raw.id];
    if (a === b || !o) continue;
    const data = electricalData(o);
    let impedance = 0;
    if (raw.hasImpedance) {
      if (o.type === "transformer") {
        const rated = number(data.ratedMVA) || 25;
        impedance = number(raw.percent) / 100 * 100 / rated;
      } else {
        const kv = number(data.nominalKV) || 13.8;
        impedance = Math.hypot(number(raw.resistanceOhm), number(raw.reactanceOhm)) * 100 / (kv * kv);
      }
    }
    const negative = o.type === "transformer"
      ? finite(data.impedancePercent) && Number(data.impedancePercent) < 0
      : ["line", "cable"].includes(o.type) && [data.resistanceOhm, data.reactanceOhm].some(v => finite(v) && Number(v) < 0);
    if (negative || impedance < 0) invalidItems.add(raw.id);
    edges.push({ ...raw, key: i, a, b, from: points.get(raw.a), to: points.get(raw.b),
      ideal: !raw.hasImpedance, weight: impedance > 0 ? 1 / impedance : 0 });
  }
  for (const [id, o] of Object.entries(items)) {
    const port = ports.get(id)?.[0], result = measurements.get(id);
    if (!port || !result?.energized) continue;
    const node = contact.root(port), value = injection.get(node), data = electricalData(o);
    if (sources.includes(id)) {
      sourceNodes.set(id, node);
      if (o.type === "utility" || o.type === "turbogenerator") {
        value.p += number(result.activeMW); value.q += number(result.reactiveMvar);
      }
      // The grid balances the lossless display. An imposed grid current stays
      // fixed; a conflicting island is hidden instead of inventing generation.
      if (o.type === "utility" && !finite(data.forcedCurrentA) ||
          o.type !== "utility" && o.type !== "turbogenerator")
        references.set(id, number(data.gridRatedMVA) || 1);
    } else if (["load", "motor"].includes(o.type) && o.state === "active" ||
               o.type === "capacitor" && (o.activeStages ?? (o.state === "active" ? 1 : 0)) > 0) {
      value.p -= number(result.activeMW); value.q -= number(result.reactiveMvar);
    }
  }
  const adjacency = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) { adjacency.get(e.a).push(e); adjacency.get(e.b).push(e); }
  const seen = new Set(), segments = [], illustrativeSegments = [], ambiguousItems = new Set(), ambiguousKeys = new Set();
  const markUnresolved = e => { ambiguousItems.add(e.id); ambiguousKeys.add(e.key); };
  const illustrate = (region, links, residual) => {
    if (!links.some(e => ambiguousKeys.has(e.key))) return;
    const allocation = illustrativeAllocation(region, links, residual);
    for (const e of links) {
      const flow = allocation.get(e.key);
      if (!ambiguousKeys.has(e.key) || !flow || !measurements.get(e.id)?.energized) continue;
      if (Math.max(Math.abs(flow.p), Math.abs(flow.q)) < FLOW_EPSILON) continue;
      illustrativeSegments.push({ key: e.key, itemId: e.id, from: { ...e.from }, to: { ...e.to },
        activeMW: flow.p, reactiveMvar: flow.q, illustrative: true });
    }
  };
  let unbalancedIslands = 0;
  for (const seed of nodes) {
    if (seen.has(seed)) continue;
    const region = [seed], regionEdges = new Set(); seen.add(seed);
    for (let i = 0; i < region.length; i++)
      for (const e of adjacency.get(region[i])) {
        regionEdges.add(e);
        const next = e.a === region[i] ? e.b : e.a;
        if (!seen.has(next)) { seen.add(next); region.push(next); }
      }
    const members = new Set(region), liveSources = [...sourceNodes].filter(([, n]) => members.has(n));
    if (!liveSources.length) continue;
    const islandEdges = [...regionEdges], ids = new Set(islandEdges.map((e) => e.id));
    if ([...ids].some((id) => invalidItems.has(id)) || network.issues.some((issue) => ids.has(issue.id))) {
      ids.forEach((id) => invalidItems.add(id)); continue;
    }
    const total = region.reduce((sum, n) => ({ p: sum.p + injection.get(n).p, q: sum.q + injection.get(n).q }), { p: 0, q: 0 });
    const slack = liveSources.filter(([id]) => references.has(id)), weight = slack.reduce((sum, [id]) => sum + references.get(id), 0);
    if (weight > 0) for (const [id, n] of slack) {
      const share = references.get(id) / weight, value = injection.get(n);
      value.p -= total.p * share; value.q -= total.q * share;
    } else if (Math.max(Math.abs(total.p), Math.abs(total.q)) > FLOW_EPSILON) {
      unbalancedIslands++; ids.forEach((id) => invalidItems.add(id)); continue;
    }

    for (const e of islandEdges) if (e.known === false) pendingImpedanceItems.add(e.id);
    const unfixed = new Map();
    for (const [id, n] of slack) if (!["utility", "turbogenerator"].includes(items[id].type))
      unfixed.set(n, (unfixed.get(n) || 0) + 1);
    const unfixedCount = [...unfixed.values()].reduce((sum, count) => sum + count, 0);
    const unique = bridgeFlows(region, adjacency, injection, () => true, unfixed);
    const unresolved = unresolvedCycleEdges(region, adjacency);

    // Keep determined powers separate from the illustrative source sharing.
    if (unfixedCount > 1) {
      for (const e of islandEdges) {
        const flow = unique.get(e.key);
        if (!flow || flow.unfixedSources > 0 && flow.unfixedSources < unfixedCount) {
          markUnresolved(e); continue;
        }
        if (Math.max(Math.abs(flow.p), Math.abs(flow.q)) < FLOW_EPSILON || !measurements.get(e.id)?.energized) continue;
        segments.push({ key: e.key, itemId: e.id, from: { ...e.from }, to: { ...e.to }, activeMW: flow.p, reactiveMvar: flow.q });
      }
      illustrate(region, islandEdges, injection);
      continue;
    }

    const ideal = disjointSet(region);
    for (const e of islandEdges) if (e.ideal || unresolved.has(e.key)) ideal.join(e.a, e.b);
    const groups = [...new Set(region.map(ideal.root))], coarseP = new Map(groups.map((g) => [g, 0])), coarseQ = new Map(coarseP);
    for (const n of region) {
      const g = ideal.root(n), value = injection.get(n);
      coarseP.set(g, coarseP.get(g) + value.p); coarseQ.set(g, coarseQ.get(g) + value.q);
    }
    const branches = islandEdges.filter((e) => !e.ideal && ideal.root(e.a) !== ideal.root(e.b))
      .map((e) => ({ ...e, a: ideal.root(e.a), b: ideal.root(e.b) }));
    const p = solveAllocation(groups, branches, coarseP), q = solveAllocation(groups, branches, coarseQ);
    if (!p || !q) { ids.forEach((id) => invalidItems.add(id)); continue; }
    const residual = new Map(region.map((n) => [n, { ...injection.get(n) }]));
    const flows = new Map();
    for (const e of islandEdges) if (!e.ideal && !unresolved.has(e.key)) {
      const ga = ideal.root(e.a), gb = ideal.root(e.b);
      const flow = { p: e.weight * (p.get(ga) - p.get(gb)), q: e.weight * (q.get(ga) - q.get(gb)) };
      flows.set(e.key, flow);
      residual.get(e.a).p -= flow.p; residual.get(e.a).q -= flow.q;
      residual.get(e.b).p += flow.p; residual.get(e.b).q += flow.q;
    }
    for (const [key, flow] of bridgeFlows(region, adjacency, residual, e => e.ideal || unresolved.has(e.key))) flows.set(key, flow);
    for (const e of islandEdges) {
      if (unresolved.has(e.key)) { markUnresolved(e); continue; }
      const flow = flows.get(e.key);
      if (!flow) { if (e.ideal) markUnresolved(e); continue; }
      if (Math.max(Math.abs(flow.p), Math.abs(flow.q)) < FLOW_EPSILON) continue;
      if (!measurements.get(e.id)?.energized) continue;
      if (!["line", "bus", "cable", "transformer", "breaker", "disconnector", "fuse"].includes(items[e.id].type)) continue;
      segments.push({ key: e.key, itemId: e.id, from: { ...e.from }, to: { ...e.to },
        activeMW: flow.p, reactiveMvar: flow.q });
    }
    illustrate(region, islandEdges.filter(e => e.ideal || unresolved.has(e.key)), residual);
  }
  return { segments, illustrativeSegments, ambiguousItems, invalidItems, pendingImpedanceItems, unbalancedIslands };
}

// Every diagram uses the same terminal graph for transformer measurements and
// animation. Layout metadata must never opt a tab out of the training engine.
export function applyTransformerFlowMeasurements(network, measurements, flow, { electricalData = o => o.electrical || {} } = {}) {
  const segments = new Map(flow.segments.map(segment => [segment.itemId, segment]));
  for (const [id, item] of Object.entries(network.items)) {
    if (item.type !== "transformer" || !measurements.has(id) || flow.invalidItems.has(id)) continue;
    const result = measurements.get(id), segment = segments.get(id);
    if (flow.ambiguousItems.has(id)) {
      Object.assign(result, { powerIndeterminate: true, activeMW: 0, reactiveMvar: 0, currentA: 0, loadingPercent: 0, powerFactor: 0 });
      continue;
    }
    const p = segment?.activeMW || 0, q = segment?.reactiveMvar || 0;
    const apparent = Math.hypot(p, q), data = electricalData(item), voltage = result.voltageSecondaryKV;
    Object.assign(result, { powerIndeterminate: false, activeMW: p, reactiveMvar: q,
      connectedBothSides: !!segment || result.connectedBothSides,
      powerFactor: apparent ? Math.abs(p) / apparent : 1,
      currentA: voltage > 0 ? Math.sign(p || q) * apparent * 1000 / (Math.sqrt(3) * voltage) : 0,
      loadingPercent: Math.max(data.ratedMVA > 0 ? apparent / data.ratedMVA * 100 : 0,
        Math.max(0, (result.overfluxPercent || 0) / 100 - 1) * 500) });
  }
  return measurements;
}

export function arrowPose(segment, quantity, timestamp, index = 0, count = 1, separated = true, reduced = false) {
  const value = quantity === "p" ? segment.activeMW : segment.reactiveMvar;
  const dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y, length = Math.hypot(dx, dy);
  const margin = Math.min(8, length / 4), travel = Math.max(1, length - 2 * margin);
  const phase = reduced ? (index + 1) / (count + 1) : ((timestamp * .035 / travel) + index / count + (quantity === "q" ? .35 : 0)) % 1;
  const progress = (margin + (value < 0 ? 1 - phase : phase) * travel) / length;
  const offset = separated ? (quantity === "p" ? -4 : 4) : 0;
  return { x: segment.from.x + dx * progress - dy / length * offset,
    y: segment.from.y + dy * progress + dx / length * offset,
    angle: Math.atan2(dy, dx) * 180 / Math.PI + (value < 0 ? 180 : 0) };
}

export function createFlowAnimator({ stage, page = stage.ownerDocument, ownerWindow = page.defaultView,
  requestFrame = (fn) => ownerWindow.requestAnimationFrame(fn), cancelFrame = (id) => ownerWindow.cancelAnimationFrame(id),
  now = () => ownerWindow.performance.now() }) {
  const element = (tag, attrs) => {
    const node = page.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const layer = element("g", { class: "flow-animation-layer", "pointer-events": "none", "aria-hidden": "true" });
  const reduced = ownerWindow.matchMedia?.("(prefers-reduced-motion: reduce)");
  let arrows = [], frame = null, lastPaint = -Infinity;
  function paint(timestamp) {
    for (const arrow of arrows) {
      const pose = arrowPose(arrow.segment, arrow.quantity, timestamp, arrow.index, arrow.count, arrow.separated, reduced?.matches);
      arrow.node.setAttribute("transform", `translate(${pose.x.toFixed(2)} ${pose.y.toFixed(2)}) rotate(${pose.angle.toFixed(2)})`);
    }
  }
  function tick(timestamp) {
    frame = null;
    if (page.hidden || !arrows.length || reduced?.matches) return;
    if (timestamp - lastPaint >= 30) { paint(timestamp); lastPaint = timestamp; }
    frame = requestFrame(tick);
  }
  function refresh() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (page.hidden || !arrows.length) return;
    paint(now()); lastPaint = -Infinity;
    if (!reduced?.matches) frame = requestFrame(tick);
  }
  page.addEventListener("visibilitychange", refresh);
  reduced?.addEventListener?.("change", refresh);
  return {
    update({ segments = [], illustrativeSegments = [], enabled = false, showActive = true, showReactive = true } = {}) {
      const existing = new Map(arrows.map((arrow) => [arrow.key, arrow])), next = [];
      if (enabled) for (const segment of [...segments, ...illustrativeSegments]) {
        const length = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
        if (length < 14 || !Number.isFinite(length)) continue;
        for (const quantity of ["p", "q"]) {
          const value = quantity === "p" ? segment.activeMW : segment.reactiveMvar;
          if (!(quantity === "p" ? showActive : showReactive) || !Number.isFinite(value) || Math.abs(value) < FLOW_EPSILON) continue;
          const count = Math.min(3, Math.max(1, Math.floor(length / 120)));
          for (let index = 0; index < count; index++) {
            const key = `${segment.itemId}:${segment.key}:${quantity}:${index}`;
            const arrow = existing.get(key) || { key, node: element("polygon", {
              class: "power-flow-arrow flow-" + quantity, points: "7,0 -5,-4 -2,0 -5,4",
              fill: quantity === "p" ? "#b91c1c" : "#1d4ed8", stroke: "white", "stroke-width": .8,
            }) };
            existing.delete(key);
            Object.assign(arrow, { segment, quantity, index, count, separated: showActive && showReactive });
            arrow.node.setAttribute("data-item-id", segment.itemId);
            arrow.node.setAttribute("data-quantity", quantity);
            arrow.node.setAttribute("data-direction", value < 0 ? "reverse" : "forward");
            arrow.node.setAttribute("data-flow-model", segment.illustrative ? "illustrative" : "calculated");
            layer.append(arrow.node); next.push(arrow);
          }
        }
      }
      for (const arrow of existing.values()) arrow.node.remove();
      arrows = next;
      if (arrows.length) stage.append(layer); else layer.remove();
      refresh();
    },
    dispose() {
      if (frame !== null) cancelFrame(frame);
      frame = null; arrows = []; layer.remove();
      page.removeEventListener("visibilitychange", refresh);
      reduced?.removeEventListener?.("change", refresh);
    },
  };
}

