import test from "node:test";
import assert from "node:assert/strict";
import { protectionResponse, protectionTime } from "../src/electrical-studies.js";
import { DEFAULT_COORDINATION_CASE, coordinationDevice, normalizeCoordinationCase, coordinationExample,
  primarySettings, responseAt, pairAt, coordinationSamples, analyzeCoordination, saveCoordinationCases,
  loadCoordinationCases, coordinationReportCSV, coordinationReportText } from "../src/protection-coordination.js";
import { coordinationChart } from "../src/protection-chart.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} ≠ ${expected}`);
const device = (i = 0, overrides = {}) => ({ ...coordinationDevice(i), protectionCurve: "definite", definiteTime: .2 + i * .4, ...overrides });
const config = overrides => normalizeCoordinationCase({ ...DEFAULT_COORDINATION_CASE, devices: [device(0), device(1)], ...overrides });

for (const [curve, expected] of [["ieeeModerate", .0515 / (2 ** .02 - 1) + .114], ["ieeeVery", 19.61 / 3 + .491], ["ieeeExtreme", 28.2 / 3 + .1217]]) {
  test(`${curve}: published generic equation at twice pickup includes its additive constant`, () => {
    close(protectionTime(device(0, { protectionCurve: curve, pickupA: 100, timeMultiplier: .25, breakerTime: .06 }), 200), expected * .25 + .06);
  });
}
for (const [curve, expected] of [["iecLong", 120], ["iecShort", .05 / (2 ** .04 - 1)]]) {
  test(`${curve}: generic IEC equation at twice pickup`, () => {
    close(protectionTime(device(0, { protectionCurve: curve, pickupA: 100, timeMultiplier: 1, breakerTime: 0 }), 200), expected);
  });
}
test("response separates relay operation from breaker clearing", () => {
  const r = protectionResponse(device(0, { breakerTime: .1 }), 1000);
  close(r.relayTime, .2); close(r.totalTime, .3); assert.equal(r.element, "timed");
});
test("instantaneous threshold is inclusive and an inactive timed element cannot suppress it", () => {
  const s = device(0, { pickupA: 1000, instantaneousA: 500 });
  assert.equal(protectionResponse(s, 499.999).element, "none");
  assert.equal(protectionResponse(s, 500).element, "instantaneous"); close(protectionTime(s, 500), .08);
});
test("a slower instantaneous element does not override a faster timed element", () => {
  assert.equal(protectionResponse(device(0, { instantaneousA: 500, instantaneousTime: 1 }), 1000).element, "timed");
});
test("near-pickup inverse response remains positive and finite", () => {
  const r = protectionResponse(device(0, { protectionCurve: "standard", pickupA: 100 }), 100 * (1 + 1e-12));
  assert.ok(Number.isFinite(r.relayTime) && r.relayTime > 1e10);
  assert.equal(protectionTime(device(0, { protectionCurve: "standard", pickupA: 100 }), 100), Infinity);
});
test("prototype names are not accepted as a protection curve", () => {
  assert.throws(() => protectionTime(device(0, { protectionCurve: "constructor" }), 1000));
});
test("secondary settings convert pickup and instantaneous thresholds to local primary amperes", () => {
  const d = device(0, { inputBasis: "secondary", ctPrimary: 800, ctSecondary: 5, pickupA: 2.5, instantaneousA: 10 });
  const p = primarySettings(d); close(p.pickupA, 400); close(p.instantaneousA, 1600);
  assert.equal(responseAt(d, 1599, 13.8).element, "timed"); assert.equal(responseAt(d, 1600, 13.8).element, "instantaneous");
  close(responseAt(d, 1600, 13.8).secondaryA, 10);
});
test("primary settings are independent of the CT ratio", () => {
  const a = device(0, { ctPrimary: 200, ctSecondary: 5 }), b = device(0, { ctPrimary: 2000, ctSecondary: 1 });
  close(responseAt(a, 1000, 13.8).relayTime, responseAt(b, 1000, 13.8).relayTime);
  close(primarySettings(a).pickupA, 300);
});
test("different voltage levels use equivalent three-phase through-current", () => {
  const low = device(0, { deviceKV: .48, pickupA: 1000, protectionCurve: "very" }), localA = 3000 * 13.8 / .48;
  const r = responseAt(low, 3000, 13.8); close(r.localA, localA);
  close(r.totalTime, protectionTime(low, localA));
});
test("secondary and primary cases at another voltage produce the same response", () => {
  const secondary = device(0, { deviceKV: 6.9, pickupA: 2, inputBasis: "secondary", ctPrimary: 600, ctSecondary: 1, protectionCurve: "ieeeVery" });
  const primary = { ...secondary, inputBasis: "primary", pickupA: 1200 };
  close(responseAt(secondary, 3000, 13.8).totalTime, responseAt(primary, 3000, 13.8).totalTime);
});
test("margin uses upstream relay operation, not the upstream breaker's later opening", () => {
  const c = config({ devices: [device(0), device(1, { definiteTime: .15, breakerTime: 1 })] }), r = analyzeCoordination(c);
  assert.ok(r.pairs[0].evaluation.up.totalTime > r.pairs[0].evaluation.down.totalTime);
  close(r.pairs[0].evaluation.gap, -.11); assert.equal(r.pairs[0].status, "insufficient");
});
test("downstream breaker opening is included before the additional gap", () => {
  const c = config({ devices: [device(0, { breakerTime: .25 }), device(1, { definiteTime: .6 })] });
  const r = analyzeCoordination(c); close(r.pairs[0].worst.gap, .15); assert.equal(r.pairs[0].status, "insufficient");
});
test("time tolerances form a conservative relay-versus-clearing margin", () => {
  const c = config({ devices: [device(0, { timeTolerancePercent: 10, timeToleranceSeconds: .01 }),
    device(1, { definiteTime: .6, timeTolerancePercent: 5, timeToleranceSeconds: .02 })] });
  const r = pairAt(...c.devices, 1000, c); close(r.down.totalLatest, .29); close(r.up.relayEarliest, .55); close(r.gap, .26);
});
test("time bands clamp earliest relay time to zero", () => {
  const r = responseAt(device(0, { timeToleranceSeconds: 1 }), 1000, 13.8);
  close(r.relayEarliest, 0); close(r.totalEarliest, .06); close(r.totalLatest, 1.26);
});
test("a margin exactly at the configured requirement passes the numeric comparison", () => {
  const c = config({ devices: [device(0), device(1, { definiteTime: .46 })] });
  close(analyzeCoordination(c).pairs[0].worst.gap, .2); assert.equal(analyzeCoordination(c).pairs[0].status, "sufficient");
});
test("neither relay operating produces a pending result, never a sufficient gap", () => {
  const c = config({ rangeMinA: 50, rangeMaxA: 100, evaluationA: 75 });
  const r = analyzeCoordination(c); assert.equal(r.pairs[0].status, "pending"); assert.equal(r.pairs[0].worst, null);
  assert.equal(r.pairs[0].evaluation.reason, "Ambas sem atuação");
});
test("a downstream operation without upstream backup stays pending", () => {
  const c = config({ devices: [device(0), device(1, { pickupA: 20000 })] });
  const p = analyzeCoordination(c).pairs[0]; assert.equal(p.status, "pending"); assert.equal(p.evaluation.gap, null);
  assert.match(p.evaluation.reason, /sem retaguarda/);
});
test("upstream-only operation identifies missing downstream protection", () => {
  const c = config({ devices: [device(0, { pickupA: 20000 }), device(1)] });
  assert.equal(analyzeCoordination(c).pairs[0].evaluation.reason, "Só a montante atua");
});
test("partially covered fault ranges are not reported as coordinated", () => {
  const c = config({ rangeMinA: 100, devices: [device(0), device(1, { pickupA: 600 })] });
  const p = analyzeCoordination(c).pairs[0]; assert.equal(p.status, "mixed"); assert.ok(p.counts.pending > 0 && p.counts.sufficient > 0);
});
test("threshold samples detect an extremely narrow upstream instantaneous conflict", () => {
  const c = config({ devices: [device(0, { instantaneousA: 4321.00002 }), device(1, { instantaneousA: 4321.00001 })] });
  const r = analyzeCoordination(c); assert.equal(r.pairs[0].status, "insufficient");
  assert.ok(r.pairs[0].worst.referenceA >= 4321.00001 && r.pairs[0].worst.referenceA < 4321.00002);
  close(r.pairs[0].worst.gap, .02 - .26);
});
test("samples include exact voltage-referred thresholds, range endpoints and the evaluation point", () => {
  const c = config({ devices: [device(0, { deviceKV: 6.9, instantaneousA: 5000 }), device(1)] });
  const s = coordinationSamples(c); assert.equal(s[0], c.rangeMinA); assert.equal(s.at(-1), c.rangeMaxA);
  assert.ok(s.includes(2500)); assert.ok(s.includes(c.evaluationA)); assert.equal(new Set(s).size, s.length);
});
test("the independent training example evaluates two adjacent pairs with the assumed bands", () => {
  const c = coordinationExample(), r = analyzeCoordination(c); assert.equal(r.pairs.length, 2);
  assert.ok(r.pairs.every(p => p.status === "sufficient")); assert.ok(c.devices.every(d => d.equipmentId === ""));
});
test("coordination does not write settings or switching states into the operational model", () => {
  const c = config({ devices: [device(0, { equipmentId: "a" }), device(1)] });
  const model = { name: "Teste", items: { a: { type: "breaker", state: "open", electrical: { pickupA: 900 } } } }, before = structuredClone(model), original = structuredClone(c);
  const r = analyzeCoordination(c, model); assert.deepEqual(model, before); assert.deepEqual(c, original); assert.match(r.warnings.join(" "), /não está fechado/);
});
test("a missing saved breaker prevents exportable results instead of silently using a different equipment", () => {
  assert.throws(() => analyzeCoordination(config({ devices: [device(0, { equipmentId: "absent" }), device(1)] })), /ausente/);
});
test("an empty case is valid for editing but cannot be analyzed", () => {
  const c = normalizeCoordinationCase({}); assert.deepEqual(c.devices, []); assert.throws(() => analyzeCoordination(c), /pelo menos duas/);
});
test("normalization rejects invalid ranges, wrong versions and unsafe numeric values", () => {
  for (const extra of [{ version: 2 }, { kind: "loadFlow" }, { rangeMaxA: 1000 }, { evaluationA: 500 }, { rangeMinA: "" },
    { referenceKV: null }, { marginSeconds: false }, { rangeMaxA: Infinity }, { rangeMinA: [] }]) assert.throws(() => config(extra));
});
test("normalization rejects unsafe devices and duplicate IDs or bindings", () => {
  for (const extra of [{ protectionCurve: "constructor" }, { inputBasis: "invalid" }, { ctSecondary: 0 }, { pickupA: "" },
    { timeTolerancePercent: 100 }, { deviceKV: false }, { id: "__proto__" }, { equipmentId: "constructor" }]) assert.throws(() => config({ devices: [device(0, extra), device(1)] }));
  assert.throws(() => config({ devices: [device(), device()] }));
  assert.throws(() => config({ devices: [device(0, { equipmentId: "same" }), device(1, { equipmentId: "same" })] }));
  assert.throws(() => normalizeCoordinationCase(JSON.parse('{"__proto__":{"polluted":true}}')));
});
test("case normalization whitelists settings and returns independent data", () => {
  const raw = { ...DEFAULT_COORDINATION_CASE, operationalCommand: "close", devices: [device(0, { command: "open" })] }, c = normalizeCoordinationCase(raw);
  assert.ok(!("operationalCommand" in c)); assert.ok(!("command" in c.devices[0])); c.devices[0].pickupA = 123; assert.equal(raw.devices[0].pickupA, 300);
});
test("device and storage limits protect large or malformed imported cases", () => {
  assert.throws(() => config({ devices: Array.from({ length: 9 }, (_, i) => device(i)) }));
  assert.throws(() => saveCoordinationCases({ setItem() {} }, "key", Array.from({ length: 41 }, () => config())));
});
test("saved cases round-trip locally and damaged entries are skipped", () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }, c = config();
  saveCoordinationCases(storage, "a", [c]); assert.deepEqual(loadCoordinationCases(storage, "a"), [c]); assert.deepEqual(loadCoordinationCases(storage, "b"), []);
  data.set("a", '[{"version":2},{"name":"Recuperado"}]'); assert.equal(loadCoordinationCases(storage, "a")[0].name, "Recuperado");
  data.set("a", 'invalid'); assert.deepEqual(loadCoordinationCases(storage, "a"), []);
});
test("reports include editable criteria, settings, through-current base and missing operation", () => {
  const r = analyzeCoordination(config({ devices: [device(0), device(1, { pickupA: 20000 })] }));
  const report = coordinationReportText(r);
  for (const text of ["13.8", "Margem adicional", "Parâmetros do caso", "Sem atuação", "faixa amostrada", "Corrente passante", "relé a montante"]) assert.ok(report.includes(text), text);
  assert.ok(!report.includes("Infinity"));
});
test("CSV quotes fields and prevents formula injection in user-supplied names", () => {
  const c = config({ name: '=SUM(1;2)', devices: [device(0, { name: '@cmd;"x"' }), device(1)] }), csv = coordinationReportCSV(analyzeCoordination(c));
  assert.ok(csv.startsWith("\ufeff")); assert.ok(csv.includes('"\'=SUM(1;2)"')); assert.ok(csv.includes('"\'@cmd;""x"""')); assert.ok(csv.includes("\r\n"));
});
test("chart uses one reference base, shows real bands and escapes imported labels", () => {
  const c = coordinationExample(); c.name = '<script>alert("test")</script>'; c.devices[0].id = 'a" onclick="bad';
  const plot = coordinationChart(c, { showRelay: true }); assert.ok(!plot.svg.includes("<script>")); assert.ok(plot.svg.includes("&lt;script&gt;"));
  assert.ok(!plot.svg.includes(' onclick="bad"')); assert.ok(plot.svg.includes('data-band=')); assert.ok(plot.svg.includes('data-relay='));
  assert.ok(!/NaN|Infinity/.test(plot.svg)); assert.match(plot.caption, /tempo assumida/);
});
test("chart does not draw a curve below an inactive pickup and can plot zero relay time safely", () => {
  const c = config({ devices: [device(0, { pickupA: 20000 }), device(1, { instantaneousA: 2000, instantaneousTime: 0, breakerTime: 0 })] });
  const plot = coordinationChart(c, { showRelay: true }); assert.ok(!plot.svg.includes('data-curve="device-1"')); assert.ok(plot.svg.includes('data-curve="device-2"'));
  assert.ok(!/NaN|Infinity/.test(plot.svg)); assert.ok(plot.yMin > 0 && plot.yMax > plot.yMin);
});
