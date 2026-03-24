# Chile Comunas Normalization

**Date:** 2026-03-21
**Status:** in progress
**Epic:** Platform Data Quality
**Depends on:** spec-12 (Distribution Sectorization — dock_zones, dock_zone_comunas)

## Problem

`orders.comuna` is a raw free-text VARCHAR written by Easy and Paris (DispatchTrack/Beetrack) connectors with no normalization. The same commune appears as `"Las Condes"`, `"LAS CONDES"`, `"las condes"`, `"Ñuñoa"`, `"Nunoa"` — sometimes in the same day. This causes:

1. **Sectorization failures** — the hub engine fuzzy-matches commune strings against andén assignments, silently routing packages to consolidation when the match fails.
2. **Analytics noise** — `get_orders_by_comuna` groups by raw string, so the same commune appears as multiple rows in dashboards.
3. **No auditability** — when a commune doesn't match, there's no record of what was received vs. what was expected.
4. **Fragile extension** — adding polygon-based routing (future) requires a canonical geometry per commune; that's impossible with free text.

## Solution

A `chile_comunas` canonical reference table (346 communes, official CUT codes, full region/province hierarchy, PostGIS geometry column for future polygons) plus a `chile_comuna_aliases` table mapping known raw variants to canonical communes. A DB trigger on `orders` normalizes every insertion automatically. `dock_zones` drops its free-text `comunas[]` array for a proper `dock_zone_comunas` junction table. Existing `orders.comuna` rows are backfilled to canonical names.

---

## Data Model

### New Table: `chile_comunas`

```sql
CREATE TABLE public.chile_comunas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_cut   VARCHAR(10)  UNIQUE NOT NULL, -- e.g. '13110' (Las Condes)
  nombre       VARCHAR(100) NOT NULL,         -- canonical, accented: 'Las Condes'
  provincia    VARCHAR(100) NOT NULL,         -- e.g. 'Santiago'
  region       VARCHAR(100) NOT NULL,         -- e.g. 'Metropolitana de Santiago'
  region_num   SMALLINT     NOT NULL,         -- 1–16 (RM = 13)
  geometry     GEOMETRY(MultiPolygon, 4326)   -- NULL until polygons loaded
);
```

RLS: read-only for all authenticated users (operator-scoped SELECT — no operator_id needed, this is a global reference table). No INSERT/UPDATE/DELETE via client.

### New Table: `chile_comuna_aliases`

```sql
CREATE TABLE public.chile_comuna_aliases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias      TEXT NOT NULL,           -- raw variant: 'LAS CONDES', 'Nunoa'
  comuna_id  UUID NOT NULL REFERENCES public.chile_comunas(id),
  source     TEXT NOT NULL DEFAULT 'seed', -- 'seed' | 'easy' | 'paris' | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias)
);
```

RLS: authenticated users can SELECT; only service_role can INSERT (alias mapping done via RPC, not direct client write).

### New Table: `dock_zone_comunas`

Replaces `dock_zones.comunas TEXT[]`.

```sql
CREATE TABLE public.dock_zone_comunas (
  dock_zone_id UUID NOT NULL REFERENCES public.dock_zones(id),
  comuna_id    UUID NOT NULL REFERENCES public.chile_comunas(id),
  PRIMARY KEY (dock_zone_id, comuna_id)
);

ALTER TABLE public.dock_zone_comunas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dock_zone_comunas_operator_select" ON public.dock_zone_comunas
  FOR SELECT USING (
    dock_zone_id IN (
      SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id()
    )
  );

CREATE POLICY "dock_zone_comunas_operator_insert" ON public.dock_zone_comunas
  FOR INSERT WITH CHECK (
    dock_zone_id IN (
      SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id()
    )
  );

CREATE POLICY "dock_zone_comunas_operator_delete" ON public.dock_zone_comunas
  FOR DELETE USING (
    dock_zone_id IN (
      SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id()
    )
  );
```

### Modified: `orders`

Two new columns added:

```sql
ALTER TABLE public.orders
  ADD COLUMN comuna_id  UUID REFERENCES public.chile_comunas(id),  -- NULL = unmatched
  ADD COLUMN comuna_raw TEXT;  -- original string from connector, preserved forever
```

`orders.comuna` (existing VARCHAR) is kept and overwritten with the canonical `chile_comunas.nombre` on match. If no match, `orders.comuna` is left as-is. This preserves backward compatibility with all existing RPCs (`get_orders_by_comuna`, delivery detail functions, dashboards).

### Dropped: `dock_zones.comunas`

```sql
ALTER TABLE public.dock_zones DROP COLUMN comunas;
```

### Normalization Function

```sql
CREATE OR REPLACE FUNCTION public.normalize_comuna_id(raw_name TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF raw_name IS NULL OR trim(raw_name) = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Exact match on canonical nombre (case-insensitive, trimmed)
  SELECT id INTO v_id
    FROM public.chile_comunas
   WHERE lower(trim(nombre)) = lower(trim(raw_name))
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  -- 2. Match on alias table (case-insensitive, trimmed)
  SELECT comuna_id INTO v_id
    FROM public.chile_comuna_aliases
   WHERE lower(trim(alias)) = lower(trim(raw_name))
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  RETURN NULL;
END;
$$;
```

### Normalization Trigger on `orders`

```sql
CREATE OR REPLACE FUNCTION public.orders_normalize_comuna()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_id   UUID;
  v_name TEXT;
BEGIN
  IF NEW.comuna IS NOT NULL THEN
    -- Preserve raw value (only on first write)
    IF NEW.comuna_raw IS NULL THEN
      NEW.comuna_raw := NEW.comuna;
    END IF;

    -- Resolve to canonical
    v_id := public.normalize_comuna_id(NEW.comuna);
    NEW.comuna_id := v_id;

    IF v_id IS NOT NULL THEN
      SELECT nombre INTO v_name FROM public.chile_comunas WHERE id = v_id;
      NEW.comuna := v_name;  -- overwrite with canonical name
    END IF;
    -- If NULL: leave NEW.comuna as-is (raw), so existing RPCs keep working
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_normalize_comuna_trigger
  BEFORE INSERT OR UPDATE OF comuna
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_normalize_comuna();
```

### Alias Mapping RPC

For the admin UI to map an unmatched commune:

```sql
CREATE OR REPLACE FUNCTION public.map_comuna_alias(
  p_alias    TEXT,
  p_comuna_id UUID,
  p_source   TEXT DEFAULT 'manual'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_canonical TEXT;
BEGIN
  SELECT nombre INTO v_canonical FROM public.chile_comunas WHERE id = p_comuna_id;

  INSERT INTO public.chile_comuna_aliases (alias, comuna_id, source)
    VALUES (trim(p_alias), p_comuna_id, p_source)
    ON CONFLICT (alias) DO UPDATE SET comuna_id = p_comuna_id, source = p_source;

  -- Backfill orders that had this raw value unmatched.
  -- Sets both comuna and comuna_id directly; the BEFORE UPDATE trigger will re-fire
  -- on orders.comuna, re-resolve the canonical name (same result), and write the same
  -- comuna_id back — this is harmless and idempotent.
  UPDATE public.orders
     SET comuna_id = p_comuna_id,
         comuna    = v_canonical
   WHERE lower(trim(comuna_raw)) = lower(trim(p_alias))
     AND comuna_id IS NULL;
END;
$$;
```

> **Trigger re-entry note:** The UPDATE inside `map_comuna_alias` sets `orders.comuna = v_canonical` (canonical name), which fires the `BEFORE UPDATE OF comuna` trigger. The trigger calls `normalize_comuna_id(NEW.comuna)` on the canonical name — this resolves to the same UUID via the exact-match path and writes the same `comuna_id`. The re-entry is harmless and idempotent. `NEW.comuna_raw` is already set so the trigger skips raw-preservation.

