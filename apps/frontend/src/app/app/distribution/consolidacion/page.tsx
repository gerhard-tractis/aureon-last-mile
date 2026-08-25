import { ConsolidationPageContent } from '@/components/distribution/ConsolidationPageContent';

/**
 * spec-68 Fase 4 — `/app/distribution/consolidacion` (mock `4f`).
 *
 * Deliberately a thin default export and NOTHING else. The screen itself
 * lives in `components/distribution/ConsolidationPageContent`, which takes
 * an injectable `now` so its tests can freeze the clock (Fase 4 review,
 * finding #5) instead of reading the wall clock and failing on a future
 * calendar date.
 *
 * That prop is exactly why the component cannot live here. Next type-checks
 * EVERY export of a page module against its Page contract, so exporting a
 * component that takes arbitrary props from this file fails the build with
 * "does not match the required types of a Next.js Page" — which `tsc
 * --noEmit` does not catch, because it is a Next build rule rather than a
 * TypeScript one. CI caught it; keep page files export-only-a-page.
 */
export default function ConsolidationPage() {
  return <ConsolidationPageContent />;
}
