const CACHE = "simusystem-v48";
const ASSETS = ["./","./index.html","./manifest.webmanifest","./src/simulation-clock.js","./src/grid-dynamics.js","./src/power-flow.js?v=48","./src/study-network.js?v=48","./src/equipment-library.js?v=48","./src/component-editor.js?v=48","./src/electrical-studies.js?v=48","./src/technical-symbols.js?v=48","./src/study-workbench.js?v=48","./src/workbench.css?v=48","./src/display-theme.js?v=48","./src/load-flow-workbench.js?v=48","./src/study-cases.js?v=48","./src/study-example.js?v=48","./src/short-circuit.js?v=48","./src/short-circuit-cases.js?v=48","./src/short-circuit-workbench.js?v=48","./src/protection-coordination.js?v=48","./src/protection-chart.js?v=48","./src/protection-workbench.js?v=48","./src/switching-analysis.js?v=48","./src/diagram-gestures.js?v=42","./src/session-timeout.js?v=40","./src/flow-animation.js?v=48"];
const ROOT = new URL("./", self.location.href);
const isAppEntry = request => {
  const url = new URL(request.url);
  return url.origin === ROOT.origin && [ROOT.pathname, ROOT.pathname + "index.html"].includes(url.pathname);
};
self.addEventListener("install", event => {
  self.skipWaiting();
  // Bypass the HTTP cache so a new worker cannot precache the previous HTML.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    ASSETS.map(path => new Request(new URL(path, ROOT), { cache: "reload" }))
  )));
});
self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then(async response => {
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
          // Root and index.html must share the newest offline entry, while
          // preview/document pages must never replace the application shell.
          if (isAppEntry(event.request)) await cache.put("./index.html", response.clone());
        } catch { /* A full cache must not block a successful online navigation. */ }
      }
      return response;
    }).catch(() => caches.match(isAppEntry(event.request) ? "./index.html" : event.request)));
  } else event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});
