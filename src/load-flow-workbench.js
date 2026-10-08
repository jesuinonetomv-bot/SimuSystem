import { DEFAULT_CASE, normalizeStudyCase, runStudyCase, loadStudyCases, saveStudyCases,
  studyReportCSV, studyReportText } from "./study-cases.js?v=49.1";
import { exampleStudyDiagram } from "./study-example.js?v=49.1";

export function attachLoadFlowWorkbench({ dialog, getDiagram, getScope, networkOptions, setOverlay, onOpen }) {
  const $ = id => dialog.querySelector("#" + id), format = (v, digits = 3) => Number.isFinite(v) ?
    v.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
  const host = $("loadFlowWorkbench");
  host.innerHTML = `
    <div class="case-bar"><label>Modelo<select id="lfNetwork"><option value="current">Estado atual do sistema</option><option value="example">Exemplo didático · três barras</option></select></label>
      <label>Casos salvos neste aparelho<select id="lfSavedCases"><option value="">Caso em edição</option></select></label>
      <div class="case-buttons"><button id="lfNew" type="button">Novo</button><button id="lfDuplicate" type="button">Duplicar</button>
        <button id="lfSave" type="button">Salvar caso</button><button id="lfDelete" type="button" disabled>Excluir</button></div></div>
    <p class="study-intro" id="lfContext"></p>
    <div class="case-tabs" role="tablist" aria-label="Caso de estudo">
      <button id="lfTabConfig" role="tab" aria-selected="true" aria-controls="lfConfig" type="button">Configuração</button>
      <button id="lfTabLoads" role="tab" aria-selected="false" aria-controls="lfLoads" tabindex="-1" type="button">Cargas</button>
      <button id="lfTabGeneration" role="tab" aria-selected="false" aria-controls="lfGeneration" tabindex="-1" type="button">Geração</button>
      <button id="lfTabAlerts" role="tab" aria-selected="false" aria-controls="lfAlerts" tabindex="-1" type="button">Alertas</button>
      <button id="lfTabResults" role="tab" aria-selected="false" aria-controls="lfResults" tabindex="-1" type="button">Resultados</button></div>
    <section id="lfConfig" class="case-panel" role="tabpanel" aria-labelledby="lfTabConfig">
      <div class="case-fields"><label class="wide">Nome do caso<input id="lfName" maxlength="100" value="Caso base"></label>
        <label>Método<select id="powerFlowMethod"><option value="newton">Newton-Raphson</option><option value="gauss">Gauss-Seidel</option><option value="decoupled">Desacoplado rápido (X/R alto)</option></select></label>
        <label>Potência-base (MVA)<input id="powerFlowBase" type="number" min="0.001" value="100" step="1"></label>
        <label>Tolerância de P/Q (pu)<input id="powerFlowTolerance" type="number" min="0.0000000001" value="0.000001" step="0.000001"></label>
        <label>Máximo de iterações por solução<input id="lfIterations" type="number" min="1" max="1000" value="100" step="1"></label>
        <label>Resistência das linhas (%)<input id="lfResistance" type="number" min="0" max="1000" value="100" step="1"></label>
        <label>Reatância das linhas (%)<input id="lfReactance" type="number" min="0" max="1000" value="100" step="1"></label>
        <label>Variação do tap (pontos %)<input id="lfTap" type="number" min="-50" max="50" value="0" step="0.5"></label>
        <label class="wide">Observações<textarea id="lfNotes" maxlength="1000" rows="2" placeholder="Objetivo e condições deste caso"></textarea></label></div>
      <p class="study-note">O caso aplica ajustes ao estado atual dos contatos. Dados nominais e conexões são cadastrados em Modelagem → Dados elétricos e Conexões. Os fatores de R/X aplicam-se somente às linhas com impedância cadastrada.</p>
      <div class="case-buttons"><button id="lfExportCase" type="button">Exportar caso JSON</button><button id="lfImportCase" type="button">Importar caso JSON</button>
        <input id="lfCaseFile" type="file" accept=".json,application/json" hidden></div>
      <div id="lfJSONTools" class="case-json-tools" hidden><label>JSON do caso<textarea id="lfJSONText" rows="7" aria-label="JSON do caso"></textarea></label>
        <div class="case-buttons"><button id="lfCopyJSON" type="button">Copiar JSON</button><button id="lfDownloadJSON" type="button">Baixar arquivo JSON</button>
          <button id="lfApplyJSON" type="button">Importar texto</button><button id="lfImportFile" type="button">Escolher arquivo JSON</button></div></div></section>
    <section id="lfLoads" class="case-panel" role="tabpanel" aria-labelledby="lfTabLoads" hidden>
      <div class="case-fields"><label>Demanda global (%)<input id="lfLoadPercent" type="number" min="0" max="1000" value="100" step="5"></label></div>
      <p class="study-note">100% conserva a potência e o perfil do momento. O fator individual multiplica o global. Cargas desligadas permanecem fora do estudo.</p>
      <div class="case-table-scroll"><table class="study-table"><thead><tr><th>Carga</th><th>Estado</th><th>MW de base</th><th>Fator individual (%)</th><th>Fator de potência</th></tr></thead><tbody id="lfLoadRows"></tbody></table></div></section>
    <section id="lfGeneration" class="case-panel" role="tabpanel" aria-labelledby="lfTabGeneration" hidden>
      <div class="case-fields"><label>Geração global (%)<input id="lfGenerationPercent" type="number" min="0" max="1000" value="100" step="5"></label></div>
      <p class="study-note">Auto usa P/Q fixos com a rede conectada e escolhe a referência em uma ilha de geradores. PV controla tensão e calcula Q; informe Q mínimo e máximo para limitar a excitação. Referência calcula o balanço P/Q da ilha e não conserva os MW programados.</p>
      <div class="case-table-scroll"><table class="study-table"><thead><tr><th>Gerador</th><th>Estado</th><th>Modo</th><th>P (MW)</th><th>Q (MVAr)</th><th>V (pu)</th><th>Q mín. (MVAr)</th><th>Q máx. (MVAr)</th></tr></thead><tbody id="lfGeneratorRows"></tbody></table></div></section>
    <section id="lfAlerts" class="case-panel" role="tabpanel" aria-labelledby="lfTabAlerts" hidden>
      <p class="study-note">Limites do caso de estudo. Os valores iniciais são exemplos editáveis para treinamento.</p>
      <div class="case-fields"><label>Subtensão crítica (pu)<input id="lfVCritLow" type="number" min="0.1" max="2" value="0.95" step="0.01"></label>
        <label>Subtensão de atenção (pu)<input id="lfVWarnLow" type="number" min="0.1" max="2" value="0.98" step="0.01"></label>
        <label>Sobretensão de atenção (pu)<input id="lfVWarnHigh" type="number" min="0.1" max="2" value="1.02" step="0.01"></label>
        <label>Sobretensão crítica (pu)<input id="lfVCritHigh" type="number" min="0.1" max="2" value="1.05" step="0.01"></label>
        <label>Carregamento de atenção (%)<input id="lfLoadWarn" type="number" min="1" max="1000" value="95" step="1"></label>
        <label>Carregamento crítico (%)<input id="lfLoadCrit" type="number" min="1" max="1000" value="100" step="1"></label></div>
      <p class="study-note">Transformadores: maior MVA entre os enrolamentos / MVA nominal. Linhas: maior corrente entre as pontas / corrente admissível cadastrada. Geradores: MVA calculado / MVA nominal. Fontes ideais no mesmo nó podem impedir a separação de contribuições individuais.</p></section>
    <section id="lfResults" class="case-panel" role="tabpanel" aria-labelledby="lfTabResults" hidden>
      <div class="case-report-heading"><h3 id="lfResultTitle"></h3><p id="lfResultDate"></p></div>
      <div id="lfResultStats" class="case-stats"></div>
      <div class="case-buttons"><button id="applyPowerFlow" type="button" disabled>Mostrar no unifilar</button>
        <button id="lfExportCSV" type="button" disabled>Exportar relatório CSV</button><button id="lfCopyReport" type="button" disabled>Copiar relatório</button>
        <button id="lfPrintReport" type="button" disabled>Imprimir / salvar PDF</button></div>
      <label class="case-check"><input id="lfShowFlows" type="checkbox">Incluir MW, MVAr e correntes dos ramos no unifilar</label>
      <div id="lfReportPreview" hidden><textarea id="lfReportText" rows="8" readonly aria-label="Relatório de fluxo de carga"></textarea></div>
      <div class="case-alert-list" id="lfAlertList" role="status"></div>
      <div class="case-table-scroll"><h3>Barras e nós elétricos</h3><table class="study-table"><thead><tr><th>Barra</th><th>Tipo</th><th>kV nominal</th><th>kV calculado</th><th>V (%)</th><th>Ângulo (°)</th><th>P líquido (MW)</th><th>Q líquido (MVAr)</th><th>Situação</th></tr></thead><tbody id="powerFlowBusBody"></tbody></table>
        <h3>Ramos</h3><table class="study-table"><thead><tr><th>Ramo</th><th>De → Para</th><th>P (MW)</th><th>Q (MVAr)</th><th>I de (A)</th><th>I para (A)</th><th>Carregamento (%)</th><th>Perda (MW)</th><th>Perda (MVAr)</th></tr></thead><tbody id="powerFlowBranchBody"></tbody></table>
        <h3>Fontes</h3><table class="study-table"><thead><tr><th>Fonte</th><th>Modo no cálculo</th><th>P (MW)</th><th>Q (MVAr)</th></tr></thead><tbody id="lfSourceRows"></tbody></table></div>
      <details class="case-assumptions"><summary>Hipóteses, dados pendentes e condições calculadas</summary><p id="lfAssumptions"></p></details></section>
    <div class="case-run"><button id="runPowerFlow" type="button">Calcular caso</button><p id="powerFlowSummary" role="status">Configure o caso e clique em Calcular.</p></div>
    <p class="study-note" id="lfPlatformNote" hidden>No aplicativo, exporte os casos e o relatório por cópia do texto. Para baixar arquivos ou salvar em PDF, abra o simulador no navegador.</p>
    <p class="study-note">AC balanceado para treinamento, cargas de potência constante. PV pode passar a PQ ao atingir o limite de Q. Sem saturação, harmônicos, desequilíbrio, curva completa de capacidade ou otimização de despacho. Medições e setas da Operação usam o modelo do treinamento.</p>`;
  const isWebView = /\bwv\b|SimuSystemAndroid/i.test(navigator.userAgent);
  $("lfPrintReport").hidden = isWebView; $("lfDownloadJSON").hidden = isWebView; $("lfPlatformNote").hidden = !isWebView;
  let config = structuredClone(DEFAULT_CASE), savedCases = [], selectedIndex = -1, scope = "", lastResult = null,
    lastSnapshot = "", lastConfig = "", modelAtOpen = null;
  const studyDiagram = () => $("lfNetwork").value === "example" ? exampleStudyDiagram() : getDiagram();
  const key = () => "simuStudyCases:" + scope;
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
      const tabs = [...dialog.querySelectorAll('[role="tab"]')], index = tabs.indexOf(button);
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length :
        event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return; event.preventDefault(); tabs[next].click(); tabs[next].focus();
    };
  }
  function cell(row, value) { const td = document.createElement("td"); td.textContent = String(value); row.append(td); return td; }
  function input(row, value, label, field, min, max) {
    const td = document.createElement("td"), element = document.createElement("input"); element.type = "number";
    element.value = value ?? ""; element.step = "any"; if (min != null) element.min = min; if (max != null) element.max = max;
    element.setAttribute("aria-label", label); element.dataset.field = field; td.append(element); row.append(td); return element;
  }
  function equipmentFields(model) {
    $("lfLoadRows").replaceChildren(); $("lfGeneratorRows").replaceChildren();
    for (const [id, o] of Object.entries(model.items || {})) {
      if (!["load", "motor", "turbogenerator"].includes(o.type)) continue;
      const row = document.createElement("tr"), data = networkOptions.electricalData(o); row.dataset.equipmentId = id;
      cell(row, o.name || (["load", "motor"].includes(o.type) ? "Carga" : "Gerador")); cell(row, ["active", "running"].includes(o.state) ? "Em operação" : "Desligado");
      if (["load", "motor"].includes(o.type)) {
        const values = config.loads[id] || {}; cell(row, format(+data.activePowerMW * (o.runtimeScale ?? 1)));
        input(row, values.percent ?? 100, (o.name || "Carga") + " · fator (%)", "percent", 0, 1000);
        input(row, values.powerFactor ?? data.powerFactor, (o.name || "Carga") + " · fator de potência", "powerFactor", .01, 1);
        $("lfLoadRows").append(row);
      } else {
        const values = config.generators[id] || {}, select = document.createElement("select"); select.dataset.field = "mode";
        select.setAttribute("aria-label", (o.name || "Gerador") + " · modo");
        for (const [value, label] of [["auto", "Auto"], ["pq", "PQ · P/Q fixos"], ["pv", "PV · tensão"], ["slack", "Referência"]]) select.add(new Option(label, value));
        select.value = values.mode ?? data.studyGeneratorMode ?? "auto"; const td = document.createElement("td"); td.append(select); row.append(td);
        input(row, values.pMW ?? (o.controlMode === "manual" ? o.manualGenerationMW : +data.generationMW * (o.runtimeScale ?? 1)), "P de " + (o.name || "gerador"), "pMW", 0, 1e6);
        input(row, values.qMvar ?? data.generationMvar, "Q de " + (o.name || "gerador"), "qMvar", -1e6, 1e6);
        input(row, values.voltagePU ?? data.voltageSetpointPU ?? 1, "Tensão de " + (o.name || "gerador"), "voltagePU", .5, 1.5);
        input(row, values.qMinMvar ?? data.studyQMinMvar, "Q mínimo de " + (o.name || "gerador"), "qMinMvar", -1e6, 1e6);
        input(row, values.qMaxMvar ?? data.studyQMaxMvar, "Q máximo de " + (o.name || "gerador"), "qMaxMvar", -1e6, 1e6);
        $("lfGeneratorRows").append(row);
      }
    }
    for (const id of ["lfLoadRows", "lfGeneratorRows"]) if (!$(id).children.length) {
      const row = document.createElement("tr"), td = cell(row, "Nenhum equipamento deste tipo no modelo."); td.colSpan = 8; $(id).append(row);
    }
  }
  const controls = { calculation: { method: "powerFlowMethod", baseMVA: "powerFlowBase", tolerance: "powerFlowTolerance", maxIterations: "lfIterations" },
    adjustments: { loadPercent: "lfLoadPercent", generationPercent: "lfGenerationPercent", resistancePercent: "lfResistance", reactancePercent: "lfReactance", tapDeltaPercent: "lfTap" },
    alerts: { voltageCriticalLow: "lfVCritLow", voltageWarningLow: "lfVWarnLow", voltageWarningHigh: "lfVWarnHigh", voltageCriticalHigh: "lfVCritHigh", loadingWarning: "lfLoadWarn", loadingCritical: "lfLoadCrit" } };
  function collect() {
    const value = { ...config, name: $("lfName").value, notes: $("lfNotes").value, loads: structuredClone(config.loads), generators: structuredClone(config.generators) };
    for (const [section, fields] of Object.entries(controls)) {
      value[section] = {}; for (const [key, id] of Object.entries(fields)) value[section][key] = $(id).value;
    }
    for (const [section, body] of [["loads", "lfLoadRows"], ["generators", "lfGeneratorRows"]])
      for (const row of $(body).querySelectorAll("[data-equipment-id]")) {
        const data = {}; for (const element of row.querySelectorAll("[data-field]")) if (element.value !== "") data[element.dataset.field] = element.value;
        Object.defineProperty(value[section], row.dataset.equipmentId, { value: data, enumerable: true });
      }
    return normalizeStudyCase(value);
  }
  function disableResults() {
    for (const id of ["applyPowerFlow", "lfExportCSV", "lfCopyReport", "lfPrintReport"]) $(id).disabled = true;
  }
  function invalidate(message = "Caso alterado. Calcule novamente para atualizar os resultados.") {
    lastResult = null; disableResults(); $("powerFlowSummary").textContent = message;
    for (const id of ["powerFlowBusBody", "powerFlowBranchBody", "lfSourceRows", "lfAlertList", "lfResultStats"]) $(id).replaceChildren();
    $("lfAssumptions").textContent = ""; $("lfResultTitle").textContent = ""; $("lfResultDate").textContent = ""; $("lfReportPreview").hidden = true;
  }
  function populate() {
    $("lfName").value = config.name; $("lfNotes").value = config.notes;
    for (const [section, fields] of Object.entries(controls)) for (const [key, id] of Object.entries(fields)) $(id).value = config[section][key];
    modelAtOpen = studyDiagram(); equipmentFields(modelAtOpen); invalidate("Configure o caso e clique em Calcular.");
  }
  function options() {
    const select = $("lfSavedCases"); select.replaceChildren(new Option("Caso em edição", ""));
    savedCases.forEach((value, index) => select.add(new Option(value.name, String(index))));
    select.value = selectedIndex < 0 ? "" : String(selectedIndex); $("lfDelete").disabled = selectedIndex < 0;
  }
  function context() {
    const example = $("lfNetwork").value === "example";
    $("lfContext").textContent = example ? "Exemplo didático independente do sistema publicado. Não pode ser mostrado no unifilar da operação." :
      "Modelo: " + (getDiagram().name || "Sistema atual") + ". Casos calculados sobre uma cópia; os equipamentos da operação não são comandados.";
  }
  function refreshScope() {
    scope = String(getScope()) + ":" + $("lfNetwork").value; selectedIndex = -1;
    savedCases = loadStudyCases(localStorage, key()); config = structuredClone(DEFAULT_CASE); options(); populate(); context();
  }
  const message = text => { $("powerFlowSummary").textContent = text; };
  function run() {
    invalidate("Calculando…");
    try {
      config = collect(); const model = studyDiagram();
      const result = runStudyCase(model, config, networkOptions);
      lastResult = result; lastSnapshot = JSON.stringify(model); lastConfig = JSON.stringify(config);
      $("lfResultTitle").textContent = result.studyCase.name;
      $("lfResultDate").textContent = (model.name || "Sistema atual") + " · " + new Date(result.completedAt).toLocaleString("pt-BR") + " · " + result.method;
      const stats = $("lfResultStats"), entries = [["Convergência", result.converged ? "Sim" : "Não"], ["Iterações", String(result.iterations)],
        ["Ilhas calculadas", String(result.islandCount)], ["Perdas ativas", format(result.totalLossMW, 4) + " MW"],
        ["Perdas reativas", format(result.totalLossMvar, 4) + " MVAr"], ["Alertas", String(result.alertReport.alerts.length)]];
      for (const [label, value] of entries) { const card = document.createElement("div"), title = document.createElement("small"), body = document.createElement("strong"); title.textContent = label; body.textContent = value; card.append(title, body); stats.append(card); }
      const status = severity => severity === "critical" ? "Crítico" : severity === "warning" ? "Atenção" : "Normal";
      for (const b of result.buses) {
        const row = document.createElement("tr"), severity = result.alertReport.busStatus.get(b.id); row.className = "study-" + (severity || "normal");
        [b.name, b.type, format(b.kv, 2), format(b.kv * b.voltagePU, 3), format(b.voltagePU * 100, 2), format(b.angleDeg),
          format(b.pCalculatedMW), format(b.qCalculatedMvar), result.converged ? status(severity) : "Sem convergência"].forEach(value => cell(row, value));
        $("powerFlowBusBody").append(row);
      }
      for (const b of result.branches) {
        const row = document.createElement("tr"); row.className = "study-" + (result.alertReport.branchStatus.get(b.itemId) || "normal");
        [b.name, result.buses[b.from].name + " → " + result.buses[b.to].name, format(b.pFromMW), format(b.qFromMvar), format(b.currentA, 1),
          format(b.currentToA, 1), format(b.loadingPercent, 1), format(b.lossMW, 4), format(b.lossMvar, 4)].forEach(value => cell(row, value));
        $("powerFlowBranchBody").append(row);
      }
      for (const s of result.sources) { const row = document.createElement("tr");
        [s.name, s.mode, format(s.powerMW), format(s.reactiveMvar)].forEach(value => cell(row, value)); $("lfSourceRows").append(row); }
      for (const a of result.alertReport.alerts) { const p = document.createElement("p"); p.className = "study-" + a.severity;
        p.textContent = status(a.severity) + " · " + a.equipment + " — " + a.message; $("lfAlertList").append(p); }
      if (result.converged && !result.alertReport.alerts.length) { const p = document.createElement("p");
        p.textContent = "Nenhum limite configurado foi ultrapassado nos trechos avaliados."; $("lfAlertList").append(p); }
      $("lfAssumptions").textContent = [...result.alertReport.pending, ...result.warnings].join("\n") || "Dados necessários informados para os trechos calculados.";
      $("applyPowerFlow").disabled = !result.converged || $("lfNetwork").value === "example";
      for (const id of ["lfExportCSV", "lfCopyReport", "lfPrintReport"]) $(id).disabled = false;
      message(config.name + " · " + result.method + " · " + (result.converged ? "Cálculo convergido." : "Sem convergência; valores provisórios, sem aplicação ao unifilar.") +
        (result.notCalculated.length ? " Há trechos não calculados; confira as pendências." : ""));
      tab("lfResults");
    } catch (e) { message("Não foi possível calcular: " + e.message); }
  }
  function currentResult() {
    if (!lastResult) return null;
    try { if (JSON.stringify(studyDiagram()) !== lastSnapshot || JSON.stringify(collect()) !== lastConfig) {
      invalidate("O modelo ou o caso mudou. Calcule novamente antes de usar o relatório."); return null;
    } } catch (e) { invalidate(e.message); return null; }
    return lastResult;
  }
  function download(text, name, type) {
    const blob = new Blob([text], { type }), link = document.createElement("a"), url = URL.createObjectURL(blob);
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("runPowerFlow").onclick = run;
  $("lfSavedCases").onchange = () => {
    selectedIndex = $("lfSavedCases").value === "" ? -1 : +$("lfSavedCases").value;
    if (selectedIndex >= 0) config = structuredClone(savedCases[selectedIndex]); populate(); options();
  };
  $("lfNew").onclick = () => { config = structuredClone(DEFAULT_CASE); selectedIndex = -1; options(); populate(); tab("lfConfig"); };
  $("lfDuplicate").onclick = () => { try { config = collect(); config.name = (config.name.slice(0, 90) + " · cópia");
    selectedIndex = -1; options(); populate(); tab("lfConfig"); } catch (e) { message(e.message); } };
  $("lfSave").onclick = () => { try {
    const value = collect(), next = savedCases.map(x => structuredClone(x));
    if (next.some((x, i) => i !== selectedIndex && x.name === value.name)) throw Error("Já existe um caso com esse nome. Escolha outro nome.");
    if (selectedIndex >= 0) next[selectedIndex] = value; else next.push(value);
    saveStudyCases(localStorage, key(), next); savedCases = next; selectedIndex = selectedIndex < 0 ? next.length - 1 : selectedIndex;
    config = value; options(); message("Caso salvo neste aparelho. Exporte o JSON para usar em outro dispositivo.");
  } catch (e) { message("Não foi possível salvar: " + e.message); } };
  $("lfDelete").onclick = () => {
    if (selectedIndex < 0 || !confirm("Excluir o caso salvo “" + savedCases[selectedIndex].name + "”?")) return;
    try { const next = savedCases.filter((_, i) => i !== selectedIndex); saveStudyCases(localStorage, key(), next);
      savedCases = next; selectedIndex = -1; options(); message("Caso excluído deste aparelho. Os dados em edição foram mantidos.");
    } catch (e) { message("Não foi possível excluir: " + e.message); }
  };
  $("lfNetwork").onchange = refreshScope;
  $("lfExportCase").onclick = () => { try { $("lfJSONText").value = JSON.stringify(collect(), null, 2); $("lfJSONTools").hidden = false;
    $("lfApplyJSON").hidden = true; $("lfImportFile").hidden = true; $("lfJSONText").readOnly = true;
  } catch (e) { message(e.message); } };
  $("lfImportCase").onclick = () => { $("lfJSONTools").hidden = false; $("lfJSONText").value = ""; $("lfJSONText").readOnly = false;
    $("lfApplyJSON").hidden = false; $("lfImportFile").hidden = false; $("lfJSONText").focus(); };
  $("lfImportFile").onclick = () => $("lfCaseFile").click();
  async function copyText(text, field) {
    field.value = text;
    try { await navigator.clipboard.writeText(text); return true; }
    catch { field.focus(); field.select(); return document.execCommand("copy"); }
  }
  $("lfCopyJSON").onclick = async () => message(await copyText($("lfJSONText").value, $("lfJSONText")) ? "JSON copiado." : "Selecione o JSON para copiar.");
  $("lfDownloadJSON").onclick = () => { try { const value = normalizeStudyCase(JSON.parse($("lfJSONText").value));
    download(JSON.stringify(value, null, 2), "SimuSystem-caso.json", "application/json"); } catch (e) { message(e.message); } };
  $("lfApplyJSON").onclick = () => { try { config = normalizeStudyCase(JSON.parse($("lfJSONText").value)); selectedIndex = -1;
    options(); populate(); $("lfJSONTools").hidden = true; message("Caso importado. Confira os equipamentos e salve neste aparelho.");
  } catch (e) { message("Não foi possível importar: " + e.message); } };
  $("lfCaseFile").onchange = async () => {
    const file = $("lfCaseFile").files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw Error("Arquivo maior que 1 MB."); config = normalizeStudyCase(JSON.parse(await file.text()));
      selectedIndex = -1; options(); populate(); tab("lfConfig"); message("Caso importado. Confira os equipamentos e salve neste aparelho.");
    } catch (e) { message("Não foi possível importar: " + e.message); } finally { $("lfCaseFile").value = ""; }
  };
  $("lfExportCSV").onclick = async () => { const result = currentResult(); if (!result) return;
    if (!isWebView) download(studyReportCSV(result), "SimuSystem-fluxo-de-carga.csv", "text/csv;charset=utf-8");
    else { $("lfReportPreview").hidden = false; message(await copyText(studyReportCSV(result), $("lfReportText")) ? "Relatório CSV copiado." : "Selecione o CSV para copiar."); }
  };
  $("lfCopyReport").onclick = async () => {
    const result = currentResult(); if (!result) return;
    const text = studyReportText(result); $("lfReportText").value = text; $("lfReportPreview").hidden = false;
    try { await navigator.clipboard.writeText(text); message("Relatório copiado."); }
    catch { $("lfReportText").select(); message(document.execCommand("copy") ? "Relatório copiado." : "Selecione o texto do relatório para copiar."); }
  };
  $("lfPrintReport").onclick = () => { const result = currentResult(); if (!result) return;
    $("lfReportText").value = studyReportText(result); dialog.classList.add("printing-report");
    const details = dialog.querySelector(".case-assumptions"), wasOpen = details.open; details.open = true;
    const after = () => { dialog.classList.remove("printing-report"); details.open = wasOpen; window.removeEventListener("afterprint", after); };
    window.addEventListener("afterprint", after); window.print();
  };
  $("applyPowerFlow").onclick = () => {
    const result = currentResult(); if (!result?.converged || $("lfNetwork").value !== "current") return;
    const values = new Map(), severity = new Map();
    for (const b of result.buses) for (const id of b.busIds) {
      values.set(id, ["AC · " + format(b.voltagePU * 100, 2) + "%", format(b.kv * b.voltagePU, 2) + " kV · " + format(b.angleDeg, 2) + "°"]);
      severity.set(id, result.alertReport.busStatus.get(b.id));
    }
    for (const b of result.branches) {
      severity.set(b.itemId, result.alertReport.branchStatus.get(b.itemId));
      if ($("lfShowFlows").checked) values.set(b.itemId, ["AC · " + format(b.pFromMW, 2) + " MW · " + format(b.qFromMvar, 2) + " MVAr", format(b.currentA, 0) + " A"]);
    }
    setOverlay({ kind: "Caso de estudo · " + result.studyCase.name, values, severity, snapshot: lastSnapshot }); dialog.close();
  };
  host.addEventListener("input", event => {
    if (!["lfCaseFile", "lfShowFlows", "lfReportText", "lfJSONText"].includes(event.target.id)) invalidate();
  });
  return { open() {
    const wanted = String(getScope()) + ":" + $("lfNetwork").value;
    if (scope !== wanted) refreshScope();
    else if (JSON.stringify(modelAtOpen) !== JSON.stringify(studyDiagram())) {
      try { config = collect(); } catch { /* Keep last valid case while refreshing equipment. */ }
      populate();
    }
    context(); onOpen(); if (!dialog.open) dialog.showModal();
  } };
}
