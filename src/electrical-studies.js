import { buildStudyNetwork } from "./study-network.js?v=48";

const C = (re = 0, im = 0) => ({ re, im });
const add = (a, b) => C(a.re + b.re, a.im + b.im);
const sub = (a, b) => C(a.re - b.re, a.im - b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  if (d < 1e-28) throw Error("Impedância ou matriz singular.");
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
function inverse(matrix) {
  const n = matrix.length, m = matrix.map((row, i) => [...row.map((v) => C(v.re, v.im)),
    ...Array.from({ length: n }, (_, j) => C(i === j ? 1 : 0))]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.hypot(m[i][k].re, m[i][k].im) > Math.hypot(m[pivot][k].re, m[pivot][k].im)) pivot = i;
    [m[k], m[pivot]] = [m[pivot], m[k]];
    const diagonal = m[k][k];
    for (let j = 0; j < 2 * n; j++) m[k][j] = div(m[k][j], diagonal);
    for (let i = 0; i < n; i++) if (i !== k) {
      const factor = m[i][k];
      for (let j = 0; j < 2 * n; j++) m[i][j] = sub(m[i][j], mul(factor, m[k][j]));
    }
  }
  return m.map((row) => row.slice(n));
}
export function calculateThreePhaseFault(diagram, options = {}) {
  const network = buildStudyNetwork(diagram, { ...options, generatorControls: false }), results = [], warnings = [];
  for (const [islandIndex, island] of network.islands.entries()) {
    const { ids, sourceIds } = island, errors = [...island.errors], localWarnings = [...island.warnings];
    const index = new Map(ids.map((id, i) => [id, i]));
    const Y = ids.map(() => ids.map(() => C()));
    for (const source of network.sourceData.filter((s) => sourceIds.includes(s.id))) {
      const { data: e, raw, name } = source;
      let z, xr;
      if (source.type === "turbogenerator") {
        if (!(+raw.subtransientPercent > 0) || !Number.isFinite(+raw.subtransientPercent) ||
            !(+e.generatorRatedMVA > 0) || !Number.isFinite(+e.generatorRatedMVA)) {
          errors.push(name + ": cadastre X″d (%) e potência nominal do gerador"); continue;
        }
        xr = raw.sourceXR == null ? 10 : +raw.sourceXR;
        const x = +raw.subtransientPercent / 100 * network.baseMVA / +e.generatorRatedMVA;
        z = C(x / xr, x);
      } else {
        if (!(+raw.shortCircuitMVA > 0) || !Number.isFinite(+raw.shortCircuitMVA)) {
          errors.push(name + ": cadastre a potência de curto-circuito da fonte (MVA)"); continue;
        }
        xr = raw.sourceXR == null ? 10 : +raw.sourceXR;
        const magnitude = network.baseMVA / +raw.shortCircuitMVA, r = magnitude / Math.hypot(1, xr);
        z = C(r, r * xr);
      }
      if (!Number.isFinite(xr) || xr <= 0 || !Number.isFinite(z.re) || !Number.isFinite(z.im)) {
        errors.push(name + ": X/R ou impedância da fonte inválido"); continue;
      }
      if (raw.sourceXR == null) localWarnings.push(name + ": X/R da fonte assumido = 10");
      const i = index.get(source.bus); Y[i][i] = add(Y[i][i], div(C(1), z));
    }
    for (const br of network.branches.filter((b) => index.has(b.from))) {
      if (errors.length) break;
      const i = index.get(br.from), j = index.get(br.to), y = div(C(1), C(br.r, br.x));
      Y[i][i] = add(Y[i][i], C(y.re / br.tap ** 2, y.im / br.tap ** 2));
      Y[j][j] = add(Y[j][j], y);
      const off = C(y.re / br.tap, y.im / br.tap);
      Y[i][j] = sub(Y[i][j], off); Y[j][i] = sub(Y[j][i], off);
    }
    let Z = null;
    if (sourceIds.length && !errors.length) {
      try { Z = inverse(Y); } catch (e) { errors.push(e.message); }
    }
    for (const id of ids) {
      const b = network.buses[id];
      // Only actual busbars appear in the report; terminal nodes stay in Y.
      if (!b.busIds.length) continue;
      const status = !sourceIds.length ? "dead" : errors.length ? "missing" : "calculated";
      const z = Z?.[index.get(id)]?.[index.get(id)], magnitude = z ? Math.hypot(z.re, z.im) : null;
      results.push({ ...b, island: islandIndex + 1, status, errors, warnings: localWarnings,
        currentKA: magnitude ? network.baseMVA / (Math.sqrt(3) * b.kv * magnitude) : null,
        shortCircuitMVA: magnitude ? network.baseMVA / magnitude : null,
        resistanceOhm: z ? z.re * b.kv ** 2 / network.baseMVA : null,
        reactanceOhm: z ? z.im * b.kv ** 2 / network.baseMVA : null });
    }
    warnings.push(...localWarnings);
  }
  return { results, warnings: [...new Set(warnings)], network,
    assumptions: "Curto trifásico franco; sequência positiva; c = 1; tensão pré-falta nominal. Sem motores, impedância de falta, componente contínua ou correções IEC de equipamentos." };
}