---

## Seed Data

### `chile_comunas` — 346 rows

All 346 Chilean communes seeded with official CUT codes, canonical accented names, provincia, región, and region_num (1–16, RM = 13). The geometry column is NULL for all seed rows.

Key examples (Región Metropolitana):

| codigo_cut | nombre | provincia | region | region_num |
|---|---|---|---|---|
| 13101 | Santiago | Santiago | Metropolitana de Santiago | 13 |
| 13110 | Las Condes | Santiago | Metropolitana de Santiago | 13 |
| 13120 | Ñuñoa | Santiago | Metropolitana de Santiago | 13 |
| 13116 | Maipú | Santiago | Metropolitana de Santiago | 13 |
| 13119 | Lo Barnechea | Santiago | Metropolitana de Santiago | 13 |
| 13601 | Puente Alto | Cordillera | Metropolitana de Santiago | 13 |

Full list: 346 rows covering all 16 regions.

### `chile_comuna_aliases` — seeded variants

Known Easy/Paris raw variants seeded for the most common Región Metropolitana communes (and extended to other regions as needed):

| alias | source |
|---|---|
| `LAS CONDES` | easy |
| `NUNOA` | easy |
| `ÑUÑOA` | easy (uppercase with ñ) |
| `MAIPU` | easy |
| `MAIPÚ` | easy |
| `LO BARNECHEA` | easy |
| `PUENTE ALTO` | easy |
| `PROVIDENCIA` | easy |
| `VITACURA` | easy |
| `LA FLORIDA` | easy |
| `SANTIAGO` | easy |
| ... | ... |

All 346 communes seeded with at minimum: uppercase version and accentless uppercase version. The accentless transformation rules:

| accented | plain |
|---|---|
| á | a |
| é | e |
| í | i |
| ó | o |
| ú, ü | u |
| ñ | n |

Examples: `Ñuñoa` → aliases `ÑUÑOA` + `NUNOA`; `Maipú` → `MAIPU`; `Cañete` → `CANETE`; `Río Hurtado` → `RIO HURTADO`.

The seed script generates aliases programmatically using a simple SQL `TRANSLATE()` call or a seeding script — not hand-written per commune.

---

## Backfill

Runs inside the same migration, after seed data and trigger creation:

```sql
-- Step 1: Preserve raw values for all existing orders
UPDATE public.orders
   SET comuna_raw = comuna
 WHERE comuna_raw IS NULL AND comuna IS NOT NULL;

-- Step 2: Normalize unresolved rows only (idempotent — safe to run twice).
-- Rows already normalized (comuna_id IS NOT NULL) are skipped.
UPDATE public.orders o
   SET comuna_id = public.normalize_comuna_id(o.comuna),
       comuna = COALESCE(
         (SELECT nombre FROM public.chile_comunas WHERE id = public.normalize_comuna_id(o.comuna)),
         o.comuna
       )
 WHERE o.comuna IS NOT NULL
   AND o.comuna_id IS NULL;
```

After backfill, `SELECT DISTINCT comuna_raw FROM orders WHERE comuna_id IS NULL` surfaces all unmatched raw values for operator review.

---

## Frontend Changes

### `useChileComunas` hook (new)

```
apps/frontend/src/hooks/distribution/useChileComunas.ts
```

TanStack Query hook fetching all 346 communes. `staleTime: Infinity` (reference data never changes). Query key: `['chile-comunas']`.

### `DockZoneForm` — commune picker

Replace the `<textarea>` (one per line) with a shadcn `Command`-based searchable multi-select combobox. Operators type to filter, click to select, see chips. Writes to `dock_zone_comunas` (IDs) not `dock_zones.comunas` (text).

### `useDockZones` hook update

Fetch `dock_zones` with joined `dock_zone_comunas(chile_comunas(id, nombre))`. The `DockZoneRecord` type gains `comunas: { id: string; nombre: string }[]`.

### Sectorization engine update

`DockZone.comunas` changes from `string[]` to `{ id: string; nombre: string }[]`.
`PackageOrder` gains `comunaId: string | null`.

`determineDockZone` match logic:
```ts
// Before: string normalization
zones.find(z => z.comunas.some(c => normalize(c) === normalize(pkg.comuna)))

// After: exact ID lookup
zones.find(z => z.comunas.some(c => c.id === pkg.comunaId))
```

Delivery date logic (consolidation for future dates) is unchanged.

### `UnmatchedComunasPanel` (new component)

```
apps/frontend/src/components/distribution/UnmatchedComunasPanel.tsx
apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts
```

Location: `/app/distribution/settings` page, below the andén list.

Fetches `orders` where `comuna_id IS NULL AND comuna_raw IS NOT NULL`, grouped by `comuna_raw` with order count. Each row:

- Raw value (e.g. `"San miguel"`)
- Order count
- "Mapear" button → opens Dialog with `useChileComunas` combobox → on confirm calls `map_comuna_alias` RPC → invalidates unmatched query + dock zone queries

---

## Migration Structure

Single file: `packages/database/supabase/migrations/20260321000001_chile_comunas_normalization.sql`

Order within the migration:
1. `CREATE EXTENSION IF NOT EXISTS postgis`
2. Create `chile_comunas` table + indexes + RLS
3. Create `chile_comuna_aliases` table + index + RLS
4. Seed 346 communes
5. Seed known aliases
6. Create `normalize_comuna_id()` function
7. Create `map_comuna_alias()` RPC
8. Create `get_unmatched_comunas(p_operator_id UUID)` RPC (returns unmatched raw commune counts)
9. `ALTER TABLE orders ADD COLUMN comuna_id, ADD COLUMN comuna_raw`
10. Create `orders_normalize_comuna` trigger function + trigger
11. Create `dock_zone_comunas` table + RLS
12. `ALTER TABLE dock_zones DROP COLUMN comunas`
13. Run backfill UPDATE statements
14. Grant permissions

---

## Testing

### Unit — normalization function (Vitest, mocked Supabase)
- Exact match case-insensitive: `"las condes"` → Las Condes UUID
- Alias match: `"LAS CONDES"` → Las Condes UUID
- Accentless alias: `"NUNOA"` → Ñuñoa UUID
- Unknown: `"Antartica Chilena"` → null
- Empty string / null → null

### Unit — sectorization engine
- ID-based match routes to correct zone
- Unknown `comunaId` (null) → consolidation zone
- Delivery date logic unchanged

### Component — `DockZoneForm`
- Renders combobox (not textarea)
- Search filters list
- Select/deselect updates chips
- Submit writes correct commune IDs

### Component — `UnmatchedComunasPanel`
- Renders when unmatched communes exist
- Renders nothing when all matched
- "Mapear" opens dialog, confirm calls RPC, panel refreshes

---

## Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize `orders.comuna` to canonical Chilean commune names via a DB-layer reference table, alias mapping, and trigger — replacing the fragile free-text `dock_zones.comunas[]` array with a proper junction table.

**Architecture:** DB-centric normalization via trigger on `orders` (invisible to connectors), canonical `chile_comunas` reference table with 346 CUT-coded communes, `dock_zone_comunas` junction table replacing the free-text array. Frontend changes: ID-based sectorization matching, combobox commune picker, unmatched communes admin panel.

**Tech Stack:** PostgreSQL trigger + PLPGSQL, PostGIS geometry column, Supabase RLS, TanStack Query, shadcn Command combobox, Vitest

---

### File Map

