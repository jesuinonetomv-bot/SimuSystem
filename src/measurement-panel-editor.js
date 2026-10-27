import { PANEL_METRICS, createMeasurementPanel, measurementPanelFor, panelDimensions, renderMeasurementPanel } from "./measurement-panels.js?v=49.7";

export function attachMeasurementPanelEditor({ getDiagram, getContext, canEdit, onSave, page = document }) {
  const node = (tag, text, className) => { const el = page.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
  const dialog = node("dialog", "", "measurement-panel-editor"); dialog.id = "measurementPanelEditor";
  dialog.setAttribute("aria-labelledby", "measurementPanelTitle");
  dialog.innerHTML = `<form><header><h2 id="measurementPanelTitle">Configurar painel de leituras</h2><button type="button" data-close aria-label="Fechar configuração do painel">×</button></header>
    <div class="meter-editor-body"><div class="meter-editor-settings">
      <label>Título<input name="panelName" maxlength="70" required /></label>
      <label>Quantidade de linhas<input name="rowCount" type="number" min="1" max="32" step="1" required /></label>
      <label>Largura do painel<input name="panelWidth" type="number" min="240" max="900" step="10" required /></label>
      <label>Tensão de referência dos totais<select name="voltageReference" aria-label="Tensão de referência dos totais"></select></label>
    </div><p class="meter-editor-hint">Escolha a grandeza e a origem de cada linha. Os totais usam as cargas e os capacitores em serviço desta aba; “Balanço” também desconta a geração.</p>
    <div class="meter-editor-layout"><div class="meter-editor-rows" data-rows></div><aside><strong>Prévia do painel</strong><svg data-preview role="img" aria-label="Prévia do painel de leituras"></svg></aside></div>
    <p class="meter-editor-hint">Trifásico equilibrado, tensão fase–fase. P e Q são somados com sinal; S = √(P² + Q²) e FP = |P|/S. A corrente é referida à tensão selecionada. Frequências de ilhas independentes não são somadas. Totais do treinamento, sem perdas da rede.</p>
    <p class="meter-editor-status" role="status" aria-live="polite" data-status></p></div>
    <footer><button type="button" data-close>Cancelar</button><button type="submit" data-save>Salvar painel</button></footer></form>`;
  page.body.append(dialog);
  const form = dialog.querySelector("form"), rowsHost = dialog.querySelector("[data-rows]"), preview = dialog.querySelector("[data-preview]"), status = dialog.querySelector("[data-status]");
  let currentId = "", working = null, conversion = null, snapshot = "", rowInputs = [];
  const option = (select, value, text) => { const el = node("option", text); el.value = value; select.append(el); };
  function field(label, input) { const holder = node("label", label); holder.append(input); return holder; }
  function populateSources(select, value) {
    option(select, "tab", "Cargas em serviço da aba"); option(select, "net", "Balanço da aba (cargas − geração)");
    for (const [id, item] of Object.entries(getDiagram().items || {}))
      if (["bus", "line", "cable", "breaker", "disconnector", "fuse", "transformer", "utility", "turbogenerator", "load", "motor", "capacitor"].includes(item.type))
        option(select, "item:" + id, item.name || id);
    if (value.startsWith("item:") && ![...select.options].some(el => el.value === value)) option(select, value, "Equipamento removido · conferir");
    select.value = value;
  }
  function readRows() {
    return rowInputs.map(inputs => ({ label: inputs.label.value.trim(), metric: inputs.metric.value,
      origin: inputs.source.value.startsWith("item:") ? "item" : inputs.source.value,
      targetId: inputs.source.value.startsWith("item:") ? inputs.source.value.slice(5) : "",
      side: inputs.side.value, digits: inputs.digits.value === "" ? PANEL_METRICS[inputs.metric.value].digits : Number(inputs.digits.value) }));
  }
  function read() {
    const selectedRef = form.elements.voltageReference.value;
    const split = selectedRef.lastIndexOf("|");
    return { ...working, name: form.elements.panelName.value.trim(), width: Number(form.elements.panelWidth.value), rows: readRows(),
      reference: selectedRef === "auto" ? { itemId: "", side: "primary" } : { itemId: selectedRef.slice(0, split), side: selectedRef.slice(split + 1) } };
  }
  function updatePreview() {
    if (!working) return;
    const panel = read(), dimensions = panelDimensions(panel);
    preview.replaceChildren(); preview.setAttribute("viewBox", `-8 -8 ${dimensions.width + 16} ${dimensions.height + 16}`);
    const E = (tag, attributes = {}, text) => { const el = page.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
      if (text != null) el.textContent = text; return el; };
    renderMeasurementPanel(preview, { ...panel, x: 0, y: 0, scale: 1, rotation: 0 }, getContext(), E);
    for (const el of preview.querySelectorAll(".sel")) el.remove();
  }
  function drawRows(rows) {
    rowsHost.replaceChildren(); rowInputs = [];
    rows.forEach((row, index) => {
      const line = node("fieldset", "", "meter-editor-row"); line.append(node("legend", "Linha " + (index + 1)));
      const label = node("input"); label.maxLength = 40; label.value = row.label || "";
      label.setAttribute("aria-label", "Nome da linha " + (index + 1));
      const metric = node("select"); for (const [key, definition] of Object.entries(PANEL_METRICS)) option(metric, key, definition.label);
      metric.value = row.metric; metric.setAttribute("aria-label", "Grandeza da linha " + (index + 1));
      const source = node("select"); populateSources(source, row.origin === "item" ? "item:" + row.targetId : row.origin || "tab");
      source.setAttribute("aria-label", "Origem da linha " + (index + 1));
      const side = node("select"); option(side, "primary", "A / primário"); option(side, "secondary", "B / secundário"); side.value = row.side || "primary";
      const digits = node("input"); digits.type = "number"; digits.min = "0"; digits.max = "4"; digits.step = "1"; digits.value = row.digits ?? 2;
      let previousMetric = metric.value;
      metric.onchange = () => {
        if (!label.value || label.value === PANEL_METRICS[previousMetric]?.label) label.value = PANEL_METRICS[metric.value].label;
        digits.value = PANEL_METRICS[metric.value].digits; previousMetric = metric.value; updatePreview();
      };
      line.append(field("Nome", label), field("Grandeza", metric), field("Origem da leitura", source), field("Terminal / lado", side), field("Casas decimais", digits));
      rowsHost.append(line); rowInputs.push({ label, metric, source, side, digits });
    });
  }
  function references() {
    const select = form.elements.voltageReference; select.replaceChildren(); option(select, "auto", "Automática · tensão única das fontes");
    for (const [id, item] of Object.entries(getDiagram().items || {})) {
      if (!["bus", "utility", "turbogenerator", "transformer"].includes(item.type)) continue;
      option(select, id + "|primary", (item.name || id) + (item.type === "transformer" ? " · primário" : ""));
      if (item.type === "transformer") option(select, id + "|secondary", (item.name || id) + " · secundário");
    }
    const ref = working.reference;
    select.value = ref?.itemId ? ref.itemId + "|" + (ref.side || "primary") : "auto";
    if (!select.value && ref?.itemId) { option(select, ref.itemId + "|" + ref.side, "Referência removida · conferir"); select.value = ref.itemId + "|" + ref.side; }
  }
  form.elements.rowCount.onchange = () => {
    const count = Number(form.elements.rowCount.value);
    if (!Number.isInteger(count) || count < 1 || count > 32) { status.textContent = "Informe de 1 a 32 linhas."; return; }
    const previous = readRows(), defaults = createMeasurementPanel({ x: 0, y: 0 }, count).rows;
    drawRows(Array.from({ length: count }, (_, i) => previous[i] || defaults[i])); status.textContent = ""; updatePreview();
  };
  form.addEventListener("input", updatePreview); form.addEventListener("change", updatePreview);
  for (const button of dialog.querySelectorAll("[data-close]")) button.onclick = () => dialog.close();
  form.onsubmit = event => {
    event.preventDefault(); if (!canEdit() || !working) return;
    if (JSON.stringify(getDiagram().items[currentId]) !== snapshot) { status.textContent = "O painel mudou. Feche e abra a configuração novamente."; return; }
    const panel = read(), errors = [];
    if (!panel.name) errors.push("Informe o título.");
    if (!(panel.width >= 240 && panel.width <= 900)) errors.push("A largura deve ficar entre 240 e 900.");
    if (!panel.rows.length || panel.rows.length > 32) errors.push("Escolha de 1 a 32 linhas.");
    for (const [i, row] of panel.rows.entries()) {
      if (!PANEL_METRICS[row.metric] || !["item", "tab", "net"].includes(row.origin)) errors.push("Grandeza ou origem inválida na linha " + (i + 1) + ".");
      if (row.origin === "item" && !getDiagram().items[row.targetId]) errors.push("Escolha um equipamento existente na linha " + (i + 1) + ".");
      if (!Number.isInteger(row.digits) || row.digits < 0 || row.digits > 4) errors.push("Casas decimais inválidas na linha " + (i + 1) + ".");
    }
    if (panel.reference.itemId && !getDiagram().items[panel.reference.itemId]) errors.push("Escolha uma tensão de referência existente.");
    if (errors.length) { status.textContent = errors.join(" "); return; }
    onSave(currentId, panel, conversion.removeIds); dialog.close();
  };
  return { open(id) {
    conversion = measurementPanelFor(getDiagram(), id); if (!conversion) return false;
    currentId = conversion.id; working = structuredClone(conversion.item); snapshot = JSON.stringify(getDiagram().items[currentId]);
    form.elements.panelName.value = working.name || "LEITURAS"; form.elements.rowCount.value = working.rows.length;
    form.elements.panelWidth.value = working.width || 300; references(); drawRows(working.rows); updatePreview();
    const editable = canEdit();
    for (const input of form.querySelectorAll("input,select")) input.disabled = !editable;
    dialog.querySelector("[data-save]").hidden = !editable;
    status.textContent = !editable ? "Leituras em visualização. Entre na engenharia para configurar o painel."
      : conversion.removeIds.length ? "Ao salvar, este painel será convertido em um único objeto editável. As leituras atuais serão preservadas." : "";
    dialog.showModal(); return true;
  } };
}
