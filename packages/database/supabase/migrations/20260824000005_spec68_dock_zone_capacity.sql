-- =============================================================================
-- spec-68 Fase 1 (Decisión 5) — dock_zones.capacity: the missing denominator
-- =============================================================================
-- dock_zones has always known the numerator (how many packages sit in a zone,
-- via dock_scans/packages) and nothing else. `4e`, `4h` and `4j` of spec-68's
-- mobile mocks show occupancy as "169 / 180 · casi lleno" and "quedan 11
-- espacios" — an operational instruction that changes what the crew does with
-- the box in their hand, not decoration. That needs a denominator, and the
-- schema has never had one; app/app/distribution/page.tsx's header comment
-- says occupancy is not rendered specifically because of this gap.
--
-- NULLABLE ON PURPOSE. A zone nobody has configured must show its count with
-- no bar and no threshold — never a bar pinned at 0%, which reads as a
-- rendering fault rather than "unconfigured". lib/distribution/dock-capacity.ts
-- (spec-68 Fase 1.2) is the single place that turns capacity + count into a
-- fill percentage, a tone and the "quedan N espacios" copy; NULL (and, as a
-- defensive belt for hand-typed data, 0 or negative) is the signal it uses to
-- tell every consumer that. The consuming screen still renders the raw count
-- on its own — only the *bar* (DockCapacityBar, Fase 1.5) disappears; there
-- is no state where the count itself goes unrendered.
--
-- NO CHECK CONSTRAINT for positivity. Decided against one, deliberately:
--   * dock-capacity.ts already treats 0/negative the same as NULL (no bar,
--     no threshold) as a defensive matter — a CHECK would just turn a
--     harmless miskeyed "-1" into a hard insert/update failure instead of a
--     value the UI already knows how to ignore.
--   * DockZoneForm (Fase 1.4) is the only write path from the app and never
--     submits <= 0 — empty input persists as NULL, not 0, and a zone whose
--     capacity was already <= 0 (a hand-edit) is normalized back to empty
--     the moment its edit dialog opens, so re-saving the form without
--     touching the field cannot echo a stale <= 0 value back either.
--   * The one path that bypasses the form is a DBA/support hand-edit, and for
--     that a soft floor (dock-capacity.ts) beats a hard rejection.
-- =============================================================================

BEGIN;

ALTER TABLE public.dock_zones
  ADD COLUMN IF NOT EXISTS capacity INT;

COMMENT ON COLUMN public.dock_zones.capacity IS
  'Max packages this dock/zone can hold, in units of packages. NULL means '
  '"not configured": lib/distribution/dock-capacity.ts and everything built '
  'on it (DockCapacityBar) render no fill bar and no threshold for it — '
  'never a bar at 0%, which would read as broken rather than unset. The '
  'raw count is still shown by the consuming screen; only the bar '
  'disappears. Zero or negative values are treated the same as NULL by '
  'that module; there is deliberately no CHECK constraint here (see '
  'migration header) since the only app write path (DockZoneForm) never '
  'produces or persists them.';

COMMIT;