| Action | File |
|--------|------|
| Create | `packages/database/supabase/migrations/20260321000001_chile_comunas_normalization.sql` |
| Modify | `apps/frontend/src/lib/types.ts` |
| Modify | `apps/frontend/src/lib/distribution/sectorization-engine.ts` |
| Modify | `apps/frontend/src/lib/distribution/sectorization-engine.test.ts` |
| Create | `apps/frontend/src/hooks/distribution/useChileComunas.ts` |
| Create | `apps/frontend/src/hooks/distribution/useChileComunas.test.ts` |
| Modify | `apps/frontend/src/hooks/distribution/useDockZones.ts` |
| Modify | `apps/frontend/src/hooks/distribution/useDockZones.test.ts` |
| Modify | `apps/frontend/src/components/distribution/DockZoneForm.tsx` |
| Modify | `apps/frontend/src/components/distribution/DockZoneForm.test.tsx` |
| Modify | `apps/frontend/src/components/distribution/DockZoneList.tsx` |
| Create | `apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts` |
| Create | `apps/frontend/src/hooks/distribution/useUnmatchedComunas.test.ts` |
| Create | `apps/frontend/src/components/distribution/UnmatchedComunasPanel.tsx` |
| Create | `apps/frontend/src/components/distribution/UnmatchedComunasPanel.test.tsx` |
| Modify | `apps/frontend/src/app/app/distribution/settings/page.tsx` |
| Create | `apps/frontend/src/__tests__/comunas-normalization.test.ts` |
| Modify | `apps/frontend/src/components/distribution/BatchScanner.tsx` |
| Modify | `apps/frontend/src/components/distribution/QuickSortScanner.tsx` |

---

### Task N.0: DB Migration

**Files:**
- Create: `packages/database/supabase/migrations/20260321000001_chile_comunas_normalization.sql`
- Modify: `apps/frontend/src/lib/types.ts`

- [ ] **Step 1: Write the failing integration test**

Create `apps/frontend/src/__tests__/comunas-normalization.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const skip = !SERVICE_KEY || !SUPABASE_URL;

describe.skipIf(skip)('comunas normalization (integration)', () => {
  let supabase: ReturnType<typeof createClient>;

  beforeAll(() => {
    supabase = createClient(SUPABASE_URL!, SERVICE_KEY!);
  });

  it('normalize_comuna_id returns UUID for exact canonical name', async () => {
    const { data } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Las Condes' });
    expect(data).toBeTruthy();
    expect(typeof data).toBe('string');
  });

  it('normalize_comuna_id is case-insensitive for canonical name', async () => {
    const { data: d1 } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Las Condes' });
    const { data: d2 } = await supabase.rpc('normalize_comuna_id', { raw_name: 'las condes' });
    expect(d1).toBe(d2);
  });

  it('normalize_comuna_id resolves uppercase alias', async () => {
    const { data: canonical } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Las Condes' });
    const { data: alias }    = await supabase.rpc('normalize_comuna_id', { raw_name: 'LAS CONDES' });
    expect(alias).toBe(canonical);
  });

  it('normalize_comuna_id resolves accentless alias NUNOA → Ñuñoa', async () => {
    const { data: canonical } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Ñuñoa' });
    const { data: alias }    = await supabase.rpc('normalize_comuna_id', { raw_name: 'NUNOA' });
    expect(alias).toBe(canonical);
    expect(canonical).toBeTruthy();
  });

  it('normalize_comuna_id returns null for unknown commune', async () => {
    const { data } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Antartica Chilena XYZ' });
    expect(data).toBeNull();
  });

  it('normalize_comuna_id returns null for empty string', async () => {
    const { data } = await supabase.rpc('normalize_comuna_id', { raw_name: '' });
    expect(data).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it skips (expected without env)**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/__tests__/comunas-normalization.test.ts
```

Expected: tests skipped (no `SUPABASE_SERVICE_ROLE_KEY` locally).

- [ ] **Step 3: Write the migration SQL**

Create `packages/database/supabase/migrations/20260321000001_chile_comunas_normalization.sql`:

