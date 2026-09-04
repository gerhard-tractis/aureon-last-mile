// apps/frontend/src/lib/dispatch/mobile/civil-date.ts
//
// spec-76 review M3. Extracted out of useCrewLoadingBoard.ts so the
// Santiago-vs-UTC boundary behaviour is unit-testable directly, without
// mocking a Supabase client — a `loaded_at` instant just after UTC midnight
// is still "yesterday evening" in Santiago (UTC-3/-4), so a UTC slice
// (`iso.slice(0, 10)`) would misdate it (spec-76 Lecciones aplicadas #9).
import { TIMEZONE } from '@/lib/utils/dateFormat';

export function civilDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(iso));
}
