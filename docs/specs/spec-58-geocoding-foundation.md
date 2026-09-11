# Spec-58: Geocoding foundation — turning the addresses our pickup points hand us into coordinates

> **Related:** [spec-59](spec-59-map-component-despacho-pins.md) (map component + Despacho pins — depends on this), [spec-60](spec-60-control-tower-fleet-map.md) (Control Tower fleet map), [spec-38](spec-38-route-activity-view.md) (created the map placeholder), [spec-54](spec-54-ui-rebrand.md) (tokenised the map surface, deferred the provider)

**Status:** in progress
**Verify:** unit
**Downstream:** spec-59-map-component-despacho-pins.md, spec-60-control-tower-fleet-map.md

_Date: 2026-08-17 — rewritten into phases 2026-09-11_

> **Why the rewrite.** The original was one 354-line block with no phase tokens, written before the convention in `docs/specs/CLAUDE.md` existed. Nothing in it had been built — verified 2026-09-11: `orders` has no geocode columns, `geocode_cache` does not exist, and the only matches for `maptiler|geocode` outside this file are four comments in other specs' migrations saying "no geocode here". So this is a restructuring, not a correction: every decision and every piece of evidence below is carried over intact, now hanging off the phase that consumes it.

> **On `**Verify:** unit`.** A schema-heavy spec would normally declare `unit, sql, e2e-qa`. It declares neither `sql` nor `e2e-qa`, on purpose. `scripts/judges/sql.sh` **does not exist** — there is no `scripts/judges/` directory at all (verified 2026-09-11), and `scripts/verify.sh:58` fails loudly on a judge it cannot resolve, so declaring `sql` would red-build every phase. pgTAP is still written and still run, via `scripts/pgtap-local.sh` against the shared Docker container. And `e2e-qa` is left out because **this spec ships no screen**: a browser judge would have nothing to look at. spec-59 is the first one that needs it.

> **On the Spanish field names in an otherwise English spec.** `**Archivos:**`, `**Depende de:**` and `> Bloqueo:` are read by machine, not by a person: `scripts/check-spec-fields.sh`, `scripts/check-phase-overlap.mjs` and `scripts/check-blocked-evidence.sh` match those literals, and the last one greps the Spanish stems `intent*` / `verific*` inside the block. They stay in Spanish because renaming them is a harness change, not a spec change.

> **Note on a stale forward-reference:** `spec-38:24-25` defers "Leaflet map integration" and "Geocoding" to *spec-39*. That number was subsequently used by `spec-39-distribution-pending-list.md`. This spec and spec-59 are the real successors; spec-38's pointer is stale and should be read as "a later spec".

---

## Goal

Give every order a latitude and longitude, so a map can be drawn at all. No UI ships here.

"The addresses the load generators give us" means `orders.delivery_address` — the free text that arrives in a pickup point's manifest, CSV, photo or API payload. Note the naming: `generators` was renamed to `pickup_points` in `20260329000001_rename_generators_to_pickup_points.sql`, which also renamed `orders.generator_id` to `orders.pickup_point_id`. A pickup point's **own** address is a Non-Goal here.

## The problem

`public.orders` stores exactly one piece of location information: `delivery_address TEXT NOT NULL` (`20260217000003_create_orders_table.sql:56`), plus `comuna` / `comuna_id`. There are **no populated coordinate columns and no geocoder anywhere in the repo**:

- `orders.destination_address JSONB` (`20260318000004_agent_suite_tables.sql:167`, commented at `:168`) is documented as "Parsed from delivery_address text". Nothing parses it. Nothing writes it.
- `orders.agent_metadata JSONB` documents `geocoded_at` and `geocode_confidence` keys. Neither is ever set.
- `drivers.last_location JSONB` and `assignments.pickup_location` / `delivery_location` JSONB (`20260318000004:251, 270, 381-382`) are likewise scaffolding that nothing writes.
- `spec-10k-intake-expansion.md:46-49` describes a `geocode_address` tool at `apps/agents/src/tools/supabase/geocoding.ts`. That file does not exist.
- `spec-33-admin-maintainer.md:117` records that `lat`/`lng` were left out of the pickup-point form as "a future enhancement".

The only **populated** coordinates are `dispatches.latitude` / `longitude`, and they are not a delivery destination — see the next section. Nothing downstream can use them as one, including the OR-Tools solver at `sidecar/or-tools/`, which consumes bare `lat` / `lng` floats per order and per driver.

## What DispatchTrack's coordinates actually are — and why they cannot help here

An earlier draft proposed harvesting destination coordinates from DispatchTrack for free. **That was wrong, and it is recorded here so it is not re-proposed.**

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

The two are near-identical in practice, but the poll is suspect: the Show Route response documents `identifier` and a **string** `status`, while the poll reads `d.dispatch_id` and a **numeric** `d.status`, `continue`-ing when either is absent (`index.ts:121`, `:125`). If the documented shape is accurate, the poll's dispatch loop never reaches line 140 and its coordinate write is dead code. The counter-evidence, so spec-60 need not rediscover it: `index.ts:116` carries the comment "NOTE: REST API returns dispatches in same shape as webhook payload" — its author believed `dispatch_id` and a numeric status are what actually arrive. One of the two is wrong; only production data settles it. It is out of scope here, but spec-60 depends on these columns and must verify it.

**No phase of this spec adds `dest_latitude` / `dest_longitude` to `dispatches`, and none modifies either edge function.**

## Decisions

1. **Provider: MapTiler**, behind an interface. Re-confirmed 2026-09-11.

   To answer the obvious question directly, because it came up: **Leaflet is not an alternative to MapTiler.** Leaflet is a client-side rendering library — it paints markers you already have onto tiles somebody else serves, and it has no geocoder, no address parser and no tile data of its own. spec-59 decision 1 already picks Leaflet + react-leaflet for the drawing. This spec never draws anything, so Leaflet has no role in it; what it needs is an HTTP service that turns `"Av. Providencia 1234, Providencia"` into a coordinate pair, which is a different layer entirely. Leaflet will render MapTiler's tiles using the coordinates this spec writes.

   The real candidates were MapTiler, Google, LocationIQ and self-hosted Nominatim. MapTiler wins on being **one vendor and one key for both** geocoding (here) and tiles (spec-59) — and Leaflet needs a tile source from someone regardless, since OSM's public tile server forbids production use. Google's geocoding is likely more accurate on Chilean street addresses, but its terms restrict persisting coordinates long-term and we intend to store lat/lng permanently on `orders`. Self-hosted Nominatim is free per lookup and unrestricted on storage, but Chilean street-level OSM coverage is materially worse than a commercial geocoder, and the whole spec is gated on hitting ≥ 80 % street-level matches — so it would be betting the gate on the weakest option. The interface exists so swapping to any of them is a single adapter file.