```sql
-- 1. PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. chile_comunas reference table
CREATE TABLE public.chile_comunas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_cut   VARCHAR(10)  UNIQUE NOT NULL,
  nombre       VARCHAR(100) NOT NULL,
  provincia    VARCHAR(100) NOT NULL,
  region       VARCHAR(100) NOT NULL,
  region_num   SMALLINT     NOT NULL,
  geometry     GEOMETRY(MultiPolygon, 4326)
);

CREATE INDEX idx_chile_comunas_nombre_lower ON public.chile_comunas (lower(nombre));
CREATE INDEX idx_chile_comunas_region_num    ON public.chile_comunas (region_num);

ALTER TABLE public.chile_comunas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chile_comunas_authenticated_select" ON public.chile_comunas
  FOR SELECT TO authenticated USING (true);

-- 3. chile_comuna_aliases
CREATE TABLE public.chile_comuna_aliases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias      TEXT NOT NULL,
  comuna_id  UUID NOT NULL REFERENCES public.chile_comunas(id),
  source     TEXT NOT NULL DEFAULT 'seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias)
);

CREATE INDEX idx_chile_comuna_aliases_alias_lower ON public.chile_comuna_aliases (lower(alias));

ALTER TABLE public.chile_comuna_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chile_comuna_aliases_authenticated_select" ON public.chile_comuna_aliases
  FOR SELECT TO authenticated USING (true);

-- 4. Seed 346 communes
-- Source: https://www.bcn.cl/siit/nuestropais/division_comunal.htm (INE CUT codes)
-- The full 346-row INSERT must be written out completely — only a sample is shown below.
-- Generate the rest from the official list, following this pattern exactly.
INSERT INTO public.chile_comunas (codigo_cut, nombre, provincia, region, region_num) VALUES
  ('13101', 'Santiago',           'Santiago',   'Metropolitana de Santiago', 13),
  ('13102', 'Cerrillos',          'Santiago',   'Metropolitana de Santiago', 13),
  ('13103', 'Cerro Navia',        'Santiago',   'Metropolitana de Santiago', 13),
  ('13104', 'Conchalí',           'Santiago',   'Metropolitana de Santiago', 13),
  ('13105', 'El Bosque',          'Santiago',   'Metropolitana de Santiago', 13),
  ('13106', 'Estación Central',   'Santiago',   'Metropolitana de Santiago', 13),
  ('13107', 'Huechuraba',         'Santiago',   'Metropolitana de Santiago', 13),
  ('13108', 'Independencia',      'Santiago',   'Metropolitana de Santiago', 13),
  ('13109', 'La Cisterna',        'Santiago',   'Metropolitana de Santiago', 13),
  ('13110', 'Las Condes',         'Santiago',   'Metropolitana de Santiago', 13),
  ('13111', 'La Florida',         'Santiago',   'Metropolitana de Santiago', 13),
  ('13112', 'La Granja',          'Santiago',   'Metropolitana de Santiago', 13),
  ('13113', 'La Pintana',         'Santiago',   'Metropolitana de Santiago', 13),
  ('13114', 'La Reina',           'Santiago',   'Metropolitana de Santiago', 13),
  ('13115', 'Lo Espejo',          'Santiago',   'Metropolitana de Santiago', 13),
  ('13116', 'Maipú',              'Santiago',   'Metropolitana de Santiago', 13),
  ('13117', 'Macul',              'Santiago',   'Metropolitana de Santiago', 13),
  ('13118', 'Pudahuel',           'Santiago',   'Metropolitana de Santiago', 13),
  ('13119', 'Lo Barnechea',       'Santiago',   'Metropolitana de Santiago', 13),
  ('13120', 'Ñuñoa',              'Santiago',   'Metropolitana de Santiago', 13),
  ('13121', 'Pedro Aguirre Cerda','Santiago',   'Metropolitana de Santiago', 13),
  ('13122', 'Peñalolén',          'Santiago',   'Metropolitana de Santiago', 13),
  ('13123', 'Providencia',        'Santiago',   'Metropolitana de Santiago', 13),
  ('13124', 'Quilicura',          'Santiago',   'Metropolitana de Santiago', 13),
  ('13125', 'Quinta Normal',      'Santiago',   'Metropolitana de Santiago', 13),
  ('13126', 'Recoleta',           'Santiago',   'Metropolitana de Santiago', 13),
  ('13127', 'Renca',              'Santiago',   'Metropolitana de Santiago', 13),
  ('13128', 'San Miguel',         'Santiago',   'Metropolitana de Santiago', 13),
  ('13129', 'San Joaquín',        'Santiago',   'Metropolitana de Santiago', 13),
  ('13130', 'San Ramón',          'Santiago',   'Metropolitana de Santiago', 13),
  ('13131', 'Vitacura',           'Santiago',   'Metropolitana de Santiago', 13),
  ('13132', 'Lo Prado',           'Santiago',   'Metropolitana de Santiago', 13),
  ('13201', 'Puente Alto',        'Cordillera', 'Metropolitana de Santiago', 13),
  ('13202', 'Pirque',             'Cordillera', 'Metropolitana de Santiago', 13),
  ('13203', 'San José de Maipo',  'Cordillera', 'Metropolitana de Santiago', 13),
  ('13301', 'Colina',             'Chacabuco',  'Metropolitana de Santiago', 13),
  ('13302', 'Lampa',              'Chacabuco',  'Metropolitana de Santiago', 13),
  ('13303', 'Tiltil',             'Chacabuco',  'Metropolitana de Santiago', 13),
  ('13401', 'San Bernardo',       'Maipo',      'Metropolitana de Santiago', 13),
  ('13402', 'Buin',               'Maipo',      'Metropolitana de Santiago', 13),
  ('13403', 'Calera de Tango',    'Maipo',      'Metropolitana de Santiago', 13),
  ('13404', 'Paine',              'Maipo',      'Metropolitana de Santiago', 13),
  ('13501', 'Melipilla',          'Melipilla',  'Metropolitana de Santiago', 13),
  ('13502', 'Alhué',              'Melipilla',  'Metropolitana de Santiago', 13),
  ('13503', 'Curacaví',           'Melipilla',  'Metropolitana de Santiago', 13),
  ('13504', 'María Pinto',        'Melipilla',  'Metropolitana de Santiago', 13),
  ('13505', 'San Pedro',          'Melipilla',  'Metropolitana de Santiago', 13),
  ('13601', 'Talagante',          'Talagante',  'Metropolitana de Santiago', 13),
  ('13602', 'El Monte',           'Talagante',  'Metropolitana de Santiago', 13),
  ('13603', 'Isla de Maipo',      'Talagante',  'Metropolitana de Santiago', 13),
  ('13604', 'Padre Hurtado',      'Talagante',  'Metropolitana de Santiago', 13),
  ('13605', 'Peñaflor',           'Talagante',  'Metropolitana de Santiago', 13),
  -- Arica y Parinacota (15)
  ('15101', 'Arica',              'Arica',      'Arica y Parinacota', 15),
  ('15102', 'Camarones',          'Arica',      'Arica y Parinacota', 15),
  ('15201', 'Putre',              'Parinacota', 'Arica y Parinacota', 15),
  ('15202', 'General Lagos',      'Parinacota', 'Arica y Parinacota', 15),
  -- Valparaíso (5)
  ('05101', 'Valparaíso',         'Valparaíso', 'Valparaíso', 5),
  ('05102', 'Casablanca',         'Valparaíso', 'Valparaíso', 5),
  ('05103', 'Concón',             'Valparaíso', 'Valparaíso', 5),
  ('05104', 'Juan Fernández',     'Valparaíso', 'Valparaíso', 5),
  ('05105', 'Puchuncaví',         'Valparaíso', 'Valparaíso', 5),
  ('05107', 'Quintero',           'Valparaíso', 'Valparaíso', 5),
  ('05109', 'Viña del Mar',       'Valparaíso', 'Valparaíso', 5),
  ('05201', 'Isla de Pascua',     'Isla de Pascua', 'Valparaíso', 5),
  ('05301', 'Los Andes',          'Los Andes',  'Valparaíso', 5),
  ('05501', 'Quillota',           'Quillota',   'Valparaíso', 5),
  ('05601', 'San Antonio',        'San Antonio','Valparaíso', 5),
  ('05701', 'San Felipe',         'San Felipe de Aconcagua', 'Valparaíso', 5),
  ('05801', 'Quilpué',            'Marga Marga','Valparaíso', 5),
  ('05802', 'Limache',            'Marga Marga','Valparaíso', 5),
  ('05803', 'Olmué',              'Marga Marga','Valparaíso', 5),
  ('05804', 'Villa Alemana',      'Marga Marga','Valparaíso', 5),
  -- Biobío (8)
  ('08101', 'Concepción',         'Concepción', 'Biobío', 8),
  ('08102', 'Coronel',            'Concepción', 'Biobío', 8),
  ('08103', 'Chiguayante',        'Concepción', 'Biobío', 8),
  ('08108', 'San Pedro de la Paz','Concepción', 'Biobío', 8),
  ('08110', 'Talcahuano',         'Concepción', 'Biobío', 8),
  ('08111', 'Tomé',               'Concepción', 'Biobío', 8)
  -- ↑ EXPAND to all 346 communes across all 16 regions before running migration
ON CONFLICT (codigo_cut) DO NOTHING;

-- 5a. Seed aliases — uppercase canonical name
INSERT INTO public.chile_comuna_aliases (alias, comuna_id, source)
SELECT upper(nombre), id, 'seed'
  FROM public.chile_comunas
ON CONFLICT (alias) DO NOTHING;

-- 5b. Seed aliases — accentless uppercase (á→a, é→e, í→i, ó→o, ú→u, ü→u, ñ→n)
INSERT INTO public.chile_comuna_aliases (alias, comuna_id, source)
SELECT
  upper(translate(nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
  id,
  'seed'
  FROM public.chile_comunas
 WHERE upper(translate(nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) != upper(nombre)
ON CONFLICT (alias) DO NOTHING;

-- 6. normalize_comuna_id function
CREATE OR REPLACE FUNCTION public.normalize_comuna_id(raw_name TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF raw_name IS NULL OR trim(raw_name) = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM public.chile_comunas
   WHERE lower(trim(nombre)) = lower(trim(raw_name))
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  SELECT comuna_id INTO v_id
    FROM public.chile_comuna_aliases
   WHERE lower(trim(alias)) = lower(trim(raw_name))
   LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  RETURN NULL;
END;
$$;

-- 7. map_comuna_alias RPC
CREATE OR REPLACE FUNCTION public.map_comuna_alias(
  p_alias     TEXT,
  p_comuna_id UUID,
  p_source    TEXT DEFAULT 'manual'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_canonical TEXT;
BEGIN
  SELECT nombre INTO v_canonical FROM public.chile_comunas WHERE id = p_comuna_id;

  INSERT INTO public.chile_comuna_aliases (alias, comuna_id, source)
    VALUES (trim(p_alias), p_comuna_id, p_source)
    ON CONFLICT (alias) DO UPDATE SET comuna_id = p_comuna_id, source = p_source;

  -- Trigger re-entry on the UPDATE below is harmless — see spec notes.
  UPDATE public.orders
     SET comuna_id = p_comuna_id,
         comuna    = v_canonical
   WHERE lower(trim(comuna_raw)) = lower(trim(p_alias))
     AND comuna_id IS NULL;
END;
$$;

-- 8. get_unmatched_comunas RPC
CREATE OR REPLACE FUNCTION public.get_unmatched_comunas(p_operator_id UUID)
RETURNS TABLE (comuna_raw TEXT, order_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT o.comuna_raw, COUNT(*)::BIGINT AS order_count
    FROM public.orders o
   WHERE o.operator_id = p_operator_id
     AND o.comuna_id IS NULL
     AND o.comuna_raw IS NOT NULL
   GROUP BY o.comuna_raw
   ORDER BY order_count DESC;
$$;

-- 9. orders: add new columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS comuna_id  UUID REFERENCES public.chile_comunas(id),
  ADD COLUMN IF NOT EXISTS comuna_raw TEXT;

-- 10. Normalization trigger
CREATE OR REPLACE FUNCTION public.orders_normalize_comuna()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_id   UUID;
  v_name TEXT;
BEGIN
  IF NEW.comuna IS NOT NULL THEN
    IF NEW.comuna_raw IS NULL THEN
      NEW.comuna_raw := NEW.comuna;
    END IF;
    v_id := public.normalize_comuna_id(NEW.comuna);
    NEW.comuna_id := v_id;
    IF v_id IS NOT NULL THEN
      SELECT nombre INTO v_name FROM public.chile_comunas WHERE id = v_id;
      NEW.comuna := v_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_normalize_comuna_trigger ON public.orders;
CREATE TRIGGER orders_normalize_comuna_trigger
  BEFORE INSERT OR UPDATE OF comuna
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_normalize_comuna();

-- 11. dock_zone_comunas junction table
CREATE TABLE public.dock_zone_comunas (
  dock_zone_id UUID NOT NULL REFERENCES public.dock_zones(id),
  comuna_id    UUID NOT NULL REFERENCES public.chile_comunas(id),
  PRIMARY KEY (dock_zone_id, comuna_id)
);

ALTER TABLE public.dock_zone_comunas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dock_zone_comunas_operator_select" ON public.dock_zone_comunas
  FOR SELECT USING (
    dock_zone_id IN (SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id())
  );
CREATE POLICY "dock_zone_comunas_operator_insert" ON public.dock_zone_comunas
  FOR INSERT WITH CHECK (
    dock_zone_id IN (SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id())
  );
CREATE POLICY "dock_zone_comunas_operator_delete" ON public.dock_zone_comunas
  FOR DELETE USING (
    dock_zone_id IN (SELECT id FROM public.dock_zones WHERE operator_id = public.get_operator_id())
  );

-- 12. Drop old free-text comunas column
ALTER TABLE public.dock_zones DROP COLUMN IF EXISTS comunas;

-- 13. Backfill existing orders
UPDATE public.orders
   SET comuna_raw = comuna
 WHERE comuna_raw IS NULL AND comuna IS NOT NULL;

UPDATE public.orders o
   SET comuna_id = public.normalize_comuna_id(o.comuna),
       comuna = COALESCE(
         (SELECT nombre FROM public.chile_comunas WHERE id = public.normalize_comuna_id(o.comuna)),
         o.comuna
       )
 WHERE o.comuna IS NOT NULL
   AND o.comuna_id IS NULL;

-- 14. Grants
GRANT SELECT ON public.chile_comunas TO authenticated, anon;
GRANT SELECT ON public.chile_comuna_aliases TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_comuna_id(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.map_comuna_alias(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unmatched_comunas(UUID) TO authenticated;
```

