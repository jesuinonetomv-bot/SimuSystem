import { buildStudyNetwork } from "./study-network.js?v=49";
import { sourceImpedance } from "./short-circuit.js?v=49";

// Sequence networks are contracted independently: a zero Z1 never erases Z0.
export const C = (re = 0, im = 0) => ({ re, im });
export const add = (a, b) => C(a.re + b.re, a.im + b.im);
export const sub = (a, b) => C(a.re - b.re, a.im - b.im);
export const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a, n) => C(a.re * n, a.im * n);
export const magnitude = z => Math.hypot(z.re, z.im);
const conj = z => C(z.re, -z.im);
const polar = (r, degrees) => C(r * Math.cos(degrees * Math.PI / 180), r * Math.sin(degrees * Math.PI / 180));
const div = (a, b) => {
  const d = b.re ** 2 + b.im ** 2;
  if (!(d > 1e-28) || !Number.isFinite(d)) throw Error("Rede de sequência singular ou impedância inválida.");
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
function solve(matrix, vector) {
  const n = matrix.length, m = matrix.map((row, i) => [...row.map(z => C(z.re, z.im)), C(vector[i].re, vector[i].im)]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (magnitude(m[i][k]) > magnitude(m[pivot][k])) pivot = i;
    [m[k], m[pivot]] = [m[pivot], m[k]];
    const d = m[k][k];
    for (let j = k; j <= n; j++) m[k][j] = div(m[k][j], d);
    for (let i = k + 1; i < n; i++) {
      const f = m[i][k];
      for (let j = k; j <= n; j++) m[i][j] = sub(m[i][j], mul(f, m[k][j]));
    }
  }
  const out = Array.from({ length: n }, () => C());
  for (let i = n - 1; i >= 0; i--) {
    out[i] = m[i][n];
    for (let j = i + 1; j < n; j++) out[i] = sub(out[i], mul(m[i][j], out[j]));
    if (!Number.isFinite(out[i].re) || !Number.isFinite(out[i].im)) throw Error("Resultado não finito na rede de sequência.");
  }
  return out;
}
const present = v => (typeof v === "number" || typeof v === "string") && String(v).trim() !== "" && Number.isFinite(+v);
function num(v, label, min = 0, max = 1e9) {
  if (!present(v) || +v < min || +v > max) throw Error(label + ": informe um valor entre " + min + " e " + max + ".");
  return +v;
}
const unsafe = id => ["__proto__", "constructor", "prototype"].includes(id);
export const FAULT_TYPES = { "3P": "Trifásico · A-B-C", LL: "Entre duas fases", LG: "Fase-terra" };
export const DEFAULT_SEQUENCE_CASE = { version: 1, kind: "faultSequence", name: "Curto e sequência de atuação", faultType: "LL", phases: "BC",
  location: { itemId: "", fraction: .5, port: 0 }, baseMVA: 100, voltageFactor: 1, faultRohm: 0, faultXohm: 0, maxSeconds: 60 };
export function normalizeSequenceCase(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(unsafe) ||
      (input.version != null && input.version !== 1) || (input.kind != null && input.kind !== "faultSequence")) throw Error("Caso de sequência de atuação inválido.");
  const c = { ...structuredClone(DEFAULT_SEQUENCE_CASE), ...input };
  c.name = String(c.name).trim().slice(0, 100); if (!c.name) throw Error("Informe o nome do caso.");
  if (!Object.hasOwn(FAULT_TYPES, c.faultType)) throw Error("Tipo de falta inválido.");
  if (!(c.faultType === "LL" ? ["AB", "BC", "CA"] : c.faultType === "LG" ? ["A", "B", "C"] : ["ABC"]).includes(c.phases)) throw Error("Fases da falta inválidas.");
  if (!c.location || typeof c.location !== "object" || Array.isArray(c.location)) throw Error("Ponto de falta inválido.");
  const id = c.location.itemId;
  if (typeof id !== "string" || !id || id.length > 250 || unsafe(id)) throw Error("Selecione o ponto da falta.");
  c.location = { itemId: id, fraction: num(c.location.fraction ?? .5, "Posição no trecho", 0, 1), port: num(c.location.port ?? 0, "Terminal", 0, 1) };
  if (!Number.isInteger(c.location.port)) throw Error("Terminal inválido.");
  for (const [key, label, min, max] of [["baseMVA", "Potência-base (MVA)", .001, 1e6], ["voltageFactor", "Tensão pré-falta (pu)", .5, 1.5],
    ["faultRohm", "R da falta (Ω)", 0, 1e6], ["faultXohm", "X da falta (Ω)", 0, 1e6], ["maxSeconds", "Duração máxima (s)", .001, 120]]) c[key] = num(c[key], label, min, max);
  return { version: 1, kind: "faultSequence", name: c.name, faultType: c.faultType, phases: c.phases, location: c.location,
    baseMVA: c.baseMVA, voltageFactor: c.voltageFactor, faultRohm: c.faultRohm, faultXohm: c.faultXohm, maxSeconds: c.maxSeconds };
}
const phaseVector = ([i0, i1, i2]) => {
  const a = polar(1, 120), a2 = polar(1, -120);
  return [add(add(i0, i1), i2), add(add(i0, mul(a2, i1)), mul(a, i2)), add(add(i0, mul(a, i1)), mul(a2, i2))];
};
function reach(seed, links) {
  const adj = new Map();
  for (const { a, b } of links) if (b != null) { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); }
  const seen = new Set([seed]), q = [seed];
  for (let i = 0; i < q.length; i++) for (const b of adj.get(q[i]) || []) if (!seen.has(b)) { seen.add(b); q.push(b); }
  return seen;
}

