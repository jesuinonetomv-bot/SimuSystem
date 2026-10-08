import { runShortCircuitCase } from "./short-circuit.js?v=47";
import { DEFAULT_FAULT_CASE, normalizeFaultCase, faultCaseLabel, saveFaultCases, loadFaultCases,
  faultReportCSV, faultReportText } from "./short-circuit-cases.js?v=47";
import { faultStudyExample } from "./study-example.js?v=47";

export function attachShortCircuitWorkbench({ dialog, getDiagram, getScope, networkOptions, setOverlay, onOpen }) {
  const host = dialog.querySelector("#shortCircuitWorkbench"), $ = id => dialog.querySelector("#" + id);
  const format = (v, digits = 3) => Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
  host.innerHTML = `
    <div class="case-bar"><label>Modelo de curto-circuito<select id="scNetwork"><option value="current">Estado atual do sistema</option><option value="example">Exemplo didático · curto-circuito</option></select></label>
      <label>Casos de curto salvos neste aparelho<select id="scSavedCases"><option value="">Caso em edição</option></select></label>
      <div class="case-buttons"><button id="scNew" type="button">Novo</button><button id="scDuplicate" type="button">Duplicar</button><button id="scSave" type="button">Salvar caso</button><button id="scDelete" type="button" disabled>Excluir</button></div></div>
    <p class="study-intro" id="scContext"></p>
    <div class="case-tabs" role="tablist" aria-label="Caso de curto-circuito">
      <button id="scTabConfig" role="tab" aria-selected="true" aria-controls="scConfig" type="button">Configuração</button>
      <button id="scTabSources" role="tab" aria-selected="false" aria-controls="scSources" tabindex="-1" type="button">Fontes</button>
      <button id="scTabAdjust" role="tab" aria-selected="false" aria-controls="scAdjust" tabindex="-1" type="button">Ajustes</button>
      <button id="scTabAlerts" role="tab" aria-selected="false" aria-controls="scAlerts" tabindex="-1" type="button">Alertas</button>
      <button id="scTabResults" role="tab" aria-selected="false" aria-controls="scResults" tabindex="-1" type="button">Resultados</button></div>
    <section id="scConfig" class="case-panel" role="tabpanel" aria-labelledby="scTabConfig">
      <div class="case-fields"><label class="wide">Nome do caso de curto<input id="scName" maxlength="100"></label>
        <label>Referência do estudo<select id="scStandard"><option value="iec">IEC · c e correções de impedância</option><option value="ansi">ANSI · redes por período</option><option value="nominal">Nominal · c = 1</option></select></label>
        <label data-sc-iec>Condição IEC<select id="scScenario"><option value="max">Máximo</option><option value="min">Mínimo</option><option value="custom">c personalizado</option></select></label>
        <label data-sc-ansi hidden>Período ANSI<select id="scStage"><option value="momentary">½ ciclo · momentâneo</option><option value="interrupting">1,5–4 ciclos · rede de interrupção</option><option value="30cycle">30 ciclos · rede X′d</option></select></label>
        <label>Barra de falta<select id="scFaultBus"><option value="">Todas as barras</option></select></label>
        <label>Potência-base do curto (MVA)<input id="scBase" type="number" min="0.001" max="1000000" step="any"></label>
        <label>Frequência do estudo<select id="scFrequency"><option value="60">60 Hz</option><option value="50">50 Hz</option></select></label>
        <label data-sc-iec>Tolerância de tensão BT<select id="scTolerance"><option value="10">+10% · c máximo = 1,10</option><option value="6">+6% · c máximo = 1,05</option></select></label>
        <label id="scVoltageLabel" hidden>Fator de tensão pré-falta (pu)<input id="scVoltage" type="number" min="0.5" max="1.5" step="0.01"></label>
        <label class="wide">Observações do curto<textarea id="scNotes" maxlength="1000" rows="2" placeholder="Objetivo e condições deste estudo"></textarea></label></div>
      <p class="study-note" id="scStandardNote"></p>
      <div class="case-buttons"><button id="scExportCase" type="button">Exportar caso JSON</button><button id="scImportCase" type="button">Importar caso JSON</button><input id="scCaseFile" type="file" accept=".json,application/json" hidden></div>
      <div id="scJSONTools" class="case-json-tools" hidden><label>JSON do caso de curto<textarea id="scJSONText" rows="7" aria-label="JSON do caso de curto"></textarea></label>
        <div class="case-buttons"><button id="scCopyJSON" type="button">Copiar JSON</button><button id="scDownloadJSON" type="button">Baixar JSON</button><button id="scApplyJSON" type="button">Importar texto</button><button id="scImportFile" type="button">Escolher arquivo JSON</button></div></div></section>
    <section id="scSources" class="case-panel" role="tabpanel" aria-labelledby="scTabSources" hidden>
      <p class="study-note">As fontes seguem o estado atual ou a participação escolhida neste caso. Incluir uma fonte não fecha seus contatos. Os valores editados valem só para o estudo; campos vazios usam o cadastro. A tensão nominal precisa estar cadastrada em Modelagem → Dados elétricos.</p>
      <div class="case-table-scroll"><h3>Redes externas</h3><table class="study-table"><thead><tr><th>Fonte / estado</th><th>Participação</th><th>kV nominal</th><th>MVA curto máx.</th><th>X/R máx.</th><th>MVA curto mín.</th><th>X/R mín.</th></tr></thead><tbody id="scGridRows"></tbody></table>
        <h3>Geradores síncronos</h3><table class="study-table"><thead><tr><th>Fonte / estado</th><th>Participação</th><th>kV nominal</th><th>MVA nominal</th><th>X″d (%)</th><th>X′d (%) · 30 ciclos</th><th>X/R de X″d</th><th>FP nominal · K_G</th></tr></thead><tbody id="scGeneratorRows"></tbody></table></div></section>
    <section id="scAdjust" class="case-panel" role="tabpanel" aria-labelledby="scTabAdjust" hidden>
      <div class="case-fields"><label>Resistência da falta (Ω na barra)<input id="scFaultR" type="number" min="0" max="1000000" step="any"></label>
        <label>Reatância da falta (Ω na barra)<input id="scFaultX" type="number" min="0" max="1000000" step="any"></label>
        <label>Tempo para estimativa DC / RMS (ciclos)<input id="scContact" type="number" min="0.5" max="30" step="0.5"></label>
        <label>Duração da falta para estimativa térmica (s)<input id="scDuration" type="number" min="0.001" max="120" step="0.01"></label>
        <label data-sc-iec>Temperatura final das linhas (°C; caso mínimo)<input id="scTemperature" type="number" min="20" max="250" step="1" placeholder="Obrigatória no mínimo com R de linha"></label></div>
      <label class="case-check" data-sc-iec><input id="scCorrections" type="checkbox">Aplicar K_T e K_G nas impedâncias IEC</label>
      <p class="study-note">R/X de linhas e transformadores vêm do cadastro. No mínimo IEC, R da linha cadastrada a 20 °C é corrigida por 1 + 0,004 × (temperatura − 20). Transformadores usam a relação nominal. As estimativas de pico, DC, RMS e efeito térmico usam um equivalente R-L com corrente AC constante; o tempo informado não altera a rede ANSI selecionada.</p></section>
    <section id="scAlerts" class="case-panel" role="tabpanel" aria-labelledby="scTabAlerts" hidden>
      <div class="case-fields"><label>Atenção na capacidade da barra (%)<input id="scWarning" type="number" min="1" max="1000" step="1"></label><label>Crítico na capacidade da barra (%)<input id="scCritical" type="number" min="1" max="1000" step="1"></label></div>
      <p class="study-note">Comparação preliminar com a capacidade simétrica e de pico cadastrada para cada barramento. Sem capacidade informada, a avaliação fica pendente. IEC mínimo e ANSI de interrupção/30 ciclos não avaliam capacidade momentânea. A corrente total da barra não certifica a capacidade de cada disjuntor.</p>
      <div class="case-table-scroll"><table class="study-table"><thead><tr><th>Barra</th><th>Capacidade simétrica (kA)</th><th>Capacidade de pico (kA)</th></tr></thead><tbody id="scRatingRows"></tbody></table></div></section>
    <section id="scResults" class="case-panel" role="tabpanel" aria-labelledby="scTabResults" hidden>
      <div class="case-report-heading"><h3 id="scResultTitle"></h3><p id="scResultDate"></p></div><div id="scStats" class="case-stats"></div>
      <div class="case-buttons"><button id="scApply" type="button" disabled>Mostrar no unifilar</button><button id="scExportCSV" type="button" disabled>Exportar relatório CSV</button><button id="scCopyReport" type="button" disabled>Copiar relatório</button><button id="scPrint" type="button" disabled>Imprimir / salvar PDF</button></div>
      <div id="scReportPreview" class="case-json-tools" hidden><label>Relatório de curto<textarea id="scReportText" rows="8" readonly aria-label="Relatório de curto-circuito"></textarea></label></div>
      <div class="case-alert-list" id="scAlertList" role="status"></div>
      <div class="case-table-scroll"><h3 id="scCurrentHeading">Correntes nas barras</h3><table class="study-table"><thead><tr><th>Barra</th><th>kV</th><th>c</th><th>I AC simétrica (kA)</th><th>Pico estimado (kA)</th><th>X/R</th><th>R eq. (Ω)</th><th>X eq. (Ω)</th><th>Situação</th></tr></thead><tbody id="scBusRows"></tbody></table></div>
      <p class="study-note">R/X equivalente complexo aparece na tabela. Em ANSI, o X/R das estimativas vem de redes R e X reduzidas separadamente. As estimativas são indicadas abaixo e no relatório; não representam corrente de interrupção normativa.</p>
      <div class="case-fields"><label>Detalhar falta na barra<select id="scDetailBus"></select></label></div>
      <h3 id="scDetailHeading"></h3>
      <div id="scDetailStats" class="case-stats sc-detail-stats"></div>
      <div class="case-table-scroll"><h3>Contribuições das fontes</h3><table class="study-table"><thead><tr><th>Fonte</th><th>I referida à barra de falta (kA)</th><th>I no terminal da fonte (kA)</th><th>Ângulo (°)</th><th>K da fonte</th></tr></thead><tbody id="scContributionRows"></tbody></table>
        <h3>Correntes nos ramos para esta falta</h3><table class="study-table"><thead><tr><th>Ramo</th><th>De → Para (kV)</th><th>I lado de (kA)</th><th>I lado para (kA)</th></tr></thead><tbody id="scBranchRows"></tbody></table></div>
      <p class="study-note">As contribuições somam-se como fasores, na tensão da barra de falta. As correntes dos dois lados do transformador têm bases diferentes. Ligações ideais e disjuntores unidos ao mesmo nó não têm corrente individual determinada neste modelo.</p>
      <details class="case-assumptions"><summary>Hipóteses, ajustes e dados pendentes</summary><p id="scAssumptions"></p></details></section>
    <div class="case-run"><button id="scRun" type="button">Calcular caso de curto</button><p id="scSummary" role="status">Configure o caso e clique em Calcular.</p></div>
    <p class="study-note" id="scPlatformNote" hidden>No aplicativo, copie o JSON ou o relatório. Downloads e impressão estão disponíveis no navegador.</p>
    <p class="study-note">Estudo trifásico para treinamento. Referências ANSI/IEC aplicadas ao modelo disponível; sem motores, inversores, faltas desequilibradas ou certificação normativa completa.</p>`;
  const isWebView = /\bwv\b|SimuSystemAndroid/i.test(navigator.userAgent);
  $("scPrint").hidden = isWebView; $("scDownloadJSON").hidden = isWebView; $("scPlatformNote").hidden = !isWebView;
  let config = structuredClone(DEFAULT_FAULT_CASE), cases = [], selectedIndex = -1, scope = "", modelAtOpen,
    lastResult = null, lastSnapshot = "", lastConfig = "";
  const diagram = () => $("scNetwork").value === "example" ? faultStudyExample() : getDiagram();
  const storageKey = () => "simusystem:short-circuit:v1:" + scope;
  const message = text => { $("scSummary").textContent = text; };
  function tab(id) {
    for (const button of dialog.querySelectorAll('[role="tab"]')) {
      const active = button.getAttribute("aria-controls") === id;
      button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
      $(button.getAttribute("aria-controls")).hidden = !active;
    }
  }
  for (const button of dialog.querySelectorAll('[role="tab"]')) {
    button.onclick = () => tab(button.getAttribute("aria-controls"));
    button.onkeydown = event => {
      const tabs = [...dialog.querySelectorAll('[role="tab"]')], i = tabs.indexOf(button);
      const next = event.key === "ArrowRight" ? (i + 1) % tabs.length : event.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length :
        event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
    };
  }
  function standardUI() {
    const standard = $("scStandard").value;
    for (const e of dialog.querySelectorAll("[data-sc-iec]")) e.hidden = standard !== "iec";
    for (const e of dialog.querySelectorAll("[data-sc-ansi]")) e.hidden = standard !== "ansi";
    $("scVoltageLabel").hidden = standard === "nominal" || (standard === "iec" && $("scScenario").value !== "custom");
    $("scStandardNote").textContent = standard === "iec" ?
      "Máximo: c = 1,10 em MT/AT; BT conforme a tolerância. Mínimo: c = 0,95 em BT e 1,00 em MT/AT; exige MVA e X/R mínimos da rede. K_T/K_G seguem equações de referência IEC 60909-0:2016. O módulo é um estudo parcial para treinamento." : standard === "ansi" ?
      "½ ciclo e 1,5–4 ciclos usam X″d do gerador síncrono; 30 ciclos usa X′d. A rede externa conserva sua impedância. Fatores de interrupção específicos do disjuntor (MFi/NACD) não fazem parte deste cálculo." :
      "Falta trifásica com c = 1 e impedâncias nominais. K_T/K_G e ajustes de temperatura IEC não são aplicados.";
  }
  function cell(row, value) { const td = document.createElement("td"); td.textContent = String(value); row.append(td); return td; }
  function numeric(row, value, name, key, max = 1e7) {
    const element = document.createElement("input"); element.type = "number"; element.step = "any";
    element.min = .000001; element.max = max; element.value = +value === 0 ? "" : value ?? ""; element.dataset.field = key;
    element.setAttribute("aria-label", name); const td = document.createElement("td"); td.append(element); row.append(td);
  }
  function equipmentFields(model) {
    for (const id of ["scGridRows", "scGeneratorRows", "scRatingRows"]) $(id).replaceChildren();
    $("scFaultBus").replaceChildren(new Option("Todas as barras", ""));
    let counts = { utility: 0, turbogenerator: 0, bus: 0 };
    for (const [id, o] of Object.entries(model.items || {})) {
      if (!["utility", "turbogenerator", "bus"].includes(o.type)) continue;
      const name = o.name || ({ utility: "Rede", turbogenerator: "Gerador", bus: "Barra" }[o.type]) + " " + (++counts[o.type]);
      const raw = o.electrical || {}, row = document.createElement("tr"); row.dataset.equipmentId = id;
      if (o.type === "bus") {
        $("scFaultBus").add(new Option(name, id)); cell(row, name);
        const values = config.ratings[id] || {};
        numeric(row, values.shortCircuitRatingKA ?? raw.shortCircuitRatingKA, name + " · capacidade simétrica (kA)", "shortCircuitRatingKA", 1e6);
        numeric(row, values.peakWithstandKA ?? raw.peakWithstandKA, name + " · capacidade de pico (kA)", "peakWithstandKA", 1e6);
        $("scRatingRows").append(row); continue;
      }
      const values = config.sources[id] || {}; cell(row, name + " · " + (o.state === "stopped" || o.isSource === false ? "Fora de operação" : "Em operação"));
      const select = document.createElement("select"); select.dataset.field = "participation"; select.setAttribute("aria-label", name + " · participação");
      for (const [value, text] of [["actual", "Estado atual"], ["include", "Incluir no caso"], ["exclude", "Excluir do caso"]]) select.add(new Option(text, value));
      select.value = values.participation || "actual"; const td = document.createElement("td"); td.append(select); row.append(td); cell(row, format(+raw.nominalKV || NaN, 2));
      const fields = o.type === "utility" ? [["shortCircuitMVA", "MVA curto máximo"], ["sourceXR", "X/R máximo"], ["shortCircuitMVAMin", "MVA curto mínimo"], ["sourceXRMin", "X/R mínimo"]] :
        [["generatorRatedMVA", "MVA nominal"], ["subtransientPercent", "X″d (%)"], ["transientPercent", "X′d (%)"], ["sourceXR", "X/R"], ["generatorRatedPowerFactor", "FP nominal"]];
      for (const [key, label] of fields) numeric(row, values[key] ?? raw[key], name + " · " + label, key, key === "generatorRatedPowerFactor" ? 1 : key.endsWith("Percent") ? 1000 : 1e6);
      $(o.type === "utility" ? "scGridRows" : "scGeneratorRows").append(row);
    }
    for (const [id, span] of [["scGridRows", 7], ["scGeneratorRows", 8], ["scRatingRows", 3]]) if (!$(id).children.length) {
      const row = document.createElement("tr"); cell(row, "Nenhum equipamento deste tipo no modelo.").colSpan = span; $(id).append(row);
    }
    if (config.faultBusId && ![...$("scFaultBus").options].some(o => o.value === config.faultBusId)) $("scFaultBus").add(new Option("Barra salva ausente · escolha outra", config.faultBusId));
    $("scFaultBus").value = config.faultBusId;
  }
  const fields = { standard: "scStandard", scenario: "scScenario", ansiStage: "scStage", baseMVA: "scBase", frequencyHz: "scFrequency", lvTolerance: "scTolerance",
    voltageFactor: "scVoltage", faultRohm: "scFaultR", faultXohm: "scFaultX", contactCycles: "scContact", clearingTime: "scDuration", lineEndTemperatureC: "scTemperature" };
  function collect() {
    const value = { ...config, name: $("scName").value, notes: $("scNotes").value, faultBusId: $("scFaultBus").value,
      calculation: {}, alerts: { warningPercent: $("scWarning").value, criticalPercent: $("scCritical").value }, sources: { ...config.sources }, ratings: { ...config.ratings } };
    for (const [key, id] of Object.entries(fields)) value.calculation[key] = $(id).value;
    value.calculation.corrections = $("scCorrections").checked;
    for (const [key, bodies] of [["sources", ["scGridRows", "scGeneratorRows"]], ["ratings", ["scRatingRows"]]])
      for (const body of bodies) for (const row of $(body).querySelectorAll("[data-equipment-id]")) {
        const data = {}; for (const input of row.querySelectorAll("[data-field]")) if (input.value !== "") data[input.dataset.field] = input.value;
        Object.defineProperty(value[key], row.dataset.equipmentId, { value: data, enumerable: true, configurable: true, writable: true });
      }
    return normalizeFaultCase(value);
  }
  function invalidate(text = "Caso alterado. Calcule novamente para atualizar os resultados.") {
    lastResult = null;
    for (const id of ["scApply", "scExportCSV", "scCopyReport", "scPrint"]) $(id).disabled = true;
    for (const id of ["scBusRows", "scContributionRows", "scBranchRows", "scStats", "scDetailStats", "scAlertList", "scDetailBus"]) $(id).replaceChildren();
    for (const id of ["scResultTitle", "scResultDate", "scAssumptions", "scDetailHeading"]) $(id).textContent = "";
    $("scReportPreview").hidden = true; message(text);
  }
  function context() { $("scContext").textContent = (diagram().name || "Sistema atual") + ($("scNetwork").value === "example" ?
    " · valores de exemplo para treinamento, separados do sistema publicado." : " · contatos e conexões atuais; ajustes aplicados somente a uma cópia do estudo."); }
  function populate() {
    $("scName").value = config.name; $("scNotes").value = config.notes;
    for (const [key, id] of Object.entries(fields)) $(id).value = config.calculation[key] ?? "";
    $("scCorrections").checked = config.calculation.corrections; $("scWarning").value = config.alerts.warningPercent; $("scCritical").value = config.alerts.criticalPercent;
    modelAtOpen = structuredClone(diagram()); equipmentFields(modelAtOpen); standardUI(); context(); invalidate("Configure o caso e clique em Calcular.");
  }
  function savedOptions() {
    $("scSavedCases").replaceChildren(new Option("Caso em edição", ""));
    cases.forEach((value, i) => $("scSavedCases").add(new Option(value.name, String(i))));
    $("scSavedCases").value = selectedIndex < 0 ? "" : String(selectedIndex); $("scDelete").disabled = selectedIndex < 0;
  }
  function refreshScope() {
    scope = String(getScope?.() || "local") + ":" + $("scNetwork").value;
    cases = loadFaultCases(localStorage, storageKey()); selectedIndex = -1; config = structuredClone(DEFAULT_FAULT_CASE);
    if ($("scNetwork").value === "example") config.calculation.lineEndTemperatureC = 80;
    savedOptions(); populate(); tab("scConfig");
  }
  function stats(host, values) {
    host.replaceChildren(); for (const [label, value] of values) { const card = document.createElement("div"), small = document.createElement("small"), strong = document.createElement("strong");
      small.textContent = label; strong.textContent = value; card.append(small, strong); host.append(card); }
  }
  function details() {
    $("scContributionRows").replaceChildren(); $("scBranchRows").replaceChildren(); $("scDetailStats").replaceChildren();
    const b = lastResult?.results.find(b => String(b.id) === $("scDetailBus").value); if (!b) return;
    $("scDetailHeading").textContent = "Falta em " + b.name + " · " + format(b.kv, 2) + " kV";
    stats($("scDetailStats"), [["Tempo avaliado", format(config.calculation.contactCycles, 1) + " ciclos"], ["DC estimada", format(b.dcKA) + " kA"],
      ["RMS assimétrica estimada", format(b.asymmetricalKA) + " kA"], ["I térmica R-L estimada", format(b.thermalKA) + " kA"]]);
    for (const s of b.contributions) { const row = document.createElement("tr"); [s.name, format(s.faultKA), format(s.localKA), format(s.angleDeg, 2), format(s.correction, 4)].forEach(v => cell(row, v)); $("scContributionRows").append(row); }
    for (const br of b.branchCurrents) { const row = document.createElement("tr"); [br.name, br.fromName + " (" + format(br.fromKV, 2) + ") → " + br.toName + " (" + format(br.toKV, 2) + ")", format(br.fromKA), format(br.toKA)].forEach(v => cell(row, v)); $("scBranchRows").append(row); }
  }
  function run() {
    invalidate("Calculando…");
    try {
      config = collect(); const model = diagram(), result = runShortCircuitCase(model, config, networkOptions);
      lastResult = result; lastSnapshot = JSON.stringify(model); lastConfig = JSON.stringify(config);
      $("scResultTitle").textContent = config.name; $("scResultDate").textContent = result.diagramName + " · " + faultCaseLabel(config) + " · " + new Date(result.completedAt).toLocaleString("pt-BR");
      const count = status => result.results.filter(b => b.status === status).length;
      stats($("scStats"), [["Barras calculadas", String(count("calculated"))], ["Sem fonte participante", String(count("dead"))], ["Dados pendentes", String(count("missing"))]]);
      $("scCurrentHeading").textContent = config.calculation.standard === "iec" ? "Corrente inicial simétrica I″k nas barras" : "Corrente AC simétrica · " + faultCaseLabel(config);
      for (const b of result.results) {
        const row = document.createElement("tr"); row.className = "study-" + (result.alertReport.busStatus.get(b.id) || "normal");
        [b.name, format(b.kv, 2), format(b.voltageFactor, 2), format(b.currentKA), format(b.peakKA), format(b.xr, 2),
          format(b.resistanceOhm, 5), format(b.reactanceOhm, 5), b.status === "calculated" ? "Calculado" : b.status === "dead" ? "Sem fonte" : "Dados pendentes"].forEach(v => cell(row, v));
        $("scBusRows").append(row); if (b.status === "calculated") $("scDetailBus").add(new Option(b.name, String(b.id)));
      }
      for (const a of result.alertReport.alerts) { const p = document.createElement("p"); p.className = "study-" + a.severity; p.textContent = (a.severity === "critical" ? "Crítico" : "Atenção") + " · " + a.equipment + " — " + a.message; $("scAlertList").append(p); }
      const pending = result.alertReport.pending;
      if (!result.alertReport.alerts.length) { const p = document.createElement("p"); p.textContent = pending.length ? "Há avaliações pendentes. Confira os dados e as hipóteses abaixo." : "Os limites cadastrados não foram ultrapassados nesta comparação preliminar."; $("scAlertList").append(p); }
      $("scAssumptions").textContent = [...pending, ...result.warnings, result.assumptions].join("\n");
      $("scApply").disabled = !count("calculated") || $("scNetwork").value === "example";
      for (const id of ["scExportCSV", "scCopyReport", "scPrint"]) $(id).disabled = false;
      details(); message(result.results.length ? `${faultCaseLabel(config)} · ${count("calculated")} barras calculadas · ${count("missing")} com dados pendentes.` : "Adicione barramentos ao modelo para calcular nas barras."); tab("scResults");
    } catch (e) { message("Não foi possível calcular: " + e.message); }
  }
  function currentResult() {
    if (!lastResult) return null;
    try { if (JSON.stringify(diagram()) !== lastSnapshot || JSON.stringify(collect()) !== lastConfig) { invalidate("O modelo ou o caso mudou. Calcule novamente antes de usar o relatório."); return null; } }
    catch (e) { invalidate(e.message); return null; }
    return lastResult;
  }
  const download = (text, filename, type) => { const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); };
  async function copyText(text, field) {
    field.value = text; try { await navigator.clipboard.writeText(text); return true; }
    catch { field.focus(); field.select(); return document.execCommand("copy"); }
  }
  function importCase(text) {
    if (text.length > 1024 * 1024) throw Error("Caso maior que 1 MB.");
    config = normalizeFaultCase(JSON.parse(text)); selectedIndex = -1; savedOptions(); populate(); $("scJSONTools").hidden = true;
    message("Caso importado. Confira os equipamentos e salve neste aparelho."); tab("scConfig");
  }
  $("scNetwork").onchange = refreshScope;
  $("scSavedCases").onchange = () => { selectedIndex = $("scSavedCases").value === "" ? -1 : +$("scSavedCases").value;
    config = selectedIndex < 0 ? structuredClone(DEFAULT_FAULT_CASE) : structuredClone(cases[selectedIndex]); savedOptions(); populate(); tab("scConfig"); };
  $("scNew").onclick = () => { config = structuredClone(DEFAULT_FAULT_CASE); selectedIndex = -1; savedOptions(); populate(); tab("scConfig"); };
  $("scDuplicate").onclick = () => { try { config = collect(); config.name = (config.name.slice(0, 85) + " · cópia"); selectedIndex = -1; savedOptions(); populate(); tab("scConfig"); } catch (e) { message(e.message); } };
  $("scSave").onclick = () => { try {
    const value = collect(), next = [...cases], index = selectedIndex < 0 ? cases.length : selectedIndex;
    next[index] = value; saveFaultCases(localStorage, storageKey(), next); cases = next; selectedIndex = index; config = value; savedOptions(); message("Caso salvo neste aparelho. Use o JSON para transferir a outro dispositivo.");
  } catch (e) { message("Não foi possível salvar: " + e.message); } };
  $("scDelete").onclick = () => { try { if (selectedIndex < 0) return; const next = cases.filter((_, i) => i !== selectedIndex);
    saveFaultCases(localStorage, storageKey(), next); cases = next; selectedIndex = -1; savedOptions(); message("Caso excluído; os valores continuam em edição."); } catch (e) { message(e.message); } };
  $("scExportCase").onclick = () => { try { $("scJSONText").value = JSON.stringify(collect(), null, 2); $("scJSONTools").hidden = false; } catch (e) { message(e.message); } };
  $("scImportCase").onclick = () => { $("scJSONText").value = ""; $("scJSONTools").hidden = false; $("scJSONText").focus(); };
  $("scCopyJSON").onclick = async () => message(await copyText($("scJSONText").value, $("scJSONText")) ? "JSON copiado." : "Selecione o JSON para copiar.");
  $("scDownloadJSON").onclick = () => { try { download(JSON.stringify(normalizeFaultCase(JSON.parse($("scJSONText").value)), null, 2), "SimuSystem-curto-circuito.json", "application/json"); } catch (e) { message(e.message); } };
  $("scImportFile").onclick = () => $("scCaseFile").click();
  $("scApplyJSON").onclick = () => { try { importCase($("scJSONText").value); } catch (e) { message("Não foi possível importar: " + e.message); } };
  $("scCaseFile").onchange = async () => { const file = $("scCaseFile").files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw Error("Arquivo maior que 1 MB."); importCase(await file.text()); } catch (e) { message("Não foi possível importar: " + e.message); } finally { $("scCaseFile").value = ""; } };
  $("scRun").onclick = run; $("scDetailBus").onchange = details;
  $("scExportCSV").onclick = async () => { const result = currentResult(); if (!result) return;
    if (!isWebView) download(faultReportCSV(result), "SimuSystem-curto-circuito.csv", "text/csv;charset=utf-8");
    else { $("scReportPreview").hidden = false; message(await copyText(faultReportCSV(result), $("scReportText")) ? "CSV copiado." : "Selecione o relatório para copiar."); } };
  $("scCopyReport").onclick = async () => { const result = currentResult(); if (!result) return; $("scReportPreview").hidden = false;
    message(await copyText(faultReportText(result), $("scReportText")) ? "Relatório copiado." : "Selecione o relatório para copiar."); };
  $("scPrint").onclick = () => { if (!currentResult()) return;
    const details = dialog.querySelector(".case-assumptions"), wasOpen = details.open; details.open = true; dialog.classList.add("printing-report");
    try { window.print(); } finally { dialog.classList.remove("printing-report"); details.open = wasOpen; } };
  $("scApply").onclick = () => { const result = currentResult(); if (!result || $("scNetwork").value === "example") return;
    const values = new Map(), severity = new Map();
    for (const b of result.results) for (const id of b.busIds) {
      values.set(id, [b.status === "calculated" ? "3φ · " + format(b.currentKA) + " kA" : b.status === "dead" ? "Sem fonte" : "Dados pendentes"]);
      severity.set(id, result.alertReport.busStatus.get(b.id));
    }
    setOverlay({ kind: "Curto-circuito · " + config.name, values, severity, snapshot: lastSnapshot }); dialog.close();
  };
  host.addEventListener("input", event => {
    if (["scCaseFile", "scJSONText", "scReportText", "scDetailBus"].includes(event.target.id)) return;
    if (["scNetwork", "scSavedCases"].includes(event.target.id)) return;
    standardUI(); invalidate();
  });
  return { open() {
    const wanted = String(getScope?.() || "local") + ":" + $("scNetwork").value;
    if (scope !== wanted) refreshScope();
    else if (JSON.stringify(modelAtOpen) !== JSON.stringify(diagram())) { try { config = collect(); } catch { /* Preserve the last valid case. */ } populate(); }
    context(); onOpen(); if (!dialog.open) dialog.showModal();
  } };
}
