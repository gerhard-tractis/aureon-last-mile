# Spec-58: Geocoding Foundation — turning delivery addresses into coordinates

> **Related:** [spec-59](spec-59-map-component-despacho-pins.md) (map component + Despacho pins — depends on this), [spec-60](spec-60-control-tower-fleet-map.md) (Control Tower fleet map), [spec-38](spec-38-route-activity-view.md) (created the map placeholder), [spec-54](spec-54-ui-rebrand.md) (tokenised the map surface, deferred the provider)

**Status:** backlog

_Date: 2026-08-17_

> **Note on a stale forward-reference:** `spec-38:24-25` defers "Leaflet map integration" and "Geocoding" to *spec-39*. That number was subsequently used by `spec-39-distribution-pending-list.md`. This spec and spec-59 are the real successors; spec-38's pointer is stale and should be read as "a later spec".

---

## Goal

Give every order a latitude and longitude, so that a map can be drawn at all. No UI ships in this spec.

## The problem

Ops asked to see orders pinned on a map in Despacho and trucks on a map in the Torre de Control. Neither is a rendering problem — it is a data problem.

`public.orders` stores exactly one piece of location information: `delivery_address TEXT NOT NULL` (`20260217000003_create_orders_table.sql:56`), plus `comuna` / `comuna_id`. There are **no populated coordinate columns and no geocoder anywhere in the repo**:

- `orders.destination_address JSONB` (`20260318000004_agent_suite_tables.sql:167`, commented at `:168`) is documented as "Parsed from delivery_address text". Nothing parses it. Nothing writes it.
- `orders.agent_metadata JSONB` documents `geocoded_at` and `geocode_confidence` keys. Neither is ever set.
- `drivers.last_location JSONB` and `assignments.pickup_location` / `delivery_location` JSONB (`20260318000004:251, 270, 381-382`) are likewise scaffolding that nothing writes.
- `spec-10k-intake-expansion.md:46-49` describes a `geocode_address` tool at `apps/agents/src/tools/supabase/geocoding.ts`. That file does not exist.
- `spec-33-admin-maintainer.md:117` records that `lat`/`lng` were left out of the pickup-point form as "a future enhancement".

The only **populated** coordinates are `dispatches.latitude` / `longitude`, and they are not a delivery destination — see the next section. Nothing downstream can use them as one, including the OR-Tools solver at `sidecar/or-tools/`, which consumes bare `lat` / `lng` floats per order and per driver.

## What DispatchTrack's coordinates actually are — and why they cannot help here

An earlier draft of this spec proposed harvesting destination coordinates from DispatchTrack for free. **That was wrong, and it is recorded here so it is not re-proposed.**

`scripts/dt-api-docs.md` uses the same field name with two different meanings:

- **Create Route / Update Route request** (`:313`, `:1516`): `dispatches.latitude` — "Latitude where the dispatch **is directed**". A destination — but this is a field *we would send to DT*, not one we receive.
- **Show Route / List Routes response** (`:1208`, `:889`): `dispatches.latitude` — "Latitude where the dispatch **was deliverred**". A delivery position, semantically the same thing as `management_latitude`.

So DT never returns a destination coordinate to us. Every geocode in this spec has to be paid for.

Three writers touch `dispatches.latitude` / `longitude` today, and they do not agree:

| Writer | Source field | Meaning |
|---|---|---|
| `beetrack-webhook/index.ts:264-265` | `management_latitude` | Where the courier stood at management |
| `dispatchtrack-route-poll/index.ts:140-141` | `management_latitude` | Same — but see below |
| `scripts/backfill-dispatches.mjs:188-189` | top-level `d.latitude` | "Where the dispatch was delivered" |

