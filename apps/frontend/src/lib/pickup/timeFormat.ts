/**
 * spec-83 fase 2, review round 2 — the single source of truth for what an
 * `operating_hours`/`pickup_cutoff_time` STRING is allowed to look like at
 * the write path (form + both API routes). Strict "HH:MM" — no seconds, no
 * garbage. `pickupWindowStatus.ts`'s own parser is intentionally MORE
 * tolerant on read (accepts a trailing ":SS") because it also has to make
 * sense of values a future backfill/SQL seed writes directly, bypassing
 * this form entirely — but nothing written THROUGH this form should ever
 * need that tolerance.
 */
export const TIME_HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TIME_FORMAT_MESSAGE = 'Formato esperado HH:MM';
