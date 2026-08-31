/**
 * Re-arm the package scan field after a mode switch.
 *
 * spec-71 QA finding. `key={mode}` on the ScanField was the first attempt and
 * it passes in jsdom, but it does NOT work in a browser. Proven on the
 * deployed build with a MutationObserver: the field's subtree is never touched
 * on a mode change, and focus stays on the control the operator just clicked —
 * Radix's Tabs moves focus to the selected trigger after React's effect runs,
 * and the mobile toggle is a plain button that keeps focus natively. jsdom
 * reproduces neither.
 *
 * The consequence on the floor is silent: a scanner gun types into whatever
 * holds focus, so the next package barcode goes into a button and is dropped —
 * no error, no scan row, nothing (see ScanField's own header).
 *
 * `requestAnimationFrame` puts the focus call after the click's own focus
 * handling has settled, which makes this independent of remount semantics and
 * of whose effect wins. The querySelector hop matches what this area already
 * does for the same problem (`SealPositionCard`'s `onCollapse`,
 * `QuickSortMobileView`'s `onEnterCode`) — the field is several components away
 * and its owners hold no ref to it.
 */
export const PACKAGE_FIELD_SELECTOR = 'input[aria-label="Escanear paquete"]';

export function refocusPackageField(): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>(PACKAGE_FIELD_SELECTOR)?.focus();
  });
}