The two are near-identical in practice, but the poll is suspect: the Show Route response documents `identifier` and a **string** `status`, while the poll reads `d.dispatch_id` and a **numeric** `d.status`, `continue`-ing when either is absent (`index.ts:121`, `:125`). If the documented shape is accurate, the poll's dispatch loop never reaches line 140 and its coordinate write is dead code. The counter-evidence, so spec-60 need not rediscover it: `index.ts:116` carries the comment "NOTE: REST API returns dispatches in same shape as webhook payload" — its author believed `dispatch_id` and a numeric status are what actually arrive. One of the two is wrong; only production data settles it. It is out of scope to fix here, but spec-60 depends on these columns and must verify it.

**This spec does not add `dest_latitude` / `dest_longitude` to `dispatches`, and does not modify either edge function.**

## Decisions

1. **Provider: MapTiler**, behind an interface. One vendor and one key for both geocoding (this spec) and tiles (spec-59). Google's geocoding is likely more accurate on Chilean street addresses, but its terms restrict persisting coordinates long-term and we intend to store lat/lng permanently on `orders`. The interface exists so swapping to Google, LocationIQ or Nominatim is a single adapter file.
2. **First-class columns, not JSONB.** Coordinates go on `orders` as real columns. `destination_address` / `agent_metadata` stay untouched — they are already unwritten scaffolding and adding a second unwritten shape helps no one.
3. **Cache aggressively, at street granularity.** Chilean last-mile has heavy address repetition. The cache key deliberately **excludes** the unit (departamento / oficina / piso): a street-level geocoder returns one point for all 40 flats in a building, so keying on the unit would turn one paid lookup into forty. The unit stays on the order; it is simply not part of the geocoding key.
4. **Never permanently fail an order, and never permanently freeze a bad answer.** An unresolved address falls back to its comuna centroid marked `approximate`, but a centroid is a *retryable* state, not a terminal one — see Job state machine. An order with an honest, visibly-approximate pin is actionable; an order silently frozen at a centroid because the provider was down for twenty minutes is a lie.
5. **Measure before backfilling, not after.** The accuracy gate runs on a sample **before** any bulk write. Once the whole order history is geocoded and cached, "swapping the adapter is cheap" stops being true.

## Non-Goals

- Any map rendering, component, or screen change — that is spec-59.
- Truck positions — that is spec-60.
- Polygon geometry for comunas. `chile_comunas.geometry` stays NULL; this spec seeds centroid lat/lng only. Zone drawing and point-in-polygon are out of scope, and PostGIS spatial indexing is not needed for a per-order pin.
- Wiring the OR-Tools solver. This spec unblocks it; it does not do it.
- Geocoding `pickup_points`. The same mechanism will apply later.
- Manual coordinate correction by an operator. Consequently `geocode_source` does **not** enumerate a `'manual'` value — when a correction UI is specified, that spec adds it.
- Reverse geocoding.

## Data model

### Changed: `public.orders`

```sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_source TEXT;      -- 'maptiler' | 'comuna_centroid'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_precision TEXT;   -- 'exact' | 'approximate'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_status TEXT NOT NULL DEFAULT 'pending';
                                                  -- 'pending' | 'resolved' | 'fallback' | 'unresolvable'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_last_attempt_at TIMESTAMPTZ;  -- stamped on every attempt, for the per-run log
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_next_attempt_at TIMESTAMPTZ;
```

`geocode_next_attempt_at` is what makes "retry with backoff" real rather than aspirational. Without a time column the claim query has no way to space attempts, and a `*/10` cron would burn all five attempts in fifty minutes — turning a one-hour provider outage into a permanent centroid for that day's orders, which is the exact failure Decision 4 exists to prevent.

`DECIMAL(10,7)` matches the precision already used on `dispatches` (`20260306000001_add_routes_dispatches_fleet_tables.sql:124-125`).

Constraints:

- `geocode_precision IN ('exact','approximate')`, `geocode_status IN ('pending','resolved','fallback','unresolvable')`.
- `latitude` and `longitude` are either both NULL or both set.
- Range check: `latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180`, and a Chile sanity check rejecting `(0,0)` — a provider bug writing null-island or a swapped pair must not reach the map.

Work-queue index, leading on the due-time column so the claim query's predicate and ordering both use it:

