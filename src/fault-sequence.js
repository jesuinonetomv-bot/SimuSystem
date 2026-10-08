import { calculatePointFault, normalizeSequenceCase, SEQUENCE_ASSUMPTIONS, FAULT_TYPES } from "./fault-analysis.js?v=49.2";
import { validateProtection, protectionResponse } from "./electrical-studies.js?v=49.2";
import { equipmentDefaults } from "./equipment-library.js?v=49.2";

const present = v => v != null && v !== "" && Number.isFinite(+v);
function ratio(sensor) {
  const e = { ...equipmentDefaults(sensor?.type), ...sensor?.electrical };
  if (!present(e.ctPrimary) || !(+e.ctPrimary > 0) || !present(e.ctSecondary) || !(+e.ctSecondary > 0)) throw Error("Informe a relação primária/secundária completa do sensor.");
  return +e.ctPrimary / +e.ctSecondary;
}
// Phase and earth elements use their own CT/sensor and their own pickup base.
export function sequenceProtections(diagram) {
  const functions = [], pending = [], items = diagram.items || {};
  for (const [id, o] of Object.entries(items)) if (["breaker", "relay"].includes(o.type)) {
    const e = { ...(o.type === "relay" ? equipmentDefaults("relay") : {}), ...o.electrical };
    for (const channel of ["phase", "earth"]) {
      const curve = channel === "phase" ? e.protectionCurve : e.earthCurve;
      if (!curve || curve === "none") continue;
      const f = { id: id + ":" + channel, equipmentId: id, name: o.name || id, channel,
        breakerId: o.type === "breaker" ? id : o.instrument?.breakerId };
      try {
        const breaker = items[f.breakerId]; if (breaker?.type !== "breaker") throw Error("Vincule o disjuntor de atuação.");
        f.breakerName = breaker.name || f.breakerId;
        let sensor = null, factor = 1;
        if (o.type === "relay") {
          const toroid = channel === "earth" && e.earthSensor === "cbct", sensorId = toroid ? o.instrument?.cbctId : o.instrument?.ctId;
          sensor = items[sensorId]; if (sensor?.type !== (toroid ? "cbct" : "ct")) throw Error(toroid ? "Vincule o TC toroidal." : "Vincule o TC de fase.");
          f.measuredId = sensor.instrument?.measuredId;
          if (!items[f.measuredId]) throw Error("Vincule o sensor ao equipamento medido.");
          const basis = channel === "phase" ? e.inputBasis : e.earthInputBasis ?? "secondary";
          if (!["primary", "secondary"].includes(basis)) throw Error("Base dos ajustes inválida.");
          if (basis === "secondary") factor = ratio(sensor);
          else ratio(sensor); // A linked physical sensor still needs a valid ratio.
        } else f.measuredId = id;
        const measured = items[f.measuredId], se = sensor?.electrical || {};
        f.port = measured.type === "transformer" ? se.measurementSide === "primary" ? 0 : 1 : se.measurementTerminal === "B" ? 1 : 0;
        f.sensorName = sensor?.name || (o.type === "breaker" ? "Ajuste primário do disjuntor" : "Sensor");
        const settings = channel === "phase" ? { ...e, protectionCurve: curve } : {
          protectionCurve: curve, pickupA: e.earthPickupA, timeMultiplier: e.earthTimeMultiplier,
          definiteTime: e.earthDelaySeconds, instantaneousA: e.earthInstantaneousA ?? 0, instantaneousTime: e.earthInstantaneousTime ?? .02 };
        f.settings = validateProtection({ ...settings, pickupA: settings.pickupA == null ? null : +settings.pickupA * factor,
          instantaneousA: +(settings.instantaneousA ?? 0) * factor,
          breakerTime: breaker.electrical?.breakerTime ?? e.breakerTime ?? .06 });
        functions.push(f);
      } catch (error) { pending.push({ ...f, reason: error.message, status: "pending" }); }
    }
  }
  return { functions, pending };
}
function observed(f, fault, model) {
  if (model.items[f.breakerId]?.state !== "closed") return { currentA: 0, reason: "Disjuntor aberto." };
  const reading = fault.measurements.get(f.measuredId)?.[f.port];
  if (!reading) return { currentA: null, reason: "Terminal de medição não encontrado." };
  const error = f.channel === "phase" ? reading.phaseError : reading.earthError;
  return { currentA: error ? null : f.channel === "phase" ? Math.max(...reading.phaseA) : reading.residualA, reason: error || "" };
}
export function simulateFaultSequence(diagram, input, options = {}) {
  const config = normalizeSequenceCase(input), model = structuredClone(diagram), snapshot = JSON.stringify(diagram);
  const protections = sequenceProtections(model), events = [], states = {}, opened = new Set(), triggered = new Set(), waiting = new Map();
  const progress = new Map(protections.functions.map(f => [f.id, { timed: 0, instant: 0 }]));
  let fault = calculatePointFault(model, config, options), time = 0, clearedAt = null, finalStatus = fault.status;
  const initial = fault, evaluated = protections.functions.map(f => {
    const r = observed(f, fault, model), response = r.currentA == null ? null : protectionResponse(f.settings, r.currentA);
    return { ...f, ...r, relaySeconds: response?.relayTime ?? null, openingSeconds: response?.totalTime ?? null,
      element: response?.element || "none", status: r.currentA == null ? "pending" : "notOperated" };
  });
  const addEvent = (type, fields = {}) => {
    const event = { index: events.length, type, timeSeconds: time, faultCurrentA: fault.currentA, ...fields, states: { ...states } };
    events.push(event); return event;
  };
  addEvent("fault", { itemId: config.location.itemId, name: model.items[config.location.itemId].name || config.location.itemId,
    description: FAULT_TYPES[config.faultType] + " · " + config.phases + (config.faultType === "LG" ? "-terra" : "") });
  const warnings = [...fault.warnings];
  if (protections.pending.length) warnings.push("Há proteções com cadastro pendente; consulte a tabela de atuação.");
  if (!protections.functions.length) warnings.push("Nenhuma função de proteção habilitada e com vínculos completos neste modelo.");
  const stepsLimit = protections.functions.length * 2 + Object.keys(model.items).length + 10;
  for (let step = 0; step < stepsLimit; step++) {
    const candidates = [];
    for (const f of protections.functions) {
      if (triggered.has(f.id) || opened.has(f.breakerId)) continue;
      const r = observed(f, fault, model), p = progress.get(f.id), s = f.settings;
      if (r.currentA == null) { p.timed = p.instant = 0; continue; }
      const timed = protectionResponse({ ...s, instantaneousA: 0 }, r.currentA).relayTime;
      const instant = +s.instantaneousA > 0 && r.currentA >= +s.instantaneousA ? +s.instantaneousTime : Infinity;
      if (!Number.isFinite(timed)) p.timed = 0;
      if (!Number.isFinite(instant)) p.instant = 0;
      const dtTimed = Number.isFinite(timed) ? Math.max(0, (1 - p.timed) * timed) : Infinity;
      const dtInstant = Number.isFinite(instant) ? Math.max(0, instant - p.instant) : Infinity;
      candidates.push({ f, p, currentA: r.currentA, timed, instant, dt: Math.min(dtTimed, dtInstant), element: dtInstant <= dtTimed ? "instantaneous" : "timed" });
    }
    const relayDt = Math.min(Infinity, ...candidates.map(c => c.dt)), openDt = Math.min(Infinity, ...[...waiting.values()].map(w => Math.max(0, w.at - time)));
    const dt = Math.min(relayDt, openDt);
    if (!Number.isFinite(dt) || time + dt > config.maxSeconds + 1e-10) break;
    for (const c of candidates) { if (Number.isFinite(c.timed)) c.p.timed += dt / c.timed; if (Number.isFinite(c.instant)) c.p.instant += dt; }
    time += dt;
    // Coincident commands latch before opening. This preserves non-selective ties.
    for (const c of candidates) if (Math.abs(c.dt - dt) <= 1e-9) {
      const f = c.f; triggered.add(f.id);
      const label = f.channel === "phase" ? c.element === "instantaneous" ? "50" : "51" : c.element === "instantaneous" ? "50N" : "51N";
      addEvent("relay", { itemId: f.equipmentId, functionId: f.id, breakerId: f.breakerId, name: f.name, element: label,
        currentA: c.currentA, description: label + " · comando de abertura para " + f.breakerName });
      const at = time + +f.settings.breakerTime, existing = waiting.get(f.breakerId);
      if (!existing || at < existing.at) waiting.set(f.breakerId, { at, functions: [f.id], names: [f.name] });
      else if (Math.abs(at - existing.at) <= 1e-9) { existing.functions.push(f.id); existing.names.push(f.name); }
    }
    let changed = false;
    for (const [id, w] of [...waiting]) if (w.at <= time + 1e-9) {
      waiting.delete(id); if (opened.has(id)) continue;
      model.items[id].state = "open"; states[id] = "open"; opened.add(id); changed = true;
      addEvent("open", { itemId: id, name: model.items[id].name || id, functionIds: w.functions, description: "Aberto por " + w.names.join(" / ") });
    }
    if (changed) {
      fault = calculatePointFault(model, config, options); warnings.push(...fault.warnings);
      if (fault.status === "dead" || fault.currentA < 1e-6) {
        if (clearedAt == null && fault.status !== "noReturn") { clearedAt = time; finalStatus = "cleared"; addEvent("cleared", { name: "Falta eliminada", description: "Ponto da falta sem alimentação das fontes modeladas." }); }
        else if (fault.status === "noReturn") { finalStatus = "noReturn"; addEvent("noReturn", { name: "Retorno de terra interrompido", description: "Ponto ainda pode estar energizado; capacitâncias à terra não calculadas." }); }
      }
    }
    if (clearedAt != null && !waiting.size) break;
  }
  if (clearedAt == null && !["dead", "noReturn"].includes(finalStatus)) finalStatus = "notCleared";
  for (const row of evaluated) {
    const event = events.find(e => e.functionId === row.id);
    if (event) { row.status = "operated"; row.actualSeconds = event.timeSeconds; row.actualElement = event.element; }
    else if (row.status !== "pending") {
      if (!Number.isFinite(row.relaySeconds)) row.status = "belowPickup";
      else if (opened.has(row.breakerId)) row.status = "openedByOther";
      else if (clearedAt != null) row.status = "cancelled";
      else row.status = "notOperated";
    }
  }
  return { config, snapshot, diagramName: diagram.name || "Sistema atual", completedAt: new Date().toISOString(), initial, final: fault,
    status: finalStatus, clearedAt, events, protections: [...evaluated, ...protections.pending], openedIds: [...opened],
    warnings: [...new Set(warnings)], assumptions: SEQUENCE_ASSUMPTIONS + " Sobrecorrente de fase 50/51 e residual 50N/51N não direcionais, TCs ideais. " +
      "Temporização por integração de Δt/t(I), reset imediato abaixo do pickup; comando de abertura latched, tempo do disjuntor fixo. " +
      "Correntes e temporizadores recalculados após cada abertura; falta persistente até isolamento. A reprodução usa uma cópia do modelo, sem alterar o diagrama operacional." };
}
export const PROTECTION_STATUS = { operated: "Atuou", cancelled: "Falta eliminada antes de atuar", openedByOther: "Disjuntor aberto por outra função",
  belowPickup: "Sem pickup", notOperated: "Não atuou no intervalo", pending: "Cadastro / corrente pendente" };
