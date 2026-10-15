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
