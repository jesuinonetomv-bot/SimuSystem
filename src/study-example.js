// Deliberately separate from the published system and from switching commands.
export function exampleStudyDiagram() {
  const bus = (name, x, kv) => ({ type: "bus", name, x1: x, x2: x + 100, y1: 0, y2: 0, electrical: { nominalKV: kv } });
  const topology = (terminalA, terminalB) => ({ terminalA, ...(terminalB ? { terminalB } : {}) });
  return { name: "Exemplo didático · três barras", items: {
    hv: bus("Rede 230 kV", 0, 230), lv: bus("Barra 13,8 kV", 1000, 13.8), feeder: bus("Alimentador", 2000, 13.8),
    grid: { type: "utility", name: "Rede exemplo", x: -500, y: -500, state: "running", topology: topology("hv"),
      electrical: { nominalKV: 230, voltageSetpointPU: 1, shortCircuitMVA: 5000, sourceXR: 10 } },
    tf: { type: "transformer", name: "TF exemplo", x: 600, y: 800, topology: topology("hv", "lv"),
      electrical: { primaryKV: 230, secondaryKV: 13.8, ratedMVA: 25, impedancePercent: 10, transformerXR: 10, tapPercent: 0 } },
    cable: { type: "line", name: "Cabo exemplo", x1: 1000, y1: 700, x2: 2000, y2: 700, topology: topology("lv", "feeder"),
      electrical: { nominalKV: 13.8, resistanceOhm: .05, reactanceOhm: .18, ampacityA: 600 } },
    loadA: { type: "load", name: "Carga A", x: 3000, y: 3000, state: "active", topology: topology("lv"),
      electrical: { nominalKV: 13.8, activePowerMW: 8, powerFactor: .92 } },
    loadB: { type: "load", name: "Carga B", x: 4000, y: 4000, state: "active", topology: topology("feeder"),
      electrical: { nominalKV: 13.8, activePowerMW: 6, powerFactor: .9 } },
    tg: { type: "turbogenerator", name: "TG exemplo", x: 5000, y: 5000, state: "running", topology: topology("feeder"),
      electrical: { nominalKV: 13.8, generationMW: 4, generationMvar: 0, generatorRatedMVA: 10, voltageSetpointPU: 1 } },
  } };
}