2. **First-class columns, not JSONB.** Coordinates go on `orders` as real columns. `destination_address` / `agent_metadata` stay untouched — they are already unwritten scaffolding and adding a second unwritten shape helps no one.
3. **Cache aggressively, at street granularity.** Chilean last-mile has heavy address repetition. The cache key deliberately **excludes** the unit (departamento / oficina / piso): a street-level geocoder returns one point for all 40 flats in a building, so keying on the unit would turn one paid lookup into forty. The unit stays on the order; it is simply not part of the geocoding key.
4. **Never permanently fail an order, and never permanently freeze a bad answer.** An unresolved address falls back to its comuna centroid marked `approximate`, but a centroid is a *retryable* state, not a terminal one — see Fase 5. An order with an honest, visibly-approximate pin is actionable; an order silently frozen at a centroid because the provider was down for twenty minutes is a lie.
5. **Measure before backfilling, not after.** The accuracy gate (Fase 6) runs on a sample **before** any bulk write (Fase 7). Once the whole order history is geocoded and cached, "swapping the adapter is cheap" stops being true.

## Non-Goals

- Any map rendering, component, or screen change — that is spec-59.
- Truck positions — that is spec-60.
- Polygon geometry for comunas. `chile_comunas.geometry` stays NULL; Fase 2 seeds centroid lat/lng only. Zone drawing and point-in-polygon are out of scope, and PostGIS spatial indexing is not needed for a per-order pin.
- Wiring the OR-Tools solver. This spec unblocks it; it does not do it.
- Geocoding `pickup_points` — the pickup points' own addresses. The same mechanism will apply later, in a spec named at that time.
- Manual coordinate correction by an operator. Consequently `geocode_source` does **not** enumerate a `'manual'` value — when a correction UI is specified, that spec adds it.
- Reverse geocoding.

## The phases

| Fase | Delivers | Token |
|---|---|---|
| 0 | Precision mapping: which MapTiler response field carries match granularity | `[done]` |
| 1 | `orders` geocode columns, queue index, reset trigger, `geocode_cache` | `[pending]` |
| 2 | `chile_comunas` centroids, 347 rows with provenance | `[pending]` |
| 3 | Address normalisation v1 + cache read/write. No network. | `[pending]` |
| 4 | MapTiler adapter behind the interface, circuit breaker, env | `[pending]` |
| 5 | `geocode.enrich` queue, cron, batch claim, retry ladder, quota | `[pending]` |
| 6 | Accuracy gate on 200 sampled production addresses | `[blocked]` |
| 7 | Backfill of the existing order history | `[blocked]` |

Two ordering constraints that are not obvious from the table, and that `scripts/check-phase-overlap.mjs` would otherwise get wrong:

- **Fase 2 declares a dependency on Fase 1 for a file reason, not a logical one.** Both regenerate `packages/database/src/database.types.ts`. Their SQL is independent and could in principle run in parallel; that one shared file is a hard conflict, so they are serialised.
- **The pgTAP suite is split in two files** (`spec58_geocoding.sql`, `spec58_comuna_centroids.sql`) for the same reason. One file would make the two schema phases collide on the tests as well. Separately: `scripts/pgtap-local.sh` drives a Docker container shared by every worktree on this machine, so two phases must not run SQL tests at the same moment even when their files are disjoint.

---

### Fase 0 — Precision mapping: what MapTiler actually calls a street-level match `[done]`

**Depende de:** ninguna

**Archivos:** `docs/specs/spec-58-geocoding-foundation.md` (esta sección)

> Implementado por: orquestador (no un implementer — el entregable es una tabla en este fichero, no código) — rama `docs/spec-58-fase-0-mapeo-precision`, rango completo de la rama (dos commits: el contenido y esta línea; un SHA suelto no se puede auto-referenciar)
> Review: `reviewer` (Opus), 13 hallazgos, 5 bloqueantes. Cerrados en esta misma rama. Dos de sus hipótesis alternativas se **refutaron midiendo** y se dejan escritas abajo para que nadie las vuelva a plantear. Segunda ronda de review sobre este rango.
> QA: n/a — no se despliega nada. 20 llamadas contra la API real de MapTiler el 2026-09-11.
> Downstream: revisado spec-59 y spec-60 — **spec-59 sí necesita un cambio**, ver «Lo que spec-59 hereda (y lo que no)» abajo. spec-60 sin cambios: consume `orders.latitude/longitude` y `geocode_precision`, cuyo contrato no cambia.

Se llamó al endpoint de geocoding con direcciones chilenas reales el 2026-09-11. **El resultado invalida la suposición con la que se escribió este spec**, así que la tabla de abajo no es la que se esperaba.

#### Qué campo trae la granularidad

| Campo | Dónde | Qué significa realmente |
|---|---|---|
| `feature.address` | raíz del feature, string o **ausente** | Presente = MapTiler acertó el número de calle. Ausente = devolvió el centroide de la calle. Ver la comprobación de interpolación abajo |
| `feature.context[]` | array | Trae una entrada `municipality.*` con la comuna que **realmente** devolvió. El segundo conjunto de la regla vive aquí |
| `feature.place_type` | array | `['address']` para **cualquier** cosa a nivel calle, acertada o no. Inútil por sí solo |
| `properties.kind` | string | `street` / `admin_area`. Misma limitación |
| `feature.relevance` | 0..1 | Similitud **de texto**, no precisión. Ver la trampa 2 |
| `properties.accuracy` | — | **Ausente en las 20 respuestas medidas.** No se afirma que el proveedor no lo emita nunca: si algún día aparece, léelo **antes** que `address`, porque en geocoders de esta familia distingue `rooftop` / `parcel` / `interpolated`, que es justo lo que `address` no distingue |

#### La regla