```sql
CREATE INDEX IF NOT EXISTS idx_orders_geocode_queue
  ON public.orders (geocode_next_attempt_at NULLS FIRST, created_at)
  WHERE geocode_status IN ('pending','fallback') AND deleted_at IS NULL;
```

Postgres defaults ASC to `NULLS LAST`, so the `ORDER BY` in the job must be written `geocode_next_attempt_at NULLS FIRST, created_at` verbatim or the index will not be used. Untried orders have a NULL due-time and therefore sort first.

**The batch query has no `operator_id` predicate**, which is a deliberate deviation from the `operator_id`-on-every-query non-negotiable and needs stating rather than implying. This is a service-role maintenance job with no tenant context: it runs on a cron, not on behalf of a user, and scoping it per operator would mean either a tenant list in the worker or one cron per tenant. The consequence to accept: one operator bulk-importing 50k orders monopolises every batch until it drains. If that becomes real, the fix is round-robin by `operator_id` within the batch, not a per-tenant job.

No RLS change: `orders` policies already scope by `operator_id`, and these are ordinary columns on existing rows.

### Re-geocoding on address change

`orders.delivery_address` is editable, and nothing today would notice. A trigger resets the geocode state:

```sql
CREATE TRIGGER orders_zz_geocode_reset
  BEFORE UPDATE OF delivery_address, comuna ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_geocode_reset();
```

```
NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
  OR NEW.comuna_id IS DISTINCT FROM OLD.comuna_id
    → latitude, longitude, geocoded_at, geocode_source, geocode_precision := NULL
    → geocode_status := 'pending', geocode_attempts := 0, geocode_next_attempt_at := NULL
```

**Trigger name ordering is a hard requirement, not cosmetics.** Postgres fires same-event BEFORE triggers in **alphabetical name order**, and the existing `orders_normalize_comuna_trigger` is declared `BEFORE INSERT OR UPDATE OF comuna` (`20260321000001:521-525`). That function both derives `NEW.comuna_id` *and* rewrites `NEW.comuna := v_name` (`:515`), so neither column is safe to compare before it runs:

- Compare `comuna_id` too early → it is not yet written, and the reset silently no-ops.
- Compare raw `comuna` too late → it has already been canonicalised and equals `OLD.comuna` for any case or accent variant, and the reset silently no-ops.

The `zz` prefix forces this trigger to sort **after** the normalisation trigger, at which point `comuna_id` is populated and is the right thing to compare. Any future rename must preserve that ordering; a comment in the migration says so.

Note also that `UPDATE OF` fires on column *mention*, not on value change — hence the `IS DISTINCT FROM` guards inside the function rather than relying on the trigger clause alone.

Without this, an edited address silently keeps the pin of the address it replaced — which is worse than having no pin, because it looks correct.

### New: `public.geocode_cache`

```sql
CREATE TABLE IF NOT EXISTS public.geocode_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address_hash TEXT NOT NULL,                 -- sha256 of the normalised street|comuna key
  normalisation_version SMALLINT NOT NULL,    -- bump when the normalisation rules change
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  geocode_source TEXT NOT NULL,
  geocode_precision TEXT NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (address_hash, normalisation_version)
);

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geocode_cache FROM anon, authenticated;
```

Column names deliberately mirror `orders.geocode_source` / `geocode_precision` rather than inventing `source` / `precision` — one concept, one name, and `precision` alone is a Postgres keyword that reads badly in joins.

**Deliberately not `operator_id`-scoped**, and this needs to be a conscious exception rather than an oversight. A street address resolves to the same point regardless of who delivers to it, and partitioning per tenant would multiply paid lookups by the number of tenants.

Being accurate about the risk: the key **is derived from customer address data**, so this is not a table of "public facts" — it is tenant-derived data in a shared table. Three mitigations, all required:

