import { studyElectricalData } from "./study-network.js?v=45.1";
import { solveDiagramPowerFlow } from "./power-flow.js?v=45.1";

export const CASE_VERSION = 1;
export const DEFAULT_CASE = {
  version: CASE_VERSION, name: "Caso base", notes: "",
  calculation: { method: "newton", baseMVA: 100, tolerance: 0.000001, maxIterations: 100 },
  adjustments: { loadPercent: 100, generationPercent: 100, resistancePercent: 100,
    reactancePercent: 100, tapDeltaPercent: 0 },
  alerts: { voltageCriticalLow: .95, voltageWarningLow: .98, voltageWarningHigh: 1.02,
    voltageCriticalHigh: 1.05, loadingWarning: 95, loadingCritical: 100 },
  loads: {}, generators: {},
};
const number = (value, name, min, max) => {
  if (value === null || value === "" || typeof value === "boolean" || !Number.isFinite(+value) || +value < min || +value > max)
    throw Error(name + ": informe um valor entre " + min + " e " + max + ".");
  return +value;
};
export function normalizeStudyCase(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Caso de estudo inválido.");
  if (input.version != null && input.version !== CASE_VERSION) throw Error("Versão de caso de estudo não suportada.");
  const out = structuredClone(DEFAULT_CASE);
  out.name = String(input.name ?? out.name).trim().slice(0, 100);
  if (!out.name) throw Error("Informe o nome do caso de estudo.");
  out.notes = String(input.notes ?? "").slice(0, 1000);
  const c = { ...out.calculation, ...input.calculation };
  if (!["newton", "gauss", "decoupled"].includes(c.method)) throw Error("Método de cálculo inválido.");
  out.calculation = { method: c.method, baseMVA: number(c.baseMVA, "Potência-base", .001, 1e6),
    tolerance: number(c.tolerance, "Tolerância", 1e-10, .01), maxIterations: number(c.maxIterations, "Iterações", 1, 1000) };
  if (!Number.isInteger(out.calculation.maxIterations)) throw Error("O limite de iterações deve ser inteiro.");
  for (const key of Object.keys(out.adjustments)) out.adjustments[key] = number(
    input.adjustments?.[key] ?? out.adjustments[key], key === "tapDeltaPercent" ? "Variação do tap (%)" : "Fator (%)",
    key === "tapDeltaPercent" ? -50 : 0, key === "tapDeltaPercent" ? 50 : 1000);
  for (const key of Object.keys(out.alerts)) out.alerts[key] = number(input.alerts?.[key] ?? out.alerts[key],
    "Limite de alerta", key.startsWith("voltage") ? .1 : 1, key.startsWith("voltage") ? 2 : 1000);
  const a = out.alerts;
  if (!(a.voltageCriticalLow < a.voltageWarningLow && a.voltageWarningLow <= a.voltageWarningHigh &&
      a.voltageWarningHigh < a.voltageCriticalHigh && a.loadingWarning < a.loadingCritical))
    throw Error("Os limites críticos devem ficar fora dos limites de atenção.");
  for (const [id, raw] of Object.entries(input.loads || {})) {
    if (!raw || typeof raw !== "object") throw Error("Ajuste de carga inválido.");
    const row = { percent: number(raw.percent ?? 100, "Fator da carga", 0, 1000) };
    if (raw.powerFactor != null) row.powerFactor = number(raw.powerFactor, "Fator de potência", .01, 1);
    Object.defineProperty(out.loads, id, { value: row, enumerable: true, configurable: true, writable: true });
  }
  for (const [id, raw] of Object.entries(input.generators || {})) {
    if (!raw || typeof raw !== "object" || !["auto", "pq", "pv", "slack"].includes(raw.mode ?? "auto"))
      throw Error("Modo do gerador inválido.");
    const row = { mode: raw.mode ?? "auto" };
    for (const [key, min, max] of [["pMW", 0, 1e6], ["qMvar", -1e6, 1e6],
      ["voltagePU", .5, 1.5], ["qMinMvar", -1e6, 1e6], ["qMaxMvar", -1e6, 1e6]])
      if (raw[key] != null) row[key] = number(raw[key], key, min, max);
    if ((row.qMinMvar != null) !== (row.qMaxMvar != null) ||
        (row.qMinMvar != null && row.qMinMvar > row.qMaxMvar))
      throw Error("Informe Q mínimo e Q máximo juntos, em ordem crescente.");
    Object.defineProperty(out.generators, id, { value: row, enumerable: true, configurable: true, writable: true });
  }
  return out;
}
export function prepareStudyCase(diagram, input, options = {}) {
  const config = normalizeStudyCase(input), model = structuredClone(diagram);
  const data = options.electricalData || studyElectricalData, warnings = [], used = new Set();
  for (const [id, o] of Object.entries(model.items || {})) {
    const e = data(o), a = config.adjustments;
    if (o.type === "load") {
      const row = config.loads[id] || {}, scale = a.loadPercent / 100 * (row.percent ?? 100) / 100;
      if (o.electrical?.activePowerMW == null) warnings.push((o.name || "Carga") + ": potência padrão utilizada.");
      o.electrical = { ...o.electrical, activePowerMW: +e.activePowerMW * scale,
        powerFactor: row.powerFactor ?? e.powerFactor };
      used.add(id);
    } else if (o.type === "turbogenerator") {
      const row = config.generators[id] || {}, scale = a.generationPercent / 100;
      const p = row.pMW ?? (o.controlMode === "manual" ? o.manualGenerationMW : +e.generationMW * (o.runtimeScale ?? 1));
      o.controlMode = "manual"; o.manualGenerationMW = p * scale;
      o.electrical = { ...o.electrical, generationMW: p * scale, generationMvar: (row.qMvar ?? +e.generationMvar) * scale,
        studyGeneratorMode: row.mode || e.studyGeneratorMode || "auto",
        voltageSetpointPU: row.voltagePU ?? e.voltageSetpointPU ?? 1 };
      if (row.qMinMvar != null) { o.electrical.studyQMinMvar = row.qMinMvar; o.electrical.studyQMaxMvar = row.qMaxMvar; }
      used.add(id);
    } else if (o.type === "line" && (o.electrical?.resistanceOhm != null || o.electrical?.reactanceOhm != null)) {
      o.electrical = { ...o.electrical, resistanceOhm: +(e.resistanceOhm ?? 0) * a.resistancePercent / 100,
        reactanceOhm: +(e.reactanceOhm ?? 0) * a.reactancePercent / 100 };
    } else if (o.type === "transformer" && a.tapDeltaPercent) {
      o.electrical = { ...o.electrical, tapPercent: (+e.tapPercent || 0) + a.tapDeltaPercent };
    }
  }
  for (const id of [...Object.keys(config.loads), ...Object.keys(config.generators)])
    if (!used.has(id)) warnings.push("Um equipamento do caso salvo não está mais neste modelo.");
  return { config, model, warnings: [...new Set(warnings)] };
}
export function analyzeStudyAlerts(result, input) {
  const limits = normalizeStudyCase(input).alerts, alerts = [], pending = [], busStatus = new Map(), branchStatus = new Map();
  const add = (severity, category, id, equipment, message) => alerts.push({ severity, category, id, equipment, message });
  if (!result.converged) return { alerts, pending: ["Sem convergência: os limites não foram avaliados."], busStatus, branchStatus };
  for (const b of result.buses) {
    const v = b.voltagePU;
    const severity = v < limits.voltageCriticalLow || v > limits.voltageCriticalHigh ? "critical" :
      v < limits.voltageWarningLow || v > limits.voltageWarningHigh ? "warning" : "normal";
    busStatus.set(b.id, severity);
    if (severity !== "normal") add(severity, "voltage", b.id, b.name,
      (v < limits.voltageWarningLow ? "Subtensão" : "Sobretensão") + ": " + (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "% da tensão nominal.");
  }
  for (const br of result.branches) {
    let loading = null;
    if (br.type === "transformer" && +br.ratedMVA > 0)
      loading = Math.max(Math.hypot(br.pFromMW, br.qFromMvar), Math.hypot(br.pToMW, br.qToMvar)) / br.ratedMVA * 100;
    if (br.type === "line" && +br.ampacityA > 0) loading = Math.max(br.currentA, br.currentToA) / br.ampacityA * 100;
    br.loadingPercent = loading;
    if (loading == null) { pending.push(br.name + ": limite nominal não cadastrado; sobrecarga não avaliada."); continue; }
    const severity = loading >= limits.loadingCritical ? "critical" : loading >= limits.loadingWarning ? "warning" : "normal";
    branchStatus.set(br.itemId, severity);
    if (severity !== "normal") add(severity, "loading", br.itemId, br.name, "Carregamento: " + loading.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "% do limite nominal.");
  }
  for (const s of result.sources || []) {
    if (s.powerMW == null) { pending.push(s.name + ": fontes no mesmo nó; contribuição individual não determinada."); continue; }
    if (s.type === "turbogenerator" && +s.ratedMVA > 0) {
      const loading = Math.hypot(s.powerMW, s.reactiveMvar) / s.ratedMVA * 100;
      if (loading >= limits.loadingWarning) add(loading >= limits.loadingCritical ? "critical" : "warning", "generation", s.id,
        s.name, "Carregamento do gerador: " + loading.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "% da potência nominal.");
    }
    if (s.qMinMvar != null && (s.reactiveMvar < s.qMinMvar - 1e-5 || s.reactiveMvar > s.qMaxMvar + 1e-5))
      add("critical", "reactive", s.id, s.name, "Potência reativa fora dos limites cadastrados.");
    if (s.qLimited) add("warning", "reactive", s.id, s.name, "Limite de Q atingido; gerador passou de PV para PQ no estudo.");
  }
  for (const island of result.notCalculated) pending.push((island.names.join(", ") || "Trecho") + ": " + island.reason);
  return { alerts, pending: [...new Set(pending)], busStatus, branchStatus };
}
export function runStudyCase(diagram, input, options = {}) {
  const prepared = prepareStudyCase(diagram, input, options);
  const result = solveDiagramPowerFlow(prepared.model, { ...options, ...prepared.config.calculation });
  result.warnings = [...new Set([...prepared.warnings, ...result.warnings])];
  result.studyCase = prepared.config;
  result.completedAt = new Date().toISOString();
  result.diagramName = String(prepared.model.name || "Sistema atual");
  result.alertReport = analyzeStudyAlerts(result, prepared.config);
  return result;
}
export function saveStudyCases(storage, key, cases) {
  if (!Array.isArray(cases) || cases.length > 40) throw Error("Limite de 40 casos por diagrama.");
  storage.setItem(key, JSON.stringify(cases.map(normalizeStudyCase)));
}
export function loadStudyCases(storage, key) {
  try { const raw = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.slice(0, 40).flatMap(x => { try { return [normalizeStudyCase(x)]; } catch { return []; } }) : [];
  } catch { return []; }
}
export function csvCell(value) {
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value).replace(".", ",") : "") : String(value ?? "");
  if (typeof value !== "number" && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function studyReportRows(result) {
  const rows = [["SimuSystem - Fluxo de carga AC"], ["Modelo", result.diagramName], ["Caso", result.studyCase.name], ["Observações", result.studyCase.notes],
    ["Data", result.completedAt], ["Método", result.method], ["Convergiu", result.converged ? "Sim" : "Não"],
    ["Perdas ativas (MW)", result.totalLossMW], ["Perdas reativas (MVAr)", result.totalLossMvar], [],
    ["Barras", "Tipo", "Tensão nominal (kV)", "Tensão (kV)", "Tensão (%)", "Ângulo (°)", "P líquido (MW)", "Q líquido (MVAr)"]];
  for (const b of result.buses) rows.push([b.name, b.type, b.kv, b.kv * b.voltagePU, b.voltagePU * 100, b.angleDeg, b.pCalculatedMW, b.qCalculatedMvar]);
  rows.push([], ["Ramos", "De", "Para", "P (MW)", "Q (MVAr)", "I de (A)", "I para (A)", "Carregamento (%)", "Perda (MW)", "Perda (MVAr)"]);
  for (const b of result.branches) rows.push([b.name, result.buses[b.from].name, result.buses[b.to].name, b.pFromMW, b.qFromMvar,
    b.currentA, b.currentToA, b.loadingPercent, b.lossMW, b.lossMvar]);
  rows.push([], ["Fontes", "Modo", "P (MW)", "Q (MVAr)"]);
  for (const s of result.sources || []) rows.push([s.name, s.mode, s.powerMW, s.reactiveMvar]);
  rows.push([], ["Alertas", "Equipamento", "Descrição"]);
  for (const a of result.alertReport.alerts) rows.push([a.severity === "critical" ? "Crítico" : "Atenção", a.equipment, a.message]);
  for (const message of result.alertReport.pending) rows.push(["Pendente", "", message]);
  for (const message of result.warnings) rows.push(["Hipótese", "", message]);
  rows.push([], ["Parâmetros do caso", JSON.stringify(result.studyCase)],
    ["Modelo AC balanceado para treinamento. Sem saturação, harmônicos, desequilíbrio ou otimização de despacho."]);
  return rows;
}
export const studyReportCSV = result => "\ufeff" + studyReportRows(result).map(row => row.map(csvCell).join(";")).join("\r\n");
export const studyReportText = result => studyReportRows(result).map(row => row.map(value => value == null ? "—" : value).join(" | ")).join("\n");
