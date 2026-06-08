const CACHE_VERSION = "dynamic-stock-hub-v1";
const APP_SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(APP_SHELL, responseClone));
          return response;
        })
        .catch(() => caches.match(APP_SHELL))
    );
    return;
  }

  if (
    requestUrl.pathname.startsWith("/assets/") ||
    requestUrl.pathname.startsWith("/icons/") ||
    requestUrl.pathname === "/favicon.svg" ||
    requestUrl.pathname === "/favicon.ico" ||
    requestUrl.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(request, responseClone));
          }

          return response;
        });
      })
    );
  }
});
