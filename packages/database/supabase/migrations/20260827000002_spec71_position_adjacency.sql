-- spec-71 follow-on — position/andén adjacency.
--
-- New operational fact from the client: this tenant has no truck bays.
-- Andenes (dock_zones) are zones against the wall; a load position is open
-- floor in front of them where a route's load is consolidated. Consequence
-- the client accepted: positions are OFFSET from the andenes they draw
-- from — a route's position must not front an andén that route is still
-- sourcing packages from, because the pile would block that andén's face
-- while sorting into it is still running.
--
-- This migration only records which andén (if any) a position physically
-- stands in front of. It does NOT enforce the offset rule — see the column
-- comment below for why that has to be an assignment-time (phase 2)
-- concern, not a DB constraint. It does NOT touch dock_zones; spec-71's
-- Non-Goals forbid changing andenes, and this FK is one-way, from
-- load_positions only.

BEGIN;

ALTER TABLE public.load_positions
  ADD COLUMN IF NOT EXISTS fronts_dock_zone_id UUID
    REFERENCES public.dock_zones(id) ON DELETE SET NULL;

-- Partial index — this is what idx_dock_scans_dock_zone_id
-- (20260504000002_fix_manual_dock_assignment.sql) actually is (WHERE
-- dock_zone_id IS NOT NULL), as are idx_dock_scans_load_position_id and
-- both existing load_positions indexes. An earlier draft of this migration
-- created this index non-partial, which diverged from that precedent
-- rather than following it; fixed here.
--
-- ON DELETE SET NULL here diverges from the sibling FKs on dock_zone_id
-- elsewhere in the schema (e.g. dock_batches.dock_zone_id, dock_scans.dock_zone_id),
-- which are NO ACTION. That divergence is deliberate and is this column's
-- own precedent, not the sibling FKs' — see the column comment below for why
-- SET NULL is correct here.
CREATE INDEX IF NOT EXISTS idx_load_positions_fronts_dock_zone_id
  ON public.load_positions (fronts_dock_zone_id)
  WHERE fronts_dock_zone_id IS NOT NULL;

COMMENT ON COLUMN public.load_positions.fronts_dock_zone_id IS
  'spec-71 follow-on. The andén (dock_zones row) this position physically '
  'stands in front of on the floor, or NULL if the position sits in an open '
  'lane that does not front any andén. This tenant has no truck bays — '
  'andenes are wall-mounted zones and a position is floor space in front of '
  'them, so this column is what makes "in front of" a queryable fact rather '
  'than tribal knowledge. '
  'This is an EXCLUSION input, not a "nearest position" input. It exists so '
  '(a) assignment (phase 2) can keep a route out of a position that fronts '
  'an andén that route is still drawing packages from — that pile would '
  'block the andén''s face while sorting into it continues — and (b) the '
  'phase-5 move-task list can order work by short andén-to-position hops. '
  'It is deliberately NOT "assign the route to the position nearest its '
  'andén"; the offset rule is the opposite of proximity. '
  'Deliberately NOT enforced by a CHECK or trigger here: whether a given '
  'position''s fronts_dock_zone_id conflicts with a route is a function of '
  'that route''s package composition (which andenes its dispatches actually '
  'source from), which is dynamic and not knowable from load_positions '
  'alone. Enforcing the offset rule is a phase 2 (assignment-time) '
  'application concern, not a database constraint on this table. '
  'dock_zones is soft-deleted and hard deletes never happen in production, '
  'so ON DELETE SET NULL is effectively dead there: a retired andén leaves '
  'this column pointing at a dock_zones row that every RLS-scoped read '
  'filters out. Consumers MUST filter dock_zones.deleted_at IS NULL when '
  'joining through this column, and must treat a non-NULL '
  'fronts_dock_zone_id whose join comes back empty as "fronts a retired '
  'andén", not as "fronts nothing".';

COMMENT ON COLUMN public.load_positions.label IS
  'Human-readable name/location, e.g. "Zona frente a Andén 4" — a named '
  'floor spot, not a bay. This tenant has no truck bays; a position is open '
  'floor in front of the wall-mounted andenes (dock_zones), so a bay-style '
  'label like "Muelle 4" misdescribes what the label names. Re-issued here '
  'because the phase 1 migration (20260827000001) shipped with the '
  'bay-style example in its COMMENT ON COLUMN and cannot be edited after '
  'merge; this is the corrected wording.';

COMMIT;
