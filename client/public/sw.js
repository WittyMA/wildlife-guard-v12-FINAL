const CACHE_NAME = 'wildlife-conservation-v1';
const RUNTIME_CACHE = 'wildlife-conservation-runtime-v1';
const DETECTION_CACHE = 'wildlife-conservation-detections-v1';

// Development mode bypass - don't cache or intercept in dev
const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
if (IS_DEV) {
  // In development, unregister self and skip all caching
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
    );
    self.clients.claim();
  });
  // Don't register fetch handler in dev - let everything pass through
  return;
}

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
];

// Install event: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Failed to cache some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE && cacheName !== DETECTION_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: network-first strategy for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || new Response('Offline - API unavailable', { status: 503 });
          });
        })
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          return new Response('Offline - Asset unavailable', { status: 503 });
        });
    })
  );
});

// Handle push notifications from FCM
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.warn('[SW] Push event with no data');
    return;
  }

  let notificationData = {};
  try {
    const jsonData = event.data.json();
    notificationData = jsonData.notification || jsonData;
  } catch (e) {
    notificationData = {
      title: 'Wildlife Conservation Alert',
      body: event.data.text(),
    };
  }

  const options = {
    icon: notificationData.icon || '/icon-192x192.png',
    badge: notificationData.badge || '/badge-72x72.png',
    tag: notificationData.tag || 'wildlife-guard',
    requireInteraction: notificationData.requireInteraction === 'true' || notificationData.requireInteraction === true || false,
    data: notificationData.data || {},
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Close' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(notificationData.title || 'Wildlife Guard Alert', options)
  );
  console.log('[SW] Push notification shown:', notificationData.title);
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const actionUrl = event.notification.data?.actionUrl || '/';
  const action = event.action;

  if (action === 'close') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if window is already open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === actionUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window if not found
      if (clients.openWindow) {
        return clients.openWindow(actionUrl);
      }
    })
  );
  console.log('[SW] Notification clicked, navigating to:', actionUrl);
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification dismissed:', event.notification.data?.tag);
});

// Background sync for offline queue
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-detections') {
    event.waitUntil(syncDetections());
  }
});

async function syncDetections() {
  try {
    const db = await openIndexedDB();
    const pendingDetections = await getPendingDetections(db);

    if (pendingDetections.length === 0) {
      console.log('[SW] No pending detections to sync');
      return;
    }

    const response = await fetch('/api/trpc/sync.push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: pendingDetections }),
    });

    if (response.ok) {
      await clearSyncedDetections(db);
      console.log('[SW] Background sync completed successfully');
    } else {
      console.error('[SW] Sync failed with status:', response.status);
      throw new Error('Sync failed');
    }
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
    throw error;
  }
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  if (type === 'GET_FCM_TOKEN') {
    // Send FCM token to client
    // In production, this would retrieve the token from Firebase Messaging
    const token = localStorage?.getItem?.('fcm_token') || null;
    event.ports[0]?.postMessage({
      type: 'FCM_TOKEN',
      token,
    });
    console.log('[SW] FCM token sent to client');
  }

  if (type === 'STORE_FCM_TOKEN') {
    // Store FCM token in service worker
    if (payload?.token) {
      try {
        localStorage?.setItem?.('fcm_token', payload.token);
        console.log('[SW] FCM token stored');
      } catch (err) {
        console.error('[SW] Failed to store FCM token:', err);
      }
    }
  }

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('WildlifeConservationDB', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getPendingDetections(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['detections'], 'readonly');
    const store = transaction.objectStore('detections');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.filter((d) => !d.synced));
    request.onerror = () => reject(request.error);
  });
}

function clearSyncedDetections(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['detections'], 'readwrite');
    const store = transaction.objectStore('detections');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Initialize FCM token storage
if (typeof localStorage !== 'undefined') {
  console.log('[SW] Service Worker initialized and ready for FCM messages');
} else {
  console.log('[SW] Service Worker initialized (localStorage not available)');
}
