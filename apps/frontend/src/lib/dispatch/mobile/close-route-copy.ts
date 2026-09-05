// apps/frontend/src/lib/dispatch/mobile/close-route-copy.ts
//
// spec-76 2e + spec-78 3a — `2i` (close route) shipped for the phone in
// spec-77 Fase 1 (UI): `DispatchRouteScanSession.tsx` no longer imports
// this constant, it calls `POST /seal` for real (direct close or
// `DispatchRouteCloseSheet`, per whether anything is still missing). The
// dock tablet (`3a`, spec-78) has NOT been wired yet — out of scope for
// spec-77, whose scope table names the phone's mobile session only — so
// `DispatchTabletActionBar.tsx` still renders "Cerrar ruta" disabled with
// this exact reason, visible as text (never `title=` only — no hover state
// on a touchscreen). Kept as its own constant/file for whoever wires the
// tablet next, rather than duplicating the string.
export const CLOSE_ROUTE_DISABLED_REASON = 'El cierre de ruta es la próxima pantalla — spec-77';