- [ ] **Step 4: Apply migration locally**

```bash
cd packages/database && npx supabase db push
```

Expected: `Applying migration 20260321000001_chile_comunas_normalization.sql... Finished supabase db push.`

- [ ] **Step 5: Verify backfill and check unmatched communes**

```bash
cd packages/database && npx supabase db remote query --sql \
  "SELECT comuna_raw, COUNT(*) as n FROM orders WHERE comuna_id IS NULL AND comuna_raw IS NOT NULL GROUP BY comuna_raw ORDER BY n DESC LIMIT 20"
```

Expected: a list of raw values that didn't match any alias. Note these — they'll be handled by the `UnmatchedComunasPanel` in N.4.

- [ ] **Step 6: Update `apps/frontend/src/lib/types.ts`**

Add to the `Tables` interface:

```typescript
chile_comunas: {
  Row: {
    id: string;
    codigo_cut: string;
    nombre: string;
    provincia: string;
    region: string;
    region_num: number;
    geometry: string | null;
  };
  Insert: {
    id?: string;
    codigo_cut: string;
    nombre: string;
    provincia: string;
    region: string;
    region_num: number;
    geometry?: string | null;
  };
  Update: {
    id?: string;
    codigo_cut?: string;
    nombre?: string;
    provincia?: string;
    region?: string;
    region_num?: number;
    geometry?: string | null;
  };
};
chile_comuna_aliases: {
  Row: {
    id: string;
    alias: string;
    comuna_id: string;
    source: string;
    created_at: string;
  };
  Insert: {
    id?: string;
    alias: string;
    comuna_id: string;
    source?: string;
    created_at?: string;
  };
  Update: {
    id?: string;
    alias?: string;
    comuna_id?: string;
    source?: string;
    created_at?: string;
  };
};
dock_zone_comunas: {
  Row: { dock_zone_id: string; comuna_id: string };
  Insert: { dock_zone_id: string; comuna_id: string };
  Update: { dock_zone_id?: string; comuna_id?: string };
};
```

In `orders` Row/Insert/Update add `comuna_id: string | null` and `comuna_raw: string | null` (with `?` on Insert/Update).

In `dock_zones` Row/Insert/Update, **remove** the `comunas` field entirely.

- [ ] **Step 7: Run all tests to confirm nothing broken**

```bash
cd apps/frontend && npx vitest run --reporter=verbose
```

Expected: all existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/database/supabase/migrations/20260321000001_chile_comunas_normalization.sql \
        apps/frontend/src/__tests__/comunas-normalization.test.ts \
        apps/frontend/src/lib/types.ts
git commit -m "feat(N.0): add chile_comunas normalization migration, trigger, aliases + types"
```

---

### Task N.1: Sectorization Engine Update

**Files:**
- Modify: `apps/frontend/src/lib/distribution/sectorization-engine.ts`
- Modify: `apps/frontend/src/lib/distribution/sectorization-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `sectorization-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { determineDockZone, type DockZone, type PackageOrder } from './sectorization-engine';

const TODAY    = '2026-03-21';
const TOMORROW = '2026-03-22';
const FUTURE   = '2026-03-30';

const LC_ID   = 'comuna-las-condes';
const PROV_ID = 'comuna-providencia';
const NUN_ID  = 'comuna-nunoa';
const VIT_ID  = 'comuna-vitacura';

const zones: DockZone[] = [
  {
    id: 'zone-1', name: 'Andén 1', code: 'DOCK-001',
    is_consolidation: false, is_active: true,
    comunas: [{ id: LC_ID, nombre: 'Las Condes' }, { id: VIT_ID, nombre: 'Vitacura' }],
  },
  {
    id: 'zone-2', name: 'Andén 2', code: 'DOCK-002',
    is_consolidation: false, is_active: true,
    comunas: [{ id: PROV_ID, nombre: 'Providencia' }, { id: NUN_ID, nombre: 'Ñuñoa' }],
  },
  {
    id: 'consol', name: 'Consolidación', code: 'CONSOL',
    is_consolidation: true, is_active: true, comunas: [],
  },
];

describe('determineDockZone (ID-based)', () => {
  it('routes package to matching andén when comunaId matches', () => {
    const pkg: PackageOrder = { comunaId: LC_ID, delivery_date: TODAY };
    expect(determineDockZone(pkg, zones, TODAY)).toMatchObject({ zone_id: 'zone-1', reason: 'matched' });
  });

  it('routes to matching andén when delivery is tomorrow', () => {
    const pkg: PackageOrder = { comunaId: PROV_ID, delivery_date: TOMORROW };
    expect(determineDockZone(pkg, zones, TODAY)).toMatchObject({ zone_id: 'zone-2', reason: 'matched' });
  });

  it('routes to consolidation when delivery date is future', () => {
    const pkg: PackageOrder = { comunaId: LC_ID, delivery_date: FUTURE };
    expect(determineDockZone(pkg, zones, TODAY)).toMatchObject({ zone_id: 'consol', reason: 'future_date' });
  });

  it('routes to consolidation with flagged=true when comunaId not in any zone', () => {
    const pkg: PackageOrder = { comunaId: 'unknown-id', delivery_date: TODAY };
    const r = determineDockZone(pkg, zones, TODAY);
    expect(r).toMatchObject({ zone_id: 'consol', reason: 'unmapped', flagged: true });
  });

  it('routes to consolidation with flagged=false when comunaId is null', () => {
    const pkg: PackageOrder = { comunaId: null, delivery_date: TODAY };
    const r = determineDockZone(pkg, zones, TODAY);
    expect(r).toMatchObject({ zone_id: 'consol', reason: 'unmapped', flagged: false });
  });

  it('skips inactive zones', () => {
    const inactive = zones.map(z => z.id === 'zone-1' ? { ...z, is_active: false } : z);
    const pkg: PackageOrder = { comunaId: LC_ID, delivery_date: TODAY };
    expect(determineDockZone(pkg, inactive, TODAY)).toMatchObject({ zone_id: 'consol', reason: 'unmapped' });
  });

  it('throws when no consolidation zone configured', () => {
    const noConsol = zones.filter(z => !z.is_consolidation);
    expect(() => determineDockZone({ comunaId: LC_ID, delivery_date: TODAY }, noConsol, TODAY))
      .toThrow('No consolidation zone');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/lib/distribution/sectorization-engine.test.ts
```

