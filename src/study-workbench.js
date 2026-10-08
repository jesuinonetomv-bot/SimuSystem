import { attachProtectionWorkbench } from "./protection-workbench.js?v=49";

import { attachShortCircuitWorkbench } from "./short-circuit-workbench.js?v=49";
import { attachFaultSequenceWorkbench } from "./fault-sequence-workbench.js?v=49";

export function attachStudyWorkbench({ getDiagram, getScope, networkOptions, openPowerFlow, setOverlay, onOpen, onClose }) {
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
      <button class="study-card" id="studyFault"><span>02 · FALTA BALANCEADA</span><strong>Curto-circuito · ANSI / IEC</strong><small>Casos trifásicos, contribuições das fontes e correntes nas barras.</small></button>
      <button class="study-card" id="studyProtection"><span>03 · TEMPO × CORRENTE</span><strong>Coordenação de proteção</strong><small>Curvas IEC / IEEE, caminho de dispositivos e margens em uma faixa de correntes.</small></button>
      <button class="study-card" id="studyFaultSequence"><span>04 · ATUAÇÃO NO UNIFILAR</span><strong>Curto e sequência de atuação</strong><small>Escolha o ponto da falta entre fases ou fase-terra e veja quais proteções e disjuntores atuam.</small></button>
    </div>
    <p class="study-note">Os estudos usam uma cópia do estado atual. A sequência calcula correntes nos sensores e aberturas; coordenação usa um caminho de fase declarado e correntes passantes informadas. Cadastre os parâmetros em Modelagem → Dados elétricos.</p>
    <div class="study-actions"><button id="clearStudyOverlay" type="button">Limpar resultados do unifilar</button></div>`, "study-hub");
  const fault = create("faultBox", "Curto-circuito · ANSI / IEC", '<div id="shortCircuitWorkbench"></div>', "study-box load-flow-box short-circuit-box");
  const faultWorkbench = attachShortCircuitWorkbench({ dialog: fault, getDiagram, getScope, networkOptions, setOverlay, onOpen });
  const protection = create("protectionBox", "Coordenação de proteção", '<div id="protectionWorkbench"></div>', "study-box load-flow-box protection-box");
  const protectionWorkbench = attachProtectionWorkbench({ dialog: protection, getDiagram, getScope, onOpen });
  const sequence = create("faultSequenceBox", "Curto e sequência de atuação", '<div id="faultSequenceWorkbench"></div>', "study-box fault-sequence-box");
  const sequenceWorkbench = attachFaultSequenceWorkbench({ dialog: sequence, getDiagram, getScope, networkOptions, onOpen });
  $("studyLoadFlow").onclick = () => { hub.close(); onOpen(); openPowerFlow(); };
  $("studyFault").onclick = () => { hub.close(); faultWorkbench.open(); };
  $("studyProtection").onclick = () => { hub.close(); protectionWorkbench.open(); };
  $("studyFaultSequence").onclick = () => { hub.close(); sequenceWorkbench.open(); };
  $("clearStudyOverlay").onclick = () => { setOverlay(null); hub.close(); };
  return { open() {
    const d = getDiagram();
    $("studiesContext").textContent = "Diagrama: " + (d.name || "sistema atual") + ". Inclui as abas carregadas conectadas a este sistema.";
    open(hub);
  } };
}