export const SEQUENCE_STATUS = { cleared: "Falta eliminada", notCleared: "Falta permanece alimentada", dead: "Ponto desenergizado antes da falta", noReturn: "Sem retorno condutivo de terra" };
export function sequenceReportRows(r) {
  const c = r.config, rows = [["SimuSystem · Curto e sequência de atuação"], ["Modelo", r.diagramName], ["Caso", c.name], ["Data", r.completedAt],
    ["Parâmetros", JSON.stringify(c)], ["Resultado", SEQUENCE_STATUS[r.status]], ["I de falta inicial (A)", r.initial.currentA],
    ["Corrente residual inicial 3I₀ (A)", r.initial.residualA], ["Tempo de eliminação (s)", r.clearedAt], [],
    ["Evento", "Tempo (s)", "Equipamento", "Tipo", "Função", "I no sensor (A primários)", "I falta antes do evento (A)", "Descrição"]];
  for (const e of r.events) rows.push([e.index + 1, e.timeSeconds, e.name, e.type, e.element, e.currentA, e.faultCurrentA, e.description]);
  rows.push([], ["Proteção", "Disjuntor", "Canal", "I inicial no sensor (A)", "Relé se falta persistisse (s)", "Abertura se falta persistisse (s)", "Atuação efetiva (s)", "Situação", "Pendência"]);
  for (const p of r.protections) rows.push([p.name, p.breakerName || p.breakerId, p.channel, p.currentA, p.relaySeconds, p.openingSeconds, p.actualSeconds, PROTECTION_STATUS[p.status], p.reason]);
  for (const w of r.warnings) rows.push(["Observação", w]); rows.push(["Hipóteses", r.assumptions]); return rows;
}
const cell = v => v == null ? "—" : typeof v === "number" && !Number.isFinite(v) ? "Sem atuação" : String(v);
export const sequenceReportText = r => sequenceReportRows(r).map(row => row.map(cell).join(" | ")).join("\n");
export const sequenceReportCSV = r => "\ufeff" + sequenceReportRows(r).map(row => row.map(v => {
  let s = cell(v); if (typeof v === "number" && Number.isFinite(v)) s = s.replace(".", ",");
  else if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}).join(";")).join("\r\n");