Expected: FAIL — `PackageOrder` has no `comunaId`, `DockZone.comunas` is `string[]`.

- [ ] **Step 3: Rewrite the sectorization engine**

Replace `sectorization-engine.ts`:

```typescript
export interface DockZone {
  id: string;
  name: string;
  code: string;
  is_consolidation: boolean;
  comunas: { id: string; nombre: string }[];
  is_active: boolean;
}

export interface PackageOrder {
  comunaId: string | null;
  delivery_date: string; // YYYY-MM-DD
}

export type ZoneMatchReason = 'matched' | 'future_date' | 'unmapped';

export interface ZoneMatchResult {
  zone_id: string;
  zone_name: string;
  zone_code: string;
  is_consolidation: boolean;
  reason: ZoneMatchReason;
  flagged: boolean;
}

function isDeliveryDateActive(deliveryDate: string, today: string): boolean {
  const delivery = new Date(deliveryDate + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return delivery <= tomorrow;
}

export function determineDockZone(
  pkg: PackageOrder,
  zones: DockZone[],
  today: string
): ZoneMatchResult {
  const consolidation = zones.find(z => z.is_consolidation);
  if (!consolidation) {
    throw new Error('No consolidation zone configured');
  }

  const makeResult = (zone: DockZone, reason: ZoneMatchReason, flagged = false): ZoneMatchResult => ({
    zone_id: zone.id,
    zone_name: zone.name,
    zone_code: zone.code,
    is_consolidation: zone.is_consolidation,
    reason,
    flagged,
  });

  if (!isDeliveryDateActive(pkg.delivery_date, today)) {
    return makeResult(consolidation, 'future_date');
  }

  if (pkg.comunaId) {
    const matchingZone = zones.find(
      z => !z.is_consolidation && z.is_active && z.comunas.some(c => c.id === pkg.comunaId)
    );
    if (matchingZone) {
      return makeResult(matchingZone, 'matched');
    }
  }

  // flagged=true when comunaId was provided but no zone matched (known commune, unassigned andén)
  // flagged=false when comunaId is null (trigger left commune unmatched entirely)
  return makeResult(consolidation, 'unmapped', pkg.comunaId !== null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/lib/distribution/sectorization-engine.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/distribution/sectorization-engine.ts \
        apps/frontend/src/lib/distribution/sectorization-engine.test.ts
git commit -m "feat(N.1): rewrite sectorization engine to ID-based commune matching"
```

---

### Task N.2: `useChileComunas` Hook + `useDockZones` Update

**Files:**
- Create: `apps/frontend/src/hooks/distribution/useChileComunas.ts`
- Create: `apps/frontend/src/hooks/distribution/useChileComunas.test.ts`
- Modify: `apps/frontend/src/hooks/distribution/useDockZones.ts`
- Modify: `apps/frontend/src/hooks/distribution/useDockZones.test.ts`

- [ ] **Step 1: Write failing test for `useChileComunas`**

Create `apps/frontend/src/hooks/distribution/useChileComunas.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useChileComunas } from './useChileComunas';

let mockResult: { data: unknown; error: unknown } = { data: [], error: null };
let mockFromFn: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFromFn })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResult = { data: [], error: null };
  mockFromFn = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue(mockResult),
    }),
  });
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useChileComunas', () => {
  it('returns empty array when table is empty', async () => {
    const { result } = renderHook(() => useChileComunas(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns communes with id, nombre, region, region_num', async () => {
    mockResult = {
      data: [
        { id: 'c1', nombre: 'Las Condes', region: 'Metropolitana de Santiago', region_num: 13 },
        { id: 'c2', nombre: 'Providencia', region: 'Metropolitana de Santiago', region_num: 13 },
      ],
      error: null,
    };
    const { result } = renderHook(() => useChileComunas(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0]).toMatchObject({ id: 'c1', nombre: 'Las Condes' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/hooks/distribution/useChileComunas.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useChileComunas`**

Create `apps/frontend/src/hooks/distribution/useChileComunas.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ChileComunaRecord {
  id: string;
  nombre: string;
  region: string;
  region_num: number;
}

export function useChileComunas() {
  return useQuery({
    queryKey: ['chile-comunas'],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('chile_comunas')
        .select('id, nombre, region, region_num')
        .order('nombre');
      if (error) throw error;
      return data as ChileComunaRecord[];
    },
    staleTime: Infinity,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/hooks/distribution/useChileComunas.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Write failing tests for `useDockZones`**

Update `apps/frontend/src/hooks/distribution/useDockZones.test.ts` with the junction table data shape:

```typescript
// In the 'returns zones sorted' test, update mock data to junction table format:
{
  id: 'z1', name: 'Las Condes', code: 'LC',
  is_consolidation: false, is_active: true, operator_id: 'op1',
  dock_zone_comunas: [{ chile_comunas: { id: 'c1', nombre: 'Las Condes' } }],
}
// Assert flattened shape:
expect(result.current.data![0].comunas).toEqual([{ id: 'c1', nombre: 'Las Condes' }]);

// Add test: useEnsureConsolidationZone INSERT does NOT include comunas column
it('useEnsureConsolidationZone inserts without comunas column', async () => {
  const { result } = renderHook(() => useEnsureConsolidationZone('op1'), { wrapper });
  await act(async () => { result.current.mutate(); });
  const insertCall = mockInsertFn.mock.calls[0][0];
  expect(insertCall).not.toHaveProperty('comunas');
});
```

- [ ] **Step 5b: Run test to verify it fails**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/hooks/distribution/useDockZones.test.ts
```

Expected: FAIL — `comunas` is `string[]`, not `{ id, nombre }[]`; insert has `comunas: []`.

- [ ] **Step 6: Implement `useDockZones.ts` — junction table fetch + two-step mutations**

Replace `useDockZones.ts` with full implementation. Key changes:

