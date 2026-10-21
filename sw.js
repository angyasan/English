// オフラインでも単語帳を使えるようにする
// - アプリ本体（index.html）：ネットにつながれば最新を取りに行き、つながらなければ保存しておいたものを出す
// - 音声（audio/）：保存してあればそれを使い、なければダウンロードして保存する
const APP_CACHE = "app-v1";
const AUDIO_CACHE = "audio-v1";
const APP_URL = new URL("./", self.registration.scope).href;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.add(APP_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then(cache => cache.put(APP_URL, copy));
          }
          return res;
        })
        .catch(() => caches.open(APP_CACHE).then(cache => cache.match(APP_URL)))
    );
    return;
  }

  if (url.pathname.includes("/audio/")) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});
