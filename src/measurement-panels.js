// Balanced three-phase training readings. Numerical studies keep their own
// loss model; these aggregates consume the already calculated live readings.
export const PANEL_METRICS = Object.freeze({
  activeMW: { label: "Pot. ativa", unit: "MW", digits: 2 },
  reactiveMvar: { label: "Pot. reativa", unit: "MVAr", digits: 2 },
  apparentMVA: { label: "Pot. aparente", unit: "MVA", digits: 2 },
  voltageKV: { label: "Tensão", unit: "kV", digits: 2 },
  currentA: { label: "Corrente", unit: "A", digits: 1 },
  powerFactor: { label: "F. potência", unit: "", digits: 3 },
  frequencyHz: { label: "Frequência", unit: "Hz", digits: 2 },
});
const EPS = 1e-8;
const finite = v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const measured = v => finite(v) ? Number(v) : null;
const consumers = new Set(["load", "motor", "capacitor"]);
const quantities = ["activeMW", "voltageKV", "currentA", "powerFactor", "frequencyHz", "reactiveMvar", "apparentMVA"];
export const isMeasurementPanel = item => item?.type === "measurementPanel";

export function createMeasurementPanel(point = { x: 0, y: 0 }, count = 5) {
  return { type: "measurementPanel", name: "LEITURAS DA ABA", x: point.x, y: point.y,
    width: 300, rowHeight: 29, fontSize: 12, color: "#687c83", scale: 1, rotation: 0,
    reference: { itemId: "", side: "primary" },
    rows: Array.from({ length: Math.max(1, Math.min(32, Math.trunc(count) || 5)) }, (_, i) => {
      const metric = quantities[i % quantities.length], definition = PANEL_METRICS[metric];
      return { label: definition.label, metric, origin: "tab", targetId: "", side: "primary", digits: definition.digits };
    }) };
}
export function panelDimensions(panel) {
  return { width: Math.max(240, Number(panel.width) || 300),
    height: 48 + (panel.rows?.length || 0) * (Number(panel.rowHeight) || 29), rowHeight: Number(panel.rowHeight) || 29 };
}
export function panelBounds(panel) {
  const { width, height } = panelDimensions(panel), z = panel.scale || 1, r = (panel.rotation || 0) * Math.PI / 180;
  const points = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => ({
    x: panel.x + z * (x * Math.cos(r) - y * Math.sin(r)), y: panel.y + z * (x * Math.sin(r) + y * Math.cos(r)),
  }));
  return { x1: Math.min(...points.map(p => p.x)), y1: Math.min(...points.map(p => p.y)),
    x2: Math.max(...points.map(p => p.x)), y2: Math.max(...points.map(p => p.y)) };
}

function connectivity(network) {
  const adjacency = new Map([...network.points.keys()].map(key => [key, []]));
  for (const edge of network.edges) { adjacency.get(edge.a)?.push(edge.b); adjacency.get(edge.b)?.push(edge.a); }
  const components = new Map(); let nextId = 0;
  for (const seed of adjacency.keys()) {
    if (components.has(seed)) continue;
    const queue = [seed]; components.set(seed, nextId);
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]))
      if (!components.has(next)) { components.set(next, nextId); queue.push(next); }
    nextId++;
  }
  const at = (id, side = "primary") => components.get(network.ports.get(id)?.[side === "secondary" ? 1 : 0]);
  const sourceCounts = new Map();
  for (const id of network.sources) {
    const item = network.items[id];
    if (item.type === "turbogenerator" || item.type === "utility" && finite(item.electrical?.forcedCurrentA)) continue;
    const root = at(id); sourceCounts.set(root, (sourceCounts.get(root) || 0) + 1);
  }
  return { at, sourceCounts };
}
function power(p, q) {
  if (!finite(p) || !finite(q)) return { activeMW: null, reactiveMvar: null, apparentMVA: null, powerFactor: null };
  const s = Math.hypot(p, q);
  return { activeMW: p, reactiveMvar: q, apparentMVA: s, powerFactor: s > EPS ? Math.abs(p) / s : null,
    nature: q > EPS ? "indutivo" : q < -EPS ? "capacitivo" : "resistivo" };
}
function voltageOf(item, result, side = "primary") {
  return measured(item?.type === "transformer"
    ? result?.[side === "secondary" ? "voltageSecondaryKV" : "voltagePrimaryKV"] : result?.voltageKV);
}
function uniform(values) {
  if (!values.length || values.some(v => !finite(v))) return null;
  return values.every(v => Math.abs(v - values[0]) <= Math.max(1e-5, Math.abs(values[0]) * 1e-5)) ? values[0] : null;
}