```typescript
export interface DockZoneRecord {
  id: string;
  name: string;
  code: string;
  is_consolidation: boolean;
  comunas: { id: string; nombre: string }[];  // was: string[]
  is_active: boolean;
  operator_id: string;
}

// useDockZones: select with junction join, flatten to DockZoneRecord
const { data, error } = await supabase
  .from('dock_zones')
  .select(`id, name, code, is_consolidation, is_active, operator_id,
           dock_zone_comunas(chile_comunas(id, nombre))`)
  .eq('operator_id', operatorId)
  .is('deleted_at', null)
  .order('name');
return data!.map(z => ({
  id: z.id, name: z.name, code: z.code,
  is_consolidation: z.is_consolidation, is_active: z.is_active,
  operator_id: z.operator_id,
  comunas: (z.dock_zone_comunas ?? []).map((r: any) => r.chile_comunas),
}));

// useUpdateDockZone — two-step mutation: delete all then insert new set
mutationFn: async ({ id, updates, comunaIds }: { id: string; updates: Partial<DockZoneRecord>; comunaIds?: string[] }) => {
  const supabase = createSPAClient();
  const { error } = await supabase
    .from('dock_zones')
    .update(updates)
    .eq('id', id)
    .eq('operator_id', operatorId!);
  if (error) throw error;
  if (comunaIds !== undefined) {
    const { error: delError } = await supabase
      .from('dock_zone_comunas')
      .delete()
      .eq('dock_zone_id', id);
    if (delError) throw delError;
    if (comunaIds.length > 0) {
      const { error: insError } = await supabase
        .from('dock_zone_comunas')
        .insert(comunaIds.map(cid => ({ dock_zone_id: id, comuna_id: cid })));
      if (insError) throw insError;
    }
  }
},

// useEnsureConsolidationZone — INSERT without comunas (column dropped):
const { error } = await supabase
  .from('dock_zones')
  .insert({
    operator_id: operatorId,
    name: 'Consolidación',
    code: 'CON',
    is_consolidation: true,
    is_active: true,
    // No comunas: [] — column removed; communes via dock_zone_comunas junction table
  });
```

- [ ] **Step 7: Run all hooks tests**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/hooks/distribution/
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/hooks/distribution/useChileComunas.ts         apps/frontend/src/hooks/distribution/useChileComunas.test.ts         apps/frontend/src/hooks/distribution/useDockZones.ts         apps/frontend/src/hooks/distribution/useDockZones.test.ts
git commit -m "feat(N.2): useChileComunas hook + useDockZones ID-based junction table"
```

---

### Task N.3: `DockZoneForm` Combobox

**Files:**
- Modify: `apps/frontend/src/components/distribution/DockZoneForm.tsx`
- Modify: `apps/frontend/src/components/distribution/DockZoneForm.test.tsx`
- Modify: `apps/frontend/src/components/distribution/DockZoneList.tsx`
- Modify: `apps/frontend/src/components/distribution/BatchScanner.tsx` (if `pkg.comuna` string reference found)
- Modify: `apps/frontend/src/components/distribution/QuickSortScanner.tsx` (if `pkg.comuna` string reference found)

- [ ] **Step 1: Write failing tests**

Replace `DockZoneForm.test.tsx` — key tests:
1. Textarea with "comunas (una por línea)" label NOT rendered
2. `getByPlaceholderText(/buscar comuna/i)` IS rendered
3. Selecting a commune adds a chip showing its name
4. Submit calls create mutation with `comunaIds: string[]` (not `comunas: string[]`)
5. Edit mode pre-populates selected communes from `editingZone.comunas[].id`

```typescript
vi.mock('@/hooks/distribution/useChileComunas', () => ({
  useChileComunas: vi.fn(() => ({
    data: [
      { id: 'c1', nombre: 'Las Condes',  region: 'RM', region_num: 13 },
      { id: 'c2', nombre: 'Providencia', region: 'RM', region_num: 13 },
    ],
    isLoading: false,
  })),
}));
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/components/distribution/DockZoneForm.test.tsx
```

Expected: failures on combobox assertions and `comunaIds` mutation shape.

- [ ] **Step 3: Implement combobox in `DockZoneForm.tsx`**

Replace the `<Textarea>` with a shadcn `Command`-based multi-select:
- `CommandInput` with `placeholder="Buscar comuna..."`
- `CommandItem` per commune, toggling selection on click
- Selected communes shown as `<Badge>` chips with X buttons
- Form submits `comunaIds: selectedIds` instead of `comunas: string[]`

Import `Badge` from `@/components/ui/badge` and `Command*` from `@/components/ui/command`.

- [ ] **Step 4: Update `DockZoneList.tsx` for new commune shape**

Find where communes are displayed (likely `zone.comunas.join(', ')`) and change to `zone.comunas.map(c => c.nombre).join(', ')`. Read the file to find the exact line.

- [ ] **Step 5: Search for remaining callers of old string-array interface**

```bash
cd apps/frontend && grep -rn "pkg\.comuna\b\|\.comunas\.join\|comunas: \[" src/ --include="*.ts" --include="*.tsx"
```

Fix any callers found (scanner components that build `PackageOrder` need to pass `comunaId` instead of `comuna`). Check `BatchScanner.tsx` and `QuickSortScanner.tsx`.

- [ ] **Step 6: Run component tests**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/components/distribution/
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/distribution/DockZoneForm.tsx \
        apps/frontend/src/components/distribution/DockZoneForm.test.tsx \
        apps/frontend/src/components/distribution/DockZoneList.tsx \
        apps/frontend/src/components/distribution/BatchScanner.tsx \
        apps/frontend/src/components/distribution/QuickSortScanner.tsx
git commit -m "feat(N.3): replace DockZoneForm textarea with Command combobox for ID-based commune selection"
```

---

### Task N.4: `UnmatchedComunasPanel`

**Files:**
- Create: `apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts`
- Create: `apps/frontend/src/hooks/distribution/useUnmatchedComunas.test.ts`
- Create: `apps/frontend/src/components/distribution/UnmatchedComunasPanel.tsx`
- Create: `apps/frontend/src/components/distribution/UnmatchedComunasPanel.test.tsx`
- Modify: `apps/frontend/src/app/app/distribution/settings/page.tsx`

- [ ] **Step 1: Write failing test for `useUnmatchedComunas`**

Create `apps/frontend/src/hooks/distribution/useUnmatchedComunas.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUnmatchedComunas } from './useUnmatchedComunas';

let mockRpcResult: { data: unknown; error: unknown } = { data: [], error: null };
let mockSupabase: { rpc: ReturnType<typeof vi.fn> };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRpcResult = { data: [], error: null };
  mockSupabase = { rpc: vi.fn().mockResolvedValue(mockRpcResult) };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useUnmatchedComunas', () => {
  it('returns empty array when all communes matched', async () => {
    const { result } = renderHook(() => useUnmatchedComunas('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns unmatched communes with order count', async () => {
    mockRpcResult = {
      data: [
        { comuna_raw: 'San miguel', order_count: 12 },
        { comuna_raw: 'LA REINA',   order_count: 3  },
      ],
      error: null,
    };
    const { result } = renderHook(() => useUnmatchedComunas('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0]).toMatchObject({ comuna_raw: 'San miguel', order_count: 12 });
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useUnmatchedComunas(null), { wrapper });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/hooks/distribution/useUnmatchedComunas.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useUnmatchedComunas`**

Create `apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface UnmatchedComunaRow {
  comuna_raw: string;
  order_count: number;
}

export function useUnmatchedComunas(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'unmatched-comunas', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('get_unmatched_comunas', {
        p_operator_id: operatorId!,
      });
      if (error) throw error;
      return (data ?? []) as UnmatchedComunaRow[];
    },
    enabled: !!operatorId,
    staleTime: 60_000,
  });
}

export function useMapComunaAlias(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { alias: string; comunaId: string }) => {
      const supabase = createSPAClient();
      const { error } = await supabase.rpc('map_comuna_alias', {
        p_alias: input.alias,
        p_comuna_id: input.comunaId,
        p_source: 'manual',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'unmatched-comunas', operatorId] });
      queryClient.invalidateQueries({ queryKey: ['distribution', 'dock-zones', operatorId] });
    },
  });
}
```

