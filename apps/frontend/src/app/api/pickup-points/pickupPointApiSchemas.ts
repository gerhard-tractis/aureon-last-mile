import { z } from 'zod';
import { TIME_HH_MM_REGEX, TIME_FORMAT_MESSAGE } from '@/lib/pickup/timeFormat';

/**
 * spec-83 fase 2, review round 2 — shared between POST /api/pickup-points
 * and PUT /api/pickup-points/[id] so the two routes cannot drift on what a
 * valid `operating_hours`/`sla_config` payload looks like (they had started
 * to: neither validated format at all before this).
 */

export const operatingHoursSchema = z.object({
  start: z.string().regex(TIME_HH_MM_REGEX, TIME_FORMAT_MESSAGE).optional(),
  end: z.string().regex(TIME_HH_MM_REGEX, TIME_FORMAT_MESSAGE).optional(),
});

export const pickupLocationSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  comuna: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  // spec-83 fase 2
  operating_hours: operatingHoursSchema.optional(),
});

/**
 * `pickup_cutoff_time: null` is a distinct, meaningful write intent (review
 * round 2, B2): PUT /api/pickup-points/[id] merges `sla_config` onto the
 * existing row rather than overwriting it (B3), so an OMITTED key means
 * "leave whatever is there" and would never clear a previously-set cutoff —
 * only an explicit `null` does that.
 */
export const slaConfigSchema = z.object({
  pickup_cutoff_time: z.union([z.null(), z.string().regex(TIME_HH_MM_REGEX, TIME_FORMAT_MESSAGE)]).optional(),
});
