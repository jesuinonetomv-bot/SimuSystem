import { EQUIPMENT_CATALOG, equipmentDefaults, cableEquivalent, instrumentTargets, instrumentLinkIssues, isInstrument } from "./equipment-library.js?v=48";
import { PROTECTION_CURVES, validateProtection } from "./electrical-studies.js?v=48";

// [key, label, kind, minimum, options]. Empty optional numbers stay null.
const number = (key, label, min = 0) => [key, label, "number", min];
const text = (key, label) => [key, label, "text"];
const select = (key, label, options) => [key, label, "select", null, options];
const side = select("measurementSide", "Lado medido, se vinculado a transformador", { primary: "Primário", secondary: "Secundário" });
const fields = {
  cable: [number("lengthM", "Comprimento elétrico (m)", .001), number("parallelRuns", "Circuitos idênticos em paralelo", 1),
    select("material", "Condutor", { copper: "Cobre", aluminium: "Alumínio" }), number("sectionMm2", "Seção por condutor (mm²)", .001), text("insulation", "Isolação"),
    number("resistanceOhmPerKm", "R de sequência positiva (Ω/km)"), number("reactanceOhmPerKm", "X de sequência positiva (Ω/km)"), number("ampacityPerRunA", "Corrente admissível por circuito (A)", .001)],
  ct: [number("ctPrimary", "Corrente primária nominal (A)", .000001), number("ctSecondary", "Corrente secundária nominal (A)", .000001), side, text("accuracyClass", "Classe"), number("burdenVA", "Carga nominal (VA)"), text("polarity", "Polaridade")],
  vt: [number("primaryV", "Tensão primária nominal (V)", .000001), number("secondaryV", "Tensão secundária nominal (V)", .000001), select("voltageBasis", "Base da relação", { line: "Fase-fase", phase: "Fase-neutro" }), side, text("accuracyClass", "Classe"), number("burdenVA", "Carga nominal (VA)")],
  cbct: [number("ctPrimary", "Primário da relação informada pelo fabricante (A)", .000001), number("ctSecondary", "Secundário da relação informada pelo fabricante (A)", .000001), number("apertureMm", "Diâmetro interno (mm)", .001), text("accuracyClass", "Classe / sensor")],
  relay: [text("manufacturer", "Fabricante"), text("model", "Modelo"),
    select("inputBasis", "Base dos ajustes de fase", { secondary: "Secundário do TC de fase", primary: "Primário local" }),
    select("protectionCurve", "Curva de fase (50/51)", { none: "Desativada", ...Object.fromEntries(Object.entries(PROTECTION_CURVES).map(([k, v]) => [k, v.name])) }),
    number("pickupA", "Pickup de fase (A na base escolhida)", .000001), number("timeMultiplier", "Multiplicador de tempo", .000001), number("definiteTime", "Tempo definido (s)"),
    number("instantaneousA", "Pickup instantâneo (A; 0 desliga)"), number("instantaneousTime", "Tempo instantâneo (s)"), number("breakerTime", "Tempo do disjuntor se não cadastrado nele (s)"),
    number("earthPickupA", "Pickup de terra (A secundários; cadastro)", .000001), number("earthDelaySeconds", "Tempo de terra (s; cadastro)")],
  fuse: [number("ratedCurrentA", "Corrente nominal (A)", .000001), number("breakingCapacityKA", "Capacidade de interrupção (kA)", .000001), text("fuseClass", "Classe / referência"),
    select("state", "Estado no modelo", { closed: "Intacto", open: "Aberto / fundido" })],
  motor: [number("activePowerMW", "Potência elétrica absorvida (MW)"), number("powerFactor", "Fator de potência", .000001), number("ratedSpeedRPM", "Rotação nominal (rpm)", .001),
    select("state", "Estado no modelo", { active: "Em operação", inactive: "Parado" })],
  surgeArrester: [number("ratedVoltageKV", "Tensão nominal (kV)", .000001), number("continuousVoltageKV", "Tensão contínua máxima Uc (kV)", .000001), number("dischargeCurrentKA", "Corrente nominal de descarga (kA)", .000001)],
  ground: [select("groundingMethod", "Método", { solid: "Direto", resistance: "Resistor", reactance: "Reator", other: "Outro" }), number("resistanceOhm", "Resistência cadastrada (Ω)")],
};
const linkLabels = { measuredId: "Equipamento medido / protegido", ctId: "TC de fase", vtId: "TP", cbctId: "TC toroidal", breakerId: "Disjuntor de atuação" };

