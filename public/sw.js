// Service worker: deixa o app abrir sem internet.
// Páginas: busca na internet primeiro (para pegar a versão nova) e usa a cópia guardada se estiver sem sinal.
// Arquivos do app (js, css, imagens): usa a cópia guardada e atualiza por trás.
// Os dados (Supabase) não passam por aqui: quem guarda os dados no aparelho é o app.
const CACHE = "batida-v2";
const PRECACHE = ["/", "/batida.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(p, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

async function networkFirst(req, key) {
  const c = await caches.open(CACHE);
  try {
    const r = await withTimeout(fetch(req), 6000);
    if (r && r.ok) c.put(key || req, r.clone()).catch(() => {});
    return r;
  } catch (err) {
    const hit = (await c.match(key || req)) || (await c.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req)
    .then((r) => {
      if (r && r.ok) c.put(req, r.clone()).catch(() => {});
      return r;
    })
    .catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req, url.pathname === "/" ? "/" : undefined).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname === "/batida.html" || url.pathname === "/sw.js") {
    e.respondWith(networkFirst(req, url.pathname));
    return;
  }
  e.respondWith(staleWhileRevalidate(req));
});
