"use client";

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface MobilePullToRefreshProps {
  children: React.ReactNode;
}

const PULL_THRESHOLD = 60; // px
const IS_TEST = process.env.NODE_ENV === 'test';

export function MobilePullToRefresh({ children }: MobilePullToRefreshProps) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const startYRef = useRef<number | null>(null);

  async function triggerRefresh() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pipeline-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['operations-orders'] }),
    ]);
    setTimeout(() => {
      setIsRefreshing(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 1500);
    }, 500);
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    startYRef.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (startYRef.current === null) return;
    const endY = e.changedTouches[0].clientY;
    const delta = endY - startYRef.current;
    startYRef.current = null;

    if (delta > PULL_THRESHOLD) {
      void triggerRefresh();
    }
  }

  return (
    <div
      data-testid="pull-to-refresh-container"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="relative"
    >
      {isRefreshing && (
        <div className="flex justify-center py-2">
          <div
            data-testid="refresh-spinner"
            className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin"
          />
        </div>
      )}
      {showToast && (
        <div className="flex justify-center py-1">
          <span className="text-xs text-green-600 font-medium">Actualizado</span>
        </div>
      )}
      {children}
      {/* Test-only trigger — invisible in production */}
      {IS_TEST && (
        <button
          type="button"
          data-testid="test-trigger-refresh"
          onClick={() => void triggerRefresh()}
          style={{ display: 'none' }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