export function sequenceExample() {
  const topology = (a, b) => ({ terminalA: a, ...(b ? { terminalB: b } : {}) });
  const bus = (name, y) => ({ type: "bus", name, x1: 360, x2: 440, y1: y, y2: y, electrical: { nominalKV: 13.8 } });
  const breaker = (name, y, a, b) => ({ type: "breaker", name, x: 400, y, state: "closed", topology: topology(a, b), electrical: { nominalKV: 13.8, breakerTime: .06 } });
  const ct = (name, y, measuredId) => ({ type: "ct", name, x: 490, y, instrument: { measuredId }, electrical: { nominalKV: 13.8, ctPrimary: 600, ctSecondary: 1, measurementTerminal: "A" } });
  const relay = (name, y, ctId, breakerId, delay, earthDelay) => ({ type: "relay", name, x: 575, y, instrument: { ctId, breakerId },
    electrical: { nominalKV: 13.8, protectionCurve: "definite", inputBasis: "secondary", pickupA: 1, definiteTime: delay,
      instantaneousA: 0, instantaneousTime: .02, earthCurve: "definite", earthInputBasis: "secondary", earthSensor: "residual",
      earthPickupA: .2, earthDelaySeconds: earthDelay, earthInstantaneousA: 0, earthInstantaneousTime: .02 } });
  return { name: "Exemplo · proteção do alimentador", items: {
    sourceBus: { ...bus("Barra da fonte", 40), x1: 200, x2: 440 },
    grid: { type: "utility", name: "Rede 13,8 kV", x: 240, y: 130, state: "running", topology: topology("sourceBus"),
      electrical: { nominalKV: 13.8, shortCircuitMVA: 500, sourceXR: 10, negativeSequenceModel: "same", sourceGrounding: "grounded", zeroResistanceOhm: .08, zeroReactanceOhm: .5 } },
    general: breaker("DJ-GERAL", 120, "sourceBus", "mainBus"), mainBus: bus("Barra principal", 200),
    feeder: breaker("DJ-ALIMENTADOR", 280, "mainBus", "cable"),
    cable: { type: "cable", name: "CABO-01", x1: 400, y1: 350, x2: 400, y2: 510, topology: topology("feeder", "loadBus"),
      electrical: { nominalKV: 13.8, lengthM: 500, parallelRuns: 1, resistanceOhmPerKm: .2, reactanceOhmPerKm: .1, zeroResistanceOhmPerKm: .6, zeroReactanceOhmPerKm: .3 } },
    loadBus: bus("Barra da carga", 600), motor: { type: "motor", name: "MOTOR-01", x: 400, y: 685, state: "active", topology: topology("loadBus"), electrical: { nominalKV: 13.8, activePowerMW: 1, powerFactor: .9 } },
    ctGeneral: ct("TC-GERAL", 120, "general"), ctFeeder: ct("TC-ALIMENTADOR", 280, "feeder"),
    relayGeneral: relay("RELÉ-GERAL", 120, "ctGeneral", "general", .8, .5), relayFeeder: relay("RELÉ-ALIMENTADOR", 280, "ctFeeder", "feeder", .3, .12),
  } };
}
