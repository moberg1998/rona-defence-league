importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyAWhZlIS8hiZ-AaNBprsRl2AVlJ0ZDQc7M",
  authDomain: "rona-defence-league.firebaseapp.com",
  projectId: "rona-defence-league",
  storageBucket: "rona-defence-league.firebasestorage.app",
  messagingSenderId: "296351261174",
  appId: "1:296351261174:web:de4731f3a75ba7ad1027d7"
});
// Viser push-notifikationer, når appen IKKE er åben/i forgrunden.
const messaging = firebase.messaging.isSupported() ? firebase.messaging() : null;
if (messaging) {
  messaging.onBackgroundMessage(payload => {
    const title = (payload.notification && payload.notification.title) || 'Rona Defence League';
    const body = (payload.notification && payload.notification.body) || '';
    self.registration.showNotification(title, { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
  });
}

const CACHE_NAME = 'rdl-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

// Kun app-skallen (HTML/manifest/ikoner) caches for hurtig/offline opstart.
// Firestore/Auth-kald går altid direkte til netværket — de rammer aldrig denne cache.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // lad Firebase/Google-kald passere uberørt
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
