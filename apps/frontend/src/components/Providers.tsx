'use client';

import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { initQueryBroadcast } from '@/lib/queryBroadcast';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            gcTime: 300000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: 3,
            retryDelay: (attempt: number) => [1000, 2000, 4000][attempt] ?? 4000,
          },
        },
      })
  );

  useEffect(() => {
    const handleOnline = () => onlineManager.setOnline(true);
    const handleOffline = () => onlineManager.setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const cleanup = initQueryBroadcast(queryClient);
    return cleanup;
  }, [queryClient]);

  useEffect(() => {
    const MAX_INACTIVE_QUERIES = 100;
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const inactiveQueries = queryClient.getQueryCache().getAll()
        .filter((query) => query.getObserversCount() === 0);
      if (inactiveQueries.length > MAX_INACTIVE_QUERIES) {
        queryClient.removeQueries({ type: 'inactive' });
      }
    });
    return unsubscribe;
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} position="bottom" />
      )}
    </QueryClientProvider>
  );
}