```
exact  <=>  feature.address presente
            Y  context[].municipality  ==  la comuna pedida
               (comparadas ya normalizadas — ver «En qué capa se decide»)

approximate  <=>  hay feature, pero falla alguno de los dos conjuntos
sin match    <=>  features vacío  -> centroide, camino `fallback`
```

Los dos casos donde **no hay comuna que cruzar** están especificados abajo; no caen en `approximate` por defecto.

#### El cruce de comuna, medido (era el hueco del review)

La primera versión de esta fase afirmaba que el cruce atrapaba los falsos positivos sin transcribir un solo valor de `context[]`. Corregido — esto es lo que devuelve:

| Consulta | `address` | `context[].municipality` | Comuna pedida | Veredicto |
|---|---|---|---|---|
| `Avenida Providencia 1234, Providencia` | `'1234'` | `Providencia` | Providencia | **exact** |
| `Colon 1000, Concepcion` | ausente | **`Chiguayante`** | Concepción | approximate — atrapado |
| `Ruta G-60 km 12, Curacavi` | ausente | **`Melipilla`** | Curacaví | approximate — atrapado |
| `Arturo Prat 100, La Union` | ausente | **`Valdivia`** | La Unión | approximate — atrapado |
| `Lote 5 Parcela 12, Curacavi` | ausente | **`Puente Alto`** | Curacaví | approximate — atrapado |

Cuatro de cuatro falsos positivos atrapados, todos en comuna distinta a la pedida. `La Union` es además la colisión de nombre que el criterio original pedía y la primera versión no probó: devuelve Valdivia.

#### Tres trampas medidas, no supuestas

**1. `place_type` miente.** Las cuatro filas de arriba devolvieron `place_type=['address']`, `kind=street`. Todas habrían pasado como `exact` con la regla que este spec daba por hecha.

**2. `relevance` no separa los casos buenos de los malos.** Medido:

| Consulta | `relevance` | `address` | Punto devuelto |
|---|---|---|---|
| `Avenida Providencia 1234, Providencia` | **1.0** | `'1234'` | el portal correcto |
| `Avenida Providencia, Providencia` (sin número) | **1.0** | ausente | centroide de la calle |
| `Avenida Providencia 1234 depto 42, Providencia` | **0.667** | `'1234'` | el portal correcto |
| `Bandera 140, Santiago` | 0.994 | ausente | centroide de la calle |

Para aceptar el acierto de 0.667 hace falta un suelo ≤ 0.667, que también acepta los dos centroides de 1.0 y 0.994. **No existe umbral que separe ese par**, que es una afirmación más fuerte y más honesta que «invierte la verdad».

**3. El `depto` degrada la puntuación, y eso importa menos de lo que la primera versión decía.** Las filas con y sin `depto` devolvieron **el mismo punto** y el mismo `address: '1234'`, así que el único efecto medido está en una métrica que acabamos de declarar sin valor. El argumento defendible es más estrecho: `relevance` **ordena** los features, de modo que una puntuación más baja puede cambiar cuál sale primero cuando hay varios candidatos. Con `limit=1` y un solo candidato eso no se observó, y no se afirma. La Decisión 3 se sostiene por economía de caché, que es como estaba justificada desde el principio.

#### Dos hipótesis del review, refutadas midiendo

**«Quizá MapTiler sólo rechaza User-Agent vacío, y cualquier cadena sirve.»** No:

| `User-Agent` | Respuesta |
|---|---|
| `aureon-geo` | **HTTP 200** |
| `Mozilla/5.0` | HTTP 403 |
| `curl/8.0` | HTTP 403 |
| `x` | HTTP 403 |
| *(sin cabecera)* | HTTP 403 |

Es una **lista blanca sobre la cadena exacta**, configurada en la consola de MapTiler. Es configuración de cuenta invisible al repo, y por eso queda escrita aquí.

**«Quizá `address` aparece por interpolación sobre rangos de portales, y entonces no significa que acertara.»** No:

| Consulta | `address` | Devolvió |
|---|---|---|
| `Avenida Providencia 99999, Providencia` | **ausente** | centroide de la calle |
| `Avenida Providencia 88888, Providencia` | **ausente** | centroide de la calle |
| `Avenida Providencia 1234, Providencia` | `'1234'` | el portal |

Un número inexistente en una calle existente **no** produce `address`, ni interpolado ni por snapping. La premisa sobre la que descansa el gate de la Fase 6 se sostiene. Era el hallazgo más peligroso del review y la medición lo cierra.

#### Formas de dirección chilenas, medidas

| Forma | Ejemplo | `address` | Comuna correcta | Veredicto |
|---|---|---|---|---|
| Urbana con número | `Los Militares 5620, Las Condes` | `'5620'` | sí | exact |
| Urbana con número | `Irarrazaval 3400, Nunoa` | `'3400'` | sí | exact |
| Número + letra | `Avenida Providencia 1234 A` | `'1234'` | sí | exact (cae al número base) |
| Calle en mayúsculas sin portal en OSM | `Pajaritos 2020, Maipu` | ausente | sí | approximate |
| `S/N` | `Avenida Providencia S/N` | ausente | sí | approximate |
| `sin numero` | idem | ausente | sí | approximate |
| Lote / Parcela | `Lote 5 Parcela 12, Curacavi` | ausente | **no** (Puente Alto) | approximate |
| Basura | `asdkjhasd 99999, Nowhereville` | — | — | `features: []` |

**Aviso honesto para la Fase 6:** las formas que no son «calle + número urbano» resuelven a `approximate` de forma sistemática, no ocasional. El gate pide ≥ 80 % `exact`. Si el corpus real trae muchos `S/N`, lotes, parcelas o villas, **ese umbral puede no alcanzarse con ningún proveedor**, y la decisión entonces no es cambiar de proveedor sino revisar el umbral. La Fase 6 mide eso; esta fase sólo advierte de que el resultado no está garantizado.

#### Una trampa de implementación para la Fase 4

**La dirección va en el *path* de la URL, no en la query.** Cualquier `/` del texto —`S/N` es la forma más común en Chile, y `Km 5/2` aparece en rutas— rompe la ruta y devuelve **HTTP 404**, no un match vacío. Medido: `S/N` con el `/` sin escapar → 404; el mismo texto con el `/` percent-encoded → 200. El adaptador debe codificar el componente entero (`encodeURIComponent`, no `encodeURI`), y la Fase 4 debe tener un test con `S/N` exactamente por esto. Un 404 por esta causa es indistinguible de «no hay match» si nadie lo separa.

