const CACHE_NAME = "digital-girlfriend-v1";

const APP_BASE = new URL(self.registration.scope).pathname;
const normalize = (path) => `${APP_BASE}${path.replace(/^\//, "")}`;

const PRECACHE = [
  normalize(""),
  normalize("manifest.webmanifest"),
  normalize("assets/avatars/lina.svg"),
  normalize("assets/avatars/moon.svg"),
  normalize("icons/app-icon.svg"),
  normalize("icons/app-icon-180.svg"),
  normalize("index.html")
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE.filter(Boolean));
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.pathname.startsWith(`${APP_BASE}api/`) || url.pathname.startsWith(`${APP_BASE}audio`)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
