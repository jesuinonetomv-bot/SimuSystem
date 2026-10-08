import { PROTECTION_CURVES } from "./electrical-studies.js?v=48";
import { DEFAULT_COORDINATION_CASE, COORDINATION_STATUS, coordinationDevice, coordinationExample,
  normalizeCoordinationCase, analyzeCoordination, loadCoordinationCases, saveCoordinationCases,
  coordinationReportCSV, coordinationReportText } from "./protection-coordination.js?v=48";
import { coordinationChart, PROTECTION_COLORS } from "./protection-chart.js?v=48";
import { relayCoordinationProfile } from "./equipment-library.js?v=48";

export function attachProtectionWorkbench({ dialog, getDiagram, getScope, onOpen }) {
  const host = dialog.querySelector("#protectionWorkbench"), $ = id => dialog.querySelector("#" + id);
  const format = (v, digits = 3) => Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
  const time = v => Number.isFinite(v) ? format(v) : "Sem atuação";
  host.innerHTML = `
    <div class="case-bar"><label>Casos de coordenação neste aparelho<select id="pcSavedCases"><option value="">Caso em edição</option></select></label>
      <div class="case-buttons"><button id="pcNew" type="button">Novo</button><button id="pcDuplicate" type="button">Duplicar</button><button id="pcSave" type="button">Salvar caso</button><button id="pcDelete" type="button" disabled>Excluir</button><button id="pcExample" type="button">Carregar exemplo</button></div></div>
    <p class="study-intro" id="pcContext"></p>
    <div class="case-tabs" role="tablist" aria-label="Caso de coordenação">
      <button id="pcTabConfig" role="tab" aria-selected="true" aria-controls="pcConfig" type="button">Configuração</button>
      <button id="pcTabDevices" role="tab" aria-selected="false" aria-controls="pcDevices" tabindex="-1" type="button">Dispositivos</button>
      <button id="pcTabResults" role="tab" aria-selected="false" aria-controls="pcResults" tabindex="-1" type="button">Curvas e resultados</button></div>
    <section id="pcConfig" class="case-panel" role="tabpanel" aria-labelledby="pcTabConfig">
      <div class="case-fields"><label class="wide">Nome do caso de coordenação<input id="pcName" maxlength="100"></label>
        <label>Tensão de referência (kV)<input id="pcReferenceKV" type="number" min="0.001" max="1000" step="any"></label>
        <label>Corrente passante mínima (A referência)<input id="pcMin" type="number" min="0.000001" max="1000000000" step="any"></label>
        <label>Corrente passante máxima (A referência)<input id="pcMax" type="number" min="0.000001" max="1000000000" step="any"></label>
        <label>Corrente de avaliação (A referência)<input id="pcEvaluation" type="number" min="0.000001" max="1000000000" step="any"></label>
        <label>Margem adicional exigida (s)<input id="pcMargin" type="number" min="0" max="3600" step="0.01"></label>
        <label class="wide">Observações da coordenação<textarea id="pcNotes" maxlength="1000" rows="2" placeholder="Caminho da falta, critérios e origem das correntes"></textarea></label></div>
      <p class="study-note">Informe a corrente que passa pelo caminho da falta. A corrente total de curto de uma barra pode se dividir entre fontes e alimentadores. A ordem dos dispositivos e esse caminho precisam ser confirmados no unifilar.</p>
      <p class="study-note">A margem compara o relé a montante, no seu tempo mais cedo, com a eliminação mais tarde da falta a jusante, incluindo o disjuntor. O valor adicional é um critério deste caso; 0,20 s é um ponto inicial didático, ajustável.</p>
      <div class="case-buttons"><button id="pcExportCase" type="button">Exportar caso JSON</button><button id="pcImportCase" type="button">Importar caso JSON</button><input id="pcCaseFile" type="file" accept=".json,application/json" hidden></div>
      <div id="pcJSONTools" class="case-json-tools" hidden><label>JSON do caso de coordenação<textarea id="pcJSONText" rows="7"></textarea></label>
        <div class="case-buttons"><button id="pcCopyJSON" type="button">Copiar JSON</button><button id="pcDownloadJSON" type="button">Baixar JSON</button><button id="pcApplyJSON" type="button">Importar texto</button><button id="pcImportFile" type="button">Escolher arquivo JSON</button></div></div></section>
    <section id="pcDevices" class="case-panel" role="tabpanel" aria-labelledby="pcTabDevices" hidden>
      <div class="pc-device-heading"><div><h3>Caminho declarado da falta</h3><p>Jusante → montante · até 8 proteções de fase</p></div><div class="case-buttons"><button id="pcAddDevice" type="button">Adicionar proteção</button></div></div>
      <p class="study-note">Selecione um relé com TC e disjuntor vinculados ou um disjuntor para copiar os ajustes de fase, ou configure uma proteção manual. Depois de copiados, os ajustes ficam no caso e podem ser editados. Tensão local e relação do TC referem as correntes a uma base comum.</p>
      <div id="pcDeviceList"></div><p id="pcEmptyDevices" class="pc-empty">Adicione as proteções do caminho ou carregue o exemplo didático.</p></section>
    <section id="pcResults" class="case-panel" role="tabpanel" aria-labelledby="pcTabResults" hidden>
      <div class="case-report-heading"><h3 id="pcResultTitle"></h3><p id="pcResultDate"></p></div><div class="case-stats" id="pcStats"></div>
      <div class="case-buttons"><button id="pcExportCSV" type="button" disabled>Exportar CSV</button><button id="pcCopyReport" type="button" disabled>Copiar relatório</button><button id="pcPrint" type="button" disabled>Imprimir relatório</button></div>
      <div class="pc-plot-controls"><label class="case-check"><input id="pcShowBands" type="checkbox" checked>Bandas de tempo assumidas</label><label class="case-check"><input id="pcShowRelay" type="checkbox">Mostrar tempo só do relé</label></div>
      <div id="pcLegend" class="pc-legend"></div><div class="pc-chart-scroll"><svg id="pcChart" class="tcc-chart" viewBox="0 0 780 490" role="img" aria-label="Curvas de coordenação tempo corrente"></svg></div><p class="study-note" id="pcChartCaption"></p>
      <h3>Margens entre proteções adjacentes</h3><div class="case-table-scroll"><table class="study-table"><thead><tr><th>Jusante → montante</th><th>Situação na faixa amostrada</th><th>Menor margem (s)</th><th>I na menor margem (A ref.)</th><th>Jusante: eliminação mais tarde (s)</th><th>Montante: relé mais cedo (s)</th><th>Margem no ponto (s)</th></tr></thead><tbody id="pcPairRows"></tbody></table></div>
      <div id="pcAlertList" class="case-alert-list"></div>
      <h3 id="pcPointHeading">Tempos previstos para falta persistente</h3><div class="case-table-scroll"><table class="study-table"><thead><tr><th>Proteção / ordem</th><th>I primário local (A)</th><th>I secundário TC ideal (A)</th><th>Pickup primário (A)</th><th>Elemento</th><th>Relé nominal (s)</th><th>Relé + disjuntor (s)</th><th>Relé mais cedo (s)</th><th>Eliminação mais tarde (s)</th></tr></thead><tbody id="pcPointRows"></tbody></table></div>
      <p class="study-note">A falta permanece aplicada neste cálculo de tempos. Se a proteção a jusante eliminar a falta, as proteções seguintes podem não atuar. A menor margem é a encontrada nas amostras da faixa, sem certificação de seletividade.</p>
      <details class="case-assumptions"><summary>Hipóteses, critérios e limitações do estudo</summary><p id="pcAssumptions"></p></details>
      <div id="pcReportPreview" class="case-json-tools" hidden><label>Relatório de coordenação<textarea id="pcReportText" rows="9" readonly></textarea></label></div></section>
    <div class="case-run"><button id="pcRun" type="button">Analisar coordenação</button><p id="pcSummary" role="status" aria-live="polite"></p></div>`;
  const isWebView = /\bwv\b|SimuSystemAndroid/i.test(navigator.userAgent);
  if (isWebView) { $("pcPrint").hidden = true; $("pcDownloadJSON").hidden = true; $("pcExportCSV").textContent = "Copiar CSV"; }
  let config = structuredClone(DEFAULT_COORDINATION_CASE), cases = [], scope = "", selectedIndex = -1;
  let lastResult = null, lastSnapshot = "", lastConfig = "", modelAtOpen = null;
  const storageKey = () => "simuCoordinationCases:v1:" + scope;
  const fields = { name: "pcName", notes: "pcNotes", referenceKV: "pcReferenceKV", rangeMinA: "pcMin", rangeMaxA: "pcMax", evaluationA: "pcEvaluation", marginSeconds: "pcMargin" };
  const message = text => { $("pcSummary").textContent = text; };
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
      const next = event.key === "ArrowRight" ? (i + 1) % tabs.length : event.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
    };
  }
  function invalidate(text = "Caso alterado. Analise novamente para atualizar as curvas e o relatório.") {
    lastResult = null;
    for (const id of ["pcExportCSV", "pcCopyReport", "pcPrint"]) $(id).disabled = true;
    for (const id of ["pcStats", "pcLegend", "pcChart", "pcPairRows", "pcPointRows", "pcAlertList"]) $(id).replaceChildren();
    for (const id of ["pcResultTitle", "pcResultDate", "pcAssumptions", "pcChartCaption"]) $(id).textContent = "";
    $("pcReportPreview").hidden = true; message(text);
  }
  function deviceUI(card) {
    const curve = card.querySelector('[data-field="protectionCurve"]').value;
    for (const label of card.querySelectorAll("[data-inverse]")) label.hidden = curve === "definite";
    for (const label of card.querySelectorAll("[data-definite]")) label.hidden = curve !== "definite";
    const secondary = card.querySelector('[data-field="inputBasis"]').value === "secondary";
    card.querySelector("[data-pickup-label]").textContent = secondary ? "Pickup secundário (A)" : "Pickup primário local (A)";
    card.querySelector("[data-instant-label]").textContent = secondary ? "Instantâneo secundário (A; 0 desliga)" : "Instantâneo primário local (A; 0 desliga)";
  }
  function renderDevices() {
    $("pcDeviceList").replaceChildren(); $("pcEmptyDevices").hidden = !!config.devices.length;
    $("pcAddDevice").disabled = config.devices.length >= 8;
    config.devices.forEach((d, i) => {
      const card = document.createElement("fieldset"); card.className = "protection-device"; card.dataset.deviceId = d.id; card.style.borderLeftColor = PROTECTION_COLORS[i];
      card.innerHTML = `<legend></legend><div class="case-buttons pc-device-actions"><button type="button" data-action="up">Mover a jusante</button><button type="button" data-action="down">Mover a montante</button><button type="button" data-action="remove">Remover</button></div><div class="case-fields">
        <label class="wide">Nome da proteção<input data-field="name" maxlength="100"></label>
        <label class="wide">Copiar do equipamento<select data-field="equipmentId"></select></label>
        <label class="wide">Curva genérica<select data-field="protectionCurve"></select></label>
        <label>Tensão local (kV)<input data-field="deviceKV" type="number" min="0.001" max="1000" step="any"></label>
        <label>Base dos ajustes<select data-field="inputBasis"><option value="primary">Primário local</option><option value="secondary">Secundário do TC</option></select></label>
        <label>TC primário (A)<input data-field="ctPrimary" type="number" min="0.000001" max="10000000" step="any"></label>
        <label>TC secundário (A)<input data-field="ctSecondary" type="number" min="0.000001" max="100" step="any"></label>
        <label><span data-pickup-label>Pickup primário local (A)</span><input data-field="pickupA" type="number" min="0.000001" max="1000000000" step="any"></label>
        <label data-inverse>Multiplicador da equação (TMS)<input data-field="timeMultiplier" type="number" min="0.000001" max="10000" step="any"></label>
        <label data-definite hidden>Tempo definido (s)<input data-field="definiteTime" type="number" min="0.000001" max="86400" step="any"></label>
        <label><span data-instant-label>Instantâneo primário local (A; 0 desliga)</span><input data-field="instantaneousA" type="number" min="0" max="1000000000" step="any"></label>
        <label>Tempo instantâneo (s)<input data-field="instantaneousTime" type="number" min="0" max="120" step="any"></label>
        <label>Tempo do disjuntor (s)<input data-field="breakerTime" type="number" min="0" max="120" step="any"></label>
        <label>Tolerância de tempo (±%)<input data-field="timeTolerancePercent" type="number" min="0" max="99" step="any"></label>
        <label>Tolerância de tempo (±s)<input data-field="timeToleranceSeconds" type="number" min="0" max="120" step="any"></label></div>
        <p class="study-note">O multiplicador aplica t = k × [A / (M^p − 1) + B]; o dial de um fabricante pode usar outra escala. As tolerâncias são hipóteses de tempo do caso, sem banda de pickup ou saturação do TC.</p>`;
      card.querySelector("legend").textContent = (i + 1) + " · " + (i === 0 ? "Jusante" : i === config.devices.length - 1 ? "Montante" : "Intermediária");
      const equipment = card.querySelector('[data-field="equipmentId"]'); equipment.add(new Option("Manual · ajustes deste caso", ""));
      for (const [id, o] of Object.entries(getDiagram().items || {})) if (["breaker", "relay"].includes(o.type) && Object.hasOwn(PROTECTION_CURVES, o.electrical?.protectionCurve)) equipment.add(new Option((o.name || id) + (o.type === "relay" ? " · relé" : " · disjuntor"), id));
      if (d.equipmentId && ![...equipment.options].some(o => o.value === d.equipmentId)) equipment.add(new Option("Equipamento salvo ausente ou sem curva · conferir", d.equipmentId));
      const curve = card.querySelector('[data-field="protectionCurve"]'); for (const [id, c] of Object.entries(PROTECTION_CURVES)) curve.add(new Option(c.name, id));
      for (const input of card.querySelectorAll("[data-field]")) { input.id = `pcDevice-${i}-${input.dataset.field}`; input.value = d[input.dataset.field]; }
      const up = card.querySelector('[data-action="up"]'), down = card.querySelector('[data-action="down"]'); up.disabled = i === 0; down.disabled = i === config.devices.length - 1;
      for (const button of card.querySelectorAll("[data-action]")) {
        button.setAttribute("aria-label", button.textContent + " · " + d.name);
        button.onclick = () => { try {
          config = collect(); const action = button.dataset.action;
          if (action === "remove") config.devices.splice(i, 1);
          else { const j = action === "up" ? i - 1 : i + 1; [config.devices[i], config.devices[j]] = [config.devices[j], config.devices[i]]; }
          renderDevices(); invalidate();
        } catch (e) { message(e.message); } };
      }
      equipment.onchange = () => {
        const o = getDiagram().items?.[equipment.value];
        if (["breaker", "relay"].includes(o?.type) && Object.hasOwn(PROTECTION_CURVES, o.electrical?.protectionCurve)) {
          let data;
          try { data = relayCoordinationProfile(o, getDiagram().items); }
          catch (error) { equipment.value = ""; message(error.message); return; }
          for (const key of ["protectionCurve", "pickupA", "timeMultiplier", "definiteTime", "instantaneousA", "instantaneousTime", "breakerTime", "ctPrimary", "ctSecondary"])
            if (data[key] != null) card.querySelector(`[data-field="${key}"]`).value = data[key];
          card.querySelector('[data-field="name"]').value = o.name || equipment.value;
          card.querySelector('[data-field="deviceKV"]').value = data.nominalKV ?? "";
          card.querySelector('[data-field="inputBasis"]').value = data.inputBasis || "primary";
          message(data.nominalKV > 0 ? "Ajustes de fase copiados para o caso. Confirme os vínculos, a relação do TC e as tolerâncias." : "Ajustes copiados. Informe a tensão local que não consta no cadastro.");
        }
        deviceUI(card);
      };
      $("pcDeviceList").append(card); deviceUI(card);
    });
  }
  function collect() {
    const value = { ...config, devices: [] };
    for (const [key, id] of Object.entries(fields)) value[key] = $(id).value;
    for (const card of $("pcDeviceList").querySelectorAll("[data-device-id]")) {
      const device = { id: card.dataset.deviceId };
      for (const input of card.querySelectorAll("[data-field]")) device[input.dataset.field] = input.value;
      value.devices.push(device);
    }
    return normalizeCoordinationCase(value);
  }
  function savedOptions() {
    $("pcSavedCases").replaceChildren(new Option("Caso em edição", ""));
    cases.forEach((c, i) => $("pcSavedCases").add(new Option(c.name, String(i))));
    $("pcSavedCases").value = selectedIndex < 0 ? "" : String(selectedIndex); $("pcDelete").disabled = selectedIndex < 0;
  }
  function populate() {
    for (const [key, id] of Object.entries(fields)) $(id).value = config[key];
    modelAtOpen = structuredClone(getDiagram()); renderDevices();
    $("pcJSONTools").hidden = true; invalidate("Configure o caso e as proteções. Clique em Analisar coordenação.");
  }
  function cell(row, value) { const td = document.createElement("td"); td.textContent = String(value); row.append(td); return td; }
  function chart() {
    if (!lastResult) return;
    const plot = coordinationChart(lastResult.studyCase, { showRelay: $("pcShowRelay").checked, showBands: $("pcShowBands").checked });
    $("pcChart").innerHTML = plot.svg; $("pcChart").setAttribute("viewBox", `0 0 ${plot.width} ${plot.height}`);
    $("pcChartCaption").textContent = plot.caption; $("pcLegend").replaceChildren();
    lastResult.studyCase.devices.forEach((d, i) => { const item = document.createElement("span"), mark = document.createElement("i");
      mark.style.backgroundColor = PROTECTION_COLORS[i]; item.append(mark, document.createTextNode((i + 1) + " · " + d.name)); $("pcLegend").append(item); });
  }
  function run() {
    invalidate("Analisando…");
    try {
      config = collect(); const model = getDiagram(), r = analyzeCoordination(config, model);
      lastResult = r; lastConfig = JSON.stringify(config); lastSnapshot = JSON.stringify(model);
      $("pcResultTitle").textContent = config.name; $("pcResultDate").textContent = r.diagramName + " · referência " + format(config.referenceKV, 3) + " kV · " + new Date(r.completedAt).toLocaleString("pt-BR");
      const stats = [["Faixa passante (A ref.)", format(config.rangeMinA, 0) + "–" + format(config.rangeMaxA, 0)],
        ["Margem adicional", format(config.marginSeconds) + " s"], ["Amostras por par", String(r.sampleCount)]];
      for (const [label, value] of stats) { const card = document.createElement("div"), small = document.createElement("small"), strong = document.createElement("strong"); small.textContent = label; strong.textContent = value; card.append(small, strong); $("pcStats").append(card); }
      for (const p of r.pairs) {
        const row = document.createElement("tr"); if (p.status !== "sufficient") row.className = p.status === "insufficient" ? "study-critical" : "study-warning";
        [p.downstream + " → " + p.upstream, COORDINATION_STATUS[p.status], format(p.worst?.gap), format(p.worst?.referenceA, 1),
          time(p.worst?.downstreamLatest), time(p.worst?.upstreamEarliest), format(p.evaluation.gap)].forEach(v => cell(row, v)); $("pcPairRows").append(row);
        const note = document.createElement("p"); note.className = row.className;
        const issues = p.ranges.slice(0, 6).map(range => format(range.startA, 1) + "–" + format(range.endA, 1) + " A ref.: " + COORDINATION_STATUS[range.status]);
        note.textContent = p.downstream + " → " + p.upstream + ": " + (issues.length ? issues.join("; ") + (p.ranges.length > 6 ? "; outras faixas no relatório" : "") : COORDINATION_STATUS[p.status]) +
          (p.evaluation.reason ? ". No ponto avaliado: " + p.evaluation.reason : ""); $("pcAlertList").append(note);
      }
      $("pcPointHeading").textContent = "Tempos para falta persistente · " + format(config.evaluationA, 1) + " A ref.";
      r.evaluation.forEach((d, i) => { const row = document.createElement("tr");
        [(i + 1) + " · " + d.name, format(d.localA, 1), format(d.secondaryA), format(d.pickupPrimaryA, 1),
          { none: "Sem atuação", timed: "Temporizado", instantaneous: "Instantâneo" }[d.element], time(d.relayTime), time(d.totalTime), time(d.relayEarliest), time(d.totalLatest)].forEach(v => cell(row, v)); $("pcPointRows").append(row); });
      $("pcAssumptions").textContent = [...r.warnings, r.assumptions].join("\n"); chart();
      for (const id of ["pcExportCSV", "pcCopyReport", "pcPrint"]) $(id).disabled = false;
      const insufficient = r.pairs.filter(p => p.status === "insufficient").length, pending = r.pairs.filter(p => ["mixed", "pending"].includes(p.status)).length;
      message(`${r.pairs.length} pares avaliados · ${insufficient} com margem insuficiente · ${pending} com atuação ou retaguarda pendente.`); tab("pcResults");
    } catch (e) { invalidate("Não foi possível analisar: " + e.message); }
  }
  function currentResult() {
    if (!lastResult) return null;
    try { if (JSON.stringify(getDiagram()) !== lastSnapshot || JSON.stringify(collect()) !== lastConfig) { invalidate("O modelo ou o caso mudou. Analise novamente antes de usar o relatório."); return null; } }
    catch (e) { invalidate(e.message); return null; }
    return lastResult;
  }
  const download = (text, filename, type) => { const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); };
  async function copy(text, field) { field.value = text; try { await navigator.clipboard.writeText(text); return true; }
    catch { field.focus(); field.select(); return document.execCommand("copy"); } }
  function importCase(text) {
    if (text.length > 1024 * 1024) throw Error("Caso maior que 1 MB.");
    config = normalizeCoordinationCase(JSON.parse(text)); selectedIndex = -1; savedOptions(); populate(); tab("pcConfig");
    message("Caso importado. Confira as referências de equipamento, o caminho e a origem das correntes.");
  }
  $("pcRun").onclick = run;
  $("pcAddDevice").onclick = () => { try { config = collect(); if (config.devices.length >= 8) return;
    config.devices.push({ ...coordinationDevice(config.devices.length, config.referenceKV), id: "device-" + crypto.randomUUID() }); renderDevices(); invalidate();
  } catch (e) { message(e.message); } };
  $("pcExample").onclick = () => { config = coordinationExample(); selectedIndex = -1; savedOptions(); populate(); tab("pcDevices"); message("Exemplo com três proteções manuais. As correntes e tolerâncias são valores didáticos."); };
  $("pcNew").onclick = () => { config = structuredClone(DEFAULT_COORDINATION_CASE); selectedIndex = -1; savedOptions(); populate(); tab("pcConfig"); };
  $("pcDuplicate").onclick = () => { try { config = collect(); config.name = config.name.slice(0, 85) + " · cópia"; selectedIndex = -1; savedOptions(); populate(); tab("pcConfig"); } catch (e) { message(e.message); } };
  $("pcSavedCases").onchange = () => { selectedIndex = $("pcSavedCases").value === "" ? -1 : +$("pcSavedCases").value;
    config = selectedIndex < 0 ? structuredClone(DEFAULT_COORDINATION_CASE) : structuredClone(cases[selectedIndex]); savedOptions(); populate(); tab("pcConfig"); };
  $("pcSave").onclick = () => { try { const c = collect(), next = [...cases], index = selectedIndex < 0 ? cases.length : selectedIndex; next[index] = c;
    saveCoordinationCases(localStorage, storageKey(), next); cases = next; selectedIndex = index; config = c; savedOptions(); message("Caso salvo neste aparelho. JSON permite transferir os parâmetros.");
  } catch (e) { message("Não foi possível salvar: " + e.message); } };
  $("pcDelete").onclick = () => { try { if (selectedIndex < 0) return; const next = cases.filter((_, i) => i !== selectedIndex); saveCoordinationCases(localStorage, storageKey(), next);
    cases = next; selectedIndex = -1; savedOptions(); message("Caso excluído; os valores continuam em edição."); } catch (e) { message(e.message); } };
  $("pcExportCase").onclick = () => { try { $("pcJSONText").value = JSON.stringify(collect(), null, 2); $("pcJSONTools").hidden = false; } catch (e) { message(e.message); } };
  $("pcImportCase").onclick = () => { $("pcJSONText").value = ""; $("pcJSONTools").hidden = false; $("pcJSONText").focus(); };
  $("pcCopyJSON").onclick = async () => message(await copy($("pcJSONText").value, $("pcJSONText")) ? "JSON copiado." : "Selecione o JSON para copiar.");
  $("pcDownloadJSON").onclick = () => { try { download(JSON.stringify(normalizeCoordinationCase(JSON.parse($("pcJSONText").value)), null, 2), "SimuSystem-coordenacao.json", "application/json"); } catch (e) { message(e.message); } };
  $("pcApplyJSON").onclick = () => { try { importCase($("pcJSONText").value); } catch (e) { message("Não foi possível importar: " + e.message); } };
  $("pcImportFile").onclick = () => $("pcCaseFile").click();
  $("pcCaseFile").onchange = async () => { const file = $("pcCaseFile").files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw Error("Arquivo maior que 1 MB."); importCase(await file.text()); } catch (e) { message(e.message); } finally { $("pcCaseFile").value = ""; } };
  $("pcExportCSV").onclick = async () => { const r = currentResult(); if (!r) return;
    if (!isWebView) download(coordinationReportCSV(r), "SimuSystem-coordenacao.csv", "text/csv;charset=utf-8");
    else { $("pcReportPreview").hidden = false; message(await copy(coordinationReportCSV(r), $("pcReportText")) ? "CSV copiado." : "Selecione o CSV para copiar."); } };
  $("pcCopyReport").onclick = async () => { const r = currentResult(); if (!r) return; $("pcReportPreview").hidden = false;
    message(await copy(coordinationReportText(r), $("pcReportText")) ? "Relatório copiado." : "Selecione o relatório para copiar."); };
  $("pcPrint").onclick = () => { if (!currentResult()) return; const details = dialog.querySelector(".case-assumptions"), wasOpen = details.open; details.open = true; dialog.classList.add("printing-report");
    try { window.print(); } finally { dialog.classList.remove("printing-report"); details.open = wasOpen; } };
  for (const id of ["pcShowBands", "pcShowRelay"]) $(id).onchange = () => { if (currentResult()) chart(); };
  host.addEventListener("input", event => {
    if (["pcJSONText", "pcReportText", "pcCaseFile", "pcSavedCases", "pcShowRelay", "pcShowBands"].includes(event.target.id)) return;
    const card = event.target.closest(".protection-device"); if (card) deviceUI(card);
    invalidate();
  });
  return { open() {
    const wanted = String(getScope?.() || "local");
    if (scope !== wanted) { scope = wanted; cases = loadCoordinationCases(localStorage, storageKey()); selectedIndex = -1; config = structuredClone(DEFAULT_COORDINATION_CASE); savedOptions(); populate(); tab("pcConfig"); }
    else if (JSON.stringify(modelAtOpen) !== JSON.stringify(getDiagram())) { try { config = collect(); } catch { /* Keep the last valid case. */ } populate(); }
    $("pcContext").textContent = (getDiagram().name || "Sistema atual") + " · estudo de fase em caminho declarado. Ajustes do caso e exemplos não alteram a operação.";
    onOpen(); if (!dialog.open) dialog.showModal();
  } };
}
