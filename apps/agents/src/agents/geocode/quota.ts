// src/agents/geocode/quota.ts — MAPTILER_MONTHLY_QUOTA guard, spec-58 fase 5.
//
// MAPTILER_MONTHLY_QUOTA is OPTIONAL (2026-09-11 decision, "La decisión que
// desbloqueó esta fase"): unset, the guard never blocks and the provider's
// own refusal is the stop condition -- safe today because the free tier
// rejects rather than bills. When a value IS given it is a hard local cap,
// enforced against a Redis counter keyed by month so it survives a restart
// or a deploy (an in-process counter would silently reset, the same reason
// CircuitBreaker's state must never stand in for this).
import type Redis from 'ioredis';

export interface QuotaGuard {
  /**
   * Reserves one provider call. Returns false, without reserving anything,
   * once the monthly cap is reached. Always true -- and never touches
   * Redis at all -- when no monthly quota is configured.
   */
  tryConsume(): Promise<boolean>;
}

function quotaKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `geocode:quota:${year}-${month}`;
}

function endOfMonthEpochSeconds(now: Date): number {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return Math.floor(nextMonth.getTime() / 1000);
}

export function createQuotaGuard(
  redis: Redis | null,
  monthlyQuota: number | undefined,
  now: () => Date,
): QuotaGuard {
  if (!monthlyQuota || !redis) {
    return { tryConsume: async () => true };
  }

  return {
    async tryConsume(): Promise<boolean> {
      const key = quotaKey(now());
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expireat(key, endOfMonthEpochSeconds(now()));
      }
      if (current > monthlyQuota) {
        // Roll back: the counter should reflect calls actually made, not
        // ones rejected at the door -- otherwise it would grow without
        // bound for every batch that runs after the cap is hit.
        await redis.decr(key);
        return false;
      }
      return true;
    },
  };
}