export const PROTECTION_CURVES = {
  standard: { name: "IEC inversa normal", k: .14, alpha: .02 },
  very: { name: "IEC muito inversa", k: 13.5, alpha: 1 },
  extreme: { name: "IEC extremamente inversa", k: 80, alpha: 2 },
  iecLong: { name: "IEC inversa longa", k: 120, alpha: 1 },
  iecShort: { name: "IEC inversa curta", k: .05, alpha: .04 },
  ieeeModerate: { name: "IEEE moderadamente inversa", k: .0515, alpha: .02, offset: .114 },
  ieeeVery: { name: "IEEE muito inversa", k: 19.61, alpha: 2, offset: .491 },
  ieeeExtreme: { name: "IEEE extremamente inversa", k: 28.2, alpha: 2, offset: .1217 },
  definite: { name: "Tempo definido" },
};
export function validateProtection(settings) {
  const s = { breakerTime: 0, instantaneousA: 0, instantaneousTime: 0, ...settings };
  if (!Object.hasOwn(PROTECTION_CURVES, s.protectionCurve)) throw Error("Selecione uma curva de proteção.");
  if (!Number.isFinite(+s.pickupA) || +s.pickupA <= 0) throw Error("Pickup deve ser maior que zero.");
  if (s.protectionCurve === "definite") {
    if (!Number.isFinite(+s.definiteTime) || +s.definiteTime <= 0) throw Error("Tempo definido deve ser maior que zero.");
  } else if (!Number.isFinite(+s.timeMultiplier) || +s.timeMultiplier <= 0)
    throw Error("Multiplicador de tempo deve ser maior que zero.");
  for (const key of ["breakerTime", "instantaneousA", "instantaneousTime"])
    if (!Number.isFinite(+s[key]) || +s[key] < 0) throw Error("Ajuste de proteção inválido: " + key);
  return s;
}
export function protectionResponse(settings, currentA) {
  const s = validateProtection(settings);
  if (!Number.isFinite(+currentA) || +currentA < 0) throw Error("Corrente de avaliação inválida.");
  let relay = Infinity, element = "none";
  if (+currentA > +s.pickupA) {
    const curve = PROTECTION_CURVES[s.protectionCurve], M = +currentA / +s.pickupA;
    relay = s.protectionCurve === "definite" ? +s.definiteTime :
      +s.timeMultiplier * (curve.k / Math.expm1(curve.alpha * Math.log(M)) + (curve.offset || 0));
    element = "timed";
  }
  if (+s.instantaneousA > 0 && +currentA >= +s.instantaneousA && +s.instantaneousTime <= relay) {
    relay = +s.instantaneousTime; element = "instantaneous";
  }
  return { relayTime: relay, totalTime: relay + +s.breakerTime, element };
}
export const protectionTime = (settings, currentA) => protectionResponse(settings, currentA).totalTime;
export function compareProtection(a, b, currentA) {
  const downstreamTime = protectionTime(a, currentA), upstreamTime = protectionTime(b, currentA);
  return { currentA: +currentA, downstreamTime, upstreamTime,
    margin: Number.isFinite(downstreamTime) && Number.isFinite(upstreamTime) ? upstreamTime - downstreamTime : null };
}
