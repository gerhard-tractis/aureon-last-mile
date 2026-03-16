import { useState, useEffect, useRef } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

export function useRealtimeStatus(): 'connected' | 'disconnected' {
  const [status, setStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const lastHeartbeat = useRef<number>(Date.now());

  useEffect(() => {
    const supabase = createSPAClient();

    const channel = supabase.channel('system-status')
      .on('system', { event: '*' } as never, () => {
        lastHeartbeat.current = Date.now();
        setStatus('connected');
      })
      .subscribe((subscriptionStatus: string) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          lastHeartbeat.current = Date.now();
          setStatus('connected');
        }
        if (subscriptionStatus === 'CLOSED' || subscriptionStatus === 'CHANNEL_ERROR') {
          setStatus('disconnected');
        }
      });

    // Check heartbeat every 10s, mark disconnected if >30s stale
    const interval = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > 30_000) {
        setStatus('disconnected');
      }
    }, 10_000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return status;
}