export function createMeasurementContext({ diagram, network, results, flow }) {
  const { at, sourceCounts } = connectivity(network), rows = [], generations = [], roots = new Set();
  let pending = false;
  for (const [id, item] of Object.entries(diagram.items || {})) {
    if (!consumers.has(item.type) && item.type !== "turbogenerator") continue;
    const active = item.type === "capacitor" ? (item.activeStages ?? (item.state === "active" ? 1 : 0)) > 0
      : item.type === "turbogenerator" ? item.state !== "stopped" && item.isSource !== false : item.state === "active";
    if (!active) continue;
    const result = results.get(id);
    if (!result) { pending = true; continue; }
    if (!result.energized) continue;
    const entry = { id, root: at(id), activeMW: measured(result.activeMW), reactiveMvar: measured(result.reactiveMvar),
      currentA: measured(result.currentA), frequencyHz: measured(result.frequencyHz), voltageKV: measured(result.voltageKV) };
    if (entry.activeMW === null || entry.reactiveMvar === null) pending = true;
    if (entry.root !== undefined) roots.add(entry.root);
    (item.type === "turbogenerator" ? generations : rows).push(entry);
  }
  const sum = (entries, metric) => entries.reduce((total, entry) => total + (entry[metric] ?? 0), 0);
  // Count each end consumer once. Transformers, buses and feeder currents are
  // intermediate readings, never extra demand in the tab's total.
  const demand = power(pending ? null : sum(rows, "activeMW"), pending ? null : sum(rows, "reactiveMvar"));
  const net = power(pending ? null : demand.activeMW - sum(generations, "activeMW"),
    pending ? null : demand.reactiveMvar - sum(generations, "reactiveMvar"));
  const sources = network.sources.filter(id => roots.size ? roots.has(at(id)) : Object.hasOwn(diagram.items, id));
  if (!roots.size) for (const id of sources) if (at(id) !== undefined) roots.add(at(id));
  const frequencies = [...rows, ...generations].map(entry => entry.frequencyHz);
  if (!frequencies.length) for (const id of sources) frequencies.push(measured(results.get(id)?.frequencyHz));
  const frequencyHz = roots.size <= 1 ? uniform(frequencies) : null;
  const sourceVoltages = sources.map(id => voltageOf(network.items[id], results.get(id)));
  const autoVoltageKV = uniform(sourceVoltages.length ? sourceVoltages : rows.map(row => row.voltageKV));
  const compatible = roots.size <= 1 && (frequencyHz !== null || !rows.length && !generations.length);
  if (!compatible) for (const aggregate of [demand, net]) { aggregate.apparentMVA = null; aggregate.powerFactor = null; }
  const branchSegments = new Map(), portEdges = new Map();
  for (const edge of network.edges) if (edge.id != null) for (const port of [edge.a, edge.b]) {
    const key = edge.id + "|" + port;
    if (!portEdges.has(key)) portEdges.set(key, []);
    portEdges.get(key).push(edge);
  }
  for (const segment of flow.segments) {
    if (!branchSegments.has(segment.itemId)) branchSegments.set(segment.itemId, []);
    branchSegments.get(segment.itemId).push(segment);
  }
  const context = { diagram, network, results, flow, at, sourceCounts, branchSegments, portEdges,
    // Runtime-only variables: saving a model persists bindings, not stale values.
    equivalent: { demand, net, loads: rows, generation: generations, pending, frequencyHz,
      autoVoltageKV, roots, compatible, lossModel: "lossless-training" } };
  context.equivalent.demand = equivalentReadings(context);
  context.equivalent.net = equivalentReadings(context, {}, true);
  return context;
}

