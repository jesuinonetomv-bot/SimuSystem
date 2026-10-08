// Explicit sequence and earth-protection data. Blank impedances stay unknown.
const n = (key, label, min = 0, value = null) => [key, label, "number", min, null, value];
const s = (key, label, options, value = "unknown") => [key, label, "select", null, options, value];
const curves = { none: "Desativada", standard: "IEC inversa normal", very: "IEC muito inversa", extreme: "IEC extremamente inversa",
  iecLong: "IEC inversa longa", iecShort: "IEC inversa curta", ieeeModerate: "IEEE moderadamente inversa",
  ieeeVery: "IEEE muito inversa", ieeeExtreme: "IEEE extremamente inversa", definite: "Tempo definido" };
export function earthProtectionFields(type) {
  return [s("earthCurve", "Curva de terra (50N/51N)", curves, "none"),
    ...(type === "relay" ? [s("earthInputBasis", "Base dos ajustes de terra", { secondary: "Secundário do sensor escolhido", primary: "Primário local" }, "secondary"),
      s("earthSensor", "Medição de terra", { residual: "Residual dos três TCs de fase (3I₀)", cbct: "TC toroidal vinculado" }, "residual")] : []),
    n("earthPickupA", "Pickup de terra (A na base escolhida)", .000001), n("earthTimeMultiplier", "Multiplicador de tempo de terra", .000001, .1),
    n("earthDelaySeconds", "Tempo definido de terra (s)", .000001),
    n("earthInstantaneousA", "Pickup instantâneo de terra (A; 0 desliga)", 0, 0), n("earthInstantaneousTime", "Tempo instantâneo de terra (s)", 0, .02)];
}
export function sequenceFields(type) {
  if (["utility", "turbogenerator"].includes(type)) return [
    s("negativeSequenceModel", "Sequência negativa da fonte (Z₂)", { unknown: "Não informado", same: "Hipótese declarada: Z₂ = Z₁", custom: "R₂ e X₂ informados em Ω" }),
    n("negativeResistanceOhm", "R₂ da fonte (Ω na tensão nominal)"), n("negativeReactanceOhm", "X₂ da fonte (Ω na tensão nominal)"),
    s("sourceGrounding", "Retorno de sequência zero da fonte", { unknown: "Não informado", grounded: "Aterrado · Z₀ informado", isolated: "Isolado · sem retorno condutivo" }),
    n("zeroResistanceOhm", "R₀ equivalente da fonte, sem Zn local (Ω)"), n("zeroReactanceOhm", "X₀ equivalente da fonte, sem Zn local (Ω)"),
    n("neutralResistanceOhm", "R do neutro local (Ω; 0 = direto)", 0, 0), n("neutralReactanceOhm", "X do neutro local (Ω; 0 = direto)", 0, 0),
    n("sourcePhaseDeg", "Ângulo da fonte em relação à referência (°)", -360, 0)];
  if (type === "transformer") return [
    s("primaryConnection", "Ligação primária", { unknown: "Não informada", D: "D · triângulo", Y: "Y · estrela isolada", Yg: "Yg · estrela aterrada" }),
    s("secondaryConnection", "Ligação secundária", { unknown: "Não informada", D: "D · triângulo", Y: "Y · estrela isolada", Yg: "Yg · estrela aterrada" }),
    s("vectorClock", "Grupo horário (tensão secundária atrasa n × 30°)", { "": "Não informado", ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), String(i) + " · " + i * 30 + "°"])) }, ""),
    n("zeroImpedancePercent", "Z₀ do transformador (% na potência nominal)", .000001), n("zeroTransformerXR", "X/R de sequência zero do transformador", .000001),
    n("primaryNeutralResistanceOhm", "R do neutro primário (Ω; 0 = direto)", 0, 0), n("primaryNeutralReactanceOhm", "X do neutro primário (Ω; 0 = direto)", 0, 0),
    n("secondaryNeutralResistanceOhm", "R do neutro secundário (Ω; 0 = direto)", 0, 0), n("secondaryNeutralReactanceOhm", "X do neutro secundário (Ω; 0 = direto)", 0, 0)];
  if (type === "line") return [n("zeroResistanceOhm", "R₀ total do trecho (Ω)"), n("zeroReactanceOhm", "X₀ total do trecho (Ω)")];
  if (type === "cable") return [n("zeroResistanceOhmPerKm", "R₀ do cabo (Ω/km)"), n("zeroReactanceOhmPerKm", "X₀ do cabo (Ω/km)")];
  if (type === "breaker" || type === "relay") return earthProtectionFields(type);
  return [];
}
export const measurementTerminalField = s("measurementTerminal", "Terminal medido em cabo / conexão", { A: "A · início do trecho", B: "B · fim do trecho" }, "A");
export const sequenceNote = "Z₂ = Z₁ é usado em linhas/cabos equilibrados e transformadores. Para fontes, declare Z₂. Em fase-terra, informe Z₀, ligação dos enrolamentos e aterramento; a impedância do neutro entra como 3Zn. Conexões de desenho ideais não recebem impedância fictícia.";