export function attachComponentEditor({ getDiagram, onSave, canEdit = () => true }) {
  const dialog = document.createElement("dialog"); dialog.className = "component-editor"; dialog.id = "componentEditor";
  dialog.innerHTML = `<form><header><div><small>Modelagem · componente</small><h2 id="componentTitle"></h2></div><button type="button" data-close aria-label="Fechar dados do componente">×</button></header>
    <div class="component-body"><div class="case-fields" data-fields></div><h3 data-links-title>Vínculos de medição e proteção</h3><div class="case-fields" data-links></div>
      <p class="study-note" data-note></p><p class="component-equivalent" data-equivalent></p><p role="status" aria-live="polite" data-status></p></div>
    <footer><button type="button" data-close>Cancelar</button><button type="submit" data-save>Salvar componente</button></footer></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form"), container = dialog.querySelector("[data-fields]"), links = dialog.querySelector("[data-links]");
  let currentId = "", descriptors = [], openedSnapshot = "";
  for (const b of dialog.querySelectorAll("[data-close]")) b.onclick = () => dialog.close();
  function makeField([key, label, kind, min, options], value, host = container) {
    const wrapper = document.createElement("label"); wrapper.append(document.createTextNode(label));
    const input = document.createElement(kind === "select" ? "select" : "input"); input.name = key;
    if (kind === "select") for (const [id, title] of Object.entries(options)) input.add(new Option(title, id));
    else { input.type = kind; if (kind === "number") { input.min = min; input.step = "any"; } else input.maxLength = 120; }
    input.value = value ?? ""; input.disabled = !canEdit(); wrapper.append(input); host.append(wrapper);
  }
  function read() {
    const item = getDiagram().items[currentId], electrical = { ...item.electrical }, instrument = {};
    let state = item.state;
    for (const [key, , kind] of descriptors) {
      const value = form.elements[key].value;
      if (key === "state") state = value;
      else electrical[key] = kind === "number" ? value === "" ? null : Number(value) : value;
    }
    for (const select of links.querySelectorAll("select")) if (select.value) instrument[select.name] = select.value;
    return { ...item, electrical, ...(state ? { state } : {}), ...(isInstrument(item) ? { instrument } : {}) };
  }
  function equivalent() {
    const output = dialog.querySelector("[data-equivalent]");
    if (getDiagram().items[currentId]?.type !== "cable") { output.textContent = ""; return; }
    const z = cableEquivalent(read().electrical);
    output.textContent = z.known ? `Equivalente do trecho: R = ${z.resistanceOhm.toLocaleString("pt-BR", { maximumSignificantDigits: 6 })} Ω · X = ${z.reactanceOhm.toLocaleString("pt-BR", { maximumSignificantDigits: 6 })} Ω · limite = ${z.ampacityA == null ? "não cadastrado" : z.ampacityA.toLocaleString("pt-BR") + " A"}` : "Cálculos pendentes: " + z.errors.join(" ");
  }
  form.addEventListener("input", equivalent);
  form.onsubmit = event => {
    event.preventDefault(); if (!canEdit()) return;
    const status = dialog.querySelector("[data-status]"), original = getDiagram().items[currentId];
    if (!original || JSON.stringify(original) !== openedSnapshot) { status.textContent = "O componente mudou enquanto esta janela estava aberta. Feche e abra novamente."; return; }
    const next = read(), issues = isInstrument(next) ? instrumentLinkIssues(next, getDiagram().items, currentId) : [];
    for (const [key, label, kind, min] of descriptors) if (kind === "number") {
      const v = next.electrical[key]; if (v != null && (!Number.isFinite(v) || v < min)) issues.push(label + " inválido.");
    }
    if (next.type === "cable" && (!Number.isInteger(next.electrical.parallelRuns) || next.electrical.parallelRuns < 1)) issues.push("Circuitos paralelos deve ser inteiro e positivo.");
    if (next.type === "motor" && next.electrical.powerFactor > 1) issues.push("Fator de potência deve ser até 1.");
    if (next.type === "relay" && next.electrical.protectionCurve !== "none") {
      try { validateProtection(next.electrical); } catch (error) { issues.push(error.message); }
    }
    for (const key of next.type === "ct" ? ["ctPrimary", "ctSecondary"] : next.type === "vt" ? ["primaryV", "secondaryV"] : []) if (!(next.electrical[key] > 0)) issues.push("Informe a relação nominal completa.");
    if (issues.length) { status.textContent = issues.join(" "); return; }
    onSave(currentId, next); dialog.close();
  };
  return { open(id) {
    const o = getDiagram().items?.[id]; if (!EQUIPMENT_CATALOG[o?.type]) return false;
    currentId = id; openedSnapshot = JSON.stringify(o); container.replaceChildren(); links.replaceChildren();
    dialog.querySelector("#componentTitle").textContent = EQUIPMENT_CATALOG[o.type].name + " · " + (o.name || id);
    dialog.querySelector("[data-note]").textContent = EQUIPMENT_CATALOG[o.type].note;
    dialog.querySelector("[data-status]").textContent = "";
    descriptors = [number("nominalKV", "Tensão nominal do circuito (kV)", .001), ...fields[o.type]];
    const data = { ...equipmentDefaults(o.type), ...o.electrical };
    for (const descriptor of descriptors) makeField(descriptor, descriptor[0] === "state" ? o.state : data[descriptor[0]]);
    const instrument = isInstrument(o); dialog.querySelector("[data-links-title]").hidden = !instrument;
    if (instrument) for (const [key, types] of Object.entries(instrumentTargets(o.type))) {
      const options = { "": "Sem vínculo" };
      for (const [targetId, target] of Object.entries(getDiagram().items || {})) if (targetId !== id && types.includes(target.type)) options[targetId] = (target.name || targetId) + " · " + (EQUIPMENT_CATALOG[target.type]?.name || target.type);
      if (o.instrument?.[key] && !options[o.instrument[key]]) options[o.instrument[key]] = "Vínculo removido · conferir";
      makeField([key, linkLabels[key], "select", null, options], o.instrument?.[key] || "", links);
    }
    dialog.querySelector("[data-save]").hidden = !canEdit(); equivalent(); dialog.showModal(); return true;
  } };
}