#### En qué capa se decide

`normalize_comuna_id()` es una función de Postgres, y la capa `providers/` no habla con Supabase. **El adaptador no resuelve la comuna: la recibe ya canónica.** `GeocodeQuery.comuna` lleva el nombre canónico que la Fase 5 obtiene de `orders.comuna_id`, y el adaptador compara ese string con `context[].municipality` usando la misma normalización de texto de la Fase 3 (minúsculas, sin acentos, espacios colapsados) — comparación de strings en TS, sin viaje a la base. Así el veredicto sigue dentro del adaptador sin sacarlo de su superficie declarada y sin un RPC por geocodificación.

#### Los dos casos sin comuna que cruzar

La regla exige cruzar contra la comuna pedida. Cuando no hay ninguna, o cuando la respuesta no trae `municipality.*`, el veredicto es `approximate` — pero **el punto devuelto se conserva**, no se sustituye por un centroide:

| Caso | Qué se guarda | `geocode_status` |
|---|---|---|
| `orders.comuna_id` NULL y el proveedor devolvió un punto | el **punto del proveedor**, `precision='approximate'`, `source='maptiler'` | `fallback` |
| `context[]` sin entrada `municipality.*`, con punto | el **punto del proveedor**, `precision='approximate'` | `fallback` |
| Sin comuna **y** sin punto | nada — `latitude`/`longitude` NULL | `unresolvable` |

Tirar un punto a nivel portal para escribir un centroide sería perder información y pagar por ello. Y sin `comuna_id` no hay centroide que escribir, así que la alternativa no existe: o se guarda el punto del proveedor, o la orden se queda sin ubicación teniendo una buena. La fila «No `comuna_id` y no provider answer → `unresolvable`» de la Fase 5 se lee ahora junto a esta tabla: el camino donde el proveedor **sí** responde existe, y es éste.

#### Lo que spec-59 hereda (y lo que no)

La primera versión de esta fase decía que spec-59 heredaba el requisito de `User-Agent` para los tiles. **Es falso, y además imposible.** Un navegador no puede fijar `User-Agent`: está en la lista de cabeceras prohibidas de fetch/XHR, y los tiles de Leaflet se piden con `<img src=...>`, donde no hay cabeceras que fijar. Tomado al pie de la letra, dejaría a spec-59 con un requisito inimplementable y el mapa en blanco.

Lo correcto, y coherente con `spec-59:54`, que ya especifica una key distinta restringida **por referrer**:

- `MAPTILER_API_KEY` — key **de servidor**, restringida por User-Agent (`aureon-geo`), sólo para el worker de geocoding. Nunca sale del backend.
- La key de tiles de spec-59 — key **de navegador**, restringida por referrer, expuesta en el bundle por diseño. **No** lleva ni puede llevar User-Agent.

Dos keys de la misma cuenta. La Decisión 1 («un proveedor, una cuenta») se mantiene; lo que no se mantiene es «una key».

#### Dónde está la key

La custodia el usuario. **Todavía no está en ningún fichero del VPS** (ni `/home/aureon/.env.qa` ni `/home/aureon/.env`) y no está registrada en `config.ts` — eso lo hace la Fase 4. El implementador de la Fase 4 no la necesita: sus tests van contra `fetch` mockeado. La primera fase que necesita la key colocada es la 5, en QA.

---

### Fase 1 — `orders` geocode columns and `geocode_cache` `[pending]`

**Depende de:** ninguna

**Archivos:** `packages/database/supabase/migrations/<ts>_spec58_geocoding_schema.sql` (nueva), `packages/database/supabase/tests/spec58_geocoding.sql` (nuevo), `packages/database/src/database.types.ts`

#### Changed: `public.orders`

```sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_source TEXT;      -- 'maptiler' | 'comuna_centroid'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_precision TEXT;   -- 'exact' | 'approximate'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_status TEXT NOT NULL DEFAULT 'pending';
                                                  -- 'pending' | 'resolved' | 'fallback' | 'unresolvable'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_last_attempt_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS geocode_next_attempt_at TIMESTAMPTZ;
```

`geocode_next_attempt_at` is what makes "retry with backoff" real rather than aspirational. Without a time column the claim query has no way to space attempts, and a `*/10` cron would burn both attempts in twenty minutes — turning a one-hour provider outage into a permanent centroid for that day's orders, which is the exact failure Decision 4 exists to prevent.

`DECIMAL(10,7)` matches the precision already used on `dispatches` (`20260306000001_add_routes_dispatches_fleet_tables.sql:124-125`).

Constraints:

- `geocode_precision IN ('exact','approximate')`, `geocode_status IN ('pending','resolved','fallback','unresolvable')`.
- `latitude` and `longitude` are either both NULL or both set.
- Range check: `latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180`, and a sanity check rejecting `(0,0)` — a provider bug writing null-island or a swapped pair must not reach the map.

Work-queue index, leading on the due-time column so the claim query's predicate and ordering both use it:

```sql
CREATE INDEX IF NOT EXISTS idx_orders_geocode_queue
  ON public.orders (geocode_next_attempt_at NULLS FIRST, created_at)
  WHERE geocode_status IN ('pending','fallback') AND deleted_at IS NULL;
```

Postgres defaults ASC to `NULLS LAST`, so the `ORDER BY` in Fase 5 must be written `geocode_next_attempt_at NULLS FIRST, created_at` verbatim or the index will not be used. Untried orders have a NULL due-time and therefore sort first.

**The batch query has no `operator_id` predicate**, a deliberate deviation from the `operator_id`-on-every-query non-negotiable that needs stating rather than implying. It is a service-role maintenance job with no tenant context: it runs on a cron, not on behalf of a user, and scoping it per operator would mean either a tenant list in the worker or one cron per tenant. The consequence to accept: one operator bulk-importing 50k orders monopolises every batch until it drains. If that becomes real, the fix is round-robin by `operator_id` within the batch, not a per-tenant job.

No RLS change: `orders` policies already scope by `operator_id`, and these are ordinary columns on existing rows.

