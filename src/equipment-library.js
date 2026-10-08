// Instrument links are metadata, never power-graph edges.
export const EQUIPMENT_CATALOG = Object.freeze({
  cable: { name: "Cabo", tag: "CABO", kind: "branch", note: "R e X por km devem vir dos dados do cabo na condição de operação. O comprimento do desenho não define o comprimento elétrico. Circuitos paralelos são idênticos e sem acoplamento mútuo neste modelo." },
  relay: { name: "Relé de proteção", tag: "RELÉ", kind: "instrument", note: "Funções de fase 50/51 e de terra 50N/51N, com ajustes e sensores separados. Vincule o sensor ao ramo medido e o relé ao disjuntor. Estudos → Curto e sequência de atuação calcula os comandos e as aberturas na cópia do modelo." },
  ct: { name: "TC", tag: "TC", kind: "instrument", note: "Medição de corrente por relação ideal. Classe e carga são dados de cadastro; saturação do TC não é calculada." },
  vt: { name: "TP", tag: "TP", kind: "instrument", note: "Medição por relação ideal. Informe tensões primária e secundária na mesma base: fase-fase ou fase-neutro." },
  cbct: { name: "TC toroidal", tag: "TC TOROIDAL", kind: "instrument", note: "Sensor de corrente residual, separado dos TCs de fase. A sequência de atuação usa 3I₀ calculado no ramo vinculado e a relação informada pelo fabricante; o fluxo equilibrado não fornece essa corrente." },
  fuse: { name: "Fusível", tag: "FUSÍVEL", kind: "series", note: "Intacto conduz; aberto interrompe a ligação. Corrente nominal e capacidade de interrupção são dados de cadastro. Curva de fusão e atuação automática ainda não são calculadas." },
  motor: { name: "Motor", tag: "MOTOR", kind: "load", note: "A potência informada é a potência elétrica absorvida, usada no fluxo de carga. Partida e contribuição do motor ao curto-circuito ainda não são calculadas." },
  surgeArrester: { name: "Para-raios", tag: "PR", kind: "instrument", note: "Cadastro e vínculo à instalação protegida. Descargas, surtos e atuação do para-raios ainda não são calculados." },
  ground: { name: "Aterramento", tag: "TERRA", kind: "instrument", note: "Símbolo e cadastro do ponto de aterramento. Não une nós de potência nem substitui o estudo de sequência zero." },
});
export const isCatalogEquipment = o => !!EQUIPMENT_CATALOG[o?.type];
export const isInstrument = o => EQUIPMENT_CATALOG[o?.type]?.kind === "instrument";
export function equipmentTypeLabel(type) {
  return EQUIPMENT_CATALOG[type]?.name || { bus: "Barramento", line: "Conexão", breaker: "Disjuntor", disconnector: "Seccionadora",
    transformer: "Transformador", utility: "Concessionária", turbogenerator: "Turbogerador", load: "Carga", capacitor: "Banco de capacitores" }[type] || "Equipamento";
}
const present = v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
export function equipmentDefaults(type) {
  const base = { nominalKV: 13.8, frequencyHz: 60 };
  const values = {
    cable: { lengthM: 100, resistanceOhmPerKm: null, reactanceOhmPerKm: null, parallelRuns: 1, ampacityPerRunA: null, material: "copper", sectionMm2: null, insulation: "XLPE" },
    relay: { protectionCurve: "none", inputBasis: "secondary", pickupA: 1, timeMultiplier: .1, definiteTime: .5, instantaneousA: 0, instantaneousTime: .02, breakerTime: .06,
      earthCurve: "none", earthInputBasis: "secondary", earthSensor: "residual", earthPickupA: null, earthDelaySeconds: null, earthTimeMultiplier: .1, earthInstantaneousA: 0, earthInstantaneousTime: .02, manufacturer: "", model: "" },
    ct: { ctPrimary: 600, ctSecondary: 1, accuracyClass: "", burdenVA: null, polarity: "P1 → P2", measurementSide: "secondary", measurementTerminal: "A" },
    vt: { primaryV: 13800, secondaryV: 110, voltageBasis: "line", accuracyClass: "", burdenVA: null, measurementSide: "secondary" },
    cbct: { ctPrimary: null, ctSecondary: null, apertureMm: null, accuracyClass: "", measurementSide: "secondary", measurementTerminal: "A" },
    fuse: { ratedCurrentA: null, breakingCapacityKA: null, fuseClass: "" },
    motor: { activePowerMW: 1, powerFactor: .9, loadNature: "inductive", ratedSpeedRPM: null },
    surgeArrester: { ratedVoltageKV: null, continuousVoltageKV: null, dischargeCurrentKA: null },
    ground: { resistanceOhm: null, groundingMethod: "solid" },
  };
  return { ...base, ...values[type] };
}
export function cableEquivalent(data = {}) {
  const errors = [];
  for (const [key, label] of [["lengthM", "Comprimento"], ["parallelRuns", "Circuitos paralelos"]])
    if (!present(data[key]) || +data[key] <= 0 || (key === "parallelRuns" && !Number.isInteger(+data[key]))) errors.push(label + " deve ser positivo" + (key === "parallelRuns" ? " e inteiro" : "") + ".");
  for (const [key, label] of [["resistanceOhmPerKm", "R por km"], ["reactanceOhmPerKm", "X por km"]])
    if (!present(data[key]) || +data[key] < 0) errors.push(label + " não cadastrado ou inválido.");
  const known = !errors.length, factor = known ? +data.lengthM / 1000 / +data.parallelRuns : null;
  return { known, resistanceOhm: known ? +data.resistanceOhmPerKm * factor : null,
    reactanceOhm: known ? +data.reactanceOhmPerKm * factor : null,
    ampacityA: present(data.ampacityPerRunA) && +data.ampacityPerRunA > 0 && present(data.parallelRuns) && Number.isInteger(+data.parallelRuns) && +data.parallelRuns > 0 ? +data.ampacityPerRunA * +data.parallelRuns : null,
    errors };
}
export function createEquipment(type, point, end = null) {
  if (!EQUIPMENT_CATALOG[type]) throw Error("Componente desconhecido.");
  const o = { type, name: EQUIPMENT_CATALOG[type].tag, electrical: equipmentDefaults(type), rotation: 0, scale: 1 };
  if (type === "cable") Object.assign(o, { x1: point.x, y1: point.y, x2: end?.x ?? point.x, y2: end?.y ?? point.y });
  else Object.assign(o, { x: point.x, y: point.y });
  if (type === "motor") o.state = "active";
  if (type === "fuse") o.state = "closed";
  return o;
}
export function instrumentTargets(type) {
  if (type === "relay") return { ctId: ["ct"], vtId: ["vt"], cbctId: ["cbct"], breakerId: ["breaker"] };
  return { measuredId: ["bus", "line", "cable", "breaker", "disconnector", "fuse", "transformer", "utility", "turbogenerator", "load", "motor", "capacitor"] };
}
export function instrumentLinkIssues(item, items, ownId = "") {
  const allowed = instrumentTargets(item.type), issues = [];
  for (const [key, id] of Object.entries(item.instrument || {})) {
    if (!id) continue;
    if (!allowed[key] || id === ownId || !allowed[key].includes(items[id]?.type)) issues.push("Vínculo inválido ou removido: " + key + ".");
  }
  return issues;
}
export function remapInstrumentLinks(item, remap) {
  if (!item.instrument) return item;
  const instrument = {};
  for (const [key, id] of Object.entries(item.instrument)) if (id && remap(id)) instrument[key] = remap(id);
  return { ...item, instrument };
}
export function relayCoordinationProfile(item, items) {
  if (item?.type === "breaker") return { ...item.electrical, inputBasis: "primary" };
  if (item?.type !== "relay") throw Error("Selecione um relé ou disjuntor.");
  const ct = items[item.instrument?.ctId], breaker = items[item.instrument?.breakerId];
  if (ct?.type !== "ct" || breaker?.type !== "breaker") throw Error("O relé precisa de um TC de fase e um disjuntor vinculados.");
  if (!ct.instrument?.measuredId || !items[ct.instrument.measuredId]) throw Error("Vincule o TC ao equipamento medido.");
  const c = { ...equipmentDefaults("ct"), ...ct.electrical };
  if (!present(c.ctPrimary) || +c.ctPrimary <= 0 || !present(c.ctSecondary) || +c.ctSecondary <= 0) throw Error("Relação do TC inválida.");
  const measured = items[ct.instrument.measuredId];
  const nominalKV = measured.type === "transformer" ? measured.electrical?.[c.measurementSide === "primary" ? "primaryKV" : "secondaryKV"] : measured.electrical?.nominalKV ?? ct.electrical?.nominalKV ?? item.electrical?.nominalKV;
  return { ...equipmentDefaults("relay"), ...item.electrical, ctPrimary: +c.ctPrimary, ctSecondary: +c.ctSecondary,
    nominalKV,
    breakerTime: breaker.electrical?.breakerTime ?? item.electrical?.breakerTime ?? .06 };
}
export function instrumentReadout(item, items, results) {
  const target = items[item.instrument?.measuredId], r = results.get(item.instrument?.measuredId), e = { ...equipmentDefaults(item.type), ...item.electrical };
  if (!target) return ["Vincule o equipamento medido em Dados elétricos."];
  if (item.type === "ct" && r && present(e.ctPrimary) && +e.ctPrimary > 0 && present(e.ctSecondary) && +e.ctSecondary > 0) {
    if (r.energized !== false && ["bus", "breaker", "disconnector", "fuse"].includes(target.type)) return ["Corrente passante: não determinada; vincule o trecho medido."];
    let primary = r.currentA;
    if (target.type === "transformer" && e.measurementSide === "primary") primary = r.energized === false ? 0 : primary * r.voltageSecondaryKV / r.voltagePrimaryKV;
    if (!Number.isFinite(primary)) return ["Corrente passante: não determinada."];
    return ["TC ideal (estimativa): " + Math.abs(primary * +e.ctSecondary / +e.ctPrimary).toLocaleString("pt-BR", { maximumFractionDigits: 3 }) + " A secundários"];
  }
  if (item.type === "vt" && r && present(e.primaryV) && +e.primaryV > 0 && present(e.secondaryV) && +e.secondaryV > 0) {
    const voltage = target.type === "transformer" ? r[e.measurementSide === "primary" ? "voltagePrimaryKV" : "voltageSecondaryKV"] : r.voltageKV;
    const primary = voltage * 1000 / (e.voltageBasis === "phase" ? Math.sqrt(3) : 1);
    if (!Number.isFinite(primary)) return ["Tensão no ponto: não determinada."];
    return ["TP ideal: " + (primary * +e.secondaryV / +e.primaryV).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " V secundários"];
  }
  if (item.type === "cbct") return ["Corrente residual: não calculada."];
  return ["Vinculado a " + (target.name || item.instrument.measuredId)];
}
