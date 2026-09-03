// apps/frontend/src/lib/dispatch/mobile/anden-status.ts
//
// spec-76 review I4. `DISPATCHABLE_STATUSES` (lib/dispatch/scan-validator.ts)
// is a superset used to validate an INCOMING scan and includes `en_bodega` —
// the exact status spec-76 decision 5's own rejection reason names as "no
// pasó por andén": a package the crew cannot actually see on the dock yet.
// Any "en el andén" figure (2a/2b's header count, 2c's `EN EL ANDÉN` tile)
// must not count it, or the crew scans toward a number they cannot reach.
// `packagesTotal` (the route's full manifest size) correctly keeps the wider
// set — see crew-board.ts's `aggregateBoxesByRoute`.
export const ON_ANDEN_STATUSES = ['sectorizado', 'asignado', 'listo_para_despacho'] as const;
