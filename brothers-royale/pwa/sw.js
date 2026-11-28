/* RELEASE y PRECACHE los genera el build. Ámbito y cachés exclusivos de esta instalación. */
const SCOPE = self.registration.scope;
const PREFIX = 'brothers-royale-pwa:' + SCOPE + ':';
const CACHE = PREFIX + RELEASE.build;
const url = path => new URL(path, SCOPE).href;
const inScope = client => client.url.startsWith(SCOPE);

self.addEventListener('install', event => {
  // Si falla algún recurso, no reemplazar una instalación válida con una incompleta.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE.map(path => new Request(url(path), { cache: 'reload' })))));
  // Una actualización espera autorización del usuario. La primera instalación activa normalmente.
});

async function states() {
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(inScope);
  return Promise.all(clients.map(client => new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      const state = event.data;
      resolve(state && typeof state.safe === 'boolean' && typeof state.build === 'string' ? state : null);
    };
    client.postMessage({ type: 'PWA_STATE' }, [channel.port2]);
  })));
}

async function cleanup() {
  const pages = await states();
  // No borrar recursos de pestañas antiguas o de clientes que todavía no contestan.
  if (pages.some(page => !page)) return;
  const keep = new Set([CACHE, ...pages.map(page => PREFIX + page.build)]);
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && !keep.has(key)) await caches.delete(key);
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => { await cleanup(); await self.clients.claim(); })());
});

self.addEventListener('message', event => {
  if (!event.source || !inScope(event.source)) return;
  const respond = value => event.ports[0]?.postMessage(value);
  if (event.data?.type === 'PWA_VERSION') respond(RELEASE);
  if (event.data?.type === 'PWA_CLEANUP') event.waitUntil(cleanup());
  if (event.data?.type === 'PWA_APPLY') event.waitUntil((async () => {
    const pages = await states();
    if (pages.some(page => !page?.safe)) { respond({ applied: false }); return; }
    respond({ applied: true });
    await self.skipWaiting();
  })());
});

async function stored(request) {
  const current = await (await caches.open(CACHE)).match(request);
  if (current) return current;
  // Una pestaña que acaba de entrar en partida puede seguir usando su bundle anterior.
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) {
    const response = await (await caches.open(key)).match(request);
    if (response) return response;
  }
  return undefined;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
  const path = new URL(request.url).pathname;
  event.respondWith((async () => {
    if (request.mode === 'navigate') {
      return await stored(url('./index.html')) ?? fetch(request);
    }
    // La URL de Render y la información de versión se consultan en red; fallback sin conexión.
    if (path === new URL('./config.js', SCOPE).pathname || path === new URL('./version.json', SCOPE).pathname) {
      try {
        const response = await fetch(new Request(request, { cache: 'no-store' }));
        if (!response.ok) throw new Error('Recurso no disponible');
        await (await caches.open(CACHE)).put(request, response.clone());
        return response;
      } catch { return await stored(request) ?? Response.error(); }
    }
    return await stored(request) ?? fetch(request);
  })());
});
