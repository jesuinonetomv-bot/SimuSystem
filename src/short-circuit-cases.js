// Cases contain study overrides, never commands for the operational diagram.
export const DEFAULT_FAULT_CASE = {
  version: 1, kind: "shortCircuit", name: "Curto-circuito · caso base", notes: "", faultBusId: "",
  calculation: { standard: "iec", scenario: "max", ansiStage: "momentary", baseMVA: 100,
    frequencyHz: 60, lvTolerance: 10, voltageFactor: 1, corrections: true,
    faultRohm: 0, faultXohm: 0, contactCycles: 3, clearingTime: 1, lineEndTemperatureC: null },
  alerts: { warningPercent: 95, criticalPercent: 100 }, sources: {}, ratings: {},
};
const plain = value => value && typeof value === "object" && !Array.isArray(value);
function number(value, label, min, max) {
  if (value == null || value === "" || typeof value === "boolean" || !Number.isFinite(+value) || +value < min || +value > max)
    throw Error(label + ": informe um valor entre " + min + " e " + max + ".");
  return +value;
}
const choices = (value, values, label) => {
  if (!values.includes(value)) throw Error(label + " inválido.");
  return value;
};
const safeId = id => { if (["__proto__", "constructor", "prototype"].includes(id) || id.length > 250) throw Error("Referência de equipamento inválida."); };
export function normalizeFaultCase(input = {}) {
  if (!plain(input) || (input.version != null && input.version !== 1) ||
      (input.kind != null && input.kind !== "shortCircuit")) throw Error("Caso de curto-circuito inválido ou versão não suportada.");
  for (const key of ["calculation", "alerts", "sources", "ratings"])
    if (input[key] != null && !plain(input[key])) throw Error("Configuração inválida: " + key);
  const out = structuredClone(DEFAULT_FAULT_CASE), c = { ...out.calculation, ...input.calculation };
  out.name = String(input.name ?? out.name).trim().slice(0, 100);
  if (!out.name) throw Error("Informe o nome do caso.");
  out.notes = String(input.notes ?? "").slice(0, 1000);
  out.faultBusId = String(input.faultBusId ?? "").slice(0, 250); safeId(out.faultBusId);
  const n = (key, label, min, max) => number(c[key], label, min, max);
  out.calculation = {
    standard: choices(c.standard, ["iec", "ansi", "nominal"], "Padrão"),
    scenario: choices(c.scenario, ["max", "min", "custom"], "Condição IEC"),
    ansiStage: choices(c.ansiStage, ["momentary", "interrupting", "30cycle"], "Rede ANSI"),
    baseMVA: n("baseMVA", "Potência-base", .001, 1e6),
    frequencyHz: choices(+c.frequencyHz, [50, 60], "Frequência"),
    lvTolerance: choices(+c.lvTolerance, [6, 10], "Tolerância BT"),
    voltageFactor: n("voltageFactor", "Fator de tensão", .5, 1.5),
    faultRohm: n("faultRohm", "R da falta", 0, 1e6), faultXohm: n("faultXohm", "X da falta", 0, 1e6),
    contactCycles: n("contactCycles", "Tempo de avaliação em ciclos", .5, 30),
    clearingTime: n("clearingTime", "Duração da falta", .001, 120),
    lineEndTemperatureC: c.lineEndTemperatureC == null || c.lineEndTemperatureC === "" ? null :
      n("lineEndTemperatureC", "Temperatura final das linhas", 20, 250),
    corrections: c.corrections,
  };
  if (typeof c.corrections !== "boolean") throw Error("A opção de correções deve ser verdadeira ou falsa.");
  out.alerts.warningPercent = number(input.alerts?.warningPercent ?? 95, "Atenção (%)", 1, 1000);
  out.alerts.criticalPercent = number(input.alerts?.criticalPercent ?? 100, "Crítico (%)", 1, 1000);
  if (out.alerts.warningPercent >= out.alerts.criticalPercent) throw Error("Atenção deve ficar abaixo do limite crítico.");
  for (const [id, raw] of Object.entries(input.sources || {})) {
    safeId(id); if (!plain(raw)) throw Error("Dados da fonte inválidos.");
    const row = { participation: choices(raw.participation ?? "actual", ["actual", "include", "exclude"], "Participação da fonte") };
    for (const [key, label, max] of [["shortCircuitMVA", "MVA de curto máximo", 1e7], ["shortCircuitMVAMin", "MVA de curto mínimo", 1e7],
      ["sourceXR", "X/R da fonte", 1e6], ["sourceXRMin", "X/R mínimo da rede", 1e6],
      ["generatorRatedMVA", "MVA nominal do gerador", 1e6], ["subtransientPercent", "X″d (%)", 1000],
      ["transientPercent", "X′d (%)", 1000], ["generatorRatedPowerFactor", "FP nominal do gerador", 1]])
      if (raw[key] != null && raw[key] !== "") row[key] = number(raw[key], label, .000001, max);
    out.sources[id] = row;
  }
  for (const [id, raw] of Object.entries(input.ratings || {})) {
    safeId(id); if (!plain(raw)) throw Error("Limites da barra inválidos.");
    const row = {};
    for (const key of ["shortCircuitRatingKA", "peakWithstandKA"])
      if (raw[key] != null && raw[key] !== "") row[key] = number(raw[key], "Capacidade da barra (kA)", .000001, 1e6);
    out.ratings[id] = row;
  }
  if (Object.keys(out.sources).length > 2000 || Object.keys(out.ratings).length > 2000) throw Error("Caso com equipamentos demais.");
  return out;
}
export function prepareFaultCase(diagram, input) {
  const config = normalizeFaultCase(input), model = structuredClone(diagram), warnings = [];
  for (const [id, row] of Object.entries(config.sources)) {
    const o = model.items?.[id];
    if (!o || !["utility", "turbogenerator"].includes(o.type)) { warnings.push("Uma fonte salva no caso não está neste modelo."); continue; }
    const { participation, ...data } = row; o.electrical = { ...o.electrical, ...data };
    if (participation === "include") { o.state = "running"; o.isSource = true; }
    if (participation === "exclude") { o.state = "stopped"; o.isSource = false; }
  }
  for (const [id, row] of Object.entries(config.ratings)) {
    const o = model.items?.[id];
    if (o?.type === "bus") o.electrical = { ...o.electrical, ...row };
    else warnings.push("Uma barra salva no caso não está neste modelo.");
  }
  if (config.faultBusId && model.items?.[config.faultBusId]?.type !== "bus") throw Error("A barra de falta salva não está neste modelo. Selecione outra barra.");
  return { config, model, warnings: [...new Set(warnings)] };
}
export function faultCaseLabel(input) {
  const c = input.calculation;
  if (c.standard === "iec") return "IEC · " + ({ max: "máximo", min: "mínimo", custom: "c personalizado" }[c.scenario]);
  if (c.standard === "ansi") return "ANSI · " + ({ momentary: "½ ciclo", interrupting: "1,5–4 ciclos", "30cycle": "30 ciclos · X′d" }[c.ansiStage]);
  return "Nominal · c = 1";
}
export function analyzeFaultAlerts(result, model, config) {
  const alerts = [], pending = [], busStatus = new Map();
  for (const b of result.results) {
    if (b.status !== "calculated") { pending.push(b.name + ": " + (b.status === "dead" ? "sem fonte participante" : b.errors.join("; "))); continue; }
    if ((config.calculation.standard === "iec" && config.calculation.scenario === "min") ||
        (config.calculation.standard === "ansi" && config.calculation.ansiStage !== "momentary")) {
      pending.push(b.name + ": esta condição não avalia a capacidade momentânea da barra."); continue;
    }
    for (const id of b.busIds) {
      const e = model.items[id].electrical || {}, name = model.items[id].name || b.name;
      for (const [key, actual, label] of [["shortCircuitRatingKA", b.currentKA, "Corrente simétrica"], ["peakWithstandKA", b.peakKA, "Pico estimado"]]) {
        const rating = +e[key];
        if (!(rating > 0) || !Number.isFinite(rating)) { pending.push(name + ": capacidade " + (key === "peakWithstandKA" ? "de pico" : "simétrica") + " não cadastrada."); continue; }
        const percent = actual / rating * 100;
        if (percent >= config.alerts.warningPercent) {
          const severity = percent >= config.alerts.criticalPercent ? "critical" : "warning";
          if (severity === "critical" || !busStatus.has(b.id)) busStatus.set(b.id, severity);
          alerts.push({ severity, id, equipment: name, message: label + ": " + percent.toFixed(1) + "% da capacidade cadastrada (" + rating + " kA)." });
        }
      }
    }
  }
  return { alerts, pending: [...new Set(pending)], busStatus };
}
export function saveFaultCases(storage, key, cases) {
  if (!Array.isArray(cases) || cases.length > 40) throw Error("Limite de 40 casos por modelo.");
  storage.setItem(key, JSON.stringify(cases.map(normalizeFaultCase)));
}
export function loadFaultCases(storage, key) {
  try { const cases = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(cases) ? cases.slice(0, 40).flatMap(c => { try { return [normalizeFaultCase(c)]; } catch { return []; } }) : [];
  } catch { return []; }
}
const csvCell = value => {
  let text = typeof value === "number" ? Number.isFinite(value) ? String(value).replace(".", ",") : "" : String(value ?? "");
  if (typeof value !== "number" && /^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function faultReportRows(result) {
  const c = result.studyCase.calculation;
  const rows = [["SimuSystem · Curto-circuito trifásico"], ["Modelo", result.diagramName], ["Caso", result.studyCase.name],
    ["Condição", faultCaseLabel(result.studyCase)], ["Observações", result.studyCase.notes], ["Data", result.completedAt],
    ["Parâmetros do caso (JSON)", JSON.stringify(result.studyCase)],
    ["Frequência (Hz)", c.frequencyHz], ["R falta (Ω)", c.faultRohm], ["X falta (Ω)", c.faultXohm],
    ["Tempo avaliado (ciclos)", c.contactCycles], ["Duração (s)", c.clearingTime], [],
    ["Barra", "kV", "c", "I AC simétrica (kA)", "Pico estimado (kA)", "X/R para estimativas", "R eq. (Ω)", "X eq. (Ω)",
      "DC estimada no tempo (kA)", "RMS assim. estimada (kA)", "I térmica R-L estimada (kA)", "Situação"]];
  for (const b of result.results) rows.push([b.name, b.kv, b.voltageFactor, b.currentKA, b.peakKA, b.xr,
    b.resistanceOhm, b.reactanceOhm, b.dcKA, b.asymmetricalKA, b.thermalKA, b.status === "calculated" ? "Calculado" : b.status === "dead" ? "Sem fonte" : "Dados pendentes"]);
  rows.push([], ["Falta na barra", "Fonte", "I referida à barra de falta (kA)", "I no terminal da fonte (kA)", "Ângulo (°)", "Fator K da fonte"]);
  for (const b of result.results) for (const s of b.contributions || []) rows.push([b.name, s.name, s.faultKA, s.localKA, s.angleDeg, s.correction]);
  rows.push([], ["Falta na barra", "Ramo", "De", "Para", "kV de", "kV para", "I lado de (kA)", "I lado para (kA)"]);
  for (const b of result.results) for (const branch of b.branchCurrents || []) rows.push([b.name, branch.name, branch.fromName, branch.toName, branch.fromKV, branch.toKV, branch.fromKA, branch.toKA]);
  rows.push([], ["Alertas · comparação preliminar das barras"]);
  for (const a of result.alertReport.alerts) rows.push([a.severity, a.equipment, a.message]);
  for (const p of result.alertReport.pending) rows.push(["Pendente", p]);
  for (const warning of result.warnings) rows.push(["Hipótese / observação", warning]);
  rows.push(["Escopo", result.assumptions]); return rows;
}
export const faultReportCSV = result => "\ufeff" + faultReportRows(result).map(row => row.map(csvCell).join(";")).join("\r\n");
export const faultReportText = result => faultReportRows(result).map(row => row.map(v => v == null ? "—" : v).join(" | ")).join("\n");
