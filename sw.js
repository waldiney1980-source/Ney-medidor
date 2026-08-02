// Service worker — casca do app em cache para uso offline.
// A API nunca é cacheada: dados vêm do IndexedDB local e sincronizam quando há rede.

const VERSION = 'hidroluz-v24';
// Todos os módulos ficam na raiz. Caminhos errados aqui fazem o addAll inteiro
// falhar, e aí só o index.html acaba em cache — cuidado ao mexer nesta lista.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.css',
  './api.js',
  './app.js',
  './capture.js',
  './charts.js',
  './dashboard.js',
  './db.js',
  './gestao.js',
  './history.js',
  './importar.js',
  './meter-detail.js',
  './meters.js',
  './ocr-local.js',
  './pdf.js',
  './qr-decode.js',
  './qr.js',
  './report.js',
  './scanner.js',
  './settings.js',
  './store.js',
  './supabase.js',
  './ui.js',
  './utils.js',
  './xlsx.js',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => cache.addAll(['./', './index.html'])))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // sempre rede

  // navegação: rede primeiro, casca em cache como reserva
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // estáticos: cache primeiro, com revalidação em segundo plano
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
