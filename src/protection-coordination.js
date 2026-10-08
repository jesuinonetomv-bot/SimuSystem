import { PROTECTION_CURVES, protectionResponse } from "./electrical-studies.js?v=47";

// A declared series path is study data. These cases never issue switching commands.
export const DEFAULT_COORDINATION_CASE = {
  version: 1, kind: "protectionCoordination", name: "Coordenação · caso base", notes: "",
  referenceKV: 13.8, rangeMinA: 1000, rangeMaxA: 10000, evaluationA: 3000,
  marginSeconds: .2, devices: [],
};
export const COORDINATION_STATUS = {
  sufficient: "Margem atendida na faixa amostrada", insufficient: "Margem insuficiente",
  pending: "Atuação ou retaguarda pendente", mixed: "Margem atendida parcialmente",
};
const unsafe = key => ["__proto__", "prototype", "constructor"].includes(key);
function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(unsafe))
    throw Error(label + " inválido.");
}
function number(value, label, min, max) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "" ||
      !Number.isFinite(+value) || +value < min || +value > max)
    throw Error(label + ": informe um valor entre " + min + " e " + max + ".");
  return +value;
}
function choice(value, values, label) {
  if (!values.includes(value)) throw Error(label + " inválido.");
  return value;
}
function identifier(value, label, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > 250 || unsafe(value)) throw Error(label + " inválida.");
  return value;
}
export function coordinationDevice(index = 0, referenceKV = 13.8) {
  return { id: "device-" + (index + 1), name: "Proteção " + (index + 1), equipmentId: "",
    deviceKV: referenceKV, inputBasis: "primary", ctPrimary: 600, ctSecondary: 1,
    protectionCurve: "standard", pickupA: 300, timeMultiplier: .1, definiteTime: .5,
    instantaneousA: 0, instantaneousTime: .02, breakerTime: .06,
    timeTolerancePercent: 0, timeToleranceSeconds: 0 };
}
export function normalizeCoordinationCase(input = {}) {
  plain(input, "Caso de coordenação");
  if ((input.version != null && input.version !== 1) || (input.kind != null && input.kind !== "protectionCoordination"))
    throw Error("Caso de coordenação inválido ou versão não suportada.");
  const raw = { ...DEFAULT_COORDINATION_CASE, ...input }, out = { version: 1, kind: "protectionCoordination" };
  out.name = String(raw.name).trim().slice(0, 100); if (!out.name) throw Error("Informe o nome do caso.");
  out.notes = String(raw.notes).slice(0, 1000);
  for (const [key, label, min, max] of [["referenceKV", "Tensão de referência (kV)", .001, 1000],
    ["rangeMinA", "Corrente mínima da faixa", .000001, 1e9], ["rangeMaxA", "Corrente máxima da faixa", .000001, 1e9],
    ["evaluationA", "Corrente de avaliação", .000001, 1e9], ["marginSeconds", "Margem adicional (s)", 0, 3600]])
    out[key] = number(raw[key], label, min, max);
  if (out.rangeMaxA <= out.rangeMinA) throw Error("A corrente máxima deve ser maior que a mínima.");
  if (out.evaluationA < out.rangeMinA || out.evaluationA > out.rangeMaxA) throw Error("A corrente de avaliação deve estar dentro da faixa.");
  if (!Array.isArray(raw.devices) || raw.devices.length > 8) throw Error("Use até 8 proteções por caminho.");
  const ids = new Set(), equipment = new Set();
  out.devices = raw.devices.map((value, i) => {
    plain(value, "Dispositivo " + (i + 1));
    const d = { ...coordinationDevice(i, out.referenceKV), ...value }, r = {};
    r.id = identifier(d.id, "Identificação da proteção");
    if (ids.has(r.id)) throw Error("As identificações das proteções devem ser diferentes."); ids.add(r.id);
    r.name = String(d.name).trim().slice(0, 100); if (!r.name) throw Error("Informe o nome da proteção " + (i + 1) + ".");
    r.equipmentId = identifier(d.equipmentId, "Referência do equipamento", true);
    if (r.equipmentId && equipment.has(r.equipmentId)) throw Error("Um equipamento aparece mais de uma vez no caminho.");
    if (r.equipmentId) equipment.add(r.equipmentId);
    r.inputBasis = choice(d.inputBasis, ["primary", "secondary"], "Base dos ajustes");
    r.protectionCurve = choice(d.protectionCurve, Object.keys(PROTECTION_CURVES), "Curva de proteção");
    for (const [key, label, min, max] of [["deviceKV", "Tensão local (kV)", .001, 1000],
      ["ctPrimary", "TC primário (A)", .000001, 1e7], ["ctSecondary", "TC secundário (A)", .000001, 100],
      ["pickupA", "Pickup (A)", .000001, 1e9], ["timeMultiplier", "Multiplicador de tempo", .000001, 1e4],
      ["definiteTime", "Tempo definido (s)", .000001, 86400], ["instantaneousA", "Instantâneo (A)", 0, 1e9],
      ["instantaneousTime", "Tempo instantâneo (s)", 0, 120], ["breakerTime", "Tempo do disjuntor (s)", 0, 120],
      ["timeTolerancePercent", "Tolerância de tempo (%)", 0, 99], ["timeToleranceSeconds", "Tolerância de tempo (s)", 0, 120]])
      r[key] = number(d[key], r.name + " · " + label, min, max);
    return r;
  });
  return out;
}
export function coordinationExample() {
  const devices = [300, 600, 1200].map((pickup, i) => ({ ...coordinationDevice(i), pickupA: pickup,
    name: ["Alimentador · jusante", "Entrada · intermediária", "Geral · montante"][i],
    timeMultiplier: [.1, .3, .6][i], timeTolerancePercent: 5 }));
  return normalizeCoordinationCase({ ...DEFAULT_COORDINATION_CASE, name: "Exemplo didático · três proteções",
    rangeMinA: 1500, notes: "Caminho de fase em série a 13,8 kV. Tolerância de tempo de ±5% assumida para treinamento; não é especificação de fabricante.", devices });
}
export function primarySettings(device) {
  const factor = device.inputBasis === "secondary" ? device.ctPrimary / device.ctSecondary : 1;
  return { ...device, pickupA: device.pickupA * factor, instantaneousA: device.instantaneousA * factor };
}
export function responseAt(device, referenceA, referenceKV) {
  const localA = referenceA * referenceKV / device.deviceKV, settings = primarySettings(device);
  const r = protectionResponse(settings, localA), p = device.timeTolerancePercent / 100, a = device.timeToleranceSeconds;
  const relayEarliest = Number.isFinite(r.relayTime) ? Math.max(0, r.relayTime * (1 - p) - a) : Infinity;
  const relayLatest = Number.isFinite(r.relayTime) ? r.relayTime * (1 + p) + a : Infinity;
  return { ...r, localA, secondaryA: localA * device.ctSecondary / device.ctPrimary,
    pickupPrimaryA: settings.pickupA, instantaneousPrimaryA: settings.instantaneousA,
    relayEarliest, relayLatest, totalEarliest: relayEarliest + device.breakerTime, totalLatest: relayLatest + device.breakerTime };
}
export function pairAt(downstream, upstream, referenceA, config) {
  const down = responseAt(downstream, referenceA, config.referenceKV), up = responseAt(upstream, referenceA, config.referenceKV);
  const gap = Number.isFinite(down.totalLatest) && Number.isFinite(up.relayEarliest) ? up.relayEarliest - down.totalLatest : null;
  const reason = !Number.isFinite(down.totalTime) ? Number.isFinite(up.relayTime) ? "Só a montante atua" : "Ambas sem atuação" :
    !Number.isFinite(up.relayTime) ? "Montante sem retaguarda nesta corrente" : "";
  return { referenceA, down, up, gap, reason,
    status: gap == null ? "pending" : gap + 1e-10 >= config.marginSeconds ? "sufficient" : "insufficient" };
}
// Include both sides of every pickup/instantaneous threshold so a narrow interval
// cannot disappear between the ordinary logarithmic samples. This is not a proof
// of continuous selectivity; reports explicitly call it a sampled range.
export function coordinationSamples(config, count = 601) {
  const { rangeMinA: lo, rangeMaxA: hi } = config, points = [lo, hi, config.evaluationA];
  const logLo = Math.log(lo), logHi = Math.log(hi);
  for (let i = 1; i < count - 1; i++) points.push(Math.exp(logLo + (logHi - logLo) * i / (count - 1)));
  for (const d of config.devices) {
    const settings = primarySettings(d);
    for (const local of [settings.pickupA, settings.instantaneousA]) if (local > 0) {
      const threshold = local * d.deviceKV / config.referenceKV;
      for (const factor of [1 - 1e-7, 1, 1 + 1e-7]) if (threshold * factor >= lo && threshold * factor <= hi) points.push(threshold * factor);
    }
  }
  return [...new Set(points)].sort((a, b) => a - b);
}
export function analyzeCoordination(input, diagram = { items: {} }) {
  const config = normalizeCoordinationCase(input);
  if (config.devices.length < 2) throw Error("Adicione pelo menos duas proteções, em ordem de jusante para montante.");
  const samples = coordinationSamples(config), pairs = [], warnings = [], missingBindings = [];
  for (const d of config.devices) if (d.equipmentId && diagram.items?.[d.equipmentId]?.type !== "breaker")
    missingBindings.push(d.name + ": equipamento salvo ausente neste modelo. Escolha um equipamento ou use o ajuste manual.");
  if (missingBindings.length) throw Error(missingBindings.join(" "));
  for (const d of config.devices) if (d.equipmentId) {
    const o = diagram.items[d.equipmentId];
    if (o.state !== "closed") warnings.push(d.name + ": disjuntor não está fechado no estado atual. O caminho é uma hipótese do caso.");
    warnings.push(d.name + ": ajustes copiados para o caso; confirme o cadastro antes do estudo.");
  }
  for (let i = 0; i < config.devices.length - 1; i++) {
    const down = config.devices[i], up = config.devices[i + 1];
    const points = samples.map(a => pairAt(down, up, a, config));
    const counts = { sufficient: 0, insufficient: 0, pending: 0 };
    let worst = null;
    for (const p of points) { counts[p.status]++; if (p.gap != null && (!worst || p.gap < worst.gap)) worst = p; }
    const status = counts.insufficient ? "insufficient" : counts.pending ? counts.sufficient ? "mixed" : "pending" : "sufficient";
    const ranges = []; let start = null, end = null;
    for (const p of points) {
      if (p.status !== "sufficient") {
        if (start && start.status !== p.status) { ranges.push({ startA: start.referenceA, endA: end.referenceA, status: start.status }); start = null; }
        if (!start) start = p; end = p;
      } else if (start) { ranges.push({ startA: start.referenceA, endA: end.referenceA, status: start.status }); start = null; }
    }
    if (start) ranges.push({ startA: start.referenceA, endA: end.referenceA, status: start.status });
    pairs.push({ downstreamId: down.id, upstreamId: up.id, downstream: down.name, upstream: up.name,
      status, counts, worst: worst ? { referenceA: worst.referenceA, gap: worst.gap,
        downstreamLatest: worst.down.totalLatest, upstreamEarliest: worst.up.relayEarliest } : null,
      evaluation: pairAt(down, up, config.evaluationA, config), ranges });
  }
  const evaluation = config.devices.map(d => ({ id: d.id, name: d.name, ...responseAt(d, config.evaluationA, config.referenceKV) }));
  return { studyCase: config, diagramName: diagram.name || "Sistema atual", completedAt: new Date().toISOString(),
    sampleCount: samples.length, pairs, evaluation, warnings,
    assumptions: "Sobrecorrente de fase em caminho declarado de jusante para montante; a topologia não é verificada automaticamente. " +
      "Corrente passante informada pelo usuário, sem repartir o curto total de barras entre disjuntores. " +
      "Conversão ideal de corrente entre tensões trifásicas: I local = I referência × kV referência / kV local; TC ideal. " +
      "Curvas genéricas IEC/IEEE e tempo definido; o multiplicador pertence à equação, sem conversão automática do dial de fabricante. " +
      "Banda de tempo = tempo do relé × (1 ± tolerância %) ± tolerância em segundos, limitada a zero; tempo do disjuntor fixo. " +
      "Margem = atuação mais cedo do relé a montante − eliminação mais tarde pelo disjuntor a jusante. " +
      "A margem adicional é um critério editável do caso. A análise percorre uma faixa amostrada, incluindo os limiares das curvas. " +
      "Tempos no ponto valem para falta persistente; o desligamento a jusante pode impedir as atuações seguintes. " +
      "Sem curvas de fabricante, fusíveis, tolerância de pickup/TC, saturação, limitação de corrente, curvas de dano, partida de motor, " +
      "proteção de terra ou deslocamento de sequência zero em transformadores. Estudo didático; não certifica seletividade integral." };
}
export function saveCoordinationCases(storage, key, cases) {
  if (!Array.isArray(cases) || cases.length > 40) throw Error("Limite de 40 casos por modelo.");
  storage.setItem(key, JSON.stringify(cases.map(normalizeCoordinationCase)));
}
export function loadCoordinationCases(storage, key) {
  try { const cases = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(cases) ? cases.slice(0, 40).flatMap(c => { try { return [normalizeCoordinationCase(c)]; } catch { return []; } }) : [];
  } catch { return []; }
}
export function coordinationReportRows(result) {
  const c = result.studyCase, rows = [["SimuSystem · Coordenação de proteção de fase"], ["Modelo", result.diagramName],
    ["Caso", c.name], ["Data", result.completedAt], ["Observações", c.notes], ["Parâmetros do caso (JSON)", JSON.stringify(c)],
    ["Referência (kV)", c.referenceKV], ["Faixa passante de referência (A)", c.rangeMinA, c.rangeMaxA],
    ["Corrente de avaliação referida (A)", c.evaluationA], ["Margem adicional exigida (s)", c.marginSeconds],
    ["Amostras por par", result.sampleCount], [],
    ["Jusante", "Montante", "Situação na faixa amostrada", "Menor margem encontrada (s)", "I referência na menor margem (A)",
      "Jusante: eliminação mais tarde (s)", "Montante: relé mais cedo (s)", "Margem no ponto avaliado (s)", "Situação no ponto"]];
  for (const p of result.pairs) rows.push([p.downstream, p.upstream, COORDINATION_STATUS[p.status], p.worst?.gap,
    p.worst?.referenceA, p.worst?.downstreamLatest, p.worst?.upstreamEarliest, p.evaluation.gap,
    p.evaluation.reason || COORDINATION_STATUS[p.evaluation.status]]);
  rows.push([], ["Dispositivo", "I primário local (A)", "I secundário TC ideal (A)", "Pickup primário local (A)",
    "Elemento", "Relé nominal (s)", "Total nominal (s)", "Relé mais cedo (s)", "Eliminação mais tarde (s)"]);
  for (const d of result.evaluation) rows.push([d.name, d.localA, d.secondaryA, d.pickupPrimaryA,
    { none: "Sem atuação", timed: "Temporizado", instantaneous: "Instantâneo" }[d.element],
    d.relayTime, d.totalTime, d.relayEarliest, d.totalLatest]);
  rows.push([], ["Faixas com pendência ou margem insuficiente · limites amostrados"], ["Jusante", "Montante", "De (A referência)", "Até (A referência)", "Situação"]);
  for (const p of result.pairs) for (const r of p.ranges) rows.push([p.downstream, p.upstream, r.startA, r.endA, COORDINATION_STATUS[r.status]]);
  for (const w of result.warnings) rows.push(["Observação", w]);
  rows.push(["Escopo e hipóteses", result.assumptions]); return rows;
}
const reportValue = v => typeof v === "number" && !Number.isFinite(v) ? "Sem atuação" : v == null ? "—" : v;
const csvCell = value => {
  const v = reportValue(value);
  let text = typeof v === "number" ? String(v).replace(".", ",") : String(v);
  if (typeof v !== "number" && /^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export const coordinationReportCSV = r => "\ufeff" + coordinationReportRows(r).map(row => row.map(csvCell).join(";")).join("\r\n");
export const coordinationReportText = r => coordinationReportRows(r).map(row => row.map(reportValue).join(" | ")).join("\n");