export function equivalentReadings(context, reference = {}, balance = false) {
  const eq = context.equivalent, aggregate = balance ? eq.net : eq.demand;
  const target = reference.itemId && context.network.items[reference.itemId];
  let voltageKV = reference.itemId ? target ? voltageOf(target, context.results.get(reference.itemId), reference.side) : null : eq.autoVoltageKV;
  const refRoot = target ? context.at(reference.itemId, reference.side) : null;
  if (target && eq.roots.size && !eq.roots.has(refRoot)) voltageKV = null;
  const reason = eq.pending ? "Há cargas sem leitura válida." : !eq.compatible
    ? "As cargas pertencem a ilhas independentes ou frequências incompatíveis."
    : !(voltageKV > 0) ? "Escolha uma tensão de referência energizada para a corrente equivalente." : "";
  const denominator = voltageKV > 0 && eq.compatible && !eq.pending ? Math.sqrt(3) * voltageKV : null;
  // I = conjugate(S)/(sqrt(3)*V), on the selected common line-voltage base.
  // Adding these real/imaginary components includes leading/lagging cancellation.
  const currentPhasorA = denominator ? { real: aggregate.activeMW * 1000 / denominator,
    imaginary: -aggregate.reactiveMvar * 1000 / denominator } : null;
  return { ...aggregate, voltageKV, frequencyHz: eq.frequencyHz,
    currentA: currentPhasorA ? Math.hypot(currentPhasorA.real, currentPhasorA.imaginary) : null,
    currentPhasorA, reason };
}

export function equipmentReadings(context, id, side = "primary") {
  const item = context.network.items[id], result = context.results.get(id);
  if (!item || !result) return { reason: "Equipamento removido ou sem leitura." };
  const voltageKV = voltageOf(item, result, side), frequencyHz = measured(result.frequencyHz);
  const sourceBoundary = context.network.sources.includes(id);
  const unresolved = context.flow.ambiguousItems.has(id) || result.powerIndeterminate ||
    sourceBoundary && item.type !== "turbogenerator" && (context.sourceCounts.get(context.at(id)) || 0) > 1;
  if (unresolved) return { voltageKV, frequencyHz, reason: "Divisão de potência indeterminada neste paralelo." };
  let p = measured(result.activeMW), q = measured(result.reactiveMvar);
  if (["bus", "line", "cable", "breaker", "disconnector", "fuse", "transformer"].includes(item.type) && !sourceBoundary) {
    const port = context.network.ports.get(id)?.[side === "secondary" ? 1 : 0];
    const owned = context.portEdges.get(id + "|" + port) || [];
    if (!owned.length && result.energized) return { voltageKV, frequencyHz, reason: "Sem trecho de potência neste terminal; escolha o alimentador." };
    p = 0; q = 0;
    for (const segment of context.branchSegments.get(id) || []) {
      const edge = context.network.edges[segment.key];
      if (!edge || edge.a !== port && edge.b !== port) continue;
      const sign = (edge.a === port ? 1 : -1) * (side === "secondary" ? -1 : 1);
      p += sign * segment.activeMW; q += sign * segment.reactiveMvar;
    }
  }
  const powers = power(p, q);
  return { ...powers, voltageKV, frequencyHz,
    currentA: result.energized === false ? 0 : voltageKV > 0 && powers.apparentMVA !== null
      ? powers.apparentMVA * 1000 / (Math.sqrt(3) * voltageKV) : null };
}
export function panelReadings(panel, context) {
  return (panel.rows || []).map(row => {
    const definition = PANEL_METRICS[row.metric] || PANEL_METRICS.activeMW;
    const readings = row.origin === "item" ? equipmentReadings(context, row.targetId, row.side)
      : equivalentReadings(context, panel.reference, row.origin === "net");
    const value = measured(readings[row.metric]), digits = Math.max(0, Math.min(4, row.digits ?? definition.digits));
    return { label: row.label || definition.label, value, reason: readings.reason || "",
      text: value === null ? /indeterminad/i.test(readings.reason || "") ? "Indef." : "—" : value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) +
        (definition.unit ? " " + definition.unit : "") };
  });
}
export function renderMeasurementPanel(group, panel, context, E) {
  const { width, height, rowHeight } = panelDimensions(panel), font = Math.max(9, Number(panel.fontSize) || 12),
    inner = E("g", { transform: `translate(${panel.x} ${panel.y}) rotate(${panel.rotation || 0}) scale(${panel.scale || 1})` });
  inner.append(E("rect", { x: 0, y: 0, width, height, rx: 5, fill: panel.color || "#687c83", stroke: "#aebdc3", "stroke-width": 2 }),
    E("text", { x: 12, y: 23, fill: "#172a36", "font-size": font + 1, "font-weight": 700, style: "fill:#172a36" }, panel.name || "LEITURAS"));
  const values = context ? panelReadings(panel, context) : (panel.rows || []).map(row => ({ label: row.label, text: "—", reason: "Sem cálculo." }));
  values.forEach((row, i) => {
    const y = 50 + i * rowHeight, valueX = width * .47;
    inner.append(E("text", { x: 12, y, "font-size": font, "font-weight": 650, fill: "#172a36", style: "fill:#172a36" }, row.label),
      E("rect", { x: valueX, y: y - font - 3, width: width - valueX - 12, height: font + 9, rx: 5, fill: "#17252d", stroke: "#c5d2d8", "stroke-width": 2 }));
    const value = E("text", { x: valueX + 8, y, "font-size": font, "font-weight": 700, fill: "#fff", style: "fill:#fff" }, row.text);
    if (row.reason) value.append(E("title", {}, row.reason));
    inner.append(value);
  });
  inner.append(E("rect", { x: -6, y: -6, width: width + 12, height: height + 12, class: "sel" }));
  group.append(inner);
}