#### Re-geocoding on address change

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

**Trigger name ordering is a hard requirement, not cosmetics.** Postgres fires same-event BEFORE triggers in **alphabetical name order**, and the existing `orders_normalize_comuna_trigger` is declared `BEFORE INSERT OR UPDATE OF comuna` (`20260321000001:523-526`). That function both derives `NEW.comuna_id` *and* rewrites `NEW.comuna := v_name` (`:516`), so neither column is safe to compare before it runs:

- Compare `comuna_id` too early → it is not yet written, and the reset silently no-ops.
- Compare raw `comuna` too late → it has already been canonicalised and equals `OLD.comuna` for any case or accent variant, and the reset silently no-ops.

The `zz` prefix forces this trigger to sort **after** the normalisation trigger, at which point `comuna_id` is populated and is the right thing to compare. Any future rename must preserve that ordering; a comment in the migration says so.

Note also that `UPDATE OF` fires on column *mention*, not on value change — hence the `IS DISTINCT FROM` guards inside the function rather than relying on the trigger clause alone.

Without this, an edited address silently keeps the pin of the address it replaced — worse than having no pin, because it looks correct.

#### New: `public.geocode_cache`

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

`normalisation_version` exists because the rules in Fase 3 will change. **It is a column, not an input to the hash** — the hash covers the normalised string only, and the uniqueness constraint spans both. That way two versions of one address can coexist: on a bump, the old rows stay queryable and targetable for cleanup instead of becoming unreachable dead weight.

Bumping the version is not free: every cached key misses, so the next drain re-pays for the whole address book. Treat it as a deliberate, costed operation, not a refactoring detail.

**Soft-delete exception:** this table has no `deleted_at`. It is a derived cache, rebuildable from `orders` and the provider, and carries no business record. A deliberate exception to the project's soft-deletes-only rule.

#### Tests (pgTAP, written first)

`packages/database/supabase/tests/spec58_geocoding.sql`:

- `orders` accepts a valid coordinate pair; rejects `geocode_precision = 'wrong'`; rejects an invalid `geocode_status`; rejects latitude-without-longitude (by constraint name); rejects `(0,0)` and out-of-range values.
- The address-change trigger resets `geocode_status` to `pending` and nulls the coordinates; an unrelated column update does not.
- The reset fires when a raw `comuna` edit changes `comuna_id` via the normalisation trigger in the same statement — this is what proves the `zz` name ordering works, and it is the one test that fails if someone renames the trigger.
- `geocode_cache` is unique on `(address_hash, normalisation_version)`, and `address_hash` alone is deliberately **not** unique.
- `geocode_cache` is unreadable by **both** `anon` and `authenticated`.
- `idx_orders_geocode_queue` exists.

Run with `scripts/pgtap-local.sh`; SQL tests do not run in CI.

Also regenerate `packages/database/src/database.types.ts` wholesale. That file is **already stale** — it still declares the dropped `barcode_scans` table and is missing `routes`, `dispatches`, `drivers` and `chile_comunas`. Regenerate, do not hand-patch.



---

### Fase 2 — Comuna centroids `[pending]`

**Depende de:** spec-58 fase 1

**Archivos:** `packages/database/supabase/migrations/<ts>_spec58_comuna_centroids.sql` (nueva), `packages/database/supabase/tests/spec58_comuna_centroids.sql` (nuevo), `packages/database/src/database.types.ts`

```sql
ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lat DECIMAL(10,7);
ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lng DECIMAL(10,7);
```

Seeded from **one** named source, committed as data in the migration exactly as the comuna list itself was (`20260321000001:43-407`). `geometry` remains NULL.

347 hand-committed coordinate pairs are unreproducible unless the provenance is written down, so record in the migration header: the source dataset and its version or download date, and the extraction method (for OSM comuna relations, the centroid definition used — bounding-box centre and polygon centroid differ noticeably for long coastal comunas). One source, not "INE / OSM".

**Two traps in that seed data, both of which will break a naive assertion:**

- The table holds **347** rows, not the 346 its own migration comment claims. Row `('14201', 'Ranco', 'Ranco', 'Los Ríos', 14)` at `:299` is a *provincia*, not a comuna — Los Ríos has 12 comunas, and this row makes 13. Assert with `COUNT(*) FILTER (WHERE centroid_lat IS NULL) = 0`, never a hard-coded row count. Give `14201` the Provincia del Ranco centroid, write the literal into the migration with a comment marking it hand-picked, and leave the pre-existing data bug alone — correcting it is a separate concern with `comuna_id` foreign keys attached.
- Three seeded comunas fall outside any mainland bounding box: `05201 Isla de Pascua` (~−109.4° lng), `05104 Juan Fernández` (~−78.8° lng), `12202 Antártica` (~−75 to −80° lat). The validity check is therefore *mainland box **or** one of those three CUT codes*, not a single rectangle.

#### Tests (pgTAP, written first)

`packages/database/supabase/tests/spec58_comuna_centroids.sql`:

- `COUNT(*) FILTER (WHERE centroid_lat IS NULL) = 0`.
- Every centroid is inside the mainland box **or** is one of the three island/Antarctic CUT codes.
- No centroid has lat/lng transposed — in Chile the two are never interchangeable, since every longitude is more negative than −65 and no mainland latitude is.



---

### Fase 3 — Address normalisation and the cache layer `[pending]`

**Depende de:** spec-58 fase 1

**Archivos:** `apps/agents/src/lib/geocoding/normalise.ts` (nuevo), `apps/agents/src/lib/geocoding/normalise.test.ts` (nuevo), `apps/agents/src/tools/supabase/geocoding.ts` (nuevo), `apps/agents/src/tools/supabase/geocoding.test.ts` (nuevo)

Pure TypeScript plus Supabase reads and writes. No network call to any provider — that is Fase 4 — so this phase is fully testable offline.

**Normalisation, version 1:** lowercase, strip accents, strip punctuation, collapse whitespace; `av.` / `avda.` → `avenida`, `pje.` → `pasaje`; **strip** the unit component (`depto` / `dpto` / `departamento` / `oficina` / `of.` / `piso` and its number) per Decision 3. Comuna resolution reuses `public.normalize_comuna_id(TEXT)` (`20260321000001_chile_comunas_normalization.sql:426`) rather than a second comuna matcher.

