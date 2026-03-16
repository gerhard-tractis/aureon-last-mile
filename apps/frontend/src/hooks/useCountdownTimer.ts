import { useState, useEffect } from 'react';

function calcMinutes(deadlineISO: string): number {
  return Math.floor((new Date(deadlineISO).getTime() - Date.now()) / 60_000);
}

/**
 * Client-side hook that returns minutes remaining to a deadline.
 * Recalculates every 60 seconds.
 * Returns null if no deadline is provided.
 * Returns negative values when the deadline has passed.
 */
export function useCountdownTimer(deadlineISO: string | null): number | null {
  const [minutes, setMinutes] = useState<number | null>(() => {
    if (!deadlineISO) return null;
    return calcMinutes(deadlineISO);
  });

  useEffect(() => {
    if (!deadlineISO) {
      setMinutes(null);
      return;
    }

    setMinutes(calcMinutes(deadlineISO));

    const id = setInterval(() => {
      setMinutes(calcMinutes(deadlineISO));
    }, 60_000);

    return () => clearInterval(id);
  }, [deadlineISO]);

  return minutes;
}
