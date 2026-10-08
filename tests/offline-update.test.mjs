import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const code = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const base = "https://example.test/SimuSystem/";
function worker() {
  const listeners = new Map(), stored = new Map(), fetches = [], precached = [];
  let offline = false, html = "v47", status = 200, failedCache = false;
  const key = value => new URL(typeof value === "string" ? value : value.url, base).href;
  const cache = { addAll: async requests => precached.push(...requests),
    put: async (request, response) => { if (failedCache) throw Error("Quota"); stored.set(key(request), response); } };
  runInNewContext(code, {
    URL, Request, self: { location: { href: base + "sw.js" }, skipWaiting() {}, clients: { claim() {} },
      addEventListener: (name, handler) => listeners.set(name, handler) },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async request => stored.get(key(request))?.clone() },
    fetch: async (request, options) => { fetches.push({ request, options }); if (offline) throw Error("Offline"); return new Response(html, { status }); },
  });
  return { stored, fetches, precached, key,
    set(values) { if ("offline" in values) offline = values.offline; if ("html" in values) html = values.html;
      if ("status" in values) status = values.status; if ("failedCache" in values) failedCache = values.failedCache; },
    async install() { let promise; listeners.get("install")({ waitUntil: p => { promise = p; } }); await promise; },
    async navigate(path) { let promise; listeners.get("fetch")({ request: { mode: "navigate", url: new URL(path, base).href }, respondWith: p => { promise = p; } }); return promise; },
  };
}
test("new worker precaches fresh HTML and versioned assets rather than reusing HTTP copies", async () => {
  const w = worker(); await w.install(); assert.ok(w.precached.length > 20);
  assert.ok(w.precached.every(r => r.cache === "reload"));
  assert.ok(w.precached.some(r => r.url === base + "index.html"));
  assert.ok(w.precached.some(r => r.url.endsWith("protection-workbench.js?v=49.1")));
});
test("navigation requests fresh HTML and updates the common root/index offline entry", async () => {
  const w = worker(); assert.equal(await (await w.navigate("./")).text(), "v47");
  assert.equal(w.fetches[0].options.cache, "no-store");
  w.set({ offline: true }); assert.equal(await (await w.navigate("index.html")).text(), "v47");
  assert.equal(await (await w.navigate("./")).text(), "v47");
});
test("a newer index navigation becomes the offline root version", async () => {
  const w = worker(); await w.navigate("./"); w.set({ html: "v48" }); await w.navigate("index.html");
  w.set({ offline: true }); assert.equal(await (await w.navigate("./")).text(), "v48");
});
test("visiting a preview page cannot replace the application's offline shell", async () => {
  const w = worker(); await w.navigate("./"); w.set({ html: "Preview" }); await w.navigate("tests/responsive-preview.html");
  w.set({ offline: true }); assert.equal(await (await w.navigate("./")).text(), "v47");
  assert.equal(await (await w.navigate("tests/responsive-preview.html")).text(), "Preview");
});
test("HTTP failures do not overwrite the last successful offline application", async () => {
  const w = worker(); await w.navigate("./"); w.set({ html: "Missing", status: 404 });
  assert.equal((await w.navigate("index.html")).status, 404);
  w.set({ offline: true }); assert.equal(await (await w.navigate("./")).text(), "v47");
});
test("cache quota errors leave a successful online page usable", async () => {
  const w = worker(); w.set({ failedCache: true }); assert.equal(await (await w.navigate("./")).text(), "v47");
});
