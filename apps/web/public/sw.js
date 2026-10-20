/*
  KAIRO's service worker: makes the web app installable (desktop and phone)
  and quick to open again.

  * Pages: network first, so a new version shows as soon as it is deployed;
    the last copy is used when the network is down.
  * Built files (/assets/..., names carry a content hash) and icons: served
    from the cache once fetched, since they never change under the same name.
  * Everything else, above all /api/... (runs, Saarthi, accounts), always goes
    to the network and is never cached.
*/
const VERSION = "kairo-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live data: never cached

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put("/", copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(ASSETS)
                .then((cache) => cache.put(request, copy).then(() => trim(cache)))
                .catch(() => undefined);
            }
            return response;
          }),
      ),
    );
  }
});

/** Old builds' files pile up with every deployment: keep the most recent ones only. */
async function trim(cache, limit = 180) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
