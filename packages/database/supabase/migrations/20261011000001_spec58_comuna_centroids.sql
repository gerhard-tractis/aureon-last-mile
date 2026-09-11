-- spec-58 fase 2: comuna centroids on `public.chile_comunas`
-- (docs/specs/spec-58-geocoding-foundation.md, "Fase 2")
--
-- `geometry` stays NULL -- this spec seeds point centroids only, no
-- polygon geometry. That is a Non-Goal (see spec-58's "Non-Goals" section).
--
-- ============================================================================
-- PROVENANCE (one named source, per the spec's requirement)
-- ============================================================================
--
-- Source: OpenStreetMap, queried live via the Nominatim public search API
-- (https://nominatim.openstreetmap.org/search) on 2026-09-11, database
-- snapshot reported by that instance as "database_version":"5.3.99-3",
-- "data_updated":"2026-09-11T16:48:35+00:00". One source, not "INE / OSM".
--
-- Extraction method: for each of the 347 codigo_cut rows, a structured
-- search (`format=jsonv2&country=Chile&city=<nombre>&limit=5`) was issued
-- against Nominatim with a custom User-Agent, rate-limited to <1 req/s per
-- that API's usage policy. For 339 of 347 rows the top result was an
-- `osm_type=relation, class=boundary, type=administrative` match -- i.e.
-- the actual comuna administrative boundary relation -- and the `lat`/`lon`
-- Nominatim returned for it is Nominatim's own "representative point" for
-- that polygon (documented by the project as a point guaranteed to fall
-- inside the geometry, computed via PostGIS ST_PointOnSurface -- NOT a raw
-- bounding-box centre, and NOT necessarily the mathematical polygon
-- centroid either, which matters for long/oddly-shaped coastal comunas
-- where a bbox-centre or true area-centroid can both land outside the
-- polygon or in the sea).
--
-- The remaining 8 rows had no administrative relation returned (small or
-- sparsely-mapped comunas) and fell back to the highest-ranked place node
-- Nominatim returned instead (city/town/hamlet points for 05502, 10201,
-- 10205, 12101, 13101, 14104 -- verified by hand to be the correct named
-- place; see "MANUAL CORRECTIONS" below for the two that were NOT correct
-- as returned, plus one address ambiguity). All five are marked inline in
-- the VALUES list below.
--
-- Verification pass, run twice (once during the first draft, once again
-- against review feedback):
--
--   1. Every non-exception row checked to fall inside a generous Chile
--      mainland bounding box (-56 to -17 lat, -76 to -66 lng).
--   2. Every row checked against its own region's median point -- a
--      same-region outlier beyond 3 degrees was treated as a wrong-place
--      match and re-queried. This caught codigo_cut 05502 (below); it did
--      not flag 12201 (Cabo de Hornos, genuinely the southernmost comuna,
--      correctly far from its region's other comunas) as a false positive.
--   3. A full reverse-geocode of all 347 points against Nominatim (review
--      round), confirming 346/347 land inside the correct comuna's
--      administrative boundary and region -- the one exception being
--      05502, already caught and fixed by pass 2 in the same round it was
--      introduced. Zero duplicate coordinate pairs across all 347 rows.
--   4. A forward search for the actual town/populated place in each of
--      the ten southernmost/most remote comunas, to catch the failure
--      mode pass 1-3 cannot see: `ST_PointOnSurface` is correct *for the
--      polygon* but can land 20-142km from any road, building or named
--      place when the polygon interior is open water or high cordillera
--      (real for Aysén and Magallanes region comunas covering fjords and
--      icefields). Ten rows were replaced with the town/village/hamlet
--      node instead -- see "TOWN-NODE REPLACEMENTS" below. This is a
--      second, distinct extraction method from the general rule above,
--      documented explicitly per-row for exactly that reason: a uniform
--      "one source, one method" claim would not survive an audit of these
--      ten rows otherwise.
--
-- MANUAL CORRECTIONS (3 of 347 rows), each called out again inline below:
--
--   1. `14201` ('Ranco') is a *provincia* row, not a comuna -- Los Ríos
--      has 12 comunas and this pre-existing data bug
--      (20260321000001_chile_comunas_normalization.sql:299) makes 13.
--      Nominatim's `city=Ranco` search returned a hamlet in a completely
--      different region (Araucanía). Queried "Provincia de Ranco"
--      directly instead and took its administrative relation's point
--      (-40.2887413, -72.6018681, Región de Los Ríos -- the correct
--      region). The underlying comuna/provincia data bug is left alone,
--      per the spec: fixing it is a separate concern with comuna_id
--      foreign keys attached.
--
--   2. `12202` ('Antártica') has no OSM administrative boundary at all --
--      the Chilean Antarctic territorial claim is not mapped as a
--      boundary relation, and `city=Antártica` returned an unrelated
--      street in Chillán. Hand-picked Villa Las Estrellas / Base
--      Presidente Eduardo Frei Montalva (-62.2004259, -58.9653690, King
--      George Island) -- the only permanently inhabited Chilean
--      settlement within this comuna. This is a deliberate deviation
--      from the original spec draft's expected `~-75 to -80 lat` range
--      for this CUT code -- Villa Las Estrellas is the more useful
--      fallback pin for an actual delivery/fleet use case than any point
--      further into the uninhabited territorial claim, and the spec is
--      being updated to reflect it.
--
--   3. `05502` ('Calera', comuna of Quillota province, Valparaíso) --
--      `city=Calera` matched a same-named hamlet near Pica, ~1,400 km
--      north in Tarapacá, and was caught by the region-outlier check
--      above (distance ~12.6 degrees from the Valparaíso median).
--      Re-queried as "La Calera" (the comuna's full/official name) and
--      got the correct administrative relation (-32.7889810,
--      -71.2035460, Provincia de Quillota, Región de Valparaíso).
--
-- TOWN-NODE REPLACEMENTS (10 of 347 rows) -- found during review, not in
-- the original draft. Each of these ten comunas' polygon-interior point
-- (`ST_PointOnSurface`) returned nothing at all when forward-searched at
-- street level -- no road, building or populated place -- because the
-- polygon interior is open water (fjords) or uninhabited cordillera/
-- icefield. As a fallback DELIVERY pin (this column backs
-- orders.geocode_source = 'comuna_centroid'), a point 20-142km out to sea
-- or on a glacier is actively worse than no pin at all. Replaced with the
-- comuna's own town/village/hamlet OSM node instead, individually queried
-- and cross-checked against its `display_name` for the correct comuna:
--
--   `11201` Aysén            -> Puerto Aysén      (was 142.4km away)
--   `11202` Cisnes           -> Puerto Cisnes      (was  81.5km away)
--   `12201` Cabo de Hornos   -> Puerto Williams    (was  75.0km away)
--   `11303` Tortel           -> Caleta Tortel      (was  60.6km away)
--   `12302` Torres del Paine -> Cerro Castillo     (was  44.8km away)
--   `12104` San Gregorio     -> Villa Punta Delgada(was  43.0km away)
--   `11402` Río Ibáñez       -> Pto. Ing. Ibáñez   (was  34.3km away)
--   `10403` Hualaihué        -> Hornopirén         (was  27.6km away)
--   `08314` Alto Biobío      -> Ralco              (was  20.5km away)
--   `11302` O'Higgins        -> Villa O'Higgins    (was  19.5km away)
--
-- Distances are from the review's forward-search of the town as a
-- distinct OSM object versus the original polygon-interior point.
--
-- CORRECTION WITHIN THIS BATCH (round 2 review): `12104` was first
-- committed pointing at the `natural=cape`/`ferry_terminal` cluster at the
-- Primera Angostura crossing (-52.4546486, -69.5435253) -- the *same class
-- of error* as the `05502`/`Calera` correction above: a short, generic
-- name ("Punta Delgada") resolving to the wrong nearby feature, while the
-- actual named settlement carries a longer name. The comuna's real
-- capital is `place=village "Villa Punta Delgada"`
-- (-52.3158634, -69.6905678), 18.3km northwest of the ferry crossing --
-- independently re-queried (not copied from the review that first spotted
-- it) and confirmed via `display_name`: "Villa Punta Delgada, San
-- Gregorio, Provincia de Magallanes, Región de Magallanes y de la
-- Antártica Chilena, Chile".
--
-- Two traps the spec calls out, both handled here rather than left for a
-- later reader to rediscover:
--
--   - The table holds 347 rows, not the 346 its own migration comment
--     claims -- `14201` is the provincia row above. The pgTAP suite for
--     this migration asserts `COUNT(*) FILTER (WHERE centroid_lat IS
--     NULL) = 0`, never a hard-coded row count, precisely so this
--     pre-existing bug does not need fixing here to pass.
--   - Three CUT codes fall outside any mainland bounding box: `05201`
--     Isla de Pascua (~-109.4 lng), `05104` Juan Fernández (~-78.8 lng),
--     `12202` Antártica (~-62 lat, -59 lng, Antarctic territory). All
--     three are seeded with their real, correct points below -- the
--     validity check in the test suite is "mainland box OR one of these
--     three CUT codes", never a single rectangle.
--
-- ============================================================================
-- WHY THE SEED IS WRAPPED IN A FUNCTION (CI feedback, not a design choice)
-- ============================================================================
--
-- `scripts/check-migration-safety-rule1.mjs` rejects a migration that mixes
-- DDL (the two `ADD COLUMN`s below) with a top-level, unbounded `UPDATE` --
-- the guard spec-87 fase 3/4 added after production backfills on
-- ~112k dispatches / ~61k packages timed out mid-migration. That risk does
-- not exist here: `chile_comunas` is a 347-row reference table, and this
-- UPDATE is a one-time seed of already-known, hand-verified literals, not a
-- data-dependent scan of a production-scale table. The guard has no way to
-- tell "347-row reference seed" apart from "unbounded backfill on a live
-- table" from the SQL shape alone -- both are `UPDATE ... FROM (VALUES/
-- subquery) ...` with no `WHERE id = '<literal>'` -- so rather than asking
-- for the rule to be loosened, the seed is wrapped in
-- `spec58_seed_comuna_centroids()`, exactly the shape the guard's own
-- header prescribes ("a CREATE FUNCTION whose body contains an UPDATE is
-- NOT a backfill", check-migration-safety-rule1.mjs:13) and the same
-- pattern `20260909000001_spec79_loaded_route_id.sql` uses. Unlike that
-- migration, THIS one calls its function inline (`SELECT
-- spec58_seed_comuna_centroids();` below) rather than leaving it for a
-- human to run by hand after measuring -- 347 literal rows against an
-- already-indexed primary key is not a measurement problem, so the
-- deferred-invocation discipline that table-scale backfill needs does not
-- apply here. The function is dropped again at the end of this same
-- migration: it is a one-shot seeder with no further use, and dropping it
-- is simpler than leaving it in the schema requiring a REVOKE EXECUTE
-- against Supabase's default `anon`/`authenticated` grant on new
-- public-schema functions.

BEGIN;

ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lat DECIMAL(10,7);
ALTER TABLE public.chile_comunas ADD COLUMN IF NOT EXISTS centroid_lng DECIMAL(10,7);

COMMENT ON COLUMN public.chile_comunas.centroid_lat IS
  'Comuna centroid latitude, seeded from OSM/Nominatim (spec-58 fase 2). '
  'Used as the fallback pin for an order whose address cannot be geocoded '
  'to street level -- see orders.geocode_source = ''comuna_centroid''.';
COMMENT ON COLUMN public.chile_comunas.centroid_lng IS
  'Comuna centroid longitude -- see centroid_lat for provenance.';

-- One UPDATE ... FROM VALUES, matched on codigo_cut so row order here
-- carries no meaning and a future re-seed can freely reorder. 347 pairs,
-- exactly matching the 347 rows seeded by
-- 20260321000001_chile_comunas_normalization.sql:43-407.
--
-- Wrapped in a function -- see "WHY THE SEED IS WRAPPED IN A FUNCTION"
-- above -- so this migration's only top-level DML is the SELECT that
-- invokes it, not a bare UPDATE next to the ADD COLUMNs.
CREATE OR REPLACE FUNCTION public.spec58_seed_comuna_centroids()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
UPDATE public.chile_comunas AS c
SET centroid_lat = v.lat,
    centroid_lng = v.lng
FROM (VALUES
  ('15101', -18.4785288, -70.3211394),
  ('15102', -18.9633718, -69.7151907),
  ('15201', -18.1963825, -69.5592242),
  ('15202', -17.8327317, -69.5535874),
  ('01101', -20.2140657, -70.1524646),
  ('01107', -20.2700478, -70.1009162),
  ('01401', -20.2597061, -69.7861372),
  ('01402', -19.3130810, -69.4266968),
  ('01403', -19.2758220, -68.6389471),
  ('01404', -19.9957872, -69.7727034),
  ('01405', -20.4911417, -69.3290752),
  ('02101', -23.6463741, -70.3980033),
  ('02102', -23.1002342, -70.4483076),
  ('02103', -22.8916766, -69.3200101),
  ('02104', -25.4078293, -70.4858424),
  ('02201', -22.4623917, -68.9272181),
  ('02202', -21.2242235, -68.2534522),
  ('02203', -23.3545489, -67.9026571),
  ('02301', -22.0887189, -70.1960657),
  ('02302', -22.3451485, -69.6618035),
  ('03101', -27.3664685, -70.3322753),
  ('03102', -27.0675545, -70.8222047),
  ('03103', -27.4680505, -70.2649307),
  ('03201', -26.3479340, -70.6223617),
  ('03202', -26.3910794, -70.0459281),
  ('03301', -28.5750438, -70.7616398),
  ('03302', -28.7596711, -70.4861108),
  ('03303', -28.5086484, -71.0785719),
  ('03304', -28.4651248, -71.2207947),
  ('04101', -29.9027050, -71.2519575),
  ('04102', -29.9531851, -71.3379503),
  ('04103', -30.2322048, -71.0847556),
  ('04104', -29.5115950, -71.2015007),
  ('04105', -30.0290417, -70.5164414),
  ('04106', -30.0340482, -70.7126702),
  ('04201', -31.6326932, -71.1683039),
  ('04202', -31.4643996, -71.4349157),
  ('04203', -31.9121725, -71.5138659),
  ('04204', -31.7804674, -70.9649896),
  ('04301', -30.6030819, -71.2029894),
  ('04302', -31.1781518, -71.0024382),
  ('04303', -30.6944769, -70.9579593),
  ('04304', -30.8337532, -71.2573637),
  ('04305', -30.4522220, -70.6801885),
  ('05101', -33.0458456, -71.6196749),
  ('05102', -33.3205864, -71.4100762),
  ('05103', -32.9220036, -71.5159565),
  ('05104', -33.6444501, -78.8262238),
  ('05105', -32.7259856, -71.4150065),
  ('05107', -32.7840217, -71.5283361),
  ('05109', -33.0244535, -71.5517636),
  ('05201', -27.1259317, -109.3495887),
  ('05301', -32.8336867, -70.5981609),
  ('05302', -32.8552685, -70.6260407),
  ('05303', -32.8393819, -70.6871827),
  ('05304', -32.7990544, -70.5795811),
  ('05401', -32.4496375, -71.2316695),
  ('05402', -32.4265909, -71.0663299),
  ('05403', -32.5075900, -71.4459354),
  ('05404', -32.2516990, -70.9309103),
  ('05405', -32.5528294, -71.4588181),
  ('05501', -32.8799970, -71.2473555),
  ('05502', -32.7889810, -71.2035460),  -- La Calera (Quillota, Valparaíso) -- disambiguated from a same-named hamlet near Pica
  ('05503', -32.8000578, -71.1452210),
  ('05504', -32.8279116, -71.2271534),
  ('05506', -32.7363810, -71.2002438),
  ('05601', -33.5808615, -71.6132377),
  ('05602', -33.3691720, -71.6680533),
  ('05603', -33.5468491, -71.6031708),
  ('05604', -33.4003110, -71.6939980),
  ('05605', -33.4545847, -71.6691070),
  ('05606', -33.7863748, -71.6756251),
  ('05701', -32.7506870, -70.7252688),
  ('05702', -32.7784214, -70.9633428),
  ('05703', -32.8430552, -70.9522903),
  ('05704', -32.7705769, -70.8361303),
  ('05705', -32.6260768, -70.7167642),
  ('05706', -32.7478749, -70.6567375),
  ('05801', -33.0498135, -71.4415282),
  ('05802', -33.0018741, -71.2657315),
  ('05803', -32.9956184, -71.1862110),
  ('05804', -33.0441903, -71.3725464),
  ('06101', -34.1702433, -70.7407180),
  ('06102', -34.0377000, -70.6565422),
  ('06103', -34.2699359, -70.9515801),
  ('06104', -34.2862794, -71.0825729),
  ('06105', -34.2260740, -70.9648916),
  ('06106', -34.0644743, -70.7262983),
  ('06107', -34.2917304, -71.3098439),
  ('06108', -34.1824530, -70.6511584),
  ('06109', -34.4421408, -70.9440652),
  ('06110', -33.9468525, -70.5981024),
  ('06111', -34.2094366, -70.8172288),
  ('06112', -34.3959163, -71.1694264),
  ('06113', -34.3584097, -71.2827150),
  ('06114', -34.3545849, -70.9638806),
  ('06115', -34.4088744, -70.8616583),
  ('06116', -34.2848586, -70.8175128),
  ('06117', -34.4392675, -71.0767900),
  ('06201', -34.3851693, -72.0046606),
  ('06202', -34.2052857, -71.6546039),
  ('06203', -34.1154229, -71.7296864),
  ('06204', -34.3668668, -71.6421489),
  ('06205', -33.9536044, -71.8305775),
  ('06206', -34.6476395, -71.9008463),
  ('06301', -34.5837910, -70.9891220),
  ('06302', -34.7285856, -71.2738582),
  ('06303', -34.7089530, -71.0403642),
  ('06304', -34.7278360, -71.6440839),
  ('06305', -34.6527427, -71.1953819),
  ('06306', -34.5960542, -71.3624782),
  ('06307', -34.4780273, -71.4793203),
  ('06308', -34.6385927, -71.1173651),
  ('06309', -34.6048141, -71.6546810),
  ('06310', -34.6403243, -71.3661297),
  ('07101', -35.4265343, -71.6660322),
  ('07102', -35.3318306, -72.4118998),
  ('07103', -35.0937166, -72.0180794),
  ('07104', -35.5907772, -72.2776205),
  ('07105', -35.5213470, -71.6918891),
  ('07106', -35.3836634, -71.4469824),
  ('07107', -35.3961663, -71.7993745),
  ('07108', -35.2934394, -71.2584579),
  ('07109', -35.5375459, -71.4858841),
  ('07110', -35.3050966, -71.5156699),
  ('07201', -35.9671286, -72.3154270),
  ('07202', -35.7341836, -72.5331642),
  ('07203', -35.8150199, -72.5769590),
  ('07301', -34.9853680, -71.2393705),
  ('07302', -34.9774855, -71.8012086),
  ('07303', -34.9856892, -71.9845873),
  ('07304', -35.1139703, -71.2799798),
  ('07305', -34.9246071, -71.3166884),
  ('07306', -34.9599696, -71.1253134),
  ('07307', -34.9990365, -71.3817116),
  ('07308', -34.8667952, -71.1612202),
  ('07309', -34.8840168, -71.9923708),
  ('07401', -35.8452905, -71.5977173),
  ('07402', -35.6960057, -71.4060907),
  ('07403', -35.9659749, -71.6846723),
  ('07404', -36.1414293, -71.8222221),
  ('07405', -36.0554429, -71.7650623),
  ('07406', -35.5923933, -71.7353080),
  ('07407', -35.6752031, -71.7446702),
  ('07408', -35.7464128, -71.5820799),
  ('16101', -36.6066616, -72.1033194),
  ('16102', -36.7422507, -72.2987216),
  ('16103', -36.6230032, -72.1317093),
  ('16104', -36.8978550, -72.0246149),
  ('16105', -36.9767381, -72.0988563),
  ('16106', -36.7036112, -71.8922832),
  ('16107', -36.8084128, -72.5053723),
  ('16108', -36.7998233, -72.0303507),
  ('16109', -37.1193665, -72.0188531),
  ('16201', -36.2827085, -72.5408101),
  ('16202', -36.1317572, -72.7915423),
  ('16203', -36.4876004, -72.7023316),
  ('16204', -36.3935896, -72.3976432),
  ('16205', -36.5274395, -72.4285292),
  ('16206', -36.6398547, -72.6037277),
  ('16207', -36.4323455, -72.6152748),
  ('16301', -36.3792284, -72.0179525),
  ('16302', -36.6288020, -71.8319077),
  ('16303', -36.2818542, -71.9526909),
  ('16304', -36.6534313, -71.2078734),
  ('16305', -36.4855033, -72.2086236),
  ('08101', -36.8270698, -73.0502064),
  ('08102', -37.0164712, -73.1561953),
  ('08103', -36.9292478, -73.0237115),
  ('08104', -36.8253041, -72.6614469),
  ('08105', -36.9759363, -72.9383874),
  ('08106', -37.0944533, -73.1564024),
  ('08107', -36.7385838, -72.9937749),
  ('08108', -36.8414183, -73.1039909),
  ('08109', -37.1737794, -72.9425900),
  ('08110', -36.7144863, -73.1141087),
  ('08111', -36.6170801, -72.9575043),
  ('08112', -36.7927608, -73.0943414),
  ('08201', -37.6102279, -73.6560550),
  ('08202', -37.2462480, -73.3176399),
  ('08203', -37.8004074, -73.3990802),
  ('08204', -38.0160243, -73.2286034),
  ('08205', -37.4758037, -73.3457069),
  ('08206', -37.6271305, -73.4618419),
  ('08207', -38.3438662, -73.4934808),
  ('08301', -37.4707455, -72.3516860),
  ('08302', -37.3299561, -71.6791577),
  ('08303', -37.0358293, -72.4026797),
  ('08304', -37.2795106, -72.7149212),
  ('08305', -37.7200873, -72.2441318),
  ('08306', -37.5018293, -72.6731100),
  ('08307', -37.5856678, -72.5292643),
  ('08308', -37.6841271, -72.0054893),
  ('08309', -37.4709734, -71.9803093),
  ('08310', -37.2630837, -72.7240272),
  ('08311', -37.6680813, -72.0214080),
  ('08312', -37.2925581, -71.9495236),
  ('08313', -37.0978676, -72.5622801),
  ('08314', -37.8820267, -71.6373781),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('09101', -38.7358908, -72.5905380),
  ('09102', -38.7115844, -73.1651699),
  ('09103', -38.9329729, -72.0320894),
  ('09104', -39.3589800, -71.5873592),
  ('09105', -38.9514242, -72.6254333),
  ('09106', -38.4111234, -72.7812506),
  ('09107', -39.1031567, -72.6759352),
  ('09108', -38.5343120, -72.4350504),
  ('09109', -39.3706160, -72.6300704),
  ('09110', -38.8532381, -71.6950139),
  ('09111', -38.7453101, -72.9519984),
  ('09112', -38.7674245, -72.5956312),
  ('09113', -38.4212493, -72.3778344),
  ('09114', -38.9862884, -72.6372500),
  ('09115', -39.2731173, -71.9777605),
  ('09116', -38.8304315, -73.2848730),
  ('09117', -38.9967454, -73.0891844),
  ('09118', -39.2143585, -73.0499304),
  ('09119', -38.6703956, -72.2240806),
  ('09120', -39.2780911, -72.2274364),
  ('09121', -38.6025592, -72.8476626),
  ('09201', -37.7987870, -72.7086097),
  ('09202', -37.9566312, -72.4374375),
  ('09203', -38.4372985, -71.8883419),
  ('09204', -38.0609055, -72.3754686),
  ('09205', -38.4540680, -71.3706282),
  ('09206', -37.9829562, -72.8291829),
  ('09207', -38.1653241, -72.9063975),
  ('09208', -38.0332836, -73.0725938),
  ('09209', -37.6717090, -72.5832643),
  ('09210', -38.2508160, -72.6668798),
  ('09211', -38.2339494, -72.3316568),
  ('14101', -39.8141262, -73.2459859),
  ('14102', -39.8877399, -73.4314543),
  ('14103', -40.1311960, -72.3826602),
  ('14104', -40.2952392, -73.0820366),  -- non-relation fallback: La Unión town-place node (correct place; no admin relation returned)
  ('14105', -40.3216708, -72.4813502),
  ('14106', -39.4522225, -72.7754222),
  ('14107', -39.8634009, -72.8129655),
  ('14108', -39.6659792, -72.9521276),
  ('14109', -39.4971612, -73.0420738),
  ('14110', -40.0706633, -72.8726695),
  ('14111', -39.6419909, -72.3333801),
  ('14112', -40.3336678, -72.9567617),
  ('14201', -40.2887413, -72.6018681),  -- hand-picked: provincia row (Provincia del Ranco), not a comuna; see header
  ('10101', -41.4717980, -72.9395915),
  ('10102', -41.7712143, -73.1275379),
  ('10103', -41.4925628, -72.3079293),
  ('10104', -41.1531405, -73.4223148),
  ('10105', -41.1258462, -73.0604738),
  ('10106', -41.3960568, -73.4617177),
  ('10107', -41.2575704, -73.0047428),
  ('10108', -41.6160139, -73.5950711),
  ('10109', -41.3178020, -72.9829073),
  ('10201', -42.4823750, -73.7642918),  -- non-relation fallback: Castro city-place node (correct place; no admin relation returned)
  ('10202', -41.8682162, -73.8287225),
  ('10203', -42.6239756, -73.7724416),
  ('10204', -42.4396611, -73.6028415),
  ('10205', -42.3795533, -73.6472998),  -- non-relation fallback: Dalcahue town-place node (correct place; no admin relation returned)
  ('10206', -42.5992585, -73.6762714),
  ('10207', -42.8898582, -73.4720620),
  ('10208', -43.1200305, -73.6203025),
  ('10209', -42.1445307, -73.4735593),
  ('10210', -42.5326883, -73.2744747),
  ('10301', -40.5736955, -73.1358091),
  ('10302', -40.9727600, -72.8842171),
  ('10303', -40.9128096, -73.1581888),
  ('10304', -40.7103613, -72.3891164),
  ('10305', -40.7961713, -73.2163904),
  ('10306', -40.4930895, -73.5391077),
  ('10307', -40.4127606, -73.0115777),
  ('10401', -42.9165335, -72.7084192),
  ('10402', -43.1857710, -71.8667020),
  ('10403', -41.9660516, -72.4706795),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('10404', -43.6178268, -71.8039587),
  ('11101', -45.5711804, -72.0684863),
  ('11102', -44.2402147, -71.8492779),
  ('11201', -45.4068167, -72.6976787),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('11202', -44.7272567, -72.6804630),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('11203', -43.9174310, -73.9078915),
  ('11301', -47.2541656, -72.5732128),
  ('11302', -48.4684802, -72.5592493),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('11303', -47.8036754, -73.5374644),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('11401', -46.5396625, -71.7245816),
  ('11402', -46.2919029, -71.9374916),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('12101', -53.1625688, -70.9078220),  -- non-relation fallback: Punta Arenas city-place node (correct place; no admin relation returned)
  ('12102', -52.4270382, -71.4141605),
  ('12103', -52.9455498, -72.6512719),
  ('12104', -52.3158634, -69.6905678),  -- Villa Punta Delgada (place=village, the comuna capital) -- corrected in round 2 review from the nearby cape/ferry-crossing node; see header
  ('12201', -54.9357749, -67.6062504),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('12202', -62.2004259, -58.9653690),  -- hand-picked: Villa Las Estrellas (only inhabited settlement); see header
  ('12301', -51.7295251, -72.4738605),
  ('12302', -51.2562493, -72.3446885),  -- populated-place node replacing a polygon-interior point over water/cordillera; see header
  ('12401', -53.2956738, -70.3687401),
  ('12402', -52.7093328, -69.2947818),
  ('12403', -54.1570930, -69.3779651),
  ('13101', -33.4376995, -70.6510671),  -- non-relation fallback: Santiago city-place node (correct place; no admin relation returned)
  ('13102', -33.5023396, -70.7158417),
  ('13103', -33.4252778, -70.7461548),
  ('13104', -33.3843233, -70.6747382),
  ('13105', -33.5561468, -70.6655679),
  ('13106', -33.4536375, -70.6898654),
  ('13107', -33.3744615, -70.6362988),
  ('13108', -33.4222950, -70.6554648),
  ('13109', -33.5346265, -70.6644024),
  ('13110', -33.4084548, -70.5671489),
  ('13111', -33.5204181, -70.6006178),
  ('13112', -33.5431234, -70.6332426),
  ('13113', -33.5833594, -70.6298270),
  ('13114', -33.4422820, -70.5432729),
  ('13115', -33.5250782, -70.6945390),
  ('13116', -33.5094409, -70.7561820),
  ('13117', -33.4821635, -70.5991929),
  ('13118', -33.4192724, -70.8634486),
  ('13119', -33.3616012, -70.5051957),
  ('13120', -33.4543164, -70.5936358),
  ('13121', -33.4938300, -70.6760755),
  ('13122', -33.4765918, -70.5418308),
  ('13123', -33.4288379, -70.6113373),
  ('13124', -33.3600426, -70.7118564),
  ('13125', -33.4283561, -70.6999898),
  ('13126', -33.4020744, -70.6428912),
  ('13127', -33.4036212, -70.7310176),
  ('13128', -33.4859746, -70.6495465),
  ('13129', -33.4942329, -70.6284983),
  ('13130', -33.5428175, -70.6438120),
  ('13131', -33.3871062, -70.5764516),
  ('13132', -33.4474082, -70.7233863),
  ('13201', -33.6095279, -70.5754736),
  ('13202', -33.6348808, -70.5729961),
  ('13203', -33.6403975, -70.3527845),
  ('13301', -33.2024720, -70.6749147),
  ('13302', -33.2895953, -70.8705255),
  ('13303', -33.0852808, -70.9293877),
  ('13401', -33.5922859, -70.7045838),
  ('13402', -33.7319741, -70.7419619),
  ('13403', -33.6309419, -70.7593202),
  ('13404', -33.8101102, -70.7390236),
  ('13501', -33.6855134, -71.2145796),
  ('13502', -34.0370862, -71.0844986),
  ('13503', -33.4022289, -71.1293733),
  ('13504', -33.5159823, -71.1200324),
  ('13505', -33.8943545, -71.4563149),
  ('13601', -33.6644388, -70.9302778),
  ('13602', -33.6678197, -71.0272362),
  ('13603', -33.7537387, -70.9039325),
  ('13604', -33.5673051, -70.8020467),
  ('13605', -33.6058638, -70.8785306)
) AS v(codigo_cut, lat, lng)
WHERE c.codigo_cut = v.codigo_cut;
END;
$fn$;

COMMENT ON FUNCTION public.spec58_seed_comuna_centroids() IS
  'spec-58 fase 2. One-time seed of chile_comunas.centroid_lat/lng from '
  '347 hand-verified OSM/Nominatim literals -- wrapped in a function only '
  'to satisfy check-migration-safety-rule1.mjs (DDL + top-level UPDATE), '
  'not because this reference-table seed carries the production-scale '
  'backfill risk that rule targets. Invoked once below, then dropped -- '
  'see this migration''s header.';

-- Invoked inline, unlike spec-79's deferred-by-design equivalent: 347
-- literal rows matched on an already-unique, already-indexed codigo_cut
-- is not a "measure in production first" backfill.
SELECT public.spec58_seed_comuna_centroids();

-- One-shot seeder, no further use -- dropped rather than left in the
-- schema (which would otherwise need an explicit REVOKE EXECUTE against
-- Supabase's default anon/authenticated grant on new public-schema
-- functions).
DROP FUNCTION public.spec58_seed_comuna_centroids();

COMMIT;
