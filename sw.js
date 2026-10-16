/* SawitGIS Hologram 3D - service worker (mode luring PWA)
 * Perbaikan dari versi asli:
 *  - cadangan navigasi luring benar-benar dikembalikan (asli: `caches.match(a) || caches.match(b)`
 *    selalu bernilai Promise sehingga cadangan kedua tak pernah dipakai);
 *  - tidak pernah respondWith(null) (asli: `.catch(() => null)` melempar TypeError);
 *  - permintaan POST ke Apps Script tidak disentuh;
 *  - ubin OpenStreetMap TIDAK disimpan (Kebijakan Ubin OSMF melarang unduh massal/luring);
 *    ubin penyedia lain hanya disimpan bila pelanggan menyatakan perjanjiannya mengizinkan,
 *    dengan batas 3.000 ubin (asli: tanpa batas, mengisi penyimpanan ponsel).
 */
var VERSI = '1.3.0-1680d566';
var CACHE_APP = 'sawitgis-app-' + VERSI;
var CACHE_PUSTAKA = 'sawitgis-pustaka-r128';
var CACHE_UBIN = 'sawitgis-ubin-v1';
var CACHE_META = 'sawitgis-meta';
var CDN_THREE = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
var INTI = ['./', 'index.html', 'manifest.webmanifest', 'ikon-512.png'];
var MAKS_UBIN = 3000;
var izinUbin = {};

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_APP).then(function (c) { return c.addAll(INTI); }).then(function () {
    // three.js dicoba simpan sekali; gagal (tanpa internet) tidak menggagalkan pemasangan.
    return caches.open(CACHE_PUSTAKA).then(function (c) {
      return c.match(CDN_THREE).then(function (ada) { return ada || fetch(CDN_THREE, { mode: 'cors' }).then(function (r) { if (r.ok) return c.put(CDN_THREE, r); }); });
    }).catch(function () { });
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (k) {
    return Promise.all(k.map(function (n) { if (/^sawitgis-app-/.test(n) && n !== CACHE_APP) return caches.delete(n); }));
  }).then(muatIzin).then(function () { return self.clients.claim(); }));
});

function muatIzin() {
  return caches.open(CACHE_META).then(function (c) { return c.match('izin-ubin'); }).then(function (r) { return r ? r.json() : {}; })
    .then(function (j) { izinUbin = j || {}; }).catch(function () { izinUbin = {}; });
}

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.tipe === 'izinUbin' && d.host) {
    if (d.izin) izinUbin[d.host] = 1; else delete izinUbin[d.host];
    caches.open(CACHE_META).then(function (c) { return c.put('izin-ubin', new Response(JSON.stringify(izinUbin), { headers: { 'Content-Type': 'application/json' } })); });
  }
});

function pangkasUbin(c) {
  return c.keys().then(function (k) { if (k.length > MAKS_UBIN) return Promise.all(k.slice(0, k.length - MAKS_UBIN).map(function (r) { return c.delete(r); })); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  // Permintaan Range (PMTiles foto udara, video) selalu langsung ke jaringan - jangan dilayani dari cache utuh.
  if (req.headers.has('range')) return;
  var url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname) || /googleusercontent\.com$/.test(url.hostname)) return;

  if (req.url === CDN_THREE) {
    e.respondWith(caches.open(CACHE_PUSTAKA).then(function (c) {
      return c.match(CDN_THREE).then(function (ada) {
        return ada || fetch(req).then(function (r) { if (r.ok) c.put(CDN_THREE, r.clone()); return r; });
      });
    }));
    return;
  }

  if (req.destination === 'image' && url.origin !== self.location.origin) {
    if (url.hostname === 'tile.openstreetmap.org' || !izinUbin[url.hostname]) return; // langsung ke jaringan, tanpa cache
    e.respondWith(caches.open(CACHE_UBIN).then(function (c) {
      return c.match(req).then(function (ada) {
        var jaringan = fetch(req).then(function (r) { if (r.ok) { c.put(req, r.clone()); pangkasUbin(c); } return r; });
        return ada || jaringan.catch(function () { return new Response('', { status: 504 }); });
      });
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var s = r.clone(); caches.open(CACHE_APP).then(function (c) { c.put('index.html', s); }); }
      return r;
    }).catch(function () {
      return caches.open(CACHE_APP).then(function (c) {
        return c.match('index.html').then(function (a) { return a || c.match('./'); }).then(function (a) {
          return a || new Response('<h1>Luring</h1><p>Aplikasi belum tersimpan di perangkat ini. Buka sekali saat ada internet.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        });
      });
    }));
    return;
  }

  // config.js: jaringan dulu agar URL peladen baru langsung terpakai.
  if (/config\.js$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(function (r) { var s = r.clone(); caches.open(CACHE_APP).then(function (c) { c.put(req, s); }); return r; })
      .catch(function () { return caches.match(req).then(function (a) { return a || new Response('window.SAWITGIS_KONFIG = window.SAWITGIS_KONFIG || {};', { headers: { 'Content-Type': 'application/javascript' } }); }); }));
    return;
  }

  e.respondWith(caches.match(req).then(function (ada) {
    var jaringan = fetch(req).then(function (r) { if (r.ok) { var s = r.clone(); caches.open(CACHE_APP).then(function (c) { c.put(req, s); }); } return r; });
    return ada || jaringan.catch(function () { return new Response('', { status: 504, statusText: 'Luring' }); });
  }));
});