1. The key is stored **only as a sha256 hash**, never as plaintext. A cross-tenant read yields hashes and coordinates, not addresses.
2. RLS on, no client-facing policy, plus an explicit `REVOKE` — belt and braces. This repo already carries `20260729000001_fix_cross_tenant_definer_rpcs.sql`, so "a future SECURITY DEFINER RPC joins this table" is a demonstrated failure mode here, not a hypothetical.
3. The frontend must never query this table. Only the service role (the agents worker) touches it.

`normalisation_version` exists because the rules below will change. **It is a column, not an input to the hash** — the hash covers the normalised string only, and the uniqueness constraint spans both. That way two versions of one address can coexist: on a bump, the old rows stay queryable and targetable for cleanup instead of becoming unreachable dead weight.

Bumping the version is not free: every cached key misses, so the next drain re-pays for the whole address book. Treat it as a deliberate, costed operation, not a refactoring detail.

**Soft-delete exception:** this table has no `deleted_at`. It is a derived cache, rebuildable from `orders` and the provider, and carries no business record. That is a deliberate exception to the project's soft-deletes-only rule.

**Normalisation** (version 1): lowercase, strip accents, strip punctuation, collapse whitespace; `av.` / `avda.` → `avenida`, `pje.` → `pasaje`; **strip** the unit component (`depto` / `dpto` / `departamento` / `oficina` / `of.` / `piso` and its number) per Decision 3. Comuna resolution reuses `public.normalize_comuna_id(TEXT)` (`20260321000001_chile_comunas_normalization.sql:426`) rather than a second comuna matcher.

### Changed: `public.chile_comunas`

```sql
ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lat DECIMAL(10,7);
ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lng DECIMAL(10,7);
```

Seeded from **one** named source, committed as data in the migration exactly as the comuna list itself was (`20260321000001:43-407`). `geometry` remains NULL.

347 hand-committed coordinate pairs are unreproducible unless the provenance is written down, so record in the migration header: the source dataset and its version/download date, and the extraction method (for OSM comuna relations, the centroid definition used — bounding-box centre and polygon centroid differ noticeably for long coastal comunas). One source, not "INE / OSM".

The `14201 Ranco` row is not in any comuna dataset, being a provincia. Write its chosen lat/lng literal into the migration and mark it hand-picked with a comment, rather than leaving a NULL that trips the assertion below.

**Two traps in that seed data, both of which will break a naive assertion:**

- The table holds **347** rows, not the 346 its own migration comment claims. Row `('14201', 'Ranco', 'Ranco', 'Los Ríos', 14)` at `:299` is a *provincia*, not a comuna — Los Ríos has 12 comunas, and this row makes 13. Assert with `COUNT(*) FILTER (WHERE centroid_lat IS NULL) = 0`, never a hard-coded row count. Give `14201` the Provincia del Ranco centroid and leave the pre-existing data bug alone; correcting it is a separate concern with `comuna_id` foreign keys attached.
- Three seeded comunas fall outside any mainland bounding box: `05201 Isla de Pascua` (~−109.4° lng), `05104 Juan Fernández` (~−78.8° lng), `12202 Antártica` (~−75 to −80° lat). The validity check is therefore *mainland box **or** one of those three CUT codes*, not a single rectangle.

## Provider layer — `apps/agents`

The agents app already has everything this needs; no new infrastructure is stood up.

**New files**, mirroring the existing `providers/` shape (`providers/openrouter.ts`, `providers/types.ts`, `providers/circuit-breaker.ts`):

- `apps/agents/src/providers/geocoding/types.ts`

```ts
export interface GeocodeQuery { address: string; comuna: string; region?: string }

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  precision: 'exact' | 'approximate';
  source: string;
  raw?: unknown;
}

export interface GeocodingProvider {
  readonly name: string;
  geocode(q: GeocodeQuery): Promise<GeocodeResult | null>;
}
```

- `apps/agents/src/providers/geocoding/maptiler.ts` — the adapter. Country-biased to `cl`, proximity-biased to the comuna centroid. Wrapped in the existing `CircuitBreaker` so a provider outage degrades to centroid fallback instead of stalling the queue.
- `apps/agents/src/tools/supabase/geocoding.ts` — cache read/write and the `orders` update, alongside the existing `tools/supabase/orders.ts`.

