'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerRegistration Component
 * Story 1.5: PWA Enhancement Layer
 *
 * Registers the service worker on app load (Task 2.4)
 * Handles registration errors with graceful degradation
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator
    ) {
      // Register service worker
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[Service Worker] Registered successfully:', registration.scope);

          // Check for updates on page load
          registration.update();
        })
        .catch((error) => {
          // Graceful degradation - app works without offline capability
          console.error('[Service Worker] Registration failed:', error);
        });
    }
  }, []);

  return null; // This component doesn't render anything
}
