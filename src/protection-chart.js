import { coordinationSamples, normalizeCoordinationCase, responseAt, primarySettings } from "./protection-coordination.js?v=48";

export const PROTECTION_COLORS = ["#2368b5", "#b9472c", "#287950", "#8654aa", "#a5740e", "#167d86", "#b23c75", "#586477"];
const esc = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const tick = v => v.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
export function coordinationChart(input, { showRelay = false, showBands = true } = {}) {
  const c = normalizeCoordinationCase(input), width = 780, height = 490, left = 74, right = 748, top = 40, bottom = 429;
  const pickups = c.devices.map(d => primarySettings(d).pickupA * d.deviceKV / c.referenceKV);
  const xMin = Math.max(1e-8, Math.min(c.rangeMinA, ...pickups) * .7), xMax = c.rangeMaxA * 1.25;
  const regular = [c.rangeMinA, Math.sqrt(c.rangeMinA * c.rangeMaxA), c.rangeMaxA, c.evaluationA];
  const times = c.devices.flatMap(d => regular.map(a => responseAt(d, a, c.referenceKV).totalTime)).filter(t => t > 0 && Number.isFinite(t));
  const yMin = times.length ? Math.max(1e-6, 10 ** (Math.floor(Math.log10(Math.min(...times))) - 1)) : .01;
  const yMax = times.length ? Math.max(yMin * 100, Math.min(1e9, 10 ** (Math.ceil(Math.log10(Math.max(...times))) + 1))) : 1000;
  const lx = Math.log(xMin), hx = Math.log(xMax), ly = Math.log(yMin), hy = Math.log(yMax);
  const X = a => left + (Math.log(a) - lx) / (hx - lx) * (right - left);
  const Y = t => bottom - (Math.log(Math.max(yMin, t)) - ly) / (hy - ly) * (bottom - top);
  const E = (tag, attrs, text) => `<${tag} ${Object.entries(attrs).map(([k, v]) => k + '="' + esc(v) + '"').join(" ")}>${text == null ? "" : esc(text)}</${tag}>`;
  const graph = [E("title", {}, "Curvas tempo × corrente: " + c.name),
    E("desc", {}, "Correntes referidas a " + tick(c.referenceKV) + " kV. Curva contínua: tempo total de eliminação. Bandas: tolerância de tempo assumida. Tabela contém os valores e as margens."),
    `<defs><clipPath id="pcPlotClip"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"></rect></clipPath></defs>`,
    E("rect", { x: left, y: top, width: right - left, height: bottom - top, fill: "#fff" }),
    E("rect", { x: X(c.rangeMinA), y: top, width: X(c.rangeMaxA) - X(c.rangeMinA), height: bottom - top, fill: "#f0f5fb" })];
  for (let p = Math.floor(Math.log10(xMin)); p <= Math.ceil(Math.log10(xMax)); p++) for (const m of [1, 2, 5]) {
    const value = m * 10 ** p; if (value < xMin || value > xMax) continue;
    graph.push(E("line", { x1: X(value), x2: X(value), y1: top, y2: bottom, stroke: m === 1 ? "#cedce9" : "#e5edf4" }));
    if (m === 1 || hx - lx < Math.log(30)) graph.push(E("text", { x: X(value), y: bottom + 20, "text-anchor": "middle", "font-size": 11, fill: "#587089" }, tick(value)));
  }
  for (let p = Math.ceil(Math.log10(yMin)); p <= Math.floor(Math.log10(yMax)); p++) {
    const value = 10 ** p;
    graph.push(E("line", { x1: left, x2: right, y1: Y(value), y2: Y(value), stroke: "#cedce9" }),
      E("text", { x: left - 8, y: Y(value) + 4, "text-anchor": "end", "font-size": 11, fill: "#587089" }, tick(value)));
  }
  graph.push(E("text", { x: left, y: 19, "font-size": 12, fill: "#304a63" }, "Tempo (s)"),
    E("text", { x: right, y: height - 12, "text-anchor": "end", "font-size": 12, fill: "#304a63" }, "Corrente (A) · referência " + tick(c.referenceKV) + " kV"));
  for (const [a, label] of [[c.rangeMinA, "Mín."], [c.rangeMaxA, "Máx."]]) graph.push(E("line", { x1: X(a), x2: X(a), y1: top, y2: bottom, stroke: "#849bb1", "stroke-dasharray": "2 4" }),
    E("text", { x: X(a), y: top - 6, "text-anchor": "middle", "font-size": 10, fill: "#607489" }, label));
  const points = coordinationSamples({ ...c, rangeMinA: xMin, rangeMaxA: xMax }, 501);
  graph.push(`<g clip-path="url(#pcPlotClip)">`);
  c.devices.forEach((d, i) => {
    const color = PROTECTION_COLORS[i], segments = []; let segment = [];
    for (const a of points) {
      const response = responseAt(d, a, c.referenceKV);
      if (!Number.isFinite(response.totalTime)) { if (segment.length) segments.push(segment); segment = []; }
      else segment.push({ x: X(a), response });
    }
    if (segment.length) segments.push(segment);
    const path = (list, field, reverse = false) => (reverse ? [...list].reverse() : list).map((p, j) => (j ? "L" : "M") + p.x.toFixed(3) + "," + Y(p.response[field]).toFixed(3)).join(" ");
    for (const list of segments) {
      if (showBands && (d.timeTolerancePercent || d.timeToleranceSeconds)) {
        const band = path(list, "totalEarliest") + " " + path(list, "totalLatest", true).replace(/^M/, "L") + " Z";
        graph.push(E("path", { d: band, fill: color, opacity: .13, "data-band": d.id }));
      }
      graph.push(E("path", { d: path(list, "totalTime"), fill: "none", stroke: color, "stroke-width": 2.3, "data-curve": d.id }));
      if (showRelay) graph.push(E("path", { d: path(list, "relayTime"), fill: "none", stroke: color, "stroke-width": 1.3, "stroke-dasharray": "5 4", "data-relay": d.id }));
    }
    const r = responseAt(d, c.evaluationA, c.referenceKV);
    if (Number.isFinite(r.totalTime)) graph.push(E("circle", { cx: X(c.evaluationA), cy: Y(r.totalTime), r: 4, fill: color }));
  });
  graph.push(E("line", { x1: X(c.evaluationA), x2: X(c.evaluationA), y1: top, y2: bottom, stroke: "#304a63", "stroke-dasharray": "6 5" }), `</g>`);
  graph.push(E("rect", { x: left, y: top, width: right - left, height: bottom - top, fill: "none", stroke: "#a4bacf" }));
  return { svg: graph.join(""), width, height, yMin, yMax,
    caption: "Contínua: relé + disjuntor. " + (showBands ? "Banda: tolerância de tempo assumida. " : "") +
      (showRelay ? "Tracejada colorida: só o relé. " : "") + "Fundo azul: faixa avaliada. Tempos fora de " + tick(yMin) + "–" + tick(yMax) + " s são recortados no gráfico." };
}