export function calculatePointFault(diagram, input = {}, options = {}) {
  const config = normalizeSequenceCase(input), target = diagram.items?.[config.location.itemId];
  const branchPoint = ["line", "bus", "cable"].includes(target?.type);
  if (!target || !["line", "bus", "cable", "breaker", "disconnector", "fuse", "transformer", "utility", "turbogenerator", "load", "motor", "capacitor"].includes(target.type)) throw Error("Ponto de falta removido ou sem terminal de potência.");
  const point = { ...config.location, ...(branchPoint ? {} : { fraction: undefined }) };
  const network = buildStudyNetwork(diagram, { ...options, baseMVA: config.baseMVA, studyKind: "shortCircuit", generatorControls: false, studyFaultPoint: point });
  const graph = network.graph, faultKey = graph.faultKey;
  if (!faultKey) throw Error("O ponto escolhido não tem terminal válido.");
  if (branchPoint && !graph.edges.some(e => e.a === faultKey || e.b === faultKey)) throw Error("O ponto está em uma interrupção do desenho. Selecione um trecho conectado ou o terminal do equipamento.");
  const component = reach(faultKey, graph.edges), edges = graph.edges.filter(e => component.has(e.a) && component.has(e.b));
  const sources = network.sourceData.filter(s => component.has(graph.ports.get(s.id)?.[0]));
  const kvAt = key => network.buses[network.pointBus.get(key)].kv;
  const kv = kvAt(faultKey), ibase = config.baseMVA / (Math.sqrt(3) * kv) * 1000;
  const warnings = [], errors = [];
  for (const issue of graph.issues) if (graph.ports.get(issue.id)?.some(key => component.has(key))) errors.push((diagram.items[issue.id]?.name || issue.id) + ": " + issue.message);
  const busIndices = new Set([...component].map(key => network.pointBus.get(key)));
  for (const index of busIndices) { errors.push(...network.buses[index].errors); warnings.push(...network.buses[index].warnings); }
  if (sources.length && errors.length) throw Error([...new Set(errors)].join(" "));
  const name = id => diagram.items[id]?.name || id;
  const data = id => diagram.items[id]?.electrical || {};
  const zeroPair = (e, r, x, label, factor = 1) => {
    const z = C(num(e[r], label + " · R₀"), num(e[x], label + " · X₀")); return scale(z, factor);
  };
  const sourceZ = new Map(), transformerZ = new Map();
  // Data upstream of a delta barrier is irrelevant to the zero-sequence fault
  // zone. Unknown connections at its boundary are still rejected below.
  const zeroReach = reach(faultKey, edges.filter(edge => {
    if (diagram.items[edge.id]?.type !== "transformer") return true;
    const e = data(edge.id); return e.primaryConnection === "Yg" && e.secondaryConnection === "Yg";
  }));
  if (sources.length) for (const source of sources) {
    const e = source.raw, z = sourceImpedance(source, network, { standard: "nominal" }).z, zbase = kvAt(graph.ports.get(source.id)[0]) ** 2 / config.baseMVA;
    let z2 = null, z0 = null;
    if (config.faultType !== "3P") {
      if (e.negativeSequenceModel === "same") { z2 = z; warnings.push(source.name + ": hipótese declarada Z₂ = Z₁."); }
      else if (e.negativeSequenceModel === "custom") z2 = scale(C(num(e.negativeResistanceOhm, source.name + " · R₂"), num(e.negativeReactanceOhm, source.name + " · X₂")), 1 / zbase);
      else throw Error(source.name + ": declare Z₂ = Z₁ ou informe R₂ e X₂ da fonte.");
      if (!(magnitude(z2) > 0)) throw Error(source.name + ": Z₂ da fonte deve ser diferente de zero.");
    }
    if (config.faultType === "LG" && zeroReach.has(graph.ports.get(source.id)[0])) {
      if (e.sourceGrounding === "grounded") {
        z0 = add(zeroPair(e, "zeroResistanceOhm", "zeroReactanceOhm", source.name, 1 / zbase),
          scale(C(num(e.neutralResistanceOhm ?? 0, source.name + " · R neutro"), num(e.neutralReactanceOhm ?? 0, source.name + " · X neutro")), 3 / zbase));
        if (!(magnitude(z0) > 0)) throw Error(source.name + ": Z₀ + 3Zn da fonte deve ser diferente de zero.");
      } else if (e.sourceGrounding !== "isolated") throw Error(source.name + ": informe Z₀ e o retorno de terra da fonte, ou declare o neutro isolado.");
    }
    sourceZ.set(source.id, [z0, z, z2]);
  }
  if (sources.length) for (const edge of edges) if (diagram.items[edge.id]?.type === "transformer" && !transformerZ.has(edge.id)) {
    const e = data(edge.id), label = name(edge.id);
    for (const k of ["primaryKV", "secondaryKV", "ratedMVA", "impedancePercent", "transformerXR"]) num(e[k], label + " · " + k, .000001);
    const clock = num(e.vectorClock, label + " · grupo horário", 0, 11); if (!Number.isInteger(clock)) throw Error(label + ": grupo horário deve ser inteiro.");
    const zabs = +e.impedancePercent / 100 * config.baseMVA / +e.ratedMVA, xr = +e.transformerXR, z1 = C(zabs / Math.hypot(1, xr), zabs * xr / Math.hypot(1, xr));
    let zero = [];
    if (config.faultType === "LG" && (zeroReach.has(edge.a) || zeroReach.has(edge.b))) {
      const p = e.primaryConnection, s = e.secondaryConnection;
      if (!["D", "Y", "Yg"].includes(p) || !["D", "Y", "Yg"].includes(s)) throw Error(label + ": informe a ligação primária e secundária para fase-terra.");
      if ((p === "D") !== (s === "D") ? clock % 2 !== 1 : clock % 2 !== 0) throw Error(label + ": grupo horário incompatível com as ligações D/Y informadas.");
      if ((p === "Yg" && s === "Y") || (p === "Y" && s === "Yg")) throw Error(label + ": Y/Yg exige a impedância de magnetização de sequência zero; este equivalente não está disponível.");
      if (p === "Yg" || s === "Yg") {
        const zp = num(e.zeroImpedancePercent, label + " · Z₀ (%)", .000001) / 100 * config.baseMVA / +e.ratedMVA,
          x0r = num(e.zeroTransformerXR, label + " · X/R de Z₀", .000001), z0 = C(zp / Math.hypot(1, x0r), zp * x0r / Math.hypot(1, x0r));
        const neutral = (prefix, key) => scale(C(num(e[prefix + "NeutralResistanceOhm"] ?? 0, label + " · R neutro " + prefix),
          num(e[prefix + "NeutralReactanceOhm"] ?? 0, label + " · X neutro " + prefix)), 3 * config.baseMVA / kvAt(key) ** 2);
        if (p === "Yg" && s === "Yg") zero = [{ a: edge.a, b: edge.b, z: add(add(z0, neutral("primary", edge.a)), neutral("secondary", edge.b)), tap: C(clock % 4 === 0 ? 1 : -1) }];
        else if (p === "Yg") zero = [{ a: edge.a, b: null, z: add(z0, neutral("primary", edge.a)), tap: C(1) }];
        else zero = [{ a: edge.b, b: null, z: add(z0, neutral("secondary", edge.b)), tap: C(1) }];
      }
    }
    transformerZ.set(edge.id, { z1, clock, zero });
  }

  function sequence(seq) {
    const records = [], shunts = [], ideal = [];
    for (const [index, edge] of edges.entries()) {
      const o = diagram.items[edge.id], e = data(edge.id);
      if (seq === 0 && !zeroReach.has(edge.a) && !zeroReach.has(edge.b)) continue;
      if (o?.type === "transformer") {
        const tf = transformerZ.get(edge.id);
        if (seq === 0) for (const record of tf.zero) (record.b == null ? shunts : records).push({ ...record, index, itemId: edge.id, source: false, emf: C() });
        else records.push({ a: edge.a, b: edge.b, index, itemId: edge.id, z: tf.z1, tap: polar(1, tf.clock * 30 * (seq === 1 ? 1 : -1)) });
        continue;
      }
      let z = C();
      if (["line", "cable"].includes(o?.type)) {
        if (!edge.known) throw Error(name(edge.id) + ": impedância do trecho pendente.");
        if (seq !== 0) z = C(edge.resistanceOhm, edge.reactanceOhm);
        else {
          const ps = graph.ports.get(edge.id), a = graph.points.get(ps[0]), b = graph.points.get(ps[1]), pa = graph.points.get(edge.a), pb = graph.points.get(edge.b);
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const fraction = length ? Math.hypot(pb.x - pa.x, pb.y - pa.y) / length : 1;
          if (o.type === "cable") z = zeroPair(e, "zeroResistanceOhmPerKm", "zeroReactanceOhmPerKm", name(edge.id), fraction * num(e.lengthM, name(edge.id) + " · comprimento", .001) / 1000 / num(e.parallelRuns ?? 1, name(edge.id) + " · circuitos", 1));
          else if (present(e.zeroResistanceOhm) && present(e.zeroReactanceOhm)) z = zeroPair(e, "zeroResistanceOhm", "zeroReactanceOhm", name(edge.id), fraction);
          else if (+edge.resistanceOhm !== 0 || +edge.reactanceOhm !== 0 || e.zeroResistanceOhm != null || e.zeroReactanceOhm != null) throw Error(name(edge.id) + ": cadastre R₀ e X₀ do trecho para fase-terra.");
        }
        z = scale(z, config.baseMVA / kvAt(edge.a) ** 2);
      }
      if (magnitude(z) === 0) ideal.push({ ...edge, index });
      else records.push({ a: edge.a, b: edge.b, index, itemId: edge.id, z, tap: C(1) });
    }
    for (const source of sources) {
      const z = sourceZ.get(source.id)[seq]; if (!z) continue;
      shunts.push({ a: graph.ports.get(source.id)[0], b: null, z, tap: C(1), itemId: source.id, source: true,
        emf: seq === 1 ? polar(config.voltageFactor, num(source.raw.sourcePhaseDeg ?? 0, source.name + " · ângulo", -360, 360)) : C() });
    }
    const parent = new Map([...component].map(key => [key, key]));
    const root = key => { if (parent.get(key) !== key) parent.set(key, root(parent.get(key))); return parent.get(key); };
    for (const edge of ideal) parent.set(root(edge.b), root(edge.a));
    const rFault = root(faultKey), reduced = records.map(e => ({ a: root(e.a), b: root(e.b) })), connected = reach(rFault, reduced);
    const grounded = shunts.filter(s => connected.has(root(s.a)));
    if (!grounded.length) return { available: false, seq, records, shunts, ideal, root, column: new Map(), prefault: new Map(), z: null };
    const ids = [...connected], at = new Map(ids.map((id, i) => [id, i]));
    if (ids.length > 500) throw Error("A ilha contém mais de 500 nós de sequência. Divida o estudo em sistemas menores.");
    const Y = ids.map(() => ids.map(() => C())), J = ids.map(() => C());
    for (const e of records) {
      const i = at.get(root(e.a)), j = at.get(root(e.b)); if (i == null || j == null) continue;
      const y = div(C(1), e.z), t = e.tap;
      Y[i][i] = add(Y[i][i], scale(y, 1 / magnitude(t) ** 2)); Y[j][j] = add(Y[j][j], y);
      Y[i][j] = sub(Y[i][j], div(y, conj(t))); Y[j][i] = sub(Y[j][i], div(y, t));
    }
    for (const e of grounded) { const i = at.get(root(e.a)), y = div(C(1), e.z); Y[i][i] = add(Y[i][i], y); J[i] = add(J[i], mul(y, e.emf)); }
    const unit = ids.map(id => C(id === rFault ? 1 : 0)), columnValues = solve(Y, unit), prefaultValues = seq === 1 ? solve(Y, J) : ids.map(() => C());
    return { available: true, seq, records, shunts, ideal, root, z: columnValues[at.get(rFault)],
      column: new Map(ids.map((id, i) => [id, columnValues[i]])), prefault: new Map(ids.map((id, i) => [id, prefaultValues[i]])) };
  }

  const networks = [], currents = [C(), C(), C()];
  let status = sources.length ? "calculated" : "dead", noReturn = false, prefault = C();
  if (sources.length) {
    networks[1] = sequence(1); prefault = networks[1].prefault.get(networks[1].root(faultKey));
    const zf = scale(C(config.faultRohm, config.faultXohm), config.baseMVA / kv ** 2);
    if (config.faultType === "3P") currents[1] = div(prefault, add(networks[1].z, zf));
    else {
      networks[2] = sequence(2);
      if (config.faultType === "LL") {
        currents[1] = div(prefault, add(add(networks[1].z, networks[2].z), zf));
        currents[2] = mul(currents[1], polar(-1, { BC: 0, AB: -120, CA: 120 }[config.phases]));
      } else {
        networks[0] = sequence(0); noReturn = !networks[0].available;
        if (!noReturn) {
          currents[1] = div(prefault, add(add(add(networks[1].z, networks[2].z), networks[0].z), scale(zf, 3)));
          const phase = { A: 0, B: -120, C: 120 }[config.phases];
          currents[0] = mul(currents[1], polar(1, phase)); currents[2] = mul(currents[1], polar(1, -phase));
        }
      }
    }
    if (noReturn) { status = "noReturn"; warnings.push("Sem retorno condutivo de sequência zero no ponto. Capacitâncias à terra não modeladas; o ponto pode continuar energizado."); }
  }

  function recover(nw, current) {
    const byEdge = new Map(), sourceCurrents = new Map(), external = new Map([...component].map(key => [key, C()]));
    const accumulate = (key, value) => external.set(key, add(external.get(key), value));
    const voltage = key => sub(nw?.prefault.get(nw.root(key)) || C(), mul(nw?.column.get(nw.root(key)) || C(), current));
    if (!nw) return { at: () => C(), sourceCurrents };
    for (const e of nw.records) {
      const ito = div(sub(div(voltage(e.a), e.tap), voltage(e.b)), e.z), from = div(ito, conj(e.tap)), to = scale(ito, -1);
      accumulate(e.a, from); accumulate(e.b, to); byEdge.set(e.index, new Map([[e.a, from], [e.b, to]]));
    }
    for (const e of nw.shunts) {
      const out = div(sub(voltage(e.a), e.emf), e.z); accumulate(e.a, out);
      if (e.source) sourceCurrents.set(e.itemId, scale(out, -1));
      else byEdge.set(e.index, new Map([[e.a, out]]));
    }
    accumulate(faultKey, current);
    const adj = new Map();
    for (const e of nw.ideal) { if (!adj.has(e.a)) adj.set(e.a, []); if (!adj.has(e.b)) adj.set(e.b, []); adj.get(e.a).push({ to: e.b, index: e.index }); adj.get(e.b).push({ to: e.a, index: e.index }); }
    const cache = new Map();
    const at = (edgeIndex, key) => {
      if (byEdge.has(edgeIndex)) return byEdge.get(edgeIndex).get(key) || C();
      const e = edges[edgeIndex]; if (!nw.ideal.some(x => x.index === edgeIndex)) return C();
      if (!cache.has(edgeIndex)) {
        const seen = new Set([e.a]), q = [e.a];
        for (let i = 0; i < q.length; i++) for (const link of adj.get(q[i]) || []) if (link.index !== edgeIndex && !seen.has(link.to)) { seen.add(link.to); q.push(link.to); }
        if (seen.has(e.b)) cache.set(edgeIndex, null);
        else cache.set(edgeIndex, scale(q.reduce((sum, node) => add(sum, external.get(node)), C()), -1));
      }
      const value = cache.get(edgeIndex); return value == null ? null : key === e.a ? value : scale(value, -1);
    };
    return { at, sourceCurrents };
  }
  const recovered = currents.map((i, seq) => recover(networks[seq], i));
  function reading(itemId, port = 0) {
    const o = diagram.items[itemId], ps = graph.ports.get(itemId), key = ps?.[port] || ps?.[0];
    if (!key) return { phaseA: null, residualA: null, phaseError: "Terminal de medição inválido.", earthError: "Terminal de medição inválido." };
    if (!component.has(key) || status === "dead") return { phaseA: [0, 0, 0], residualA: 0, kv: kvAt(key), phaseError: "", earthError: "" };
    if (o.type === "bus") return { phaseA: null, residualA: null, kv: kvAt(key), phaseError: "Vincule o TC a um ramo ou disjuntor; um barramento tem múltiplas derivações.", earthError: "Vincule o sensor de terra a um ramo ou disjuntor." };
    const edgeIndices = edges.map((e, i) => e.id === itemId && (e.a === key || e.b === key) ? i : -1).filter(i => i >= 0);
    const seqCurrents = recovered.map(r => ["utility", "turbogenerator"].includes(o.type) ? r.sourceCurrents.get(itemId) || C() :
      edgeIndices.reduce((sum, i) => { const v = r.at(i, key); return sum == null || v == null ? null : add(sum, v); }, C()));
    const base = config.baseMVA / (Math.sqrt(3) * kvAt(key)) * 1000;
    const phaseError = seqCurrents.some(i => i == null) ? "Corrente indeterminada em caminhos ideais paralelos; cadastre as impedâncias dos ramos." : "";
    const earthError = seqCurrents[0] == null ? "Corrente residual indeterminada em caminhos ideais paralelos." : "";
    return { kv: kvAt(key), phaseA: phaseError ? null : phaseVector(seqCurrents).map(i => magnitude(i) * base),
      phasePhasors: phaseError ? null : phaseVector(seqCurrents).map(i => scale(i, base)), residualA: earthError ? null : 3 * magnitude(seqCurrents[0]) * base,
      phaseError, earthError };
  }
  const measurements = new Map();
  for (const id of graph.ports.keys()) measurements.set(id, [reading(id, 0), reading(id, 1)]);
  const phasePhasors = phaseVector(currents).map(i => scale(i, ibase)), phaseA = phasePhasors.map(magnitude);
  return { config, status, noReturn, kv, point: graph.points.get(faultKey), faultKey, phaseA, phasePhasors, currentA: Math.max(...phaseA),
    residualA: magnitude(currents[0]) * 3 * ibase, prefaultPU: magnitude(prefault), measurements, graph, warnings: [...new Set(warnings)],
    equivalent: { z1: networks[1]?.z || null, z2: networks[2]?.z || null, z0: networks[0]?.z || null, baseOhm: kv ** 2 / config.baseMVA } };
}

export const SEQUENCE_ASSUMPTIONS = "Modelo RMS de componentes simétricas com impedâncias constantes e fontes na tensão pré-falta informada. " +
  "Falta trifásica: só Z₁; entre fases: Z₁ + Z₂ + Zf; fase-terra: Z₁ + Z₂ + Z₀ + 3Zf. " +
  "Linhas/cabos equilibrados e transformadores usam Z₂ = Z₁; fontes exigem declaração ou dados de Z₂. Z₀ e neutros são explícitos; Zn entra como 3Zn. " +
  "Grupo horário aplicado com sinais opostos em sequência positiva/negativa; delta bloqueia corrente residual externa. Transformadores de dois enrolamentos D/Yg, Yg/D, Yg/Yg, D/D e enrolamentos isolados; sem magnetização de sequência zero. " +
  "Corrente passante de contatos ideais recuperada por Kirchhoff quando determinada pela rede; divisões em laços ideais ficam pendentes. " +
  "Sem contribuição de motores/inversores, capacitância à terra, decaimento de geradores, saturação de TC, arco, funções direcionais/diferenciais ou fusão automática. " +
  "Esta sequência não aplica correções normativas IEC/ANSI nem certifica capacidade de interrupção; usa as impedâncias nominais cadastradas.";
