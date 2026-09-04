// apps/frontend/src/lib/dispatch/mobile/close-route-copy.ts
//
// spec-76 2e + spec-78 3a — 2i (close route) is spec-77, `Status: backlog`.
// Both the phone (2e) and the tablet (3a) render "Cerrar ruta" disabled
// with this exact reason visible as text (never `title=` only — no hover
// state on a touchscreen), so the two surfaces never drift into two
// different explanations for the same missing screen.
export const CLOSE_ROUTE_DISABLED_REASON = 'El cierre de ruta es la próxima pantalla — spec-77';
