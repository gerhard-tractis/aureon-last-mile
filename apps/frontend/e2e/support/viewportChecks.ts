/**
 * spec-95 ronda 2 — the check that would have caught the `5c` footer bug:
 * the "+" button (`RouteFooterTopRow.tsx`'s `open-add-manifest`) sat 108px
 * outside the viewport at 390px, clipped and untappable, because the pie
 * grew to two rows and nothing re-measured against the phone width. No
 * unit test can see this — the render engine there does not lay anything
 * out — and no E2E spec ever asked the real DOM "does anything stick out
 * past the right edge?". This is that question, asked directly.
 *
 * Deliberately NOT a snapshot of one known-bad selector: a fixed selector
 * list would have missed the `+` button just as easily as it missed
 * everything else, because nobody knew in advance which element would
 * overflow next. Walking every element in the DOM is the only way this
 * check stays useful after the current bug is fixed.
 */
import { expect, type Page } from '@playwright/test';

/**
 * Fails if any element's right edge sits past the current viewport width.
 * `+1` tolerates sub-pixel rounding a browser's own layout engine
 * introduces — not a fudge factor for a real overflow.
 *
 * `context` is folded into the assertion message only (Playwright's
 * `expect(x, message)` form) — it does not change what is measured, only
 * what a failure prints, since the same check runs at several widths and
 * on several screens in the one spec.
 */
export async function assertNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1;
      })
      .map((e) => `${e.tagName}.${(e.className || '').toString().slice(0, 40)}`),
  );
  expect(overflow, `elements overflowing the viewport on ${context}`).toEqual([]);
}

/**
 * Every English literal spec-95 fase 5's review found and translated
 * (`ScanHistoryList.tsx`, `ScannerInput.tsx`, `ManifestDetailList.tsx`,
 * `PackageRow.tsx`) plus the two the same fase's review round caught
 * mid-flight (`Package Not Included`, `Failed to load` copies once used on
 * this same screen). A literal string match, not a translation-key check —
 * this is a regression guard for a screen a Spanish-speaking driver reads
 * every pickup, not a proof the i18n system is wired correctly everywhere.
 */
const BANNED_ENGLISH_STRINGS = [
  'No scans yet',
  'Scan barcode',
  'Orders & Packages',
  'Mark Verified',
  'Package Not Included',
  'No packages',
  'No orders found',
  'Retry',
  'Failed to load',
] as const;

export async function assertNoEnglishLeftovers(page: Page, context: string): Promise<void> {
  const text = await page.locator('body').innerText();
  const found = BANNED_ENGLISH_STRINGS.filter((needle) => text.includes(needle));
  expect(found, `English leftovers found on ${context}`).toEqual([]);
}