// Recognize the existing editable area/text panels without changing any saved
// model. Conversion happens only when Engineering saves its panel editor.
export function measurementPanelFor(diagram, selectedId) {
  const selected = diagram.items?.[selectedId]; if (!selected) return null;
  if (isMeasurementPanel(selected)) return { id: selectedId, item: selected, removeIds: [] };
  if (!["area", "text"].includes(selected.type)) return null;
  const entries = Object.entries(diagram.items), fields = entries.filter(([, item]) => item.type === "text" && item.reconstruction?.readout);
  if (!fields.length) return null;
  const inside = (o, area) => o.x != null ? o.x >= area.x1 && o.x <= area.x2 && o.y >= area.y1 && o.y <= area.y2
    : o.x1 >= area.x1 && o.x2 <= area.x2 && o.y1 >= area.y1 && o.y2 <= area.y2;
  const candidates = entries.filter(([, item]) => item.type === "area" && item.x2 - item.x1 >= 180 && item.x2 - item.x1 <= 600 && inside(selected, item))
    .map(([id, area]) => ({ id, area, fields: fields.filter(([, field]) => inside(field, area)) }))
    .filter(candidate => candidate.fields.length >= 2)
    .sort((a, b) => (a.area.x2 - a.area.x1) * (a.area.y2 - a.area.y1) - (b.area.x2 - b.area.x1) * (b.area.y2 - b.area.y1));
  const found = candidates[0]; if (!found) return null;
  const members = entries.filter(([id, item]) => id !== found.id && ["area", "text"].includes(item.type) && inside(item, found.area));
  const title = members.find(([, item]) => item.type === "text" && !item.reconstruction?.readout && item.y < Math.min(...found.fields.map(([, field]) => field.y)) - 12);
  const next = createMeasurementPanel({ x: found.area.x1, y: found.area.y1 }, found.fields.length);
  next.width = found.area.x2 - found.area.x1; next.color = found.area.reconstruction?.fill || found.area.color;
  next.name = title?.[1].name || "LEITURAS";
  next.rows = found.fields.sort((a, b) => a[1].y - b[1].y).map(([, item]) => {
    const source = item.reconstruction.readout, metric = source.metric === "sourceCurrentA" ? "currentA" : source.metric;
    const label = members.find(([, other]) => other.type === "text" && !other.reconstruction?.readout &&
      Math.abs(other.y - item.y) < 2 && other.x < item.x);
    return { label: label?.[1].name || PANEL_METRICS[metric]?.label || metric, metric, origin: "item",
      targetId: source.targetId, side: "primary", digits: source.digits ?? 2 };
  });
  return { id: found.id, item: next, removeIds: members.map(([id]) => id) };
}
export function remapPanelLinks(item, mapId) {
  if (!isMeasurementPanel(item)) return item;
  return { ...item, reference: { ...item.reference, itemId: item.reference?.itemId ? mapId(item.reference.itemId) : "" },
    rows: (item.rows || []).map(row => ({ ...row, targetId: row.targetId ? mapId(row.targetId) : "" })) };
}
