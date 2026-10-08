import { buildStudyNetwork } from "./study-network.js?v=49";
import { prepareFaultCase, analyzeFaultAlerts } from "./short-circuit-cases.js?v=49";

const C = (re = 0, im = 0) => ({ re, im }), abs = z => Math.hypot(z.re, z.im);
const add = (a, b) => C(a.re + b.re, a.im + b.im), sub = (a, b) => C(a.re - b.re, a.im - b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => {
  const d = b.re ** 2 + b.im ** 2;
  if (!(d > 1e-28) || !Number.isFinite(d)) throw Error("Impedância ou matriz singular.");
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
function inverse(matrix) {
  const n = matrix.length, m = matrix.map((row, i) => [...row.map(z => C(z.re, z.im)),
    ...Array.from({ length: n }, (_, j) => C(i === j ? 1 : 0))]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (abs(m[i][k]) > abs(m[pivot][k])) pivot = i;
    [m[k], m[pivot]] = [m[pivot], m[k]];
    const diagonal = m[k][k];
    for (let j = 0; j < 2 * n; j++) m[k][j] = div(m[k][j], diagonal);
    for (let i = 0; i < n; i++) if (i !== k) {
      const factor = m[i][k];
      for (let j = 0; j < 2 * n; j++) m[i][j] = sub(m[i][j], mul(factor, m[k][j]));
    }
  }
  return m.map(row => row.slice(n));
}
const positive = v => v != null && v !== "" && Number.isFinite(+v) && +v > 0;
export function voltageFactor(kv, calculation, maximum = false) {
  if (calculation.standard === "nominal") return 1;
  if (calculation.standard !== "iec") return calculation.voltageFactor;
  if (!maximum && calculation.scenario === "custom") return calculation.voltageFactor;
  if (!maximum && calculation.scenario === "min") return kv <= 1 ? .95 : 1;
  return kv <= 1 && calculation.lvTolerance === 6 ? 1.05 : 1.1;
}
export function sourceImpedance(source, network, c) {
  const { raw: e, name } = source;
  const requireValue = (key, label) => { if (!positive(e[key])) throw Error(name + ": informe " + label + "."); return +e[key]; };
  const kv = requireValue("nominalKV", "a tensão nominal (kV)"), busKV = network.buses[source.bus].kv;
  let r, x, correction = 1;
  if (source.type === "utility") {
    const minimum = c.standard === "iec" && c.scenario === "min";
    const mva = requireValue(minimum ? "shortCircuitMVAMin" : "shortCircuitMVA", minimum ? "MVA de curto mínimo da rede" : "MVA de curto máximo da rede");
    const xr = requireValue(minimum ? "sourceXRMin" : "sourceXR", minimum ? "X/R da rede para o caso mínimo" : "X/R da fonte");
    // Grid fault MVA already describes the duty at its bus. Its equivalent
    // impedance contains c_grid; multiplying supplied fault MVA by c is wrong.
    const z = network.baseMVA / mva * (c.standard === "iec" ? voltageFactor(busKV, c) : 1);
    r = z / Math.hypot(1, xr); x = r * xr;
  } else if (source.type === "turbogenerator") {
    const ratedMVA = requireValue("generatorRatedMVA", "MVA nominal do gerador"), xr = requireValue("sourceXR", "X/R da fonte");
    const xd = requireValue("subtransientPercent", "X″d subtransitória (%)") / 100;
    const selectedX = c.standard === "ansi" && c.ansiStage === "30cycle" ? requireValue("transientPercent", "X′d transitória para a rede de 30 ciclos (%)") / 100 : xd;
    r = xd / xr * network.baseMVA / ratedMVA; x = selectedX * network.baseMVA / ratedMVA;
    if (c.standard === "iec" && c.corrections) {
      const pf = requireValue("generatorRatedPowerFactor", "fator de potência nominal para K_G");
      if (pf > 1) throw Error(name + ": FP nominal deve ser menor ou igual a 1.");
      correction = kv / busKV * voltageFactor(busKV, c, true) / (1 + xd * Math.sqrt(1 - pf ** 2));
      r *= correction; x *= correction;
    }
  } else throw Error(name + ": tipo de fonte não suportado neste estudo.");
  return { ...source, z: C(r, x), correction };
}
function drivingMatrix(ids, sources, branches, reactanceScale = 1) {
  const at = new Map(ids.map((id, i) => [id, i])), Y = ids.map(() => ids.map(() => C()));
  for (const source of sources) {
    const i = at.get(source.bus), y = div(C(1), C(source.z.re, source.z.im * reactanceScale));
    Y[i][i] = add(Y[i][i], y);
  }
  for (const br of branches) {
    const i = at.get(br.from), j = at.get(br.to), y = div(C(1), C(br.r, br.x * reactanceScale));
    Y[i][i] = add(Y[i][i], y); Y[j][j] = add(Y[j][j], y);
    Y[i][j] = sub(Y[i][j], y); Y[j][i] = sub(Y[j][i], y);
  }
  return inverse(Y);
}
// ANSI X/R uses independently reduced R and X networks. Zero-valued branches
// contract exactly; they never receive an arbitrary small impedance.
function separateEquivalent(ids, sources, branches, component) {
  const ground = "ground", parent = new Map([...ids, ground].map(id => [id, id]));
  const root = id => { if (parent.get(id) !== id) parent.set(id, root(parent.get(id))); return parent.get(id); };
  const links = [...branches.map(br => ({ from: br.from, to: br.to, value: component === "r" ? br.r : br.x })),
    ...sources.map(s => ({ from: s.bus, to: ground, value: component === "r" ? s.z.re : s.z.im }))];
  for (const l of links) if (l.value === 0) parent.set(root(l.from), root(l.to));
  const earth = root(ground), roots = [...new Set(ids.map(root))].filter(id => id !== earth);
  const at = new Map(roots.map((id, i) => [id, i])), Y = roots.map(() => roots.map(() => C()));
  for (const l of links) {
    const a = root(l.from), b = root(l.to); if (a === b) continue;
    const i = at.get(a), j = at.get(b), y = 1 / l.value;
    if (i != null) Y[i][i].re += y; if (j != null) Y[j][j].re += y;
    if (i != null && j != null) { Y[i][j].re -= y; Y[j][i].re -= y; }
  }
  const Z = roots.length ? inverse(Y) : [];
  return new Map(ids.map(id => [id, root(id) === earth ? 0 : Z[at.get(root(id))][at.get(root(id))].re]));
}
// Worst point-on-wave envelope for a constant AC current in an equivalent R-L
// circuit. These estimates are not ANSI MFi/NACD or a complete IEC duty model.
export function rlEstimates(currentKA, xr, frequencyHz, cycles, duration) {
  const tau = xr / (2 * Math.PI * frequencyHz), time = cycles / frequencyHz;
  const decay = tau > 0 ? Math.exp(-time / tau) : 0;
  const omega = 2 * Math.PI * frequencyHz;
  const envelope = t => {
    const d = tau > 0 ? Math.exp(-t / tau) : 0;
    return Math.sqrt(2) * currentKA * Math.sqrt(Math.max(0, 1 + d * d - 2 * d * Math.cos(omega * t)));
  };
  let best = 0, bestIndex = 0;
  for (let i = 0; i <= 64; i++) { const value = envelope(i / (64 * frequencyHz)); if (value > best) { best = value; bestIndex = i; } }
  let lo = Math.max(0, bestIndex - 1) / (64 * frequencyHz), hi = Math.min(64, bestIndex + 1) / (64 * frequencyHz);
  for (let i = 0; i < 36; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (envelope(a) > envelope(b)) hi = b; else lo = a; }
  const thermalFactor = tau > 0 ? tau / duration * -Math.expm1(-2 * duration / tau) : 0;
  return { peakKA: Math.max(best, envelope((lo + hi) / 2)), dcKA: Math.sqrt(2) * currentKA * decay,
    asymmetricalKA: currentKA * Math.sqrt(1 + 2 * decay ** 2), thermalKA: currentKA * Math.sqrt(1 + thermalFactor), tauSeconds: tau };
}
export function runShortCircuitCase(diagram, input = {}, options = {}) {
  const { config, model, warnings } = prepareFaultCase(diagram, input), c = config.calculation;
  const network = buildStudyNetwork(model, { ...options, baseMVA: c.baseMVA, studyKind: "shortCircuit", generatorControls: false });
  const results = [];
  for (const [islandIndex, island] of network.islands.entries()) {
    const { ids, sourceIds } = island, errors = [...island.errors], localWarnings = [...island.warnings];
    const at = new Map(ids.map((id, i) => [id, i])), sources = [], branches = network.branches.filter(b => at.has(b.from)).map(br => ({ ...br }));
    for (const source of network.sourceData.filter(s => sourceIds.includes(s.id))) {
      try { sources.push(sourceImpedance(source, network, c)); } catch (e) { errors.push(e.message); }
    }
    for (const br of branches) {
      const raw = model.items[br.itemId].electrical || {};
      if (br.type === "transformer") {
        for (const [key, label] of [["primaryKV", "kV primário"], ["secondaryKV", "kV secundário"], ["ratedMVA", "MVA nominal"],
          ["impedancePercent", "impedância Z (%)"], ["transformerXR", "X/R"]])
          if (!positive(raw[key])) errors.push(br.name + ": cadastre " + label + ".");
        if (+raw.tapPercent) localWarnings.push(br.name + ": relação nominal usada; tap da operação não aplicado ao curto.");
        if (c.standard === "iec" && c.corrections && positive(raw.impedancePercent) && positive(raw.transformerXR)) {
          const xr = +raw.transformerXR, xRated = +raw.impedancePercent / 100 * xr / Math.hypot(1, xr);
          br.correction = .95 * voltageFactor(Math.min(network.buses[br.from].kv, network.buses[br.to].kv), c, true) / (1 + .6 * xRated);
          br.r *= br.correction; br.x *= br.correction;
        }
      } else if (c.standard === "iec" && c.scenario === "min" && br.r > 0) {
        if (c.lineEndTemperatureC == null) errors.push(br.name + ": informe a temperatura final das linhas para o caso mínimo.");
        else br.r *= 1 + .004 * (c.lineEndTemperatureC - 20);
      }
    }
    let Z, separateR, separateX;
    if (sourceIds.length && !errors.length) {
      try {
        Z = drivingMatrix(ids, sources, branches);
        if (c.standard === "ansi") { separateR = separateEquivalent(ids, sources, branches, "r"); separateX = separateEquivalent(ids, sources, branches, "x"); }
      } catch (e) { errors.push(e.message); }
    }
    for (const id of ids) {
      const b = network.buses[id];
      if (!b.busIds.length || (config.faultBusId && !b.busIds.includes(config.faultBusId))) continue;
      const status = !sourceIds.length ? "dead" : errors.length ? "missing" : "calculated";
      const row = { ...b, island: islandIndex + 1, status, errors: [...new Set(errors)], warnings: localWarnings,
        voltageFactor: voltageFactor(b.kv, c), currentKA: null, peakKA: null, xr: null, resistanceOhm: null, reactanceOhm: null,
        dcKA: null, asymmetricalKA: null, thermalKA: null, contributions: [], branchCurrents: [] };
      if (status === "calculated") {
        const i = at.get(id), zbase = b.kv ** 2 / network.baseMVA, z = Z[i][i], zfault = C(c.faultRohm / zbase, c.faultXohm / zbase);
        const fault = div(C(row.voltageFactor), add(z, zfault)), ibase = network.baseMVA / (Math.sqrt(3) * b.kv);
        row.currentKA = abs(fault) * ibase; row.resistanceOhm = z.re * zbase; row.reactanceOhm = z.im * zbase;
        const req = (separateR?.get(id) ?? z.re) + zfault.re, xeq = (separateX?.get(id) ?? z.im) + zfault.im;
        row.xr = xeq / req;
        if (!Number.isFinite(row.xr) || row.xr < 0) throw Error(b.name + ": equivalente R-L inválido.");
        Object.assign(row, rlEstimates(row.currentKA, row.xr, c.frequencyHz, c.contactCycles, c.clearingTime));
        let sum = C();
        for (const s of sources) {
          const contribution = mul(div(Z[i][at.get(s.bus)], s.z), fault); sum = add(sum, contribution);
          row.contributions.push({ id: s.id, name: s.name, correction: s.correction, faultKA: abs(contribution) * ibase,
            localKA: abs(contribution) * network.baseMVA / (Math.sqrt(3) * network.buses[s.bus].kv),
            angleDeg: Math.atan2(contribution.im, contribution.re) * 180 / Math.PI,
            realFaultKA: contribution.re * ibase, imaginaryFaultKA: contribution.im * ibase });
        }
        if (abs(sub(sum, fault)) > Math.max(1e-8, abs(fault) * 1e-7)) throw Error(b.name + ": contribuições inconsistentes; confira o condicionamento da rede.");
        const voltages = ids.map((_, j) => sub(C(row.voltageFactor), mul(Z[j][i], fault)));
        for (const br of branches) {
          const current = div(sub(voltages[at.get(br.from)], voltages[at.get(br.to)]), C(br.r, br.x));
          row.branchCurrents.push({ itemId: br.itemId, name: br.name, from: br.from, to: br.to,
            fromName: network.buses[br.from].name, toName: network.buses[br.to].name,
            fromKV: network.buses[br.from].kv, toKV: network.buses[br.to].kv,
            fromKA: abs(current) * network.baseMVA / (Math.sqrt(3) * network.buses[br.from].kv),
            toKA: abs(current) * network.baseMVA / (Math.sqrt(3) * network.buses[br.to].kv) });
        }
      }
      results.push(row);
    }
    warnings.push(...localWarnings);
  }
  const assumptions = "Faltas trifásicas de sequência positiva; tensões pré-falta uniformes em pu; transformadores de dois enrolamentos na relação nominal. " +
    (c.standard === "iec" ? "c máximo/mínimo usa equações de referência IEC 60909-0:2016; K_T/K_G " + (c.corrections ? "aplicados" : "desativados neste caso") + "; o módulo não cobre integralmente as edições 2016 ou 2026. " :
      c.standard === "ansi" ? "Redes ANSI: TG com X″d em ½ ciclo e 1,5–4 ciclos; X′d em 30 ciclos; R do TG derivada de X″d/X/R e mantida entre períodos. X/R reduzido em redes separadas. " : "c = 1; impedâncias nominais, sem K_T/K_G. ") +
    "Pico, DC, RMS assimétrica e corrente térmica são estimativas do equivalente R-L com AC constante e pior ângulo de início; não incluem decaimento AC de geradores nem fatores ANSI MFi/NACD. " +
    "Sem contribuição de motores, inversores, unidades gerador-transformador K_S, faltas desequilibradas, aterramento ou corrente de interrupção normativa I_b. " +
    "Cargas, motores e capacitores são desprezados; R das linhas/cabos é referida a 20 °C e corrigida apenas no caso IEC mínimo. " +
    "Capacidades das barras recebem comparação preliminar; a corrente em cada disjuntor de uma ligação ideal não é determinada e sua capacidade de interrupção não é certificada. As contribuições somam-se como fasores na tensão da barra de falta.";
  const result = { results, network, warnings: [...new Set(warnings)], studyCase: config, assumptions,
    diagramName: String(model.name || "Sistema atual"), completedAt: new Date().toISOString() };
  result.alertReport = analyzeFaultAlerts(result, model, config);
  return result;
}
