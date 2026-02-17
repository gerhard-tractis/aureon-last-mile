'use client';

/**
 * Connection Status Banner Component
 * Story 1.5: PWA Enhancement Layer
 *
 * Displays connection status and queued scans count
 * Task 5.1-5.3: Complete connection status UI
 */

import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { syncManager } from '@/lib/sync-manager';

type ConnectionStatus = 'online' | 'offline' | 'syncing';

export default function ConnectionStatusBanner() {
  const [status, setStatus] = useState<ConnectionStatus>('online');
  const [queueCount, setQueueCount] = useState(0);

  // Online/Offline Event Listeners (Task 5.2)
  useEffect(() => {
    // Set initial status
    const isOnline = navigator.onLine;
    setStatus(isOnline ? 'online' : 'offline');

    // Online event handler
    const handleOnline = async () => {
      setStatus('syncing');

      try {
        await syncManager.manualSync();
        setStatus('online');
      } catch (error) {
        console.error('[Connection Banner] Sync failed:', error);
        setStatus('online');
      }
    };

    // Offline event handler
    const handleOffline = () => {
      setStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial queue count check
    db.scan_queue.filter((scan) => !scan.synced).count().then(setQueueCount).catch(() => {});

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Only poll IndexedDB when offline or syncing (avoid wasting CPU when online with empty queue)
  useEffect(() => {
    if (status === 'online' && queueCount === 0) return;

    const interval = setInterval(async () => {
      try {
        const count = await db.scan_queue.filter((scan) => !scan.synced).count();
        setQueueCount(count);
      } catch (error) {
        console.error('[Connection Banner] Failed to get queue count:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [status, queueCount]);

  // Don't show banner if online and no queued scans
  if (status === 'online' && queueCount === 0) {
    return null;
  }

  // Render Connection Banner (Task 5.3)
  return (
    <div
      data-testid="connection-banner"
      className={`
        fixed top-0 left-0 right-0 z-50
        px-4 py-2 text-center text-sm font-medium
        ${
          status === 'online'
            ? 'bg-green-500 text-white'
            : status === 'offline'
              ? 'bg-yellow-500 text-black'
              : 'bg-gray-400 text-white'
        }
      `}
    >
      {status === 'online' && queueCount > 0 && (
        <span>Online - {queueCount} scans queued for sync</span>
      )}
      {status === 'offline' && (
        <span>Offline - {queueCount} scans queued</span>
      )}
      {status === 'syncing' && <span>Syncing...</span>}
    </div>
  );
}
