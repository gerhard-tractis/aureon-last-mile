// apps/frontend/src/lib/dispatch/mobile/anden-status.ts
//
// spec-76 review I4, resolved in task 3 (escalated decision). This used to
// be a hand-duplicated, narrower copy of `DISPATCHABLE_STATUSES`
// (lib/dispatch/scan-validator.ts) — that constant included `en_bodega`
// (a package not yet sorted to any andén) until task 3, so this file
// existed specifically to exclude it from "en el andén" figures (2a/2b's
// header count, 2c's `EN EL ANDÉN` tile) that `DISPATCHABLE_STATUSES`
// itself couldn't be trusted for. Now that `en_bodega` is OUT of
// `DISPATCHABLE_STATUSES` (it is rejected at the scanner, not just excluded
// from a dock count), the two sets are the same set — re-exported as an
// alias rather than a second array that could silently drift from it
// again. `packagesTotal` (the route's full manifest size) intentionally
// stays on the wider `DISPATCHABLE_STATUSES` definition too — see
// crew-board.ts's `aggregateBoxesByRoute` — so both "en el andén" and
// "en la ruta" now read from the one constant.
export { DISPATCHABLE_STATUSES as ON_ANDEN_STATUSES } from '../scan-validator';
