importScripts('./exercise-media.js');
const CACHE = 'workout-diary-v66';
const ASSETS = ['./', './index.html', './styles.css', './workout-data.js', './exercise-media.js', './workspace.js', './trainer-ui.js', './app.js', './manifest.webmanifest', './icon.svg', './image/avatar-anna.png', './image/avatar-mikhail.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(ASSETS);
    // A missing illustration must not prevent the diary from working offline.
    await Promise.all(ExerciseMedia.assets.map((url) => cache.add(url).catch(() => {})));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (event.request.destination === 'image' && cached) return cached;
      return fetch(event.request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(async () => cached || (event.request.mode === 'navigate' ? await caches.match('./index.html') : new Response('', { status: 503 })));
    })()
  );
});