The hash is sha256 over the normalised `street|comuna` string. `normalisation_version` is **not** an input to it (Fase 1 explains why).

The cache tool exposes exactly two operations — look up by `(address_hash, normalisation_version)`, and insert a result — plus the `orders` update. Keep the normaliser in its own file: it is the part Fase 5's tests exercise hardest, and the part a version bump will rewrite.

#### Tests (Vitest, written first)

- Accent stripping, `av.` → `avenida`, whitespace collapse; two spellings of one address produce one hash.
- **`depto 42` and `depto 7` at the same street address produce the same hash** (Decision 3).
- The hash does not include `normalisation_version`: one address yields the same hash across versions, and the two cache rows coexist.
- A cache hit bumps `hit_count` and `last_used_at`.

Run locally with `--pool=forks`.



---

### Fase 4 — The MapTiler adapter `[pending]`

**Depende de:** spec-58 fase 0

**Archivos:** `apps/agents/src/providers/geocoding/types.ts` (nuevo), `apps/agents/src/providers/geocoding/maptiler.ts` (nuevo), `apps/agents/src/providers/geocoding/maptiler.test.ts` (nuevo), `apps/agents/src/providers/types.ts`, `apps/agents/src/providers/openrouter.ts`, `apps/agents/src/providers/circuit-breaker.ts`, `apps/agents/src/providers/circuit-breaker.test.ts`, `apps/agents/src/config.ts`, `apps/agents/src/config.test.ts`, `apps/agents/.env.example`

The agents app already has everything this needs; no new infrastructure is stood up. New files mirror the existing `providers/` shape (`providers/openrouter.ts`, `providers/types.ts`, `providers/circuit-breaker.ts`).

`apps/agents/src/providers/geocoding/types.ts`:

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

`apps/agents/src/providers/geocoding/maptiler.ts` — country-biased to `cl`, proximity-biased to the comuna centroid from Fase 2, `exact` vs `approximate` decided by **Fase 0's measured rule**: `feature.address` present **and** the `municipality.*` entry of `context[]` resolving to the requested comuna. Not `place_type`, which Fase 0 measured returning `['address']` for results in the wrong comuna, and not a `relevance` floor, which Fase 0 measured inverting the truth.

**The request must carry `User-Agent: aureon-geo`.** Fase 0 measured this as an allowlist on that exact string: `Mozilla/5.0`, `curl/8.0`, `x` and no header at all each return `HTTP 403`. Not optional politeness — it is the difference between a working adapter and one that 403s on every request. This applies to the **server** key only; spec-59's browser tile key is referrer-restricted and cannot carry a User-Agent at all.

**Percent-encode the address into the path.** Fase 0 measured an unescaped `/` (as in `S/N`, the commonest Chilean form for "no street number") returning `HTTP 404` rather than an empty match. Use `encodeURIComponent`, and carry a test with `S/N` in it.

**The comuna arrives already canonical.** `GeocodeQuery.comuna` carries the canonical name resolved from `orders.comuna_id` by Fase 5; the adapter compares it to `context[].municipality` with Fase 3's text normalisation. `normalize_comuna_id()` is a Postgres function and this layer does not talk to Supabase — see Fase 0's "En qué capa se decide". Wrapped in the existing `CircuitBreaker` so a provider outage degrades to centroid fallback instead of stalling the queue.

**Error classification.** Fase 5's retry ladder distinguishes three things, not two: "the provider told us something about this address", "the provider was unreachable", and "our credential is refused". The third needs its own type — `credential` — beyond the existing union. A 401 or a 403 whose body says the key is refused is **not** a transient outage: it never clears on its own, so classifying it as transport means the worker retries a doomed request every thirty minutes forever while reporting itself healthy. Fase 0 hit exactly this against a User-Agent-restricted key.

**But 403 is ambiguous and must be disambiguated before this ships.** MapTiler returns 403 both for a refused key and, plausibly, for plan or rate limits — and the quota row below already claims 403-adjacent territory with a completely different backoff. **First task of this phase:** capture the response body for a refused key (Fase 0 recorded `"Key usage restricted"`) and, if it can be provoked, for a quota rejection, and write the discriminator here. Do not guess: a wrong split either bricks the worker on a rate limit or retries a dead key all month.

Opening the circuit for a refused credential needs a mode `CircuitBreaker` does not have today — it only opens on `failureCount >= failureThreshold` and always re-arms after `recoveryTimeout` (`providers/circuit-breaker.ts`). Add an explicit trip, and give it a **finite one-hour latch, not "until restart"**: the spend is identical, and it cannot turn a transient 403 into a silently lost month. The union already exists, spelled at `apps/agents/src/providers/types.ts:36` — `'rate_limit' | 'timeout' | 'api_error' | 'network'` — but it is currently a member of `LLMError`, so importing it as-is would type a geocoding failure as an LLM error. **Extract it to a shared `ProviderErrorType`** (which touches `openrouter.ts`) rather than inventing a second vocabulary that can drift.

**Env.** `MAPTILER_API_KEY` and `MAPTILER_MONTHLY_QUOTA` in `apps/agents/.env` locally, added to `.env.example`, registered in `apps/agents/src/config.ts` (which validates every var at startup). On the VPS there are **two** files, and since Fase 5 verifies in QA, QA is the one that matters first:

| Entorno | Fichero | Unidad que lo lee |
|---|---|---|
| QA | `/home/aureon/.env.qa` | `infra/supabase-qa/systemd/aureon-agents-qa.service` |
| Producción | `/home/aureon/.env` | `apps/agents/deploy/aureon-agents.service` |

Ambos `chmod 600`, propiedad de `aureon`, fuera del repo. (Este spec decía antes `deploy/aureon-agents.service` y no mencionaba QA en absoluto; las dos rutas se verificaron leyendo las unidades el 2026-09-11.)

`MAPTILER_API_KEY` is **optional**: if absent the worker boots and Fase 5 resolves everything to centroids rather than refusing to start. A geocoding key must not be able to take down the agent suite. Log loudly at startup when it is missing.

#### Tests (Vitest, written first)

Against a mocked `fetch`: a Chilean address fixture resolving `exact`; a locality-granularity response resolving `approximate`; a malformed response; HTTP 429; a timeout — each classified per the union above. The circuit breaker opens after repeated failure and the adapter surfaces that as a transport failure, not as "no match".



