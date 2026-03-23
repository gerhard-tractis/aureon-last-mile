'use client';

import { useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true; // assume online on server
}

export default function OfflineBanner() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (isOnline) return null;

  return (
    <div className="flex items-center gap-3 bg-[var(--color-status-warning-bg)] border border-[var(--color-status-warning-border)] rounded-lg px-4 py-3 mb-4">
      <WifiOff className="h-4 w-4 text-status-warning shrink-0" />
      <span className="text-sm font-medium text-status-warning">
        Sin conexión — mostrando datos en caché
      </span>
    </div>
  );
}