### Precision mapping — resolve before implementing

The entire accuracy gate is measured off this mapping, so it cannot be left to the implementer's judgement. **Task 1 of implementation** is to call MapTiler's geocoding endpoint with three real Chilean addresses, record the response, and write the mapping table into this section: which response field carries the match granularity (candidates: `place_type`, `properties.accuracy`, `relevance`), and exactly which values count as `exact`. Only street-level or better is `exact`; locality, municipality and region are `approximate`. Do not proceed on a guess.

### Resolution order

1. `geocode_cache` hit on `(address_hash, normalisation_version)` → use it, bump `hit_count` / `last_used_at`. No network call. A cache hit is always `resolved`, because only `exact` results are ever cached.
2. MapTiler → `source='maptiler'`, precision per the mapping above. **Written to the cache only when `precision='exact'`.**
3. Comuna centroid → `source='comuna_centroid'`, `precision='approximate'`, `geocode_status='fallback'`. **Never written to the cache.**

**Only `exact` results are cached.** Caching a coarse answer would silently defeat the retry the state machine promises: step 1 would short-circuit every subsequent attempt, the row would re-read the same approximate value five times without a single network call, and it would land `unresolvable` while the spec claimed it was being retried. The same reasoning that has always excluded centroids applies to a provider's locality-level match — both are "we do not really know where this is", and neither should be frozen into the cache.

There is no DispatchTrack step; see the section above.

### Env

`MAPTILER_API_KEY` and `MAPTILER_MONTHLY_QUOTA` in `apps/agents/.env`, added to `.env.example`, and registered in `apps/agents/src/config.ts` (which validates every var at startup). Production values live in `/home/aureon/.env` (chmod 600), read via `deploy/aureon-agents.service`.

`MAPTILER_API_KEY` is **optional**: if absent, the worker boots and the job resolves everything to centroids rather than refusing to start. A geocoding key must not be able to take down the agent suite. Log loudly at startup when it is missing.

## Job state machine

New queue `geocode.enrich` — add `'geocode.enrich'` to the exported `QueueName` union at `orchestration/queues.ts:5` **and** to `QUEUE_CONFIGS` at `:20` (`Record<QueueName, QueueConfig>` will not compile otherwise), `attempts: 3, backoffDelay: 60_000`. Worker in `orchestration/workers.ts`, scheduler in `orchestration/schedulers.ts`:

```ts
{ queue: 'geocode.enrich', schedulerId: 'geocode-cron', pattern: '*/10 * * * *', jobName: 'geocode_pending' }
```

`America/Santiago` is already that file's default TZ.

Each run claims a bounded batch of 200 rows:

```sql
WHERE geocode_status IN ('pending','fallback')
  AND deleted_at IS NULL
  AND (geocode_next_attempt_at IS NULL OR geocode_next_attempt_at <= now())
ORDER BY geocode_next_attempt_at NULLS FIRST, created_at
LIMIT 200
```

| Outcome | `geocode_status` | `geocode_attempts` | Next attempt |
|---|---|---|---|
| Cache hit, or provider returned a street-level match | `resolved` | — | never |
| Provider answered at locality/region granularity → centroid | `fallback` | **+1** | `now() + 7 days` |
| Provider answered `null` — no match for this address → centroid | `fallback` | **+1** | `now() + 7 days` |
| Provider **unavailable** — circuit-breaker open, quota exhausted, 429, timeout → centroid | `fallback` | **unchanged** | `now() + 30 min` |
| 2 attempts exhausted | `unresolvable` | 2 | never |
| No `comuna_id` and no provider answer | `unresolvable` | — | never |

Two rules do the work here:

**A transport failure is not evidence about the address**, so it must not consume the attempt budget. That is what stops a provider outage of any length from marching a day's orders to `unresolvable` — it re-arms every 30 minutes indefinitely. Classify these using the error taxonomy that already exists at `apps/agents/src/providers/types.ts:36` (`'rate_limit' | 'timeout' | 'api_error' | 'network'`) rather than inventing a parallel one that can drift from this table.

