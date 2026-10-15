// Presentation of editable reference models; readings come from the simulator.
export function electricalFieldValue(input) {
  return input.tagName === "SELECT" ? input.value : input.value === "" ? null : Number(input.value);
}
export function transformerNameplate(item, data = item.electrical || {}) {
  const values = Array.isArray(data.ratedMVARange) && data.ratedMVARange.length ? data.ratedMVARange : [data.ratedMVA];
  if (values.some(v => v == null || !Number.isFinite(+v) || +v <= 0)) return "Potência nominal pendente";
  const rating = values.map(v => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })).join("/") + " MVA";
  if (item.reconstruction?.compactNameplate) return rating;
  if (!(data.primaryKV > 0) || !(data.secondaryKV > 0)) return rating + " · relação de tensão pendente";
  return rating + " · " + Number(data.primaryKV).toLocaleString("pt-BR") + "/" + Number(data.secondaryKV).toLocaleString("pt-BR") + " kV";
}

// Lossless training balances for explicit native reference diagrams. Cutting a
// transformer edge identifies its real downstream loads, including cascaded
// transformers, without merging drawn crossings or bypassing open contacts.
export function applyReferenceTransformerBalances(diagram, results, network) {
  if (!diagram.reconstruction?.nominalTransformerBalances) return results;
  const adjacency = new Map([...network.points.keys()].map(k => [k, []]));
  for (const edge of network.edges) {
    adjacency.get(edge.a)?.push({ next: edge.b, edge });
    adjacency.get(edge.b)?.push({ next: edge.a, edge });
  }
  const sourcePorts = network.sources.flatMap(id => network.ports.get(id) || []);
  function walk(seed, excluded) {
    const seen = new Set([seed]), queue = [seed];
    for (let i = 0; i < queue.length; i++) for (const link of adjacency.get(queue[i]) || [])
      if (link.edge.id !== excluded && !seen.has(link.next)) {
        seen.add(link.next); queue.push(link.next);
      }
    return seen;
  }
  for (const [id, item] of Object.entries(diagram.items || {})) {
    if (item.type !== "transformer" || !results.has(id)) continue;
    const ports = network.ports.get(id);
    if (!ports || ports.length !== 2) continue;
    const primary = walk(ports[0], id), secondary = walk(ports[1], id);
    const primaryFed = sourcePorts.some(p => primary.has(p)), secondaryFed = sourcePorts.some(p => secondary.has(p));
    const result = results.get(id);
    if (primaryFed && secondaryFed) {
      // A parallel or meshed path needs impedances for a defensible split.
      Object.assign(result, { powerIndeterminate: true, activeMW: 0, reactiveMvar: 0, currentA: 0, loadingPercent: 0, powerFactor: 0 });
      continue;
    }
    const downstream = primaryFed ? secondary : primary, direction = primaryFed ? 1 : -1;
    let p = 0, q = 0;
    if (primaryFed || secondaryFed) for (const [loadId, load] of Object.entries(diagram.items || {})) {
      if (!["load", "motor", "capacitor", "turbogenerator"].includes(load.type)) continue;
      if (!(network.ports.get(loadId) || []).some(port => downstream.has(port))) continue;
      const value = results.get(loadId);
      if (!value?.energized) continue;
      const sign = load.type === "turbogenerator" ? -1 : 1;
      p += sign * value.activeMW; q += sign * value.reactiveMvar;
    }
    p *= direction; q *= direction;
    const apparent = Math.hypot(p, q), voltage = result.voltageSecondaryKV, rated = item.electrical?.ratedMVA;
    Object.assign(result, { powerIndeterminate: false, activeMW: p, reactiveMvar: q,
      connectedBothSides: primaryFed || secondaryFed, powerFactor: apparent ? Math.abs(p) / apparent : 1,
      currentA: voltage > 0 ? Math.sign(p || q) * apparent * 1000 / (Math.sqrt(3) * voltage) : 0,
      loadingPercent: rated > 0 ? apparent / rated * 100 : 0 });
  }
  return results;
}

export function referenceReadouts(diagram, results, network) {
  const readouts = new Map(), fields = Object.entries(diagram.items || {}).filter(([, o]) => o.type === "text" && o.reconstruction?.readout);
  if (!fields.length) return readouts;
  const adjacency = new Map([...network.points.keys()].map(k => [k, []]));
  for (const edge of network.edges) { adjacency.get(edge.a)?.push(edge.b); adjacency.get(edge.b)?.push(edge.a); }
  const components = new Map(); let component = 0;
  for (const seed of adjacency.keys()) {
    if (components.has(seed)) continue;
    const queue = [seed]; components.set(seed, component);
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]))
      if (!components.has(next)) { components.set(next, component); queue.push(next); }
    component++;
  }
  const sourceCounts = new Map();
  for (const id of network.sources) {
    const root = components.get(network.ports.get(id)?.[0]);
    sourceCounts.set(root, (sourceCounts.get(root) || 0) + 1);
  }
  for (const [id, item] of fields) {
    const config = item.reconstruction.readout, result = results.get(config.targetId);
    const root = components.get(network.ports.get(config.targetId)?.[0]);
    if (!result) { readouts.set(id, "—"); continue; }
    const shared = config.sourceBoundary && (sourceCounts.get(root) || 0) > 1;
    if (shared && ["activeMW", "reactiveMvar", "sourceCurrentA", "powerFactor"].includes(config.metric)) {
      readouts.set(id, "Indef."); continue;
    }
    let value = result[config.metric];
    if (config.metric === "sourceCurrentA")
      value = result.energized === false ? 0 : result.voltageKV > 0 ? Math.hypot(result.activeMW, result.reactiveMvar) * 1000 / (Math.sqrt(3) * result.voltageKV) : null;
    if (config.metric === "powerFactor" && Math.hypot(result.activeMW, result.reactiveMvar) < 1e-9) value = null;
    if (value == null || !Number.isFinite(value)) { readouts.set(id, "—"); continue; }
    const digits = Math.max(0, Math.min(4, config.digits ?? 2));
    readouts.set(id, value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + (config.unit ? " " + config.unit : ""));
  }
  return readouts;
}
