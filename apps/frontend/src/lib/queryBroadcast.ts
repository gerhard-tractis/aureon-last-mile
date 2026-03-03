import type { QueryClient } from '@tanstack/react-query';

interface BroadcastMessage {
  queryKey: unknown[];
  data: unknown;
}

/**
 * Sets up BroadcastChannel-based cache sharing across browser tabs.
 * All data is serialized via JSON.stringify/JSON.parse to avoid corrupting
 * non-serializable types (Date objects, Supabase response prototypes, etc.)
 *
 * Gracefully no-ops when BroadcastChannel is unavailable (e.g. Safari private browsing).
 *
 * Returns a cleanup function to be called on unmount.
 */
export function initQueryBroadcast(queryClient: QueryClient): () => void {
  if (typeof globalThis.BroadcastChannel === 'undefined') {
    return () => {};
  }

  const channel = new BroadcastChannel('tanstack-query-sync');
  let isSending = false;

  // Subscribe to cache updates and broadcast to other tabs
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    if (isSending) return; // prevent re-broadcast loops

    const { queryKey, state } = event.query;
    if (state.status !== 'success') return;

    try {
      channel.postMessage(JSON.stringify({ queryKey, data: state.data } satisfies BroadcastMessage));
    } catch {
      // Ignore non-serializable data silently
    }
  });

  // Receive updates from other tabs and seed local cache
  channel.onmessage = (event: MessageEvent<string>) => {
    try {
      const { queryKey, data } = JSON.parse(event.data) as BroadcastMessage;
      isSending = true;
      try {
        queryClient.setQueryData(queryKey, data);
      } finally {
        isSending = false;
      }
    } catch {
      // Ignore malformed messages
    }
  };

  return () => {
    unsubscribe();
    channel.close();
  };
}
