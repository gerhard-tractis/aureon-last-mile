/**
 * spec-71 phase 3. Normalizes a scanned code for comparison against a
 * stored value.
 *
 * project_qa_scanner_hardware: the QA hardware scanner has no CR/Enter
 * suffix (handled separately by `useScannerAutoSubmit`) and a US/ES
 * keyboard-layout mismatch that corrupts hyphens — at least one real scan
 * arrived as `CARGA'PARIS'...`, apostrophes where hyphens belong. That
 * mismatch is unresolved on the device, so software has to absorb it.
 *
 * `load_positions.code` values look like "POS-04". A scan can arrive as
 * "POS-04" (clean), "POS'04" (layout-corrupted), or "POS04" (the hyphen
 * dropped outright). Stripping every non-alphanumeric character and
 * uppercasing collapses all three to the same key, "POS04", without ever
 * touching the stored code itself.
 */
export function normalizeScanCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Whether a scanned code resolves to the same normalized key as a stored
 * one. An empty normalized scan (e.g. `'---'`, all punctuation) never
 * matches anything — without this guard two all-punctuation strings would
 * both normalize to `''` and compare equal, a false positive rather than a
 * real match. Applies wherever this function is used, client compare or
 * server resolve alike.
 */
export function scanCodesMatch(scanned: string, stored: string): boolean {
  const normalizedScanned = normalizeScanCode(scanned);
  if (normalizedScanned === '') return false;
  return normalizedScanned === normalizeScanCode(stored);
}