- [ ] **Step 4: Run hook test to verify it passes**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/hooks/distribution/useUnmatchedComunas.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Write failing component test**

Create `apps/frontend/src/components/distribution/UnmatchedComunasPanel.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UnmatchedComunasPanel } from './UnmatchedComunasPanel';

const mockMapMutate = vi.fn();

vi.mock('@/hooks/distribution/useUnmatchedComunas', () => ({
  useUnmatchedComunas: vi.fn(() => ({
    data: [
      { comuna_raw: 'San miguel', order_count: 12 },
      { comuna_raw: 'LA REINA',   order_count: 3  },
    ],
    isLoading: false,
  })),
  useMapComunaAlias: vi.fn(() => ({ mutate: mockMapMutate, isPending: false })),
}));

vi.mock('@/hooks/distribution/useChileComunas', () => ({
  useChileComunas: vi.fn(() => ({
    data: [
      { id: 'c-sm', nombre: 'San Miguel', region: 'RM', region_num: 13 },
      { id: 'c-lr', nombre: 'La Reina',   region: 'RM', region_num: 13 },
    ],
    isLoading: false,
  })),
}));

describe('UnmatchedComunasPanel', () => {
  it('renders unmatched communes with order counts', () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    expect(screen.getByText('San miguel')).toBeInTheDocument();
    expect(screen.getByText('LA REINA')).toBeInTheDocument();
  });

  it('renders a Mapear button for each unmatched row', () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    expect(screen.getAllByRole('button', { name: /mapear/i })).toHaveLength(2);
  });

  it('opens dialog with commune combobox when Mapear is clicked', async () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: /mapear/i })[0]);
    expect(await screen.findByPlaceholderText(/buscar/i)).toBeInTheDocument();
  });

  it('calls map mutation on confirm', async () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: /mapear/i })[0]);
    fireEvent.click(await screen.findByText('San Miguel'));
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => {
      expect(mockMapMutate).toHaveBeenCalledWith(
        { alias: 'San miguel', comunaId: 'c-sm' },
        expect.anything()
      );
    });
  });

  it('renders nothing when no unmatched communes', () => {
    const mod = vi.mocked(require('@/hooks/distribution/useUnmatchedComunas'));
    mod.useUnmatchedComunas.mockReturnValueOnce({ data: [], isLoading: false });
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    expect(screen.queryByRole('button', { name: /mapear/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/components/distribution/UnmatchedComunasPanel.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement `UnmatchedComunasPanel`**

Create `apps/frontend/src/components/distribution/UnmatchedComunasPanel.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Command, CommandInput, CommandList,
  CommandGroup, CommandItem, CommandEmpty,
} from '@/components/ui/command';
import { useUnmatchedComunas, useMapComunaAlias } from '@/hooks/distribution/useUnmatchedComunas';
import { useChileComunas } from '@/hooks/distribution/useChileComunas';

interface UnmatchedComunasPanelProps {
  operatorId: string;
}

export function UnmatchedComunasPanel({ operatorId }: UnmatchedComunasPanelProps) {
  const { data: unmatched = [], isLoading } = useUnmatchedComunas(operatorId);
  const { data: allComunas = [] } = useChileComunas();
  const mapAlias = useMapComunaAlias(operatorId);

  const [dialogOpen, setDialogOpen]             = useState(false);
  const [selectedRaw, setSelectedRaw]           = useState<string | null>(null);
  const [selectedComunaId, setSelectedComunaId] = useState<string | null>(null);

  if (isLoading || unmatched.length === 0) return null;

  const handleMapear = (raw: string) => {
    setSelectedRaw(raw);
    setSelectedComunaId(null);
    setDialogOpen(true);
  };

  const handleConfirm = () => {
    if (!selectedRaw || !selectedComunaId) return;
    mapAlias.mutate(
      { alias: selectedRaw, comunaId: selectedComunaId },
      { onSuccess: () => setDialogOpen(false) }
    );
  };

  return (
    <div className="mt-8">
      <h2 className="text-base font-semibold mb-1">Comunas sin mapear</h2>
      <p className="text-sm text-muted-foreground mb-3">
        Estos valores no se reconocieron como comunas chilenas. Mapéalas para que la sectorización automática funcione correctamente.
      </p>
      <div className="border rounded-md divide-y">
        {unmatched.map(row => (
          <div key={row.comuna_raw} className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">{row.comuna_raw}</span>
              <Badge variant="secondary">{row.order_count} órdenes</Badge>
            </div>
            <Button size="sm" variant="outline" onClick={() => handleMapear(row.comuna_raw)}>
              Mapear
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mapear &ldquo;{selectedRaw}&rdquo;</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Buscar..." />
            <CommandList className="max-h-60">
              <CommandEmpty>No encontrado.</CommandEmpty>
              <CommandGroup>
                {allComunas.map(c => (
                  <CommandItem
                    key={c.id}
                    value={c.nombre}
                    onSelect={() => setSelectedComunaId(c.id)}
                    className={selectedComunaId === c.id ? 'bg-accent' : ''}
                  >
                    {c.nombre}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <DialogFooter>
            <Button
              onClick={handleConfirm}
              disabled={!selectedComunaId || mapAlias.isPending}
            >
              {mapAlias.isPending ? 'Guardando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 8: Add `UnmatchedComunasPanel` to settings page**

Edit `apps/frontend/src/app/app/distribution/settings/page.tsx`:

Add import:
```typescript
import { UnmatchedComunasPanel } from '@/components/distribution/UnmatchedComunasPanel';
```

After the closing `</Dialog>` tag, add:
```typescript
{operatorId && <UnmatchedComunasPanel operatorId={operatorId} />}
```

- [ ] **Step 9: Run component tests**

```bash
cd apps/frontend && npx vitest run --reporter=verbose src/components/distribution/UnmatchedComunasPanel.test.tsx
```

Expected: all PASS.

- [ ] **Step 10: Run full test suite**

```bash
cd apps/frontend && npx vitest run --reporter=verbose 2>&1 | tail -5
```

Expected: all tests PASS. Note final count.

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts \
        apps/frontend/src/hooks/distribution/useUnmatchedComunas.test.ts \
        apps/frontend/src/components/distribution/UnmatchedComunasPanel.tsx \
        apps/frontend/src/components/distribution/UnmatchedComunasPanel.test.tsx \
        apps/frontend/src/app/app/distribution/settings/page.tsx
git commit -m "feat(N.4): UnmatchedComunasPanel — manual alias mapping for unrecognized communes"
```

---

### Final Step: Push + PR

- [ ] **Push branch and create PR with auto-merge**

```bash
git push -u origin feat/spec-14-chile-comunas
gh pr create --title "feat(spec-14): Chile comunas normalization" --body "$(cat <<'EOF'
## Summary
- Adds `chile_comunas` (346 communes, CUT codes) + `chile_comuna_aliases` reference tables with PostGIS geometry column for future polygon routing
- DB trigger on `orders` normalizes free-text commune on every INSERT/UPDATE — transparent to connectors
- Replaces `dock_zones.comunas TEXT[]` with `dock_zone_comunas` junction table (proper FK + RLS)
- Sectorization engine now matches by `comunaId` (UUID) instead of string normalization — no more silent fuzzy-match failures
- `DockZoneForm` gets a searchable multi-select combobox (Command) replacing the free-text textarea
- New `UnmatchedComunasPanel` in settings for operators to map unrecognized raw commune values

## Test plan
- [ ] Migration applies cleanly via CI (`supabase db push`)
- [ ] Backfill: `get_unmatched_comunas` returns manageable list, operator maps remaining via UI
- [ ] All Vitest tests pass
- [ ] CI green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```
