// Balanced, positive-sequence training model. Connectivity comes from the
// switching graph, so an open contact and a connector mean the same in all modes.
import { createSwitchingStudy } from "./switching-analysis.js?v=41";

const positive = (v) => v !== null && v !== "" && Number.isFinite(+v) && +v > 0;
const finite = (v) => v !== null && v !== "" && Number.isFinite(+v);
export function studyElectricalData(o) {
  const common = { nominalKV: 13.8, voltageSetpointPU: 1 };
  const defaults = {
    utility: { nominalKV: 230 },
    transformer: { primaryKV: 230, secondaryKV: 13.8, ratedMVA: 25,
      impedancePercent: 10, transformerXR: 10, tapPercent: 0 },
    load: { activePowerMW: 1, powerFactor: .9, loadNature: "inductive" },
    capacitor: { capacitorMvar: 5, capacitorStages: 1 },
    turbogenerator: { generatorRatedMVA: 35, generationMW: 20, generationMvar: 0 },
  };
  return { ...common, ...defaults[o.type], ...o.electrical };
}

export function buildStudyNetwork(diagram, options = {}) {
  const baseMVA = options.baseMVA ?? 100;
  if (!positive(baseMVA)) throw Error("A potência-base deve ser maior que zero.");
  const electricalData = options.electricalData || studyElectricalData;
  const graph = createSwitchingStudy(diagram, { ...options, electricalData }).network();
  const { items, ports, points, edges, sources } = graph;
  const parent = new Map([...points.keys()].map((key) => [key, key]));
  function root(key) {
    const p = parent.get(key);
    if (p !== key) parent.set(key, root(p));
    return parent.get(key);
  }
  for (const e of edges)
    if (e.known && !e.hasImpedance && items[e.id]?.type !== "transformer")
      parent.set(root(e.b), root(e.a));
  const roots = [...new Set([...points.keys()].map(root))];
  const indices = new Map(roots.map((key, i) => [key, i]));
  const at = (key) => indices.get(root(key));
  const buses = roots.map((key, id) => ({ id, key, name: "Nó " + (id + 1),
    kv: null, type: "PQ", p: 0, q: 0, v: 1, angle: 0, itemIds: [], busIds: [],
    errors: [], warnings: [] }));
  const busOfItem = new Map(), nodesOfItem = new Map();
  const named = new Set();
  for (const [id, ps] of ports) {
    const ids = [...new Set(ps.map(at))];
    nodesOfItem.set(id, ids); busOfItem.set(id, at(ps[0]));
    for (const index of ids) {
      const b = buses[index], o = items[id];
      b.itemIds.push(id);
      if (o.type === "bus") {
        b.busIds.push(id);
        if (!named.has(index)) { b.name = o.name || id; named.add(index); }
      }
    }
  }
  const name = (id) => items[id]?.name || id;
  const error = (id, text) => {
    for (const index of nodesOfItem.get(id) || []) buses[index].errors.push(name(id) + ": " + text);
  };
  const warn = (id, text) => {
    for (const index of nodesOfItem.get(id) || []) buses[index].warnings.push(name(id) + ": " + text);
  };
  for (const issue of graph.issues) error(issue.id, issue.message);
  const unlocatedErrors = graph.issues.filter((issue) => !nodesOfItem.has(issue.id))
    .map((issue) => name(issue.id) + ": " + issue.message);
  function voltage(id, index, value) {
    if (!positive(value)) { error(id, "tensão nominal inválida"); return; }
    const b = buses[index];
    if (b.kv !== null && Math.abs(b.kv - +value) > 1e-5 * Math.max(b.kv, +value))
      error(id, "tensões nominais incompatíveis no mesmo nó (" + b.kv + " / " + value + " kV)");
    else b.kv = +value;
  }
  for (const [id, ps] of ports) {
    const o = items[id], e = electricalData(o);
    if (o.type === "transformer") {
      voltage(id, at(ps[0]), e.primaryKV); voltage(id, at(ps[1]), e.secondaryKV);
      if (o.electrical?.primaryKV == null || o.electrical?.secondaryKV == null)
        warn(id, "relação de tensão padrão " + e.primaryKV + "/" + e.secondaryKV + " kV");
    } else if (o.electrical?.nominalKV != null || ["utility", "turbogenerator"].includes(o.type))
      voltage(id, at(ps[0]), e.nominalKV);
  }
  const branches = [];
  for (const edge of edges) {
    const from = at(edge.a), to = at(edge.b), o = items[edge.id];
    if (o?.type === "transformer" && from === to) {
      error(edge.id, "primário e secundário estão ligados ao mesmo nó"); continue;
    }
    if (from === to || !o || !["transformer", "line"].includes(o.type)) continue;
    branches.push({ from, to, itemId: edge.id, name: name(edge.id), type: o.type, edge });
  }
  // A line keeps the voltage base; a transformer has independent winding bases.
  for (let pass = 0; pass < buses.length; pass++) {
    let changed = false;
    for (const br of branches) if (br.type === "line") {
      const a = buses[br.from], b = buses[br.to];
      if (a.kv !== null && b.kv === null) { b.kv = a.kv; changed = true; }
      if (b.kv !== null && a.kv === null) { a.kv = b.kv; changed = true; }
    }
    if (!changed) break;
  }
  for (const b of buses) if (b.kv === null) {
    b.kv = 13.8; b.warnings.push(b.name + ": base de tensão padrão 13,8 kV");
  }
  for (const br of branches) {
    const o = items[br.itemId], e = electricalData(o), edge = br.edge;
    br.tap = 1; br.r = 0; br.x = 0;
    if (!edge.known) { error(br.itemId, "impedância inválida"); continue; }
    if (br.type === "line") {
      if (Math.abs(buses[br.from].kv - buses[br.to].kv) > 1e-5 * buses[br.from].kv)
        error(br.itemId, "linha entre bases de tensão diferentes");
      const zbase = buses[br.from].kv ** 2 / baseMVA;
      br.r = edge.resistanceOhm / zbase; br.x = edge.reactanceOhm / zbase;
      br.ampacityA = e.ampacityA;
    } else {
      if (!positive(e.ratedMVA) || !positive(e.impedancePercent) || !positive(e.transformerXR) ||
          !finite(e.tapPercent) || 1 + +e.tapPercent / 100 <= 0) {
        error(br.itemId, "MVA, Z%, X/R ou tap inválido"); continue;
      }
      const z = +e.impedancePercent / 100 * baseMVA / +e.ratedMVA, xr = +e.transformerXR;
      br.r = z / Math.hypot(1, xr); br.x = br.r * xr;
      br.tap = 1 + +e.tapPercent / 100; br.ratedMVA = +e.ratedMVA;
      if (o.electrical?.ratedMVA == null || o.electrical?.impedancePercent == null)
        warn(br.itemId, "transformador com dados padrão (" + e.ratedMVA + " MVA; Z " + e.impedancePercent + "%)");
      if (o.electrical?.transformerXR == null) warn(br.itemId, "X/R do transformador assumido = " + e.transformerXR);
    }
    br.kv = buses[br.from].kv;
    delete br.edge;
  }
  const idealLines = new Set(edges.filter((e) => items[e.id]?.type === "line" &&
    e.known && !e.hasImpedance && e.modelDefault).map((e) => e.id));
  for (const id of idealLines) warn(id, "conexão ideal; R/X não cadastrados");
  const sourceData = [];
  for (const [id, ps] of ports) {
    const o = items[id], e = electricalData(o), b = buses[at(ps[0])];
    const scale = finite(o.runtimeScale) ? +o.runtimeScale : 1;
    if (o.type === "load" && o.state === "active") {
      if (!finite(e.activePowerMW) || +e.activePowerMW < 0 || !positive(e.powerFactor) || +e.powerFactor > 1 || scale < 0) {
        error(id, "potência ou fator de potência inválido"); continue;
      }
      const p = +e.activePowerMW * scale;
      const q = p * Math.tan(Math.acos(+e.powerFactor)) *
        (e.loadNature === "capacitive" ? -1 : e.loadNature === "resistive" ? 0 : 1);
      b.p -= p / baseMVA; b.q -= q / baseMVA;
      if (o.electrical?.activePowerMW == null) warn(id, "carga com potência padrão " + p + " MW");
    }
    if (o.type === "capacitor") {
      const count = +e.capacitorStages, stages = o.activeStages ?? count;
      if (!positive(count) || !finite(e.capacitorMvar) || +e.capacitorMvar < 0 || !finite(stages)) {
        error(id, "potência ou estágios inválidos"); continue;
      }
      b.q += +e.capacitorMvar * Math.max(0, Math.min(count, +stages)) / count / baseMVA;
    }
    if (!sources.includes(id)) continue;
    sourceData.push({ id, name: name(id), bus: b.id, type: o.type, data: e, raw: o.electrical || {} });
    if (o.type === "turbogenerator") {
      const p = o.controlMode === "manual" ? o.manualGenerationMW : +e.generationMW * scale;
      if (!finite(p) || !finite(e.generationMvar)) error(id, "geração P/Q inválida");
      else { b.p += +p / baseMVA; b.q += +e.generationMvar / baseMVA; }
    } else {
      if (!positive(e.voltageSetpointPU)) error(id, "referência de tensão inválida");
      else {
        if (b.type === "Slack" && Math.abs(b.v - +e.voltageSetpointPU) > 1e-8)
          error(id, "fontes ideais com referências de tensão diferentes no mesmo nó");
        b.type = "Slack"; b.v = +e.voltageSetpointPU;
      }
    }
  }
  const adjacent = buses.map(() => []);
  for (const br of branches) { adjacent[br.from].push(br.to); adjacent[br.to].push(br.from); }
  const seen = new Set(), islands = [];
  for (const seed of buses) {
    if (seen.has(seed.id)) continue;
    const ids = [seed.id]; seen.add(seed.id);
    for (let i = 0; i < ids.length; i++) for (const next of adjacent[ids[i]])
      if (!seen.has(next)) { seen.add(next); ids.push(next); }
    const sourceIds = sourceData.filter((s) => ids.includes(s.bus)).map((s) => s.id);
    if (sourceIds.length && !ids.some((i) => buses[i].type === "Slack")) {
      const first = sourceData.find((s) => sourceIds.includes(s.id));
      buses[first.bus].type = "Slack";
      buses[first.bus].v = positive(first.data.voltageSetpointPU) ? +first.data.voltageSetpointPU : 1;
      buses[first.bus].warnings.push(first.name + ": gerador usado como referência de tensão e balanço P/Q");
    }
    islands.push({ ids, sourceIds,
      errors: [...new Set([...unlocatedErrors, ...ids.flatMap((i) => buses[i].errors)])],
      warnings: [...new Set(ids.flatMap((i) => buses[i].warnings))] });
  }
  return { baseMVA: +baseMVA, buses, branches, busOfItem, nodesOfItem, sourceData, islands, items };
}
