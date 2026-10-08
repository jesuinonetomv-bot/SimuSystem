// Balanced, positive-sequence training model. Connectivity comes from the
// switching graph, so an open contact and a connector mean the same in all modes.
import { createSwitchingStudy } from "./switching-analysis.js?v=49.2";
import { equipmentDefaults, cableEquivalent } from "./equipment-library.js?v=49.2";

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
  const data = { ...common, ...equipmentDefaults(o.type), ...defaults[o.type], ...o.electrical };
  return o.type === "cable" ? { ...data, ...cableEquivalent(data) } : data;
}

export function buildStudyNetwork(diagram, options = {}) {
  const shortCircuit = options.studyKind === "shortCircuit";
  const baseMVA = options.baseMVA ?? 100;
  if (!positive(baseMVA)) throw Error("A potência-base deve ser maior que zero.");
  const electricalData = options.electricalData || studyElectricalData;
  const graph = createSwitchingStudy(diagram, { ...options, electricalData }).network();
  const { items, ports, points, edges, sources } = graph;
  const typeNames = { bus: "Barra", line: "Linha", breaker: "Disjuntor", disconnector: "Seccionadora",
    transformer: "Transformador", utility: "Rede", turbogenerator: "Gerador", load: "Carga", capacitor: "Capacitor" };
  const counters = {}, labels = new Map();
  for (const [id, o] of Object.entries(items)) {
    counters[o.type] = (counters[o.type] || 0) + 1;
    labels.set(id, o.name || diagram.conductorGroups?.[o.conductorGroupId]?.name ||
      (typeNames[o.type] || "Equipamento") + " " + counters[o.type]);
  }
  const name = (id) => labels.get(id) || "Equipamento sem referência";
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
    errors: [], warnings: [], loadMW: 0, loadMvar: 0, capacitorMvar: 0 }));
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
        if (!named.has(index)) { b.name = name(id); named.add(index); }
      }
    }
  }
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
    if (from === to || !o || !["transformer", "line", "cable"].includes(o.type)) continue;
    branches.push({ from, to, itemId: edge.id, name: name(edge.id), type: o.type, edge });
  }
  // A line keeps the voltage base; a transformer has independent winding bases.
  for (let pass = 0; pass < buses.length; pass++) {
    let changed = false;
    for (const br of branches) if (["line", "cable"].includes(br.type)) {
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
    if (!edge.known) { error(br.itemId, "impedância inválida ou não cadastrada"); continue; }
    if (["line", "cable"].includes(br.type)) {
      if (Math.abs(buses[br.from].kv - buses[br.to].kv) > 1e-5 * buses[br.from].kv)
        error(br.itemId, "linha entre bases de tensão diferentes");
      const zbase = buses[br.from].kv ** 2 / baseMVA;
      br.r = edge.resistanceOhm / zbase; br.x = edge.reactanceOhm / zbase;
      br.ampacityA = br.type === "cable" ? cableEquivalent({ ...equipmentDefaults("cable"), ...o.electrical }).ampacityA : o.electrical?.ampacityA;
    } else {
      if (!positive(e.ratedMVA) || !positive(e.impedancePercent) || !positive(e.transformerXR) ||
          (!shortCircuit && (!finite(e.tapPercent) || 1 + +e.tapPercent / 100 <= 0))) {
        error(br.itemId, "MVA, Z%, X/R ou tap inválido"); continue;
      }
      const z = +e.impedancePercent / 100 * baseMVA / +e.ratedMVA, xr = +e.transformerXR;
      br.r = z / Math.hypot(1, xr); br.x = br.r * xr;
      br.tap = shortCircuit ? 1 : 1 + +e.tapPercent / 100; br.ratedMVA = +e.ratedMVA;
      if (o.electrical?.ratedMVA == null || o.electrical?.impedancePercent == null)
        warn(br.itemId, "transformador com dados padrão (" + e.ratedMVA + " MVA; Z " + e.impedancePercent + "%)");
      if (o.electrical?.transformerXR == null) warn(br.itemId, "X/R do transformador assumido = " + e.transformerXR);
    }
    br.kv = buses[br.from].kv;
    delete br.edge;
  }
  const idealLines = new Set(edges.filter((e) => items[e.id]?.type === "line" &&
    e.known && !e.hasImpedance && e.modelDefault).map((e) => e.id));
  const sourceData = [];
  for (const [id, ps] of ports) {
    const o = items[id], e = electricalData(o), b = buses[at(ps[0])];
    const scale = finite(o.runtimeScale) ? +o.runtimeScale : 1;
    if (!shortCircuit && ["load", "motor"].includes(o.type) && o.state === "active") {
      if (!finite(e.activePowerMW) || +e.activePowerMW < 0 || !positive(e.powerFactor) || +e.powerFactor > 1 || scale < 0) {
        error(id, "potência ou fator de potência inválido"); continue;
      }
      const p = +e.activePowerMW * scale;
      const q = p * Math.tan(Math.acos(+e.powerFactor)) *
        (e.loadNature === "capacitive" ? -1 : e.loadNature === "resistive" ? 0 : 1);
      b.p -= p / baseMVA; b.q -= q / baseMVA;
      b.loadMW += p; b.loadMvar += q;
      if (o.electrical?.activePowerMW == null) warn(id, "carga com potência padrão " + p + " MW");
    }
    if (!shortCircuit && o.type === "capacitor") {
      const count = +e.capacitorStages, stages = o.activeStages ?? count;
      if (!positive(count) || !finite(e.capacitorMvar) || +e.capacitorMvar < 0 || !finite(stages)) {
        error(id, "potência ou estágios inválidos"); continue;
      }
      const q = +e.capacitorMvar * Math.max(0, Math.min(count, +stages)) / count;
      b.q += q / baseMVA; b.capacitorMvar += q;
    }
    if (!sources.includes(id)) continue;
    const source = { id, name: name(id), bus: b.id, type: o.type, data: e, raw: o.electrical || {} };
    sourceData.push(source);
    if (shortCircuit) { source.mode = "shortCircuit"; continue; }
    if (o.type === "turbogenerator") {
      const p = o.controlMode === "manual" ? o.manualGenerationMW : +e.generationMW * scale;
      if (!finite(p) || !finite(e.generationMvar)) error(id, "geração P/Q inválida");
      else { b.p += +p / baseMVA; b.q += +e.generationMvar / baseMVA; }
      source.scheduledMW = +p; source.scheduledMvar = +e.generationMvar;
      source.mode = options.generatorControls === false ? "auto" : e.studyGeneratorMode || "auto";
      if (!["auto", "pq", "pv", "slack"].includes(source.mode)) error(id, "modo do gerador inválido");
      if (options.generatorControls !== false && ((e.studyQMinMvar != null) !== (e.studyQMaxMvar != null) ||
          (e.studyQMinMvar != null && (!finite(e.studyQMinMvar) || !finite(e.studyQMaxMvar) || +e.studyQMinMvar > +e.studyQMaxMvar))))
        error(id, "limites de potência reativa inválidos");
      if (["pv", "slack"].includes(source.mode)) {
        if (!positive(e.voltageSetpointPU)) error(id, "referência de tensão inválida");
        else {
          if (b.regulatingSourceId || b.referenceSourceId) error(id, "duas fontes regulam tensão no mesmo nó; use P/Q fixos para uma delas");
          b.type = source.mode === "pv" ? "PV" : "Slack"; b.v = +e.voltageSetpointPU;
          if (source.mode === "pv") b.regulatingSourceId = id;
          else b.referenceSourceId = id;
        }
      }
    } else {
      if (!positive(e.voltageSetpointPU)) error(id, "referência de tensão inválida");
      else {
        if (b.type === "Slack" && Math.abs(b.v - +e.voltageSetpointPU) > 1e-8)
          error(id, "fontes ideais com referências de tensão diferentes no mesmo nó");
        if (b.regulatingSourceId || (b.referenceSourceId && items[b.referenceSourceId]?.type === "turbogenerator"))
          error(id, "duas fontes regulam tensão no mesmo nó; use P/Q fixos no gerador");
        b.type = "Slack"; b.v = +e.voltageSetpointPU; b.referenceSourceId ||= id;
      }
      source.mode = "slack";
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
    const islandSources = sourceData.filter(s => sourceIds.includes(s.id));
    const explicitReferences = islandSources.filter(s => s.type === "turbogenerator" && s.mode === "slack");
    if (explicitReferences.length > 1 || (explicitReferences.length && islandSources.some(s => s.type !== "turbogenerator")))
      for (const s of explicitReferences) error(s.id, "use apenas uma referência por ilha; com a rede em operação, selecione Auto, PV ou PQ");
    if (!shortCircuit && sourceIds.length && !ids.some((i) => buses[i].type === "Slack")) {
      const first = islandSources.find(s => s.mode === "auto");
      if (!first) for (const s of islandSources) error(s.id, "ilha sem referência de tensão; selecione Auto ou Referência em um gerador");
      else {
        if (buses[first.bus].regulatingSourceId) error(first.id, "duas fontes regulam tensão no mesmo nó; use PQ em uma delas");
        buses[first.bus].type = "Slack"; buses[first.bus].referenceSourceId = first.id;
        buses[first.bus].v = positive(first.data.voltageSetpointPU) ? +first.data.voltageSetpointPU : 1;
        buses[first.bus].warnings.push(first.name + ": gerador usado como referência de tensão e balanço P/Q");
      }
    }
    for (const index of ids) {
      const b = buses[index], s = sourceData.find(source => source.id === b.regulatingSourceId);
      if (s?.data.studyQMinMvar != null) {
        const otherQ = b.q - s.scheduledMvar / baseMVA;
        b.qMinPV = otherQ + +s.data.studyQMinMvar / baseMVA;
        b.qMaxPV = otherQ + +s.data.studyQMaxMvar / baseMVA;
      }
      if (s && s.data.studyQMinMvar == null) b.warnings.push(s.name + ": controle PV sem limites de Q cadastrados");
    }
    const idealCount = [...idealLines].filter(id => (nodesOfItem.get(id) || []).some(i => ids.includes(i))).length;
    islands.push({ ids, sourceIds,
      errors: [...new Set([...unlocatedErrors, ...ids.flatMap((i) => buses[i].errors)])],
      warnings: [...new Set([...ids.flatMap((i) => buses[i].warnings),
        ...(idealCount ? [idealCount + " conexões ideais; R/X não cadastrados"] : [])])] });
  }
  return { baseMVA: +baseMVA, buses, branches, busOfItem, nodesOfItem, sourceData, islands, items,
    graph, pointBus: new Map([...points.keys()].map(key => [key, at(key)])) };
}
