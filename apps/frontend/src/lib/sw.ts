import { Serwist } from 'serwist';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

// This declares the value of `injectionPoint` to TypeScript.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Initialize Serwist with configuration
const serwist = new Serwist({
  precacheEntries: [
    ...(self.__SW_MANIFEST || []),
    { url: '/offline', revision: '1' },
  ],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Runtime caching strategies (Task 1.3)
  runtimeCaching: [
    // API routes: NetworkFirst with 5-second timeout, 1-hour expiration
    {
      matcher: /^https?:\/\/.*\/api\/.*/,
      handler: new NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 5,
        plugins: [
          {
            cacheWillUpdate: async ({ response }) => {
              return response.status === 200 ? response : null;
            },
          },
        ],
      }),
    },
    // Static assets: CacheFirst, cache forever
    {
      matcher: /^\/_next\/static\/.*/,
      handler: new CacheFirst({
        cacheName: 'static-assets',
      }),
    },
    // Google Fonts: CacheFirst, 1-year expiration
    {
      matcher: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/,
      handler: new CacheFirst({
        cacheName: 'google-fonts',
      }),
    },
    // Images: StaleWhileRevalidate, 7-day expiration
    {
      matcher: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
      handler: new StaleWhileRevalidate({
        cacheName: 'images',
      }),
    },
  ],
  // Offline fallback
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

// Register Serwist event listeners
serwist.addEventListeners();

// Background Sync event handler (Task 2.2)
self.addEventListener('sync', (event) => {
  if (event.tag === 'pickup-scans-sync') {
    event.waitUntil(syncPickupScans());
  }
});

// Function to sync pickup scans when connection restored
async function syncPickupScans() {
  try {
    console.log('[Service Worker] Background sync triggered for pickup scans');

    // Broadcast to all clients that sync is starting
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'SYNC_SCANS_START',
      });
    });

    // The actual sync logic will be handled by sync-manager.ts in the app
    // This service worker just broadcasts the event to trigger the sync
  } catch (error) {
    console.error('[Service Worker] Background sync failed:', error);
    throw error; // Re-throw to trigger retry
  }
}

// Message passing for UI <-> SW communication (Task 2.3)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
