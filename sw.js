// Keeps the app on the iPad so it works without Wi-Fi (at a venue, say). The PDFs, lessons and markings are already
// on the iPad (store.js); this keeps the app's own files. Online, the newest version is always fetched (so updates show
// at once); offline, or when the network is slow, the kept copy is used. The big PDF reader files are kept as they are.
const CACHE = "page-turner-v1";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "listen.js", "store.js", "marks.js", "library.js", "share.js", "journal.js", "metronome.js", "pitch.js", "engine/notecheck.js",
  "audio/capture-worklet.js",
  "engine/features.js", "engine/fft.js", "engine/follower.js", "engine/hearing.js", "engine/layout.js", "engine/marker.js",
  "engine/practice.js", "engine/recorder.js", "engine/score.js", "engine/scorelesson.js", "engine/search.js",
  "engine/synth.js", "engine/xml.js",
  "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "vendor/fflate/fflate.js", "vendor/tfjs/tf.min.js", "vendor/basic-pitch/inference.js", "vendor/basic-pitch/toMidi.js", "vendor/basic-pitch/model.json", "vendor/basic-pitch/group1-shard1of1.bin",
  "samples/warm-ups.pdf", "privacy.html", "support.html", "doc.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), ms));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !fonts) return;
  const steady = fonts || url.pathname.includes("/vendor/") || url.pathname.includes("/icons/");
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (steady) {
      // files that don't change: the kept copy first
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }
    // the app's own files: the newest version, or the kept copy when offline or slow
    try {
      const res = await Promise.race([fetch(req), timeout(4000)]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("index.html") : null);
      if (hit) return hit;
      throw new Error("offline and not kept");
    }
  })());
});
