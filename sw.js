// sw.js — service worker network-first de koi-flow (PWA offline básico).
// Hereda el patrón de wind-shm: red primero, cae al caché si no hay conexión.
const CACHE_VERSION = 'koi-v2';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Aislamiento cross-origin (Fase 1, WASM threads: SharedArrayBuffer) en hosting
  // estático donde no se controlan las cabeceras del servidor (en desarrollo ya
  // las manda serve.py). Técnica "coi-serviceworker": el SW agrega COOP/COEP SOLO
  // al documento principal (navegación) — es lo único que exige el spec para que
  // la página quede cross-origin-isolated; los subrecursos no se tocan.
  // 'credentialless' (no 'require-corp'): permite tiles de otro origen (ArcGIS,
  // OpenTopoMap, S3 terrarium) sin que traigan cabecera CORP propia.
  // Nota: la carga inicial NO queda aislada (el SW aún no controla esa
  // navegación); recién la siguiente navegación/reload sí. index.html decide si
  // vale la pena recargar una vez para activarlo.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }).catch(() => caches.match(req)));
    return;
  }

  // No cachear tiles externos (satélite/topo/terrarium): siempre red.
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req))
  );
});
