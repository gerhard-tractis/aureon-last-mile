import type { ManifestRow } from '@/components/pickup/ManifestTable';

/**
 * Extracted from page.tsx (spec-54 3h review fix, item 6) to keep the page
 * under the 300-line guideline — pure, presentation-agnostic helpers with
 * no hook/router/Supabase dependency, so they belong in `lib/`, not the
 * page itself.
 */

export function todayLabel(now: Date): string {
  const text = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function matchesSearchTerm(row: ManifestRow, term: string): boolean {
  if (!term) return true;
  const q = term.toLowerCase();
  return (
    row.externalLoadId.toLowerCase().includes(q) ||
    (row.retailerName ?? '').toLowerCase().includes(q) ||
    (row.pickupPoint ?? '').toLowerCase().includes(q)
  );
}
