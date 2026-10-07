import { calculateThreePhaseFault, PROTECTION_CURVES, protectionTime, compareProtection } from "./electrical-studies.js?v=45";

export function attachStudyWorkbench({ getDiagram, networkOptions, openPowerFlow, setOverlay, onOpen, onClose }) {
  const $ = (id) => document.getElementById(id);
  const create = (id, title, body, className = "study-box") => {
    const dialog = document.createElement("dialog");
    dialog.id = id; dialog.className = className;
    dialog.setAttribute("aria-labelledby", id + "Title");
    dialog.innerHTML = `<div class="history-head"><h2 id="${id}Title">${title}</h2><div class="grow"></div>
      <button class="top" type="button" data-close style="color:#24323d;background:#eef2f4">Fechar</button></div>${body}`;
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("close", onClose);
    document.body.append(dialog);
    return dialog;
  };
  const open = (dialog) => { onOpen(); if (!dialog.open) dialog.showModal(); };
  const hub = create("studiesBox", "Estudos do sistema", `
    <p class="study-intro" id="studiesContext"></p>
    <div class="study-cards">
      <button class="study-card" id="studyLoadFlow"><span>01 · REGIME PERMANENTE</span><strong>Fluxo de carga</strong><small>Tensões, ângulos, potências e perdas na rede AC.</small></button>
      <button class="study-card" id="studyFault"><span>02 · FALTA BALANCEADA</span><strong>Curto trifásico</strong><small>Corrente inicial simétrica nas barras e impedância equivalente.</small></button>
      <button class="study-card" id="studyProtection"><span>03 · TEMPO × CORRENTE</span><strong>Curvas de proteção</strong><small>Compare duas curvas e a margem de tempo na corrente escolhida.</small></button>
    </div>
    <p class="study-note">Os estudos usam um retrato do estado atual. Dados nominais são cadastrados em Modelagem → Dados elétricos. As hipóteses e os parâmetros pendentes aparecem em cada cálculo.</p>
    <div class="study-actions"><button id="clearStudyOverlay" type="button">Limpar resultados do unifilar</button></div>`, "study-hub");
  const fault = create("faultBox", "Curto-circuito trifásico", `
    <div class="study-controls"><label>Potência-base (MVA)<input id="faultBase" type="number" min="1" value="100" step="1"></label>
      <button id="runFault" type="button">Calcular nas barras</button></div>
    <div class="study-summary" id="faultSummary" role="status">Cadastre MVA de curto da rede e X″d do gerador para calcular suas contribuições.</div>
    <div class="study-actions"><button id="applyFault" type="button" disabled>Mostrar no unifilar</button></div>
    <p class="study-note">Modelo para treinamento: falta franca balanceada; sequência positiva; c = 1; tensão pré-falta nominal. Sem motores, componente contínua, impedância de falta ou correções IEC de equipamentos. O resultado não representa a corrente de pico nem um estudo IEC 60909 completo.</p>
    <div class="study-scroll"><table class="study-table"><thead><tr><th>Barra / nó</th><th>kV</th><th>I″k (kA)</th><th>MVA de curto</th><th>R eq. (Ω)</th><th>X eq. (Ω)</th><th>Situação</th></tr></thead><tbody id="faultRows"></tbody></table>
      <details><summary>Dados pendentes e hipóteses do modelo</summary><div class="study-summary" id="faultNotes"></div></details></div>`);
  const curveOptions = Object.entries(PROTECTION_CURVES).map(([value, c]) => `<option value="${value}">${c.name}</option>`).join("");
  const profile = (prefix, title, pickup, tms) => `<fieldset class="tcc-profile"><legend>${title}</legend><div class="tcc-fields">
    <label class="wide">Equipamento<select id="${prefix}Device"><option value="">Manual · valores de exemplo</option></select></label>
    <label class="wide">Curva<select id="${prefix}Curve">${curveOptions}</select></label>
    <label>Pickup primário (A)<input id="${prefix}Pickup" type="number" min="0.01" value="${pickup}" step="1"></label>
    <label data-inverse>TMS<input id="${prefix}Tms" type="number" min="0.001" value="${tms}" step="0.01"></label>
    <label data-definite hidden>Tempo definido (s)<input id="${prefix}Definite" type="number" min="0.001" value="0.5" step="0.01"></label>
    <label>Instantâneo (A; 0 desliga)<input id="${prefix}Instant" type="number" min="0" value="0" step="1"></label>
    <label>Tempo instantâneo (s)<input id="${prefix}InstantTime" type="number" min="0" value="0.02" step="0.01"></label>
    <label>Tempo do disjuntor (s)<input id="${prefix}BreakerTime" type="number" min="0" value="0.06" step="0.01"></label>
    </div></fieldset>`;
  const protection = create("protectionBox", "Comparação de curvas de proteção", `
    <p class="study-intro">A e B recebem a mesma corrente primária, referida ao mesmo lado do transformador. Use ajustes manuais ou curvas cadastradas nos disjuntores.</p>
    <div class="study-controls"><label>Corrente de avaliação (A)<input id="tccCurrent" type="number" min="0.01" value="3000" step="1"></label>
      <button id="runProtection" type="button">Comparar curvas</button></div>
    <div class="study-summary" id="protectionSummary" role="status"></div>
    <div class="tcc-layout"><div>${profile("tccA", "A · Jusante", 300, .1)}${profile("tccB", "B · Montante", 600, .2)}</div>
      <div><div class="tcc-key"><span>● A · Jusante</span><span>● B · Montante</span></div>
        <svg class="tcc-chart" id="tccChart" viewBox="0 0 600 440" role="img" aria-label="Curvas tempo corrente em escala logarítmica"></svg>
        <p class="study-note" style="margin:12px 0">Curvas IEC genéricas e tempo definido, com atraso do disjuntor. A margem exibida vale para a corrente escolhida. Esta comparação não inclui tolerâncias de fabricante, saturação de TC ou divisão da corrente entre alimentadores e não certifica seletividade.</p></div></div>`);
  const cells = (body, values) => {
    const row = document.createElement("tr");
    for (const value of values) { const td = document.createElement("td"); td.textContent = String(value); row.append(td); }
    body.append(row);
  };
  const format = (v, places = 3) => Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: places, maximumFractionDigits: places }) : "—";
  let lastFault = null, lastFaultSnapshot = "";
  function runFault() {
    const d = getDiagram(); lastFault = null; $("applyFault").disabled = true; $("faultRows").replaceChildren();
    try {
      const result = calculateThreePhaseFault(d, { ...networkOptions, baseMVA: +$("faultBase").value });
      const counted = (status) => result.results.filter((b) => b.status === status).length;
      $("faultSummary").textContent = `${counted("calculated")} barras calculadas · ${counted("dead")} sem fonte · ${counted("missing")} com dados pendentes. Estado atual; nenhuma manobra é executada.`;
      if (!result.results.length) $("faultSummary").textContent = "Adicione barramentos ao modelo para obter os resultados nas barras.";
      for (const b of result.results) cells($("faultRows"), [b.name, format(b.kv, 2), format(b.currentKA),
        format(b.shortCircuitMVA, 1), format(b.resistanceOhm, 5), format(b.reactanceOhm, 5),
        b.status === "calculated" ? "Calculado" : b.status === "dead" ? "Sem fonte em operação" : "Dados pendentes"]);
      $("faultNotes").textContent = [...new Set([...result.results.flatMap((b) => b.errors), ...result.warnings])].join("\n") || "Todos os dados necessários foram informados.";
      lastFault = result; lastFaultSnapshot = JSON.stringify(d);
      $("applyFault").disabled = !counted("calculated");
    } catch (e) { $("faultSummary").textContent = "Não foi possível calcular: " + e.message; $("faultNotes").textContent = ""; }
  }
  $("runFault").onclick = runFault;
  $("faultBase").oninput = () => { lastFault = null; $("applyFault").disabled = true;
    $("faultSummary").textContent = "Potência-base alterada. Calcule novamente para atualizar o relatório."; };
  $("applyFault").onclick = () => {
    if (!lastFault || JSON.stringify(getDiagram()) !== lastFaultSnapshot) {
      $("faultSummary").textContent = "O estado do sistema mudou. Calcule novamente antes de mostrar os resultados."; return;
    }
    const values = new Map();
    for (const b of lastFault.results) for (const id of b.busIds)
      values.set(id, [b.status === "calculated" ? "3φ · " + format(b.currentKA) + " kA" :
        b.status === "dead" ? "Sem fonte" : "Dados pendentes"]);
    setOverlay({ kind: "Curto trifásico", values, snapshot: lastFaultSnapshot }); fault.close();
  };
  function readProfile(p) {
    return { protectionCurve: $(p + "Curve").value, pickupA: +$(p + "Pickup").value,
      timeMultiplier: +$(p + "Tms").value, definiteTime: +$(p + "Definite").value,
      instantaneousA: +$(p + "Instant").value, instantaneousTime: +$(p + "InstantTime").value,
      breakerTime: +$(p + "BreakerTime").value };
  }
  function plot(a, b, current) {
    const svg = $("tccChart"); svg.replaceChildren();
    const ns = "http://www.w3.org/2000/svg";
    const E = (tag, attrs, content) => {
      const e = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, String(value));
      if (content != null) e.textContent = content;
      svg.append(e); return e;
    };
    const low = Math.max(.000001, Math.min(a.pickupA, b.pickupA, current) / 2);
    const high = Math.max(low * 100, current * 2, a.instantaneousA * 1.5, b.instantaneousA * 1.5);
    const lx = Math.log10(low), hx = Math.log10(high), ly = -3, hy = 4;
    const X = (i) => 62 + (Math.log10(i) - lx) / (hx - lx) * 516;
    const Y = (t) => 385 - (Math.log10(Math.max(10 ** ly, t)) - ly) / (hy - ly) * 355;
    for (let exp = Math.ceil(lx); exp <= Math.floor(hx); exp++) {
      const x = X(10 ** exp); E("line", { x1: x, y1: 30, x2: x, y2: 385, stroke: "#e3e9f0" });
      E("text", { x, y: 405, "text-anchor": "middle", "font-size": 11, fill: "#687d90" }, (10 ** exp).toLocaleString("pt-BR"));
    }
    for (let exp = ly; exp <= hy; exp++) {
      const y = Y(10 ** exp); E("line", { x1: 62, y1: y, x2: 578, y2: y, stroke: "#e3e9f0" });
      E("text", { x: 54, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "#687d90" }, (10 ** exp).toLocaleString("pt-BR"));
    }
    E("text", { x: 62, y: 17, "font-size": 12, fill: "#47637e" }, "Tempo total (s)");
    E("text", { x: 578, y: 428, "text-anchor": "end", "font-size": 12, fill: "#47637e" }, "Corrente primária (A)");
    for (const [s, color, label] of [[a, "#2368b5", "A"], [b, "#c24b31", "B"]]) {
      const samples = Array.from({ length: 401 }, (_, j) => 10 ** (lx + (hx - lx) * j / 400));
      if (s.instantaneousA > low && s.instantaneousA < high) samples.push(s.instantaneousA * (1 - 1e-7), s.instantaneousA);
      samples.sort((i, j) => i - j);
      let path = "", connected = false;
      for (const i of samples) {
        const t = protectionTime(s, i);
        if (!Number.isFinite(t) || t > 10 ** hy || t < 0) { connected = false; continue; }
        path += (connected ? " L" : " M") + X(i).toFixed(2) + "," + Y(t).toFixed(2); connected = true;
      }
      const curve = E("path", { d: path, fill: "none", stroke: color, "stroke-width": 2.4, "data-curve": label });
      const title = document.createElementNS(ns, "title"); title.textContent = label + " · " + PROTECTION_CURVES[s.protectionCurve].name; curve.append(title);
      const t = protectionTime(s, current);
      if (Number.isFinite(t) && t <= 10 ** hy) E("circle", { cx: X(current), cy: Y(t), r: 4, fill: color });
    }
    E("line", { x1: X(current), x2: X(current), y1: 30, y2: 385, stroke: "#8b9aaa", "stroke-dasharray": "4 4" });
  }
  function runProtection() {
    try {
      const a = readProfile("tccA"), b = readProfile("tccB"), i = +$("tccCurrent").value;
      if (!(i > 0)) throw Error("Informe uma corrente de avaliação maior que zero.");
      const r = compareProtection(a, b, i); plot(a, b, i);
      const time = (t) => Number.isFinite(t) ? format(t) + " s" : "não atua nesta corrente";
      $("protectionSummary").textContent = `Em ${format(i, 0)} A: A = ${time(r.downstreamTime)}; B = ${time(r.upstreamTime)}.\n` +
        (r.margin == null ? "Margem não definida: uma ou ambas as curvas não atuam nesta corrente." :
          "Margem B − A = " + format(r.margin) + " s. " + (r.margin > 0 ? "B atua depois de A neste ponto." :
            r.margin < 0 ? "B atua antes de A neste ponto." : "As curvas atuam ao mesmo tempo neste ponto."));
    } catch (e) { $("protectionSummary").textContent = e.message; $("tccChart").replaceChildren(); }
  }
  function fieldsForCurve(p) {
    const fieldset = $(p + "Curve").closest("fieldset"), definite = $(p + "Curve").value === "definite";
    fieldset.querySelector("[data-inverse]").hidden = definite;
    fieldset.querySelector("[data-definite]").hidden = !definite;
  }
  for (const p of ["tccA", "tccB"]) {
    const fieldset = $(p + "Curve").closest("fieldset");
    fieldset.addEventListener("input", (e) => {
      if (e.target === $(p + "Device")) return;
      $(p + "Device").value = ""; fieldsForCurve(p); runProtection();
    });
    $(p + "Device").onchange = () => {
      const e = getDiagram().items?.[$(p + "Device").value]?.electrical;
      if (!e || !PROTECTION_CURVES[e.protectionCurve]) return;
      const fields = { Curve: "protectionCurve", Pickup: "pickupA", Tms: "timeMultiplier", Definite: "definiteTime",
        Instant: "instantaneousA", InstantTime: "instantaneousTime", BreakerTime: "breakerTime" };
      for (const [suffix, key] of Object.entries(fields)) $(p + suffix).value = e[key] ?? (suffix === "Tms" ? .1 : suffix === "Definite" ? .5 : 0);
      fieldsForCurve(p); runProtection();
    };
    fieldsForCurve(p);
  }
  $("runProtection").onclick = runProtection;
  $("tccCurrent").oninput = runProtection;
  $("studyLoadFlow").onclick = () => { hub.close(); onOpen(); openPowerFlow(); };
  $("studyFault").onclick = () => { hub.close(); open(fault); runFault(); };
  $("studyProtection").onclick = () => {
    hub.close();
    for (const p of ["tccA", "tccB"]) {
      const select = $(p + "Device"), previous = select.value;
      select.replaceChildren(new Option("Manual · valores de exemplo", ""));
      for (const [id, o] of Object.entries(getDiagram().items || {}))
        if (o.type === "breaker" && PROTECTION_CURVES[o.electrical?.protectionCurve]) select.add(new Option(o.name || id, id));
      select.value = [...select.options].some((option) => option.value === previous) ? previous : "";
    }
    open(protection); runProtection();
  };
  $("clearStudyOverlay").onclick = () => { setOverlay(null); hub.close(); };
  return { open() {
    const d = getDiagram();
    $("studiesContext").textContent = "Diagrama: " + (d.name || "sistema atual") + ". Inclui as abas carregadas conectadas a este sistema.";
    open(hub);
  } };
}
