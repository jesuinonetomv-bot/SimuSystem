// Terminal graph for switching studies. The commanded switch is removed
// before looking for an alternate electrical path; transformers keep two ports.
import { cableEquivalent, equipmentDefaults } from "./equipment-library.js?v=49";
const SWITCHES = new Set(["breaker", "disconnector"]);
const CONTACTS = new Set(["breaker", "disconnector", "fuse"]);
const CONDUCTORS = new Set(["line", "bus"]);
const TYPES = new Set(["line", "bus", "breaker", "disconnector", "transformer",
  "utility", "turbogenerator", "load", "capacitor", "motor", "cable", "fuse"]);
const EPS = 1e-9;
const finite = (v) => v !== null && v !== "" && Number.isFinite(Number(v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function project(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}
function defaultTerminals(o) {
  const z = o.scale || 1, r = (o.rotation || 0) * Math.PI / 180;
  const rot = (x, y) => ({ x: o.x + x * Math.cos(r) - y * Math.sin(r),
    y: o.y + x * Math.sin(r) + y * Math.cos(r) });
  if (CONTACTS.has(o.type)) return [rot(0, -22 * z), rot(0, 22 * z)];
  if (o.type === "transformer") return [rot(0, -44 * z), rot(0, 44 * z)];
  if (o.type === "turbogenerator") return [rot(18 * z, -40 * z)];
  if (o.type === "utility") return [rot(0, -52 * z)];
  if (["load", "capacitor", "motor"].includes(o.type)) return [rot(0, -34 * z)];
  return [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }];
}
function defaultElectrical(o) {
  return { nominalKV: 13.8, frequencyHz: 60, resistanceOhm: 0.02,
    reactanceOhm: 0.04, impedancePercent: 10, ...(o.electrical || {}) };
}
function configured(o) {
  return !!(o.topology?.terminalA || o.topology?.terminalB);
}
function impedance(o, data, fraction = 1) {
  if (o.type === "cable") {
    const z = cableEquivalent({ ...equipmentDefaults("cable"), ...o.electrical });
    return { ...z, resistanceOhm: z.known ? z.resistanceOhm * fraction : null,
      reactanceOhm: z.known ? z.reactanceOhm * fraction : null,
      hasImpedance: z.known && Math.hypot(z.resistanceOhm, z.reactanceOhm) * fraction > EPS,
      kind: "cable", modelDefault: false };
  }
  if (o.type === "transformer") {
    const known = finite(data.impedancePercent) && Number(data.impedancePercent) >= 0;
    const percent = known ? Number(data.impedancePercent) : null;
    return { known, hasImpedance: known && percent > EPS, kind: "transformer",
      percent, modelDefault: o.electrical?.impedancePercent == null };
  }
  if (o.type === "line") {
    // Drawing a connection does not configure a series impedance. Only use
    // the line parameters saved by Engineering, never the display defaults.
    const configuredR = Object.hasOwn(o.electrical || {}, "resistanceOhm");
    const configuredX = Object.hasOwn(o.electrical || {}, "reactanceOhm");
    const resistance = configuredR ? data.resistanceOhm : 0;
    const reactance = configuredX ? data.reactanceOhm : 0;
    const known = finite(resistance) && finite(reactance) &&
      Number(resistance) >= 0 && Number(reactance) >= 0;
    const r = known ? Number(resistance) * fraction : null;
    const x = known ? Number(reactance) * fraction : null;
    return { known, hasImpedance: known && Math.hypot(r, x) > EPS,
      kind: "line", resistanceOhm: r, reactanceOhm: x,
      modelDefault: o.electrical?.resistanceOhm == null ||
        o.electrical?.reactanceOhm == null };
  }
  return { known: true, hasImpedance: false, kind: "ideal" };
}
export function createSwitchingStudy(diagram, options = {}) {
  const items = diagram?.items || {};
  const terminals = options.terminals || defaultTerminals;
  const electricalData = options.electricalData || defaultElectrical;
  const tolerance = options.tolerance ?? 20;
  const entries = Object.entries(items).filter(([, o]) => o && TYPES.has(o.type));
  const ports = new Map(), points = new Map(), taps = new Map();
  const adj = new Map(), edges = [], issues = [];
  const issue = (id, message) => issues.push({ id, message });
  function node(key, point) {
    if (!adj.has(key)) adj.set(key, []);
    points.set(key, point);
    return key;
  }
  function edge(a, b, id, imp = { known: true, hasImpedance: false, kind: "ideal" }) {
    if (!adj.has(a) || !adj.has(b) || a === b) return;
    const e = { a, b, id, ...imp };
    edges.push(e);
    adj.get(a).push({ to: b, edge: e });
    adj.get(b).push({ to: a, edge: e });
  }
  for (const [id, o] of entries) {
    const raw = terminals(o);
    if (!raw?.length || raw.some((p) => !p || !finite(p.x) || !finite(p.y))) {
      issue(id, "Posição dos terminais inválida: " + (o.name || id));
      continue;
    }
    const keys = raw.map((p, i) => node(id + "@" + i,
      { x: Number(p.x), y: Number(p.y) }));
    ports.set(id, keys);
    if (CONDUCTORS.has(o.type))
      taps.set(id, [{ t: 0, key: keys[0] }, { t: 1, key: keys[1] }]);
  }
  function conductorTap(id, p) {
    const ps = ports.get(id), list = taps.get(id);
    const q = project(p, points.get(ps[0]), points.get(ps[1]));
    const existing = list.find((x) => Math.abs(x.t - q.t) < EPS);
    if (existing) return existing.key;
    const key = node(id + "@tap" + list.length, q);
    list.push({ t: q.t, key });
    return key;
  }
  function targetPort(targetId, fromId, fromPoint, role) {
    const target = items[targetId], ps = ports.get(targetId);
    if (!target || !ps) return null;
    if (CONDUCTORS.has(target.type)) return conductorTap(targetId, fromPoint);
    if (target.type === "transformer") {
      if (role === "transformer_primary") return ps[0];
      if (role === "transformer_secondary") return ps[1];
    }
    const reciprocal = [target.topology?.terminalA, target.topology?.terminalB]
      .indexOf(fromId);
    if (reciprocal >= 0 && reciprocal < ps.length) return ps[reciprocal];
    return ps.reduce((best, key) =>
      distance(points.get(key), fromPoint) < distance(points.get(best), fromPoint)
        ? key : best, ps[0]);
  }
  // Explicit terminal bindings take priority over visual proximity.
  for (const [id, o] of entries) {
    if (!configured(o) || !ports.has(id)) continue;
    const ps = ports.get(id);
    const targets = [o.topology?.terminalA, o.topology?.terminalB];
    if (!targets[0] || (ps.length > 1 && !targets[1]))
      issue(id, "Topologia incompleta: " + (o.name || id));
    for (let i = 0; i < ps.length; i++) {
      const targetId = targets[i];
      if (!targetId) continue;
      if (targetId === id) {
        issue(id, "Um terminal referencia o próprio equipamento.");
        continue;
      }
      const key = targetPort(targetId, id, points.get(ps[i]), o.topology.role);
      if (!key) {
        issue(id, "Referência de terminal inexistente: " + targetId);
        continue;
      }
      edge(ps[i], key, null);
    }
  }
  for (let i = 0; i < entries.length; i++) {
    const [aId, a] = entries[i], ap = ports.get(aId);
    if (!ap || configured(a)) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const [bId, b] = entries[j], bp = ports.get(bId);
      if (!bp || configured(b)) continue;
      function connectToConductor(conductorId, pointPorts) {
        const cp = ports.get(conductorId);
        for (const key of pointPorts) {
          const p = points.get(key);
          const q = project(p, points.get(cp[0]), points.get(cp[1]));
          if (distance(p, q) <= tolerance)
            edge(key, conductorTap(conductorId, p), null);
        }
      }
      if (CONDUCTORS.has(a.type)) connectToConductor(aId, bp);
      if (CONDUCTORS.has(b.type)) connectToConductor(bId, ap);
      if (!CONDUCTORS.has(a.type) && !CONDUCTORS.has(b.type))
        for (const ak of ap) for (const bk of bp)
          if (distance(points.get(ak), points.get(bk)) <= tolerance)
            edge(ak, bk, null);
    }
  }
  // A conductor drawn behind a switch/transformer must not bypass its ports.
  // A study-only tap locates a fault without changing the saved drawing.
  const faultPoint = options.studyFaultPoint;
  let faultKey = null;
  if (faultPoint && ports.has(faultPoint.itemId)) {
    const id = faultPoint.itemId, o = items[id], ps = ports.get(id);
    if (CONDUCTORS.has(o.type)) {
      const a = points.get(ps[0]), b = points.get(ps[1]), t = faultPoint.fraction;
      faultKey = conductorTap(id, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    } else if (o.type === "cable" && faultPoint.fraction > 0 && faultPoint.fraction < 1) {
      const a = points.get(ps[0]), b = points.get(ps[1]), t = faultPoint.fraction;
      faultKey = node(id + "@fault", { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    } else faultKey = ps[o.type === "cable" && faultPoint.fraction === 1 ? 1 : faultPoint.port || 0];
  }
  for (const [id, list] of taps) {
    const cp = ports.get(id), a = points.get(cp[0]), b = points.get(cp[1]);
    const cuts = [];
    for (const [deviceId, o] of entries) {
      if ((!CONTACTS.has(o.type) && o.type !== "transformer") ||
          configured(o) || !ports.has(deviceId)) continue;
      const dp = ports.get(deviceId);
      const p = points.get(dp[0]), q = points.get(dp[1]);
      const pa = project(p, a, b), pb = project(q, a, b);
      if (distance(p, pa) <= tolerance && distance(q, pb) <= tolerance &&
          Math.abs(pa.t - pb.t) > EPS)
        cuts.push([Math.min(pa.t, pb.t), Math.max(pa.t, pb.t)]);
    }
    list.sort((x, y) => x.t - y.t);
    const data = electricalData(items[id]);
    for (let i = 1; i < list.length; i++) {
      const t = (list[i - 1].t + list[i].t) / 2;
      if (cuts.some(([lo, hi]) => t > lo + EPS && t < hi - EPS)) continue;
      edge(list[i - 1].key, list[i].key, id,
        impedance(items[id], data, list[i].t - list[i - 1].t));
    }
  }
  // Merged diagram connector IDs link matching buses across tabs.
  const groups = new Map();
  for (const [id, o] of entries) {
    if (!CONDUCTORS.has(o.type) || !o.conductorGroupId || !ports.has(id)) continue;
    const key = ports.get(id)[0], first = groups.get(o.conductorGroupId);
    if (first) edge(first, key, null);
    else groups.set(o.conductorGroupId, key);
  }
  for (const [id, o] of entries) {
    const ps = ports.get(id);
    if (!ps || ps.length !== 2) continue;
    if (o.type === "cable" && id === faultPoint?.itemId && faultKey && !ps.includes(faultKey)) {
      edge(ps[0], faultKey, id, impedance(o, electricalData(o), faultPoint.fraction));
      edge(faultKey, ps[1], id, impedance(o, electricalData(o), 1 - faultPoint.fraction));
    } else if (["transformer", "cable"].includes(o.type) || CONTACTS.has(o.type))
      edge(ps[0], ps[1], id, impedance(o, electricalData(o)));
  }
  const conducts = (e, states = {}, excluded = null) =>
    (excluded === null || e.id !== excluded) &&
    (!CONTACTS.has(items[e.id]?.type) ||
      (states[e.id] ?? items[e.id].state) === "closed");
  function walk(seed, states = {}, accepts = () => true, excluded = null) {
    const seeds = Array.isArray(seed) ? seed : [seed];
    const seen = new Set(seeds.filter((key) => adj.has(key))), queue = [...seen];
    for (let i = 0; i < queue.length; i++)
      for (const link of adj.get(queue[i]) || [])
        if (conducts(link.edge, states, excluded) && accepts(link.edge) &&
            !seen.has(link.to)) {
          seen.add(link.to);
          queue.push(link.to);
        }
    return seen;
  }
  const sourceEntries = entries.filter(([id, o]) => ports.has(id) &&
    o.state !== "stopped" && o.isSource !== false &&
    (o.type === "utility" || o.type === "turbogenerator" || o.isSource === true));
  const sourcePorts = sourceEntries.flatMap(([id]) => ports.get(id));
  const livePorts = (states = {}, excluded = null) =>
    walk(sourcePorts, states, () => true, excluded);
  const energizedItems = (states = {}) => {
    const live = livePorts(states);
    return new Set(entries.filter(([id, o]) => ports.has(id) &&
      (!CONTACTS.has(o.type) || (states[id] ?? o.state) === "closed") &&
      ports.get(id).some((key) => live.has(key))).map(([id]) => id));
  };
  const sourcesFor = (seen) => sourceEntries.filter(([id]) =>
    ports.get(id).some((key) => seen.has(key)))
    .map(([id, o]) => ({ id, name: o.name || id }));
  const issuesIn = (seen, id) => issues.filter((x) => x.id === id ||
    (ports.get(x.id) || []).some((key) => seen.has(key)));
  const transformers = entries.filter(([id, o]) =>
    o.type === "transformer" && ports.has(id));

  function analyze(switchId, states = {}) {
    const sw = items[switchId];
    const invalid = (message) => ({ type: "indeterminate", label: "Topologia a verificar",
      message, ring: null, hasImpedance: null, parallelTransformers: [],
      requiresSynchronism: false, path: [], components: [], sourcesA: [], sourcesB: [],
      energizedA: null, energizedB: null, issues });
    if (!sw || !SWITCHES.has(sw.type) || !ports.has(switchId))
      return invalid("Selecione um disjuntor ou uma seccionadora com dois terminais válidos.");
    const [start, end] = ports.get(switchId);
    const before = { ...states, [switchId]: "open" };
    const sideA = walk(start, before), sideB = walk(end, before);
    const relevantIssues = issuesIn(new Set([...sideA, ...sideB]), switchId);
    if (relevantIssues.length)
      return invalid(relevantIssues.map((x) => x.message).join(" "));
    if (!adj.get(start)?.some((link) => link.edge.id !== switchId) ||
        !adj.get(end)?.some((link) => link.edge.id !== switchId))
      return invalid("Um dos terminais está sem ligação elétrica. Configure os terminais A e B.");
    const sourcesA = sourcesFor(sideA), sourcesB = sourcesFor(sideB);
    const energizedA = sourcesA.length > 0, energizedB = sourcesB.length > 0;
    function findPath(accepts) {
      const parents = new Map([[start, null]]), queue = [start];
      for (let i = 0; i < queue.length && !parents.has(end); i++)
        for (const link of adj.get(queue[i]) || [])
          if (conducts(link.edge, before) && accepts(link.edge) && !parents.has(link.to)) {
            parents.set(link.to, { from: queue[i], edge: link.edge });
            queue.push(link.to);
          }
      if (!parents.has(end)) return null;
      const path = [];
      for (let key = end; parents.get(key); key = parents.get(key).from)
        path.unshift(parents.get(key).edge);
      return path;
    }
    const idealPath = findPath((e) => e.known && !e.hasImpedance);
    const path = idealPath || findPath(() => true);
    const ring = path !== null, hasImpedance = ring
      ? (path.some((e) => !e.known) ? null : path.some((e) => e.hasImpedance)) : null;
    const noTransformers = (e) => e.kind !== "transformer";
    const relevantTransformers = transformers.filter(([id]) =>
      ports.get(id).some((key) => sideA.has(key) || sideB.has(key)));
    // Parallel transformers need a common primary AND a common secondary.
    // Two transformers merely present in series are not sufficient.
    const regions = new Map(), afterRegions = new Map();
    const region = (key, after = false) => {
      const cache = after ? afterRegions : regions;
      if (!cache.has(key)) {
        const seen = walk(key, { ...states, [switchId]: after ? "closed" : "open" },
          noTransformers);
        for (const member of seen) cache.set(member, seen);
      }
      return cache.get(key);
    };
    const parallelTransformers = new Set();
    for (let i = 0; i < relevantTransformers.length; i++) for (let j = i + 1; j < relevantTransformers.length; j++) {
      const aId = relevantTransformers[i][0], bId = relevantTransformers[j][0];
      const [aP, aS] = ports.get(aId), [bP, bS] = ports.get(bId);
      const commonPrimary = region(aP).has(bP), commonSecondary = region(aS).has(bS);
      if ((commonPrimary && !commonSecondary && region(aS, true).has(bS)) ||
          (commonSecondary && !commonPrimary && region(aP, true).has(bP))) {
        parallelTransformers.add(aId);
        parallelTransformers.add(bId);
      }
    }
    const result = { type: "", label: "", message: "", ring, hasImpedance,
      energizedA, energizedB, sourcesA, sourcesB, requiresSynchronism: false,
      parallelTransformers: [...parallelTransformers],
      path: path ? [...new Set(path.map((e) => e.id).filter(Boolean))] : [],
      components: [], issues: relevantIssues };
    for (const id of result.path) {
      const o = items[id], imp = impedance(o, electricalData(o));
      result.components.push({ id, name: o.name || id, type: o.type, ...imp });
    }
    if (ring && !energizedA && !energizedB) {
      result.type = "deenergized_ring";
      result.label = "Fechamento de anel desenergizado";
      result.message = "Há um caminho elétrico alternativo, mas nenhuma fonte está energizando os terminais.";
    } else if (idealPath) {
      result.type = "ring_without_impedance";
      result.label = "Fechamento de anel sem impedância no modelo";
      result.message = "Os terminais já estão interligados por um caminho sem impedância série. O fechamento acrescenta um caminho em paralelo.";
    } else if (ring && hasImpedance === null) {
      result.type = "ring_unknown_impedance";
      result.label = "Fechamento de anel — impedância a verificar";
      result.message = "Há um caminho elétrico alternativo, mas algum parâmetro de impedância está inválido.";
    } else if (ring && parallelTransformers.size) {
      result.type = "transformer_parallel";
      result.label = "Paralelismo de transformadores";
      result.message = "O fechamento une os lados de transformadores que passam a compartilhar primário e secundário. O anel contém impedâncias de transformadores.";
    } else if (ring) {
      result.type = "ring_with_impedance";
      result.label = "Fechamento de anel com impedância";
      result.message = "Há um caminho elétrico alternativo por transformadores ou linhas com impedância. A presença de impedância não confirma a compatibilidade da manobra.";
    } else if (energizedA && energizedB) {
      result.type = "source_parallel";
      result.label = "Paralelismo de fontes";
      result.message = "Os terminais pertencem a ilhas energizadas separadas. O fechamento une as fontes; o sincronismo ainda precisa ser verificado.";
      result.requiresSynchronism = true;
    } else if (energizedA || energizedB) {
      result.type = "energization";
      result.label = "Energização de trecho";
      result.message = "Apenas um lado está energizado. O fechamento leva energia ao outro lado.";
    } else {
      result.type = "deenergized_connection";
      result.label = "Interligação de trechos desenergizados";
      result.message = "Nenhum dos dois lados tem uma fonte em operação.";
    }
    return result;
  }

  function firstBreakers(seed, states = {}) {
    const queue = [seed], seen = new Set(queue), found = [];
    for (let i = 0; i < queue.length; i++)
      for (const link of adj.get(queue[i]) || []) {
        if (items[link.edge.id]?.type === "transformer") continue;
        if (items[link.edge.id]?.type === "breaker") {
          if (!found.includes(link.edge.id)) found.push(link.edge.id);
          continue;
        }
        if (SWITCHES.has(items[link.edge.id]?.type) &&
            (states[link.edge.id] ?? items[link.edge.id].state) !== "closed") continue;
        if (!seen.has(link.to)) { seen.add(link.to); queue.push(link.to); }
      }
    return found;
  }
  function reverseTransformers(before, after, affected) {
    const found = [];
    for (const [id, o] of transformers) {
      const [primary, secondary] = ports.get(id);
      if (!affected.has(primary) && !affected.has(secondary)) continue;
      // Exclude the winding itself: otherwise the secondary would falsely
      // appear to be an independent source on the primary side.
      const was = livePorts(before, id), next = livePorts(after, id);
      if (next.has(primary) || !next.has(secondary) ||
          (!was.has(primary) && was.has(secondary))) continue;
      const candidates = firstBreakers(secondary, after)
        .filter((k) => (after[k] ?? items[k].state) === "closed");
      const single = candidates.find((k) =>
        !livePorts({ ...after, [k]: "open" }, id).has(secondary));
      const allOpen = Object.fromEntries(candidates.map((k) => [k, "open"]));
      const tripBreakers = single ? [single] :
        !livePorts({ ...after, ...allOpen }, id).has(secondary) ? candidates : [];
      found.push({ id, name: o.name || "Transformador", tripBreakers });
    }
    return found;
  }
  function command(switchId, nextState, states = {}) {
    const sw = items[switchId], analysis = analyze(switchId, states);
    if (!sw || !SWITCHES.has(sw.type) || !["open", "closed"].includes(nextState) ||
        analysis.type === "indeterminate")
      return { analysis, valid: false, canOpenInRing: null, lostLoads: [],
        reverseTransformers: [], nextState };
    const before = livePorts(states), afterStates = { ...states, [switchId]: nextState },
      after = livePorts(afterStates), affected = walk(ports.get(switchId), states);
    const lostLoads = entries.filter(([id, o]) => ["load", "motor"].includes(o.type) &&
      o.state === "active" && ports.has(id) && before.has(ports.get(id)[0]) &&
      !after.has(ports.get(id)[0])).map(([id, o]) => ({ id, name: o.name || "Carga" }));
    const reverse = reverseTransformers(states, afterStates, affected);
    return { analysis, valid: true, nextState, lostLoads, reverseTransformers: reverse,
      canOpenInRing: nextState === "open" && analysis.ring &&
        !lostLoads.length && !reverse.length,
      breaksRing: nextState === "open" && analysis.ring };
  }
  function openingCandidates(closingId, { onlyIdeal = false } = {}) {
    const closed = { [closingId]: "closed" }, analysis = analyze(closingId);
    if (!analysis.ring || analysis.type === "indeterminate") return [];
    const affected = walk(ports.get(closingId), closed), candidates = [];
    for (const [id, o] of entries) {
      if (o.type !== "breaker" || (closed[id] ?? o.state) !== "closed" ||
          o.inMaintenance || !ports.get(id)?.some((p) => affected.has(p))) continue;
      const opening = command(id, "open", closed);
      if (!opening.valid || !opening.canOpenInRing) continue;
      if (id !== closingId) {
        const remaining = analyze(closingId, { ...closed, [id]: "open" });
        if (remaining.type === "indeterminate" ||
            (onlyIdeal ? remaining.ring && remaining.hasImpedance !== true : remaining.ring))
          continue;
      }
      candidates.push({ id, name: o.name || "Disjuntor sem TAG" });
    }
    return candidates;
  }
  // Read-only snapshot of the same terminal connections used by the commands.
  // Visualization must not rebuild a proximity graph that bypasses open devices.
  const network = (states = {}) => ({
    items,
    ports: new Map([...ports].map(([id, keys]) => [id, [...keys]])),
    points: new Map([...points].map(([key, point]) => [key, { ...point }])),
    edges: edges.filter((e) => conducts(e, states)).map((e) => ({ ...e })),
    sources: sourceEntries.map(([id]) => id),
    faultKey,
    issues: issues.map((x) => ({ ...x })),
  });
  return { analyze, command, openingCandidates, energizedItems, network };
}
export function analyzeSwitching(diagram, switchId, options = {}) {
  return createSwitchingStudy(diagram, options).analyze(switchId);
}