**A real answer — coarse or null — is evidence, and retrying it is nearly pure spend.** A deterministic geocoder returns the same coarse answer to the same query, so an aggressive ladder would buy several paid lookups per bad address with an expected yield near zero, applied to the ~20 % of the corpus the accuracy gate already tolerates. Hence one retry at 7 days (long enough for the provider's data to have actually changed), then stop. The realistic re-query volume is therefore *(coarse + null share) × order volume ÷ 7 days*, which must be stated against `MAPTILER_MONTHLY_QUOTA` when that value is chosen — this retry policy is the single largest driver of the monthly number.

**Claiming the batch.** The select must be `FOR UPDATE SKIP LOCKED`. Without it a run that outlives its ten-minute cron window — or any BullMQ retry, and the queue is configured `attempts: 3` — re-selects the identical 200 rows and pays the provider for them twice. "Claims a batch" has to be mechanised, not asserted.

**Quota counter.** `MAPTILER_MONTHLY_QUOTA` is enforced against a Redis counter keyed by month (`geocode:quota:YYYY-MM`) with a TTL past month end, on the Redis that BullMQ already requires. It must not live in process memory: `CircuitBreaker` keeps its state in private in-process fields (`providers/circuit-breaker.ts:16-18`), and an in-memory quota counter would silently reset on every restart and every deploy while the state machine treats "quota exhausted" as a first-class outcome.

`orders.comuna_id` is nullable and `get_unmatched_comunas()` exists precisely because unmatched comunas are a live problem, so the no-comuna case is real and must terminate rather than loop forever.

**Coordinates held by an `unresolvable` row differ by path**, and spec-59 renders the two differently, so the invariant is stated rather than left to guess:

- *2 attempts exhausted* — holds the comuna centroid, `precision='approximate'`. spec-59 draws a hollow marker.
- *No `comuna_id`* — `latitude` / `longitude` stay NULL. spec-59 excludes it from the map and counts it under "sin ubicación".

**Surfacing `unresolvable`.** Manual correction is a Non-Goal, so **nothing can move a row out of this state, and `unresolvable` is genuinely terminal today.** No workflow is implied, because none exists: there is no `.from('orders').update(` anywhere in `apps/frontend/src`, and nothing outside intake writes `delivery_address`. An operator who spots a wrong pin has no in-app way to fix it.

What this spec provides is visibility, not remedy: the worker logs a per-run count of `fallback` and `unresolvable` rows, and rollout step 4 watches it. The reset trigger above is **forward-looking** — it protects re-intake of a corrected address and whatever correction UI a later spec adds; it is not a remedy available now.

A one-off backfill script under `scripts/` handles the existing order history, importing the same resolver — not a second implementation of it.

## Accuracy gate — runs before any bulk write

**Sequencing:** the gate cannot run until the precision mapping table above is written into this file, because the ≥80 % threshold is measured off that mapping.

**Where it runs:** on the VPS, as a one-off script against a checked-out branch — *not* a service deploy, and therefore ahead of rollout step 3. It uses the production Supabase service key already in `/home/aureon/.env`, which is also where `MAPTILER_API_KEY` must be placed first. Running it from a laptop would mean copying a production service key onto a laptop, so it does not happen there.

Per `CLAUDE.md`'s rule about never touching the VPS unprompted, this run needs the user's explicit go-ahead.

Run the resolver against a sample of **200 real production `delivery_address` values**, sampled across comunas rather than from a single client, with cache writes disabled (dry run):

| Metric | Threshold |
|---|---|
| `exact` (street-level or better) | ≥ 80 % |
| `approximate` (centroid fallback) | ≤ 20 % |
| Provider hard failures | ≈ 0 % |

Sampling and grading is a script under `scripts/`; the resulting numbers get written back into this file.

**If `exact` lands materially below 80 %, stop and re-evaluate the provider.** This is why the gate precedes the backfill: afterwards there is no cheap swap, because `geocode_cache` and `orders.latitude` are both fully written and this spec specifies no cache-purge or re-geocode procedure.

A precision distribution cannot catch a systematically-shifted-yet-plausible result, so also eyeball 20 resolved points against their addresses before declaring the gate passed.

## Testing (TDD — tests first)

**pgTAP**, as `packages/database/supabase/tests/spec58_geocoding.sql` (matching the existing `specNN_<topic>.sql` convention, e.g. `spec52_migration_reconciliation.sql`):

- `orders` accepts a valid coordinate pair; rejects `geocode_precision = 'wrong'`; rejects an invalid `geocode_status`; rejects latitude-without-longitude (by constraint name); rejects `(0,0)` and out-of-range values.
- The address-change trigger resets `geocode_status` to `pending` and nulls the coordinates; an unrelated column update does not.
- `geocode_cache` is unique on `(address_hash, normalisation_version)` — and `address_hash` alone is deliberately **not** unique, so two versions of one address can coexist.
- `geocode_cache` is unreadable by **both** `anon` and `authenticated`.
- `idx_orders_geocode_queue` exists.
- `COUNT(*) FILTER (WHERE centroid_lat IS NULL) = 0` on `chile_comunas`; every centroid is inside the mainland box **or** one of the three island/Antarctic CUT codes; no centroid has lat/lng transposed.

**Vitest — `apps/agents`** (colocated `*.test.ts`):

- Normalisation: accent stripping, `av.` → `avenida`, whitespace collapse; two spellings of one address produce one hash; **`depto 42` and `depto 7` at the same street address produce the same hash** (Decision 3). The hash does **not** include `normalisation_version`: one address yields the same hash across versions, and the two cache rows coexist.
- Resolution order: a cache hit makes no provider call; a coarse provider result is stored `approximate` + `fallback`; a null provider result falls back to the centroid; **neither centroid nor coarse results are written to the cache**, and a `fallback` row therefore re-queries the provider on its next run rather than re-reading a frozen answer.
- State machine: a `fallback` row is re-claimed once `geocode_next_attempt_at` has passed and **not** before; a `resolved` row is never re-claimed; a coarse answer increments `geocode_attempts` while a circuit-breaker/quota/429/timeout does **not**; a `null` provider answer also increments it; the 2nd coarse-or-null attempt lands `unresolvable` holding a centroid; an order with no `comuna_id` and no provider answer lands `unresolvable` with NULL coordinates.
- The reset trigger fires when a raw `comuna` edit changes `comuna_id` via the normalisation trigger in the same statement (this is what proves the `zz` name ordering works), and does **not** fire when an unrelated column is updated.
- MapTiler adapter against a mocked `fetch`: a Chilean address fixture, a malformed response, HTTP 429, and a timeout each behave as specified.
- The circuit breaker opens after repeated failure and the job continues via centroid fallback, marking rows `fallback` (not `resolved`).
- The quota guard stops calling the provider once exhausted, and its rows are `fallback`.
- Missing `MAPTILER_API_KEY`: the worker boots and resolves to centroids.

Vitest cannot run locally on this machine; use `npx turbo run lint type-check build` locally and let CI run the suite.

## Rollout

1. Migration plus a regenerated `packages/database/src/database.types.ts`. That file is **already stale** — it still declares the dropped `barcode_scans` table and is missing `routes`, `dispatches`, `drivers` and `chile_comunas`. Regenerate it wholesale here rather than hand-patching.
2. **Run the accuracy gate as a dry run on 200 sampled addresses. Record the numbers in this file. Do not proceed on a failure.**
3. Deploy the agents worker with `MAPTILER_API_KEY` set, and confirm the deploy actually ran the DB job — a green PR check does not prove the migration applied.
4. Let the cron drain the backlog; watch cache hit rate, provider call count, and the `fallback` / `unresolvable` counts for a day.
5. Only then start spec-59.