---

### Fase 5 — The `geocode.enrich` worker and its state machine `[pending]`

**Depende de:** spec-58 fase 4

**Archivos:** `apps/agents/src/orchestration/queues.ts`, `apps/agents/src/orchestration/queues.test.ts`, `apps/agents/src/orchestration/workers.ts`, `apps/agents/src/orchestration/workers.test.ts`, `apps/agents/src/orchestration/schedulers.ts`, `apps/agents/src/orchestration/schedulers.test.ts`, `apps/agents/src/agents/geocode/enrich.ts` (nuevo), `apps/agents/src/agents/geocode/enrich.test.ts` (nuevo)

Add `'geocode.enrich'` to the exported `QueueName` union at `orchestration/queues.ts:5` **and** to `QUEUE_CONFIGS` at `:20` (`Record<QueueName, QueueConfig>` will not compile otherwise), `attempts: 3, backoffDelay: 60_000`. Worker in `orchestration/workers.ts`, scheduler in `orchestration/schedulers.ts`:

```ts
{ queue: 'geocode.enrich', schedulerId: 'geocode-cron', pattern: '*/10 * * * *', jobName: 'geocode_pending' }
```

`America/Santiago` is already that file's default TZ.

#### Resolution order

1. `geocode_cache` hit on `(address_hash, normalisation_version)` → use it, bump `hit_count` / `last_used_at`. No network call. A cache hit is always `resolved`, because only `exact` results are ever cached.
2. MapTiler → `source='maptiler'`, precision per Fase 0's mapping. **Written to the cache only when `precision='exact'`.**
3. Comuna centroid → `source='comuna_centroid'`, `precision='approximate'`, `geocode_status='fallback'`. **Never written to the cache.**

**Only `exact` results are cached.** Caching a coarse answer would silently defeat the retry this state machine promises: step 1 would short-circuit every subsequent attempt, the row would re-read the same approximate value on every run without a single network call, and it would land `unresolvable` while the spec claimed it was being retried. The same reasoning that has always excluded centroids applies to a provider's locality-level match — both are "we do not really know where this is", and neither should be frozen into the cache.

There is no DispatchTrack step; see the section above.

#### Claiming a batch

Each run claims a bounded batch of 200 rows:

```sql
WHERE geocode_status IN ('pending','fallback')
  AND deleted_at IS NULL
  AND (geocode_next_attempt_at IS NULL OR geocode_next_attempt_at <= now())
ORDER BY geocode_next_attempt_at NULLS FIRST, created_at
LIMIT 200
FOR UPDATE SKIP LOCKED
```

`FOR UPDATE SKIP LOCKED` is not optional. Without it a run that outlives its ten-minute cron window — or any BullMQ retry, and the queue is configured `attempts: 3` — re-selects the identical 200 rows and pays the provider for them twice. "Claims a batch" has to be mechanised, not asserted.

#### The ladder

| Outcome | `geocode_status` | `geocode_attempts` | Next attempt |
|---|---|---|---|
| Cache hit, or provider returned a street-level match | `resolved` | — | never |
| Provider answered at locality/region granularity → centroid | `fallback` | **+1** | `now() + 7 days` |
| Provider answered `null` — no match for this address → centroid | `fallback` | **+1** | `now() + 7 days` |
| Provider **unavailable** — circuit-breaker open, 429, timeout, network → centroid | `fallback` | **unchanged** | `now() + 30 min` |
| **Monthly quota exhausted**, or `MAPTILER_API_KEY` absent → centroid | `fallback` | **unchanged** | start of next month |
| **Credential refused** — 401, or 403 identified as a key refusal → centroid | `fallback` | **unchanged** | **1 hour**, circuit latched. Log at error |
| Provider returned a point but the comuna could not be cross-checked (no `comuna_id`, or no `municipality.*`) | `fallback` | **+1** | `now() + 7 days`. **Keep the provider's point**, not a centroid — see Fase 0 |
| 2 attempts exhausted | `unresolvable` | 2 | never |
| No `comuna_id` and no provider answer | `unresolvable` | — | never |

Two rules do the work here.

**A refused credential is not an outage, and must not be retried like one.** Fase 0 measured a 403 from a User-Agent-restricted key — indistinguishable from an `api_error` to any classifier that only asks "did the call fail". Left in the transport bucket it re-arms every thirty minutes forever: a worker that looks busy, spends nothing and geocodes nothing, while every order sits on a comuna centroid. So a refused credential trips a latched circuit for an hour and logs at error level. A wrong key must be loud within one cron tick, not inferred a week later from the `fallback` count. The latch is **one hour and not "until restart"**, because 403 is ambiguous: MapTiler also uses it for plan limits, and a permanent latch would turn a transient rate-limit into a month with every order on a centroid and `geocode_attempts` never incrementing — no signal in the counts at all, which is the very failure Decision 4 exists to prevent. Fase 4 owns measuring the discriminator between the two kinds of 403.

**A transport failure is not evidence about the address**, so it must not consume the attempt budget. That is what stops a provider outage of any length from marching a day's orders to `unresolvable` — it re-arms every 30 minutes indefinitely. Quota exhaustion and a missing key get their own row because they do not clear in half an hour: re-arming those every 30 minutes would churn the entire order book through the batch all month doing no useful work.

