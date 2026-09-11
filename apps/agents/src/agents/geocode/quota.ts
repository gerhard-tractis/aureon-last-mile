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

  /**
   * Gives back a reservation made by tryConsume() when it turned out NOT to
   * produce a usable network result -- a transport failure, a refused
   * credential, or any other thrown error means the reservation was never
   * actually spent. Without this, a circuit-breaker-open stretch (which
   * makes zero HTTP calls) can still burn the whole monthly cap and freeze
   * every remaining row until next month having spent nothing (spec-58
   * fase 5 review, BLOCKER 3). A no-op when no quota is configured, or when
   * tryConsume() itself already returned false (it rolls back its own
   * reservation internally in that case -- nothing to refund).
   */
  refund(): Promise<void>;
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
    return { tryConsume: async () => true, refund: async () => {} };
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

    async refund(): Promise<void> {
      await redis.decr(quotaKey(now()));
    },
  };
}
