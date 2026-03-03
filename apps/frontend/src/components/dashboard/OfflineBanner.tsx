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
    <div className="flex items-center gap-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 mb-4">
      <WifiOff className="h-4 w-4 text-amber-600 shrink-0" />
      <span className="text-sm font-medium text-amber-800">
        Sin conexión — mostrando datos en caché
      </span>
    </div>
  );
}