**A real answer — coarse or null — is evidence, and retrying it is nearly pure spend.** A deterministic geocoder returns the same coarse answer to the same query, so an aggressive ladder would buy several paid lookups per bad address with an expected yield near zero, applied to the ~20 % of the corpus the accuracy gate already tolerates. Hence one retry at 7 days (long enough for the provider's data to have actually changed), then stop. The realistic re-query volume is *(coarse + null share) × monthly order volume* — each bad address is re-queried exactly once, and the 7 days is a delay, not a divisor. State that figure against `MAPTILER_MONTHLY_QUOTA` when the quota value is chosen; this retry policy is the single largest driver of the monthly number.

**Quota counter.** `MAPTILER_MONTHLY_QUOTA` is enforced against a Redis counter keyed by month (`geocode:quota:YYYY-MM`) with a TTL past month end, on the Redis that BullMQ already requires. It must not live in process memory: `CircuitBreaker` keeps its state in private in-process fields (`providers/circuit-breaker.ts:16-18`), and an in-memory quota counter would silently reset on every restart and every deploy while this table treats "quota exhausted" as a first-class outcome.

`orders.comuna_id` is nullable and `get_unmatched_comunas()` exists precisely because unmatched comunas are a live problem, so the no-comuna case is real and must terminate rather than loop forever.

**Coordinates held by an `unresolvable` row differ by path**, and spec-59 renders the two differently, so the invariant is stated rather than left to guess:

- *2 attempts exhausted* — holds the comuna centroid, `precision='approximate'`. spec-59 draws a hollow marker.
- *No `comuna_id`* — `latitude` / `longitude` stay NULL. spec-59 excludes it from the map and counts it under "sin ubicación".

**Surfacing `unresolvable`.** Manual correction is a Non-Goal, so **nothing can move a row out of this state, and `unresolvable` is genuinely terminal today.** No workflow is implied, because none exists: there is no `.from('orders').update(` anywhere in `apps/frontend/src`, and nothing outside intake writes `delivery_address`. An operator who spots a wrong pin has no in-app way to fix it. What this phase provides is visibility, not remedy: the worker logs a per-run count of `resolved` / `fallback` / `unresolvable` rows and of provider calls made versus cache hits. Fase 1's reset trigger is **forward-looking** — it protects re-intake of a corrected address and whatever correction UI a later spec adds; it is not a remedy available now.

#### Tests (Vitest, written first)

- A `fallback` row is re-claimed once `geocode_next_attempt_at` has passed and **not** before; a `resolved` row is never re-claimed.
- A coarse answer increments `geocode_attempts`; a null answer also increments it; a circuit-breaker / quota / 429 / timeout does **not**.
- The 2nd coarse-or-null attempt lands `unresolvable` holding a centroid.
- An order with no `comuna_id` and no provider answer lands `unresolvable` with NULL coordinates.
- Neither centroid nor coarse results are written to the cache, and a `fallback` row therefore re-queries the provider on its next run rather than re-reading a frozen answer.
- The circuit breaker opens and the job continues via centroid fallback, marking rows `fallback` (not `resolved`).
- The quota guard stops calling the provider once exhausted, and its rows are `fallback`.
- Missing `MAPTILER_API_KEY`: the worker boots and resolves to centroids.

#### QA before this phase closes

Deploy the agents worker to QA with the key set, seed a handful of QA orders with real Santiago addresses, let one cron tick run, and read the per-run log: calls made, cache hits, and the three status counts. A green PR check does not prove the migration applied — `deploy.yml`'s path filter can skip the DB job entirely.



> **On the single name in `**Depende de:**`.** This phase genuinely needs fases 1, 2, 3 and 4. It names fase 4 because fase 4 is the last of them to land — 1 gates 2 and 3, and nothing gates 4 except fase 0. The single name must not be read as "the other three are optional".

---

### Fase 6 — Accuracy gate, before any bulk write `[blocked]`

**Depende de:** spec-58 fase 4

**Where it runs:** on the VPS, as a one-off script against a checked-out branch — *not* a service deploy. It uses the production Supabase service key already in `/home/aureon/.env`, which is also where `MAPTILER_API_KEY` must be placed first. Running it from a laptop would mean copying a production service key onto a laptop, so it does not happen there.

Run the resolver against a sample of **200 real production `delivery_address` values**, sampled across comunas rather than from a single client, with cache writes disabled (dry run):

| Metric | Threshold |
|---|---|
| `exact` (street-level or better) | ≥ 80 % |
| `approximate` (centroid fallback) | ≤ 20 % |
| Provider hard failures | ≈ 0 % |

**If `exact` lands materially below 80 %, stop and re-evaluate the provider.** This is why the gate precedes the backfill: afterwards there is no cheap swap, because `geocode_cache` and `orders.latitude` are both fully written and this spec specifies no cache-purge or re-geocode procedure.

A precision distribution cannot catch a systematically-shifted-yet-plausible result, so also eyeball 20 resolved points against their addresses before declaring the gate passed.

The sampling and grading script lives under `scripts/`. The resulting numbers are written back **into this section** — the phase is not `[done]` until they are.

> Bloqueo: se intentó acotar la fase a algo que un agente pueda cerrar por su cuenta y no se puede — lee direcciones reales de la Supabase de producción con la service key de `/home/aureon/.env` y gasta cuota del proveedor; verificado contra `CLAUDE.md`, que prohíbe tocar el VPS salvo que el usuario lo pida — 2026-09-11 — desbloquea: usuario (visto bueno explícito a la corrida en el VPS). La key ya **no** es parte de este bloqueo: existe desde la fase 0, pero sigue sin colocarse en `/home/aureon/.env`, y colocarla es del usuario.


---

### Fase 7 — Backfill of the existing order history `[blocked]`

**Depende de:** spec-58 fase 6

A one-off script under `scripts/` handles the orders that already exist, **importing the same resolver** the worker uses — not a second implementation of it. Production is roughly 112k dispatches and 61k packages, so this is the phase where a naive loop times out: batch it, and make it resumable.

Then let the cron drain whatever the script leaves and watch, for a day: cache hit rate, provider call count, and the `fallback` / `unresolvable` counts. Only then does spec-59 start.

> Bloqueo: se intentó adelantar el backfill a las fases tomables por un agente y no procede — la Decisión 5 lo condiciona a que el gate de la fase 6 pase, y esa fase está bloqueada en el usuario; verificado contra la Decisión 5 de este mismo spec y contra el tamaño real del corpus de producción (~112k despachos), que es lo que vuelve irreversible un backfill mal medido — 2026-09-11 — desbloquea: dependencia (spec-58 fase 6), y después el usuario para la corrida en producción


---

## Rollout order

1. ~~Fase 0~~ — done 2026-09-11. The key exists and the mapping rule is measured, not assumed.
2. Fases 1 and 2 (schema, serialised), then 3 and 4.
3. Fase 5, verified in QA.
4. Fase 6, the gate. Do not proceed on a failure.
5. Fase 7, the backfill, then a day of watching the counts.
6. Only then, spec-59.

Fases 1, 2 and 3 need no MapTiler key and can start today. Fase 4 is unblocked too, now that Fase 0 is `[done]`.
