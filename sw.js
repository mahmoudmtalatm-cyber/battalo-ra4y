/* Battalo Ra4y service worker.
 * Only here so the app can be installed to the home screen.
 * It caches nothing and does not touch any request (no offline mode, no connection checks). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', () => { /* network as usual */ });
