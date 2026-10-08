import { FAULT_TYPES, DEFAULT_SEQUENCE_CASE, normalizeSequenceCase } from "./fault-analysis.js?v=49";
import { simulateFaultSequence, sequenceExample, SEQUENCE_STATUS, PROTECTION_STATUS, sequenceReportCSV, sequenceReportText } from "./fault-sequence.js?v=49";
import { createSwitchingStudy } from "./switching-analysis.js?v=49";
import { renderTechnicalSymbol, renderInstrumentLinks } from "./technical-symbols.js?v=49";
import { attachDiagramGestures } from "./diagram-gestures.js?v=42";
import { equipmentTypeLabel, isInstrument } from "./equipment-library.js?v=49";

export function attachFaultSequenceWorkbench({ dialog, getDiagram, getScope, networkOptions = {}, onOpen }) {
  const host = dialog.querySelector("#faultSequenceWorkbench"), $ = id => host.querySelector("#" + id);
  const format = (v, digits = 3) => Number.isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
  const seconds = v => Number.isFinite(v) ? format(v * 1000, 1) + " ms" : "Sem atuação";
  host.innerHTML = `
    <div class="case-bar"><label>Modelo<select id="fsNetwork"><option value="current">Estado atual do sistema</option><option value="example">Exemplo didático · alimentador</option></select></label>
      <label>Casos salvos neste aparelho<select id="fsCases"><option value="">Caso em edição</option></select></label>
      <div class="case-buttons"><button type="button" id="fsNew">Novo</button><button type="button" id="fsSave">Salvar caso</button><button type="button" id="fsDelete" disabled>Excluir</button></div></div>
    <p class="study-intro" id="fsContext"></p>
    <div class="case-fields fs-fields"><label class="wide">Nome do caso<input id="fsName" maxlength="100"></label>
      <label>Tipo de curto<select id="fsType"><option value="LL">Entre fases</option><option value="LG">Fase-terra</option><option value="3P">Trifásico</option></select></label>
      <label>Fases envolvidas<select id="fsPhases"></select></label>
      <label class="wide">Ponto da falta<select id="fsPoint"></select></label>
      <label id="fsPositionLabel">Posição no trecho (% desde A)<input id="fsPosition" type="number" min="0" max="100" step="any" value="50"></label>
      <label id="fsPortLabel" hidden>Terminal<select id="fsPort"><option value="0">A / primário</option><option value="1">B / secundário</option></select></label>
      <label>R da falta (Ω)<input id="fsR" type="number" min="0" max="1000000" step="any" value="0"></label>
      <label>X da falta (Ω)<input id="fsX" type="number" min="0" max="1000000" step="any" value="0"></label>
      <label>Intervalo máximo (s)<input id="fsMax" type="number" min="0.001" max="120" step="any" value="60"></label></div>
    <details class="fs-advanced"><summary>Parâmetros do cálculo</summary><div class="case-fields">
      <label>Potência-base (MVA)<input id="fsBase" type="number" min="0.001" max="1000000" step="any" value="100"></label>
      <label>Tensão pré-falta (pu)<input id="fsVoltage" type="number" min="0.5" max="1.5" step="any" value="1"></label></div></details>
    <div class="study-actions"><button id="fsRun" type="button" class="fs-primary">Calcular quem atua</button><button id="fsReset" type="button">Restaurar reprodução</button>
      <button id="fsExportCase" type="button">Exportar caso JSON</button><button id="fsImportCase" type="button">Importar caso JSON</button><input id="fsFile" type="file" accept=".json,application/json" hidden></div>
    <p id="fsMessage" class="fs-message" role="status" aria-live="polite"></p>
    <div id="fsStats" class="case-stats fs-stats" hidden></div>
    <div class="fs-layout"><section class="fs-diagram-panel"><div class="fs-diagram-head"><div><strong>Unifilar do estudo</strong><small>Toque sem arrastar para posicionar o curto.</small></div>
      <label>Aba exibida<select id="fsView"></select></label></div><div id="fsViewport" class="fs-viewport"><svg id="fsDiagram" class="technical" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Unifilar interativo para escolher a falta e reproduzir a atuação das proteções"></svg></div>
      <p class="study-note">Arraste para navegar. A reprodução usa uma cópia do sistema; relés e disjuntores atuam apenas neste estudo.</p></section>
      <section class="fs-events-panel"><div class="fs-events-head"><h3>Sequência de atuação</h3><output id="fsTime">0,0 ms</output></div>
        <div class="fs-playback"><button type="button" id="fsFirst" disabled aria-label="Ir ao início">Início</button><button type="button" id="fsPrevious" disabled aria-label="Evento anterior">Anterior</button>
          <button type="button" id="fsPlay" disabled>Reproduzir</button><button type="button" id="fsNext" disabled aria-label="Próximo evento">Próximo</button></div>
        <label class="fs-slider">Evento exibido<input id="fsSlider" type="range" min="0" max="0" step="1" value="0" disabled></label>
        <p id="fsEventDescription" class="fs-event-description">Escolha o ponto e calcule o curto.</p>
        <div class="case-table-scroll"><table class="study-table fs-event-table"><thead><tr><th>Tempo</th><th>Equipamento</th><th>Atuação</th></tr></thead><tbody id="fsEventRows"></tbody></table></div></section></div>
    <section class="fs-protections"><h3>Proteções de fase e terra</h3><p class="study-note">A corrente é calculada no sensor de cada proteção. Os tempos previstos valem enquanto a falta persistir; a sequência registra as atuações efetivas.</p>
      <div class="case-table-scroll"><table class="study-table"><thead><tr><th>Proteção / disjuntor</th><th>Função</th><th>I inicial no sensor</th><th>Relé previsto</th><th>Abertura prevista</th><th>Resultado</th></tr></thead><tbody id="fsProtectionRows"></tbody></table></div></section>
    <div class="study-actions"><button id="fsCSV" type="button" disabled>Relatório CSV</button><button id="fsText" type="button" disabled>Relatório TXT</button></div>
    <details class="fs-details"><summary>Dados necessários e hipóteses</summary><p class="study-note">Cadastre em Modelagem → Dados elétricos: MVA/X-R das fontes, Z₂, Z₀ e aterramento; grupo horário e ligações dos transformadores; R₀/X₀ dos cabos. No relé, habilite 50/51 ou 50N/51N e vincule o TC/sensor e o disjuntor. O símbolo de aterramento não define a rede de sequência zero.</p>
      <p id="fsAssumptions" class="study-note"></p><ul id="fsWarnings"></ul></details>
    <div id="fsExportFallback" class="case-json-tools" hidden><label id="fsExportLabel">Conteúdo para copiar<textarea id="fsExportContent" rows="7"></textarea></label><button type="button" id="fsCopy">Copiar conteúdo</button><button type="button" id="fsApplyJSON">Importar texto JSON</button></div>`;
  const svg = $("fsDiagram"), viewport = $("fsViewport"), segment = o => ["bus", "line", "cable"].includes(o?.type);
  const power = o => ["bus", "line", "cable", "breaker", "disconnector", "fuse", "transformer", "utility", "turbogenerator", "load", "motor", "capacitor"].includes(o?.type);
  const prefix = id => id.includes("::") ? id.slice(0, id.indexOf("::") + 2) : "";
  const E = (tag, attrs = {}, value = "") => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (value !== "") e.textContent = value; return e; };
  let result = null, model = null, graph = null, cursor = 0, timer = null, cases = [], selectedCase = "", views = [], exportKind = "";
  const network = () => $("fsNetwork").value === "example" ? sequenceExample() : getDiagram();
  const options = () => $("fsNetwork").value === "example" ? {} : networkOptions;
  const storageKey = () => "simuFaultSequences:" + (getScope?.() || "system") + ":" + $("fsNetwork").value;
  function message(text, error = false) { $("fsMessage").textContent = text; $("fsMessage").classList.toggle("error", error); }
  function stop() { if (timer != null) clearTimeout(timer); timer = null; $("fsPlay").textContent = "Reproduzir"; }
  function phases(value) {
    $("fsPhases").replaceChildren();
    for (const p of $("fsType").value === "LG" ? ["A", "B", "C"] : $("fsType").value === "LL" ? ["AB", "BC", "CA"] : ["ABC"]) $("fsPhases").add(new Option(p.split("").join("-") + ($("fsType").value === "LG" ? "-terra" : ""), p));
    if ([...$("fsPhases").options].some(o => o.value === value)) $("fsPhases").value = value;
  }
  function pointFields() {
    const o = model?.items[$("fsPoint").value]; $("fsPositionLabel").hidden = !segment(o); $("fsPortLabel").hidden = segment(o) || !o || (graph?.ports.get($("fsPoint").value)?.length || 0) < 2;
  }
  function read() {
    return normalizeSequenceCase({ name: $("fsName").value, faultType: $("fsType").value, phases: $("fsPhases").value,
      location: { itemId: $("fsPoint").value, fraction: $("fsPosition").value === "" ? "" : +$("fsPosition").value / 100, port: $("fsPort").value },
      baseMVA: $("fsBase").value, voltageFactor: $("fsVoltage").value, faultRohm: $("fsR").value, faultXohm: $("fsX").value, maxSeconds: $("fsMax").value });
  }
  function fill(c) {
    $("fsName").value = c.name; $("fsType").value = c.faultType; phases(c.phases);
    $("fsPoint").value = c.location.itemId; $("fsPosition").value = c.location.fraction * 100; $("fsPort").value = String(c.location.port);
    for (const [id, key] of [["fsR", "faultRohm"], ["fsX", "faultXohm"], ["fsBase", "baseMVA"], ["fsVoltage", "voltageFactor"], ["fsMax", "maxSeconds"]]) $(id).value = c[key];
    pointFields(); invalidate(false);
  }
  function listCases() {
    try { cases = JSON.parse(localStorage.getItem(storageKey()) || "[]"); } catch { cases = []; }
    if (!Array.isArray(cases)) cases = [];
    cases = cases.slice(0, 40).flatMap(c => { try { return [normalizeSequenceCase(c)]; } catch { return []; } });
    $("fsCases").replaceChildren(new Option("Caso em edição", ""));
    cases.forEach((c, i) => $("fsCases").add(new Option(c.name, String(i)))); $("fsCases").value = selectedCase; $("fsDelete").disabled = selectedCase === "";
  }
  function loadModel() {
    model = structuredClone(network()); graph = createSwitchingStudy(model, options()).network();
    const previous = $("fsPoint").value; $("fsPoint").replaceChildren(new Option("Selecione ou toque no unifilar", ""));
    for (const [id, o] of Object.entries(model.items || {})) if (power(o)) $("fsPoint").add(new Option((o.name || "Sem TAG") + " · " + equipmentTypeLabel(o.type) + (prefix(id) ? " · outra aba" : ""), id));
    if (model.items[previous] && power(model.items[previous])) $("fsPoint").value = previous;
    const scopes = [...new Set(Object.keys(model.items || {}).map(prefix))]; views = scopes.map((id, i) => ({ id, name: id === "" ? "Diagrama atual" : "Aba conectada " + (i + (scopes.includes("") ? 0 : 1)) }));
    $("fsView").replaceChildren(); for (const v of views) $("fsView").add(new Option(v.name, v.id));
    $("fsContext").textContent = "Modelo: " + (model.name || "Sistema atual") + ". Curto e atuação calculados nas abas carregadas conectadas a este sistema.";
    pointFields(); render();
  }
  function setViewFor(id) { const p = prefix(id); if (views.some(v => v.id === p)) $("fsView").value = p; }
  function invalidate(notify = true) {
    stop(); result = null; cursor = 0; $("fsEventRows").replaceChildren(); $("fsProtectionRows").replaceChildren(); $("fsStats").hidden = true;
    for (const id of ["fsPlay", "fsFirst", "fsPrevious", "fsNext", "fsSlider", "fsCSV", "fsText"]) $(id).disabled = true;
    $("fsSlider").max = 0; $("fsSlider").value = 0; $("fsTime").textContent = "0,0 ms";
    $("fsEventDescription").textContent = "Escolha o ponto e calcule o curto."; $("fsWarnings").replaceChildren(); $("fsAssumptions").textContent = "";
    if (notify) message("O caso mudou. Calcule novamente para atualizar a sequência.");
    render();
  }
  function markerPoint() {
    if (result) return result.initial.point;
    const o = model?.items[$("fsPoint").value], ps = graph?.ports.get($("fsPoint").value); if (!o || !ps?.length) return null;
    if (segment(o)) { const t = +$("fsPosition").value / 100; return { x: o.x1 + t * (o.x2 - o.x1), y: o.y1 + t * (o.y2 - o.y1) }; }
    return graph.points.get(ps[+$("fsPort").value] || ps[0]);
  }
  function render() {
    if (!model || !graph) return; svg.replaceChildren();
    const scope = $("fsView").value, entries = Object.entries(model.items).filter(([id, o]) => prefix(id) === scope && (power(o) || isInstrument(o)));
    if (!entries.length) { svg.setAttribute("viewBox", "0 0 600 400"); svg.append(E("text", { x: 30, y: 80, class: "fs-empty" }, "Nenhum equipamento nesta aba.")); return; }
    const coords = entries.flatMap(([, o]) => o.x != null ? [{ x: +o.x, y: +o.y }] : [{ x: +o.x1, y: +o.y1 }, { x: +o.x2, y: +o.y2 }]).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!coords.length) return;
    const minX = Math.min(...coords.map(p => p.x)) - 100, minY = Math.min(...coords.map(p => p.y)) - 100, maxX = Math.max(...coords.map(p => p.x)) + 150, maxY = Math.max(...coords.map(p => p.y)) + 100;
    svg.setAttribute("viewBox", [minX, minY, Math.max(300, maxX - minX), Math.max(300, maxY - minY)].join(" "));
    const state = result?.events[cursor]?.states || {}, lastEvent = result?.events[cursor], replay = { ...model, items: { ...model.items } };
    for (const [id, value] of Object.entries(state)) if (replay.items[id]) replay.items[id] = { ...replay.items[id], state: value };
    const live = createSwitchingStudy(replay, options()).energizedItems();
    const visibleIds = new Set(entries.map(([id]) => id));
    const keys = new Set([...graph.points.keys()].filter(key => visibleIds.has(key.slice(0, key.lastIndexOf("@")))));
    for (const edge of graph.edges) if (!edge.id && keys.has(edge.a) && keys.has(edge.b)) {
      const a = graph.points.get(edge.a), b = graph.points.get(edge.b);
      svg.append(E("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "wire fs-binding" }));
    }
    renderInstrumentLinks(svg, model, new Set(entries.filter(([, o]) => isInstrument(o)).map(([id]) => id)), E);
    for (const [id] of entries) {
      const o = replay.items[id], operated = lastEvent?.itemId === id && ["relay", "open"].includes(lastEvent.type);
      const g = E("g", { class: "item type-" + o.type + " " + (o.state || "") + (live.has(id) || isInstrument(o) ? " energized" : "") + (operated ? " fs-operated" : "") + (id === $("fsPoint").value ? " fs-picked" : ""), "data-id": id });
      if (!renderTechnicalSymbol(g, o, E) && segment(o)) {
        g.append(E("line", { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, class: o.type === "bus" ? "bus" : "wire" }),
          E("line", { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke: "transparent", "stroke-width": 20 }));
      }
      const x = o.x ?? (o.x1 + o.x2) / 2, y = o.y ?? (o.y1 + o.y2) / 2;
      g.append(E("text", { x: x + 30, y: y - 12, class: "tag" }, o.name || equipmentTypeLabel(o.type))); svg.append(g);
    }
    const point = markerPoint();
    if (point && prefix($("fsPoint").value) === scope && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      const marker = E("g", { class: "fs-fault-marker", "pointer-events": "none" });
      marker.append(E("circle", { cx: point.x, cy: point.y, r: 18 }), E("path", { d: `M ${point.x + 3} ${point.y - 12} l -10 14 h 8 l -4 11 13 -16 h -8 z` }),
        E("text", { x: point.x + 27, y: point.y + 19 }, $("fsPhases").value.split("").join("-") + ($("fsType").value === "LG" ? "-terra" : "")));
      svg.append(marker);
    }
  }
  function step(index, changeView = false) {
    if (!result) return; cursor = Math.max(0, Math.min(index, result.events.length - 1)); const e = result.events[cursor];
    if (changeView && e.itemId) setViewFor(e.itemId);
    $("fsSlider").value = cursor; $("fsTime").textContent = seconds(e.timeSeconds); $("fsEventDescription").textContent = e.name + " · " + e.description;
    $("fsFirst").disabled = $("fsPrevious").disabled = cursor === 0; $("fsNext").disabled = cursor === result.events.length - 1;
    for (const row of $("fsEventRows").rows) { row.classList.toggle("fs-current-event", +row.dataset.event === cursor); row.querySelector("button")?.setAttribute("aria-current", +row.dataset.event === cursor ? "step" : "false"); }
    render();
  }
  function resultTable() {
    $("fsEventRows").replaceChildren();
    for (const e of result.events) {
      const tr = document.createElement("tr"); tr.dataset.event = e.index;
      for (const value of [seconds(e.timeSeconds), e.name, e.element || { fault: "Início da falta", open: "Abertura", cleared: "Eliminação", noReturn: "Retorno interrompido" }[e.type]]) {
        const td = document.createElement("td"); td.textContent = value; tr.append(td);
      }
      const button = document.createElement("button"); button.type = "button"; button.textContent = tr.cells[0].textContent; button.setAttribute("aria-label", "Exibir evento " + (e.index + 1) + ": " + e.name); button.onclick = () => { stop(); step(e.index, true); };
      tr.cells[0].replaceChildren(button); $("fsEventRows").append(tr);
    }
    $("fsProtectionRows").replaceChildren();
    for (const p of result.protections) {
      const tr = document.createElement("tr"); tr.className = "fs-protection-" + p.status;
      const vals = [p.name + " → " + (p.breakerName || "Disjuntor pendente"), p.channel === "phase" ? "50/51 · fase" : "50N/51N · terra",
        p.currentA == null ? "Pendente" : format(p.currentA, 1) + " A", p.relaySeconds == null ? "Pendente" : seconds(p.relaySeconds),
        p.openingSeconds == null ? "Pendente" : seconds(p.openingSeconds), PROTECTION_STATUS[p.status] + (p.actualSeconds != null ? " · " + p.actualElement + " em " + seconds(p.actualSeconds) : "") + (p.reason ? " · " + p.reason : "")];
      for (const value of vals) { const td = document.createElement("td"); td.textContent = value; tr.append(td); } $("fsProtectionRows").append(tr);
    }
    if (!result.protections.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 6; td.textContent = "Nenhuma função 50/51 ou 50N/51N habilitada neste modelo."; tr.append(td); $("fsProtectionRows").append(tr); }
    $("fsStats").replaceChildren(); $("fsStats").hidden = false;
    for (const [title, value] of [["Resultado", SEQUENCE_STATUS[result.status]], ["Curto inicial", format(result.initial.currentA / 1000) + " kA"],
      ["Residual 3I₀", format(result.initial.residualA / 1000) + " kA"], ["Eliminação", result.clearedAt == null ? "—" : seconds(result.clearedAt)]]) {
      const card = document.createElement("div"), label = document.createElement("small"), strong = document.createElement("strong"); label.textContent = title; strong.textContent = value; card.append(label, strong); $("fsStats").append(card);
    }
    $("fsAssumptions").textContent = result.assumptions; $("fsWarnings").replaceChildren();
    for (const w of result.warnings) { const li = document.createElement("li"); li.textContent = w; $("fsWarnings").append(li); }
    $("fsSlider").max = result.events.length - 1;
    for (const id of ["fsPlay", "fsSlider", "fsCSV", "fsText"]) $(id).disabled = false;
    $("fsPlay").disabled = result.events.length <= 1;
    step(0); message(SEQUENCE_STATUS[result.status] + (result.openedIds.length ? " · " + result.openedIds.map(id => model.items[id].name || id).join(", ") : "") + ". Selecione os eventos ou use Reproduzir.");
  }
  $("fsRun").onclick = () => {
    stop();
    try { const c = read(); model = structuredClone(network()); result = simulateFaultSequence(model, c, options()); graph = result.initial.graph; setViewFor(c.location.itemId); resultTable(); }
    catch (error) { invalidate(false); message(error.message, true); }
  };
  $("fsNetwork").onchange = () => { selectedCase = ""; invalidate(false); loadModel(); listCases(); fill({ ...structuredClone(DEFAULT_SEQUENCE_CASE), location: { itemId: $("fsNetwork").value === "example" ? "loadBus" : "", fraction: .5, port: 0 } }); message("Escolha o ponto no unifilar e calcule quem atua."); };
  $("fsType").onchange = () => { phases(); invalidate(); };
  for (const id of ["fsPhases", "fsName", "fsPosition", "fsPort", "fsR", "fsX", "fsBase", "fsVoltage", "fsMax"]) $(id).addEventListener("input", () => invalidate());
  $("fsPoint").onchange = () => { pointFields(); setViewFor($("fsPoint").value); invalidate(); };
  $("fsView").onchange = render;
  $("fsReset").onclick = () => { stop(); if (result) step(0, true); else render(); };
  $("fsFirst").onclick = () => { stop(); step(0, true); }; $("fsPrevious").onclick = () => { stop(); step(cursor - 1, true); }; $("fsNext").onclick = () => { stop(); step(cursor + 1, true); };
  $("fsSlider").oninput = () => { stop(); step(+$("fsSlider").value, true); };
  $("fsPlay").onclick = () => {
    if (timer != null) { stop(); return; } if (!result) return;
    if (cursor === result.events.length - 1) step(0, true);
    $("fsPlay").textContent = "Pausar";
    const advance = () => { if (!dialog.open || !result) { stop(); return; } step(cursor + 1, true); if (cursor === result.events.length - 1) stop(); else timer = setTimeout(advance, 650); };
    timer = setTimeout(advance, 650);
  };
  attachDiagramGestures({ viewport, enabled: () => dialog.open, onTap(event, id) {
    if (!power(model.items[id])) { message("Selecione uma barra, cabo, conexão ou terminal de potência para colocar a falta."); return; }
    const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const point = p.matrixTransform(svg.getScreenCTM().inverse()), o = model.items[id];
    $("fsPoint").value = id;
    if (segment(o)) { const dx = o.x2 - o.x1, dy = o.y2 - o.y1, length = dx * dx + dy * dy; $("fsPosition").value = (100 * (length ? Math.max(0, Math.min(1, ((point.x - o.x1) * dx + (point.y - o.y1) * dy) / length)) : .5)).toFixed(2); }
    else { const ps = graph.ports.get(id) || []; $("fsPort").value = String(ps.length > 1 && Math.hypot(graph.points.get(ps[1]).x - point.x, graph.points.get(ps[1]).y - point.y) < Math.hypot(graph.points.get(ps[0]).x - point.x, graph.points.get(ps[0]).y - point.y) ? 1 : 0); }
    pointFields(); invalidate(false); message("Ponto selecionado: " + (o.name || equipmentTypeLabel(o.type)) + ". Clique em Calcular quem atua.");
  } });
  $("fsNew").onclick = () => { selectedCase = ""; fill({ ...structuredClone(DEFAULT_SEQUENCE_CASE), location: { itemId: $("fsPoint").value, fraction: .5, port: 0 } }); listCases(); };
  $("fsCases").onchange = () => { selectedCase = $("fsCases").value; $("fsDelete").disabled = selectedCase === ""; if (selectedCase !== "") fill(cases[+selectedCase]); };
  $("fsSave").onclick = () => { try { const c = read(); if (selectedCase === "") { if (cases.length >= 40) throw Error("Limite de 40 casos por modelo."); cases.push(c); selectedCase = String(cases.length - 1); } else cases[+selectedCase] = c;
    localStorage.setItem(storageKey(), JSON.stringify(cases)); listCases(); message("Caso salvo neste aparelho."); } catch (error) { message(error.message, true); } };
  $("fsDelete").onclick = () => { if (selectedCase === "") return; try { cases.splice(+selectedCase, 1); localStorage.setItem(storageKey(), JSON.stringify(cases)); selectedCase = ""; listCases(); message("Caso excluído deste aparelho."); } catch (error) { message(error.message, true); } };
  function exportText(content, filename, mime, kind) {
    exportKind = kind; $("fsExportFallback").hidden = false; $("fsExportContent").value = content; $("fsApplyJSON").hidden = kind !== "json";
    try { const url = URL.createObjectURL(new Blob([content], { type: mime })), a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
    catch { message("Use o conteúdo exibido para copiar o arquivo."); }
  }
  $("fsCSV").onclick = () => { if (result) exportText(sequenceReportCSV(result), "SimuSystem-sequencia.csv", "text/csv;charset=utf-8", "report"); };
  $("fsText").onclick = () => { if (result) exportText(sequenceReportText(result), "SimuSystem-sequencia.txt", "text/plain;charset=utf-8", "report"); };
  $("fsExportCase").onclick = () => { try { exportText(JSON.stringify(read(), null, 2), "SimuSystem-caso-de-falta.json", "application/json", "json"); } catch (error) { message(error.message, true); } };
  $("fsImportCase").onclick = () => { exportKind = "json"; $("fsExportFallback").hidden = false; $("fsExportContent").value = ""; $("fsApplyJSON").hidden = false; $("fsFile").click(); };
  function importText(text) { const c = normalizeSequenceCase(JSON.parse(text)); if (!model.items[c.location.itemId]) throw Error("O ponto salvo não existe no modelo selecionado."); selectedCase = ""; fill(c); listCases(); message("Caso importado. Calcule novamente."); }
  $("fsApplyJSON").onclick = () => { if (exportKind !== "json") return; try { importText($("fsExportContent").value); } catch (error) { message(error.message, true); } };
  $("fsFile").onchange = async () => { const file = $("fsFile").files[0]; if (!file) return; try { if (file.size > 1000000) throw Error("Arquivo maior que 1 MB."); importText(await file.text()); } catch (error) { message(error.message, true); } finally { $("fsFile").value = ""; } };
  $("fsCopy").onclick = async () => { try { await navigator.clipboard.writeText($("fsExportContent").value); message("Conteúdo copiado."); } catch { $("fsExportContent").focus(); $("fsExportContent").select(); message("Selecione e copie o conteúdo exibido."); } };
  dialog.addEventListener("close", stop);
  return { open() { onOpen(); loadModel(); listCases(); if (!$("fsName").value) fill({ ...structuredClone(DEFAULT_SEQUENCE_CASE), location: { itemId: $("fsNetwork").value === "example" ? "loadBus" : "", fraction: .5, port: 0 } }); else invalidate(false);
    message("Escolha o ponto no unifilar ou na lista e calcule quem atua."); if (!dialog.open) dialog.showModal(); render(); } };
}
