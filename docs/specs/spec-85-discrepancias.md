# Spec-85: Discrepancias — un registro resoluble de lo que faltó o sobró

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (**su fase 2 consume esta tabla en vez de decidir un estado de bulto**), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (la merma de «Cierres de hoy» se lee de aquí), [spec-62](spec-62-reception-mobile.md) (recepción móvil, el otro productor), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (recepción consolidada por ruta), [spec-43](spec-43-failed-delivery-return-flow.md) (entrega fallida y retorno), [spec-55](spec-55-carton-expansion.md) (bultos minteados que también pueden faltar)

**Status:** in progress
**Verify:** unit, sql, e2e-qa
**Downstream:** spec-80-recogida-movil-cierre-de-carga.md, spec-83-recogida-escritorio-datos-faltantes.md, spec-86-discrepancias-de-recepcion.md

_Date: 2026-09-07_

---

## Goal

Una tabla `discrepancies` con ciclo de vida propio: qué bulto faltó o sobró, **en qué operación**, quién lo detectó, y cómo se resolvió.

Hoy no existe nada equivalente. Lo más cercano es `discrepancy_notes` — `(operator_id, manifest_id, package_id, note, created_by_user_id)` — que es **sólo texto**: no tiene tipo, ni operación, ni estado, ni resolución. Cinco filas vivas en QA, así que migrarla es trivial.

## Por qué esto va primero

**Recogida y Recepción tienen el mismo problema y lo van a resolver en paralelo, en sesiones distintas.** Si cada una inventa su propio registro acabamos con dos tablas que responden la misma pregunta y ninguna que sirva de evidencia consolidada.

Esta spec entrega **el contrato compartido**: tabla, enums y RPCs. Luego cada módulo la consume:

| Quién | Cuándo | Qué escribe |
|---|---|---|
| **spec-85** (esta) | primero | tabla, enums, RPCs, migración de `discrepancy_notes` |
| **spec-80 fase 2** | después | al cerrar una carga, una fila por bulto sin verificar y por bulto ajeno |
| **Recepción** (sesión paralela) | después | lo mismo al cerrar una recepción |

**Nadie más toca el esquema de `discrepancies`.** Si al consumirla falta un campo, se pide aquí y se añade aquí — dos migraciones paralelas sobre la misma tabla es exactamente el choque que esta spec existe para evitar.

## Para qué sirve realmente

**Es la evidencia contra una indemnización.** El generador de carga reclama que entregó N bultos; la operación sostiene que recibió N-3. Lo que decide esa conversación es el registro de quién declaró qué, cuándo, y con qué firma detrás — no la memoria de nadie.

Por eso la fila apunta al respaldo firmado: en Recogida, el manifiesto que el local firmó (`manifest_documents`, spec-80 fase 3) es la prueba de que la cifra se aceptó en el momento. Una discrepancia sin ese vínculo vale mucho menos.

Y por eso **se resuelve, no se borra**: en Recepción el bulto puede aparecer físicamente, recibirse, y la discrepancia queda `resolved` con su historia. Si no aparece, pasa a `lost` — y eso es lo que en el futuro dispara el flujo de indemnización.

## Por qué no `exceptions`

`exceptions` ya existe y se le parece: `status` (`open, auto_resolving, auto_resolved, escalated, human_resolved, dismissed`), `resolved_by`, `resolved_at`, `resolution_notes`, y hasta `settlement_id`. Aun así no es el sitio:

- **La granularidad es otra.** `exceptions` cuelga de `order_id`. Una discrepancia es de **un bulto** — una carga puede quedar corta 3 bultos repartidos en 3 órdenes distintas, y el bulto es contra lo que el cliente firma. Mezclar grano de orden y grano de bulto en una tabla es de donde salen los bugs de «cuál id manda».
- **`exception_category_enum` no tiene nada parecido** — `late_delivery, driver_no_show, missing_pod, wrong_address, data_quality, customer_complaint, safety_incident, duplicate_submission, amount_mismatch, other`.
- **El ciclo de vida es distinto.** El de `exceptions` está pensado para agentes (`detected_by_agent`, `auto_resolution_strategy`, `escalated_at`). El de una discrepancia es físico: el bulto aparece o no aparece.

**Sí se referencia, no se duplica.** Cuando una discrepancia pasa a `lost`, el flujo de indemnización futuro cuelga de `exceptions`/`settlements` — que ya tienen esa maquinaria. Esta tabla no reimplementa liquidaciones.

---

## El modelo

### Las dos formas

`5e` las dibuja separadas y **no son simétricas en el esquema**:

- **`missing`** — declarado en el manifiesto y nunca escaneado. Hay `package_id`; no hay código leído.
- **`unexpected`** — escaneado y no pertenece a esta carga/recepción. **No hay `package_id`** — el bulto es ajeno, sólo existe el código de barras leído.

Un `CHECK` obliga a esa asimetría en vez de dejarla a la convención — cerrada
en las dos ramas: una `unexpected` con `package_id` no es sólo redundante, es
peligrosa (ver más abajo, por qué):

```sql
CONSTRAINT discrepancy_shape CHECK (
  (kind = 'missing'    AND package_id IS NOT NULL) OR
  (kind = 'unexpected' AND barcode IS NOT NULL AND package_id IS NULL)
)
```

### Una discrepancia abierta, por EVENTO — no una por bulto en toda su vida

El spec original decía «dos discrepancias abiertas en la misma operación» y
era ambiguo: ¿la misma *operación* como tipo (`pickup`/`reception`), o el
mismo *evento* (esta carga, esta recepción)? La implementación inicial lo leyó
como tipo; la decisión correcta es evento.

**Un bulto puede faltar el lunes en la carga A y otra vez el martes en la
carga B — son dos hechos distintos, y ambos son evidencia.** Bloquear la
segunda porque ya existe una discrepancia abierta sobre el mismo `package_id`
perdería la merma de la carga B.

Por eso la tabla tiene una columna generada que resuelve el origen sin
polimorfismo, indexable directamente:

```sql
source_id UUID GENERATED ALWAYS AS (COALESCE(manifest_id, route_reception_id)) STORED
```

Y el índice único de abiertas la incluye — ver más abajo.

### Tabla

```sql
CREATE TYPE public.discrepancy_kind_enum      AS ENUM ('missing', 'unexpected');
CREATE TYPE public.discrepancy_operation_enum AS ENUM ('pickup', 'reception');
CREATE TYPE public.discrepancy_status_enum    AS ENUM ('open', 'resolved', 'lost');

CREATE TABLE public.discrepancies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  kind           public.discrepancy_kind_enum      NOT NULL,
  operation_type public.discrepancy_operation_enum NOT NULL,
  status         public.discrepancy_status_enum    NOT NULL DEFAULT 'open',

  package_id     UUID REFERENCES public.packages(id),
  barcode        VARCHAR(100),

  -- Dónde ocurrió. Explícito y anulable por operación, NO polimórfico:
  -- un (source_type, source_id) sin FK real se corrompe en silencio y no se
  -- puede usar en RLS ni en un join.
  manifest_id        UUID REFERENCES public.manifests(id),
  route_reception_id UUID REFERENCES public.route_receptions(id),

  -- Origen indexable sin polimorfismo — ver "Una discrepancia abierta, por
  -- EVENTO" arriba.
  source_id UUID GENERATED ALWAYS AS (COALESCE(manifest_id, route_reception_id)) STORED,

  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by_user_id UUID REFERENCES public.users(id),
  note                TEXT,

  resolution       TEXT,
  resolved_at      TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES public.users(id),

  -- Trazabilidad del backfill de discrepancy_notes: no comparar por el texto
  -- de `note`, que el frontend deja editar.
  migrated_from_note_id UUID REFERENCES public.discrepancy_notes(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT discrepancy_shape CHECK (
    (kind = 'missing'    AND package_id IS NOT NULL) OR
    (kind = 'unexpected' AND barcode IS NOT NULL AND package_id IS NULL)
  ),
  CONSTRAINT discrepancy_resolved_has_when CHECK (
    (status = 'open') OR (resolved_at IS NOT NULL)
  ),
  -- operation_type tiene que coincidir con qué columna de origen está
  -- poblada, o entra una fila que no cuelga de ninguna operación real:
  -- ninguna pantalla la lista y la merma de spec-83 no la cuenta.
  CONSTRAINT discrepancy_source_matches_operation CHECK (
    (operation_type = 'pickup'    AND manifest_id        IS NOT NULL AND route_reception_id IS NULL) OR
    (operation_type = 'reception' AND route_reception_id IS NOT NULL AND manifest_id        IS NULL)
  )
);
```

`operator_id` en la tabla y en la RLS, como toda tabla del repo. Borrado suave.

**Un bulto no puede tener dos discrepancias `missing` abiertas en el MISMO evento** — si no, cerrar dos veces duplica la merma y el cliente firma dos veces sobre lo mismo. Dos eventos distintos sobre el mismo bulto sí coexisten (ver arriba):

```sql
CREATE UNIQUE INDEX uniq_open_discrepancy_per_package
  ON public.discrepancies (operator_id, package_id, operation_type, source_id)
  WHERE status = 'open' AND package_id IS NOT NULL AND deleted_at IS NULL;
```

Y lo mismo para `unexpected`, que nunca tiene `package_id` y por eso necesita
su propio índice — sin él, un reintento de la cola offline (spec-81) duplica
el sobrante contra el papel que el local ya firmó:

```sql
CREATE UNIQUE INDEX uniq_open_discrepancy_per_barcode
  ON public.discrepancies (operator_id, barcode, operation_type, source_id)
  WHERE status = 'open' AND package_id IS NULL AND deleted_at IS NULL;
```

### Escritura y auditoría

`GRANT SELECT` a `authenticated`, nada más. La fase 2 escribe con
`SECURITY DEFINER` (`record_discrepancies`, `resolve_discrepancy`), que corre
con los privilegios del dueño de la función y no necesita el `GRANT` de
escritura. **Ojo con el default ACL de la imagen base:** cualquier tabla nueva
en `public` creada por `postgres` recibe por defecto `arwdDxt` (todo) para
`authenticated` — un `GRANT SELECT` no resta nada de eso, sólo suma. Hace
falta el `REVOKE` explícito de `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
TRIGGER` para que el grant efectivo sea de verdad sólo lectura (verificado con
`has_table_privilege()` en el pgTAP de esta fase, no leyendo el texto de la
migración — round 2 del review encontró que la primera versión de este REVOKE
no tenía ningún test que lo comprobara de forma aislada de RLS).

Con la escritura de cliente cerrada, un `audit_trigger_func` (plantilla:
`20260903000001_spec72_route_blocks.sql`) registra cada `INSERT`/`UPDATE`/
`DELETE` que sí llegue a pasar (por `service_role` o por un RPC
`SECURITY DEFINER`) — sin esto cualquier autenticado podía antes reabrir o
borrar una fila sin dejar rastro, sobre una tabla que existe para ser
evidencia.

**La RLS efectiva de esta tabla, una vez cerrado el `GRANT`, es sólo el
`SELECT`.** Las únicas escrituras que quedan pasan por `service_role`
(`BYPASSRLS`) o por los RPC `SECURITY DEFINER` de fase 2, propiedad de
`postgres` — que también salta la política porque la tabla no tiene
`FORCE ROW LEVEL SECURITY`. Nada por debajo de esos RPC va a filtrar por
`operator_id` en su lugar: **`record_discrepancies` y `resolve_discrepancy`
tienen que comprobar ellos mismos, dentro del cuerpo de la función, que el
`manifest_id`/`route_reception_id` que reciben pertenece al operador del JWT**
(vía `public.get_operator_id()`), igual que hace `expand_carton`
(`20260814000002`). Un `record_discrepancies` que confíe en la RLS de la tabla
para eso insertaría evidencia en el expediente de otro operador.

### `migrated_from_note_id` y el contract phase futuro

`migrated_from_note_id` tiene una FK a `discrepancy_notes(id)` — necesaria
mientras ambas tablas coexisten, pero **bloquea el `DROP TABLE
discrepancy_notes`** que esta misma spec promete para más adelante (fase de
contrato, como spec-56 hizo con spec-52): el `DROP TABLE` fallará por esa
dependencia. Un `DROP TABLE ... CASCADE` **no** borra la columna: elimina el
objeto dependiente —la constraint FK— y lo avisa con un `NOTICE`; la columna y
sus valores sobreviven. Postgres nunca borra columnas de otra tabla por CASCADE.
Aun así, esa fase de contrato tiene que primero
`ALTER TABLE public.discrepancies DROP CONSTRAINT <fk_de_migrated_from_note_id>`
y dejar la columna como un UUID suelto (ya no referenciable, pero el valor
histórico se conserva) antes de tocar `discrepancy_notes`.

### La costura entre esta fase y spec-80 fase 2

Entre este merge y spec-80 fase 2, **el frontend de Recogida sigue
escribiendo en `discrepancy_notes`**, no en `discrepancies` — esta fase migra
lo que ya existía, no cambia dónde escribe la pantalla de Revisión. Las notas
que se creen en esa ventana no llegan a `discrepancies` hasta que alguien
corra el backfill de nuevo o hasta que spec-80 fase 2 apunte la escritura al
RPC nuevo. No hay pérdida de datos (siguen en `discrepancy_notes`), pero
tampoco hay lectura consolidada de esas filas nuevas hasta entonces.

### El estado del bulto

**Deliberadamente NO se añade `faltante` a `package_status_enum`.** La discrepancia es la fila autoritativa; duplicar el hecho en el estado del bulto crea dos fuentes que se desincronizan.

Lo que sí puede pasar: cuando una discrepancia se marca `lost`, el bulto pase a `extraviado` (valor que ya existe). Esa transición se decide en la fase 3, con el flujo de indemnización a la vista — no antes.

---

## Fases

| Fase | Qué entrega |
|---|---|
| **1 — Esquema** | tipos, tabla, RLS, constraints, migración de `discrepancy_notes` |
| **2 — RPCs** | `record_discrepancies`, `resolve_discrepancy`, lectura |
| **3 — `lost` e indemnización** | qué pasa con el bulto y con `exceptions` |

### Fase 1 — Esquema `[done]`

> Implementado por: implementer — rama `feat/spec-85-fase-1-esquema`, SHA `771dc6e`, PR #651.
> Review: reviewer (opus), **dos rondas adversariales**. Ronda 1: 8 bloqueantes
> (backfill sin `ON CONFLICT` que podía abortar el deploy; `unexpected` sin barrera
> de duplicación; RLS probada sólo en lectura; backfill sin test; `detected_at`
> perdido; sin audit trigger con UPDATE/DELETE abiertos; `operation_type` sin atar
> a su origen; CHECK de forma permitiendo `unexpected` con `package_id`). Ronda 2:
> el `REVOKE` del arreglo había desactivado los tests de RLS — cerrado con
> `has_table_privilege` y un rol de prueba sin BYPASSRLS. Veredicto final:
> mergeable. El revisor **se retractó** de un hallazgo propio: pidió distinguir
> `check_violation` de `insufficient_privilege`, y el implementador demostró que
> RLS levanta `42501` igual que un GRANT denegado.
> QA: PR #651 merged 2026-09-07T21:55:32Z, CI verde. **Hueco declarado:** el juez
> `e2e-qa` NO se leyó verde — lleva días rojo por tres specs de Despacho ajenas
> (spec-87 fase 1/2 lo aborda). Esta fase es sólo esquema y no tiene cobertura
> e2e propia; el juez `sql` sí se verificó: 17 tests pgTAP en contenedor
> reconstruido desde cero, con los mutantes matados sobre el contenedor en vivo.
> Downstream: revisado spec-80, spec-83 y spec-86. **Sí hubo cambios**: el cuerpo
> de spec-80 fase 1 seguía describiendo la decisión del enum ya revertida —
> corregido en PR #653; `spec-83:74` afirmaba que spec-80 fase 1 persistiría el
> conteo de faltantes, que con el alcance corregido es falso — corregido en la
> rama de spec-80 fase 1. spec-84 no requiere cambios: consume la tabla, no su
> forma interna. **spec-86 sí los requería y no se habían hecho** (hallazgo de
> la ronda de arreglos 2 de fase 2, B-3): estaba escrito contra `source_process`,
> un nombre que nunca existió — la columna real es `operation_type`
> (`discrepancy_operation_enum`), y el spec tampoco mencionaba
> `route_reception_id`, `source_id` ni los tres RPCs. Corregido en la fase 2 de
> esta spec, no aquí — la fase 1 ya estaba `[done]` y mergeada; se deja esta nota
> para que la reconciliación quede completa.
>
> **Corrección (ronda de arreglos 3, C2):** el párrafo de arriba decía que
> spec-80/spec-83 ya estaban corregidos (PR #653 / "la rama de spec-80 fase
> 1") — falso contra el árbol: los dos seguían escritos contra
> `source_process` al llegar aquí (spec-80 tiene código mergeado en `main`,
> PR #657, y describía su propia columna con un nombre que nunca existió).
> Corregido ahora, en la ronda 3 de esta misma fase: los dos usan
> `operation_type`/`discrepancy_operation_enum` y citan el RPC real
> (`record_discrepancies`/`get_discrepancies`, spec-85 fase 2).

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP en `packages/database/supabase/tests/`

- [x] Test pgTAP primero: aislamiento por operador, el `CHECK` de forma (un `missing` sin `package_id` y un `unexpected` sin `barcode` deben fallar), y el índice único de abiertas.
- [x] Migración con prefijo de versión único (`scripts/check-migration-versions.sh`).
- [x] Migrar las filas vivas de `discrepancy_notes` → `discrepancies` con `kind='missing'`, `operation_type='pickup'`, `status='open'`, conservando `note`, `manifest_id`, `package_id`, `created_by_user_id` y `detected_at ← created_at`. Envuelto en `public.spec85_backfill_discrepancy_notes()` (`ON CONFLICT DO NOTHING`, sin target — cubre los dos índices únicos) para que no pueda tumbar el deploy, y para que el pgTAP la ejerza directamente sobre fixtures en vez de sólo comprobar que la tabla existe.
- [x] **No borrar `discrepancy_notes` todavía.** Queda leída por la pantalla de Revisión hasta que spec-80 fase 2 la sustituya; borrarla ahora rompe Recogida. Se elimina en un contract phase posterior, como spec-56 hizo con spec-52.
- [x] Correr con `scripts/pgtap-local.sh` — los tests SQL **no** corren en CI, y el contenedor es **compartido entre worktrees**: no correr dos fases SQL en paralelo.

**Ronda de code review (adversarial), cerrada:** C1 (backfill sin `ON CONFLICT`
podía abortar el deploy), C2 (`unexpected` sin barrera de duplicación), C3/C3b
(RLS y backfill sin tests que los ejercieran de verdad), I1 (`detected_at`
perdido), I2 (grant de escritura + sin auditoría), I3 (`operation_type` sin
atar a su columna de origen), I5 (`unexpected` con `package_id` colaba).
Detalle de cada uno en "El modelo" arriba. Un hallazgo no listado en el review
original salió al verificar I2: la imagen base otorga por defecto `arwdDxt` a
`authenticated` en toda tabla nueva, así que el `GRANT SELECT` por sí solo no
restringía nada — hizo falta el `REVOKE` explícito. El mismo patrón (falta el
REVOKE) puede estar en otras tablas del repo — confirmado en `route_blocks`
por el revisor en la ronda 2, va a su propio spec de auditoría, no se tocó
aquí.

**Ronda 2, acotada al REVOKE de I2 y a C3:** el primer arreglo de I2 desactivó
sin querer los propios tests de C3 — TEST 11/12 entran con
`role='authenticated'`, que ya no tiene `INSERT`/`UPDATE`, así que Postgres
rechaza en el chequeo de privilegios **antes** de evaluar ninguna política
RLS, y el `EXCEPTION WHEN insufficient_privilege OR check_violation` acepta
ambas causas sin distinguir cuál disparó. Dos mutantes sobrevivían con la
suite en verde: (1) las dos políticas a `WITH CHECK (true)` — sigue dando
42501 por privilegio, TEST 11/12 pasan igual; (2) borrar el `REVOKE` —
entonces la RLS da el mismo 42501, TEST 11/12 pasan igual. Corregido con dos
tests nuevos: TEST 15 (`has_table_privilege()`, ACL puro, sin RLS de por
medio) y TEST 16 (un rol de prueba creado dentro de la transacción, con
`GRANT INSERT, UPDATE` real y sin `BYPASSRLS`, que sí llega al `WITH CHECK`).
Total 17 tests pgTAP.

**Corrección técnica encontrada al escribir TEST 16:** Postgres no tiene un
SQLSTATE propio para una violación de `WITH CHECK` — tanto un rechazo de RLS
como un rechazo de `GRANT` levantan `42501` (`insufficient_privilege`); sólo
el texto del mensaje distingue "new row violates row-level security policy"
de "permission denied for table". El `WHEN check_violation` que TEST 11/12
tenían desde la ronda 1 nunca disparaba — es rama muerta, se dejó sólo
`WHEN insufficient_privilege` ahí y se documentó que esos dos tests prueban
sólo que el rechazo ocurre, no en qué capa; TEST 15/16 son los que atribuyen
la capa, comparando el texto del mensaje con `GET STACKED DIAGNOSTICS`.

Además: el backfill ahora compara `COUNT(*)` de notas vivas contra su propio
valor de retorno y deja un `RAISE NOTICE` si `ON CONFLICT DO NOTHING` tragó
alguna — tragar sigue siendo correcto (el backfill de una tabla de evidencia
no puede tumbar un deploy), pero ya no es silencioso en los logs.

### Fase 2 — RPCs `[in_progress]`

**Archivos:** migración nueva, test pgTAP

`SECURITY DEFINER`, `operator_id` desde `public.get_operator_id()` y nunca de un argumento del cliente — plantilla: `expand_carton` (`20260814000002`).

- `record_discrepancies(p_operation_type, p_source_id, p_items jsonb)` — idempotente por el índice único de arriba; la llama `close_manifest` (spec-80) y su equivalente de recepción.
- `resolve_discrepancy(p_id, p_status, p_resolution)` — sólo `open → resolved | lost`. Rechaza reabrir: una discrepancia cerrada es evidencia, y editarla después destruye su valor.
- Lectura por operación y por estado, para la pantalla de resolución.

- [x] Tests pgTAP primero, incluyendo el rechazo cross-tenant y el rechazo de reapertura.
- [x] Implementar.

Migración `20260913000003_spec85_discrepancies_rpcs.sql`, tests en
`spec85_discrepancies_rpcs.test.sql` (36 tests, tras la ronda de arreglos 3).
`record_discrepancies` valida que `p_source_id` (manifiesto o recepción según
`p_operation_type`) y cada `package_id` pertenezcan al operador del JWT antes
de insertar — nada por debajo lo hace, porque la RLS efectiva de la tabla es
sólo `SELECT` y el RPC corre `SECURITY DEFINER`. Con `p_items = '[]'` no
inserta nada y devuelve el conjunto vacío en vez de fallar — `close_manifest`
(spec-80), su llamador nombrado, cierra así una carga limpia (0 faltantes, 0
sobrantes) sin que eso cuente como error. `resolve_discrepancy` rechaza
cualquier transición que no sea `open → resolved|lost` (incluida
`resolved → lost`, y el reintento literal `resolved → resolved`) con
`ERRCODE 23505` (unique_violation, el idioma del repo para "esto ya pasó" →
HTTP 409) — **no** `P0002` (no_data_found → HTTP 404 en PostgREST, que una
cola offline (spec-81) leería como "no existe" y descartaría el ítem). Mismo
split que `close_manifest` usa para "ya firmado" (`23505`) contra una
validación (`P0001`).
`get_discrepancies` es `SECURITY INVOKER`: la tabla ya concede `SELECT` a
`authenticated` y la RLS filtra por `operator_id`, así que una consulta
directa ya queda acotada por tenant; el filtro explícito por
`get_operator_id()` en el cuerpo es defensa en profundidad, no lo único que
impide una fuga cross-tenant.

**Contrato de errores (B-3, ronda de arreglos 2):** las tres RPCs comparten
`ERRCODE 42501` para tres causas distintas (sin operador resoluble, fuente
— manifiesto/recepción — ajena, bulto ajeno), y un frontend no puede
distinguirlas por `SQLSTATE` solo. Siguiendo el patrón de `close_manifest`
(`20260913000002`, prefijos `MANIFEST_ALREADY_SIGNED:` etc.), cada mensaje
lleva un prefijo centinela antes del `:`:

| RPC | Prefijo | ERRCODE |
|---|---|---|
| `record_discrepancies` | `NO_OPERATOR_IN_JWT` | 42501 |
| | `INVALID_ITEMS` | P0001 |
| | `MANIFEST_NOT_FOUND` | 42501 |
| | `ROUTE_RECEPTION_NOT_FOUND` | 42501 |
| | `UNKNOWN_OPERATION_TYPE` | P0001 |
| | `MISSING_REQUIRES_PACKAGE_ID` | P0001 |
| | `PACKAGE_NOT_FOUND` | 42501 |
| | `UNEXPECTED_REQUIRES_BARCODE` | P0001 |
| | `UNKNOWN_KIND` | P0001 |
| `resolve_discrepancy` | `NO_OPERATOR_IN_JWT` | 42501 |
| | `INVALID_STATUS` | P0001 |
| | `RESOLUTION_REQUIRED` | P0001 |
| | `DISCREPANCY_NOT_FOUND` | 42501 |
| | `DISCREPANCY_ALREADY_RESOLVED` | 23505 |
| | `LOST_REQUIRES_OPERATIONS_MANAGER` (fase 3a) | 42501 |
| `get_discrepancies` | (ninguna — no lanza) | — |

Un consumidor de frontend hace `message.startsWith('PACKAGE_NOT_FOUND:')`,
no `LIKE 'package %'` sobre texto en inglés con un UUID interpolado.

**Nota sobre `p_resolution`:** el spec no decía si es obligatorio.
`expand_carton`/`delete_minted_carton` exigen `p_reason` no vacío para
cualquier acción que deja rastro sobre evidencia, así que `resolve_discrepancy`
sigue el mismo patrón. Si la pantalla de resolución necesita cerrar sin texto
libre (p.ej. un botón "apareció" sin campo), se ajusta aquí, no inventando una
regla distinta en el frontend.

**Ronda de arreglos 1 (adversarial), cerrada:** B1 (`P0002` → `23505` en el
rechazo de reapertura de `resolve_discrepancy` — ver arriba), B2 (la rama
`reception` de `record_discrepancies` no tenía ni un test; el fixture de
`route_receptions` existía sin usar — cubierto con TEST 4b/5b/5c: guard de
tenant sobre `route_reception_id`, happy path, y guard de `package_id` ajeno
en esa rama), M3 (`p_status = NULL` caía en `NULL NOT IN (...)` = `NULL`, el
`IF` nunca disparaba, y el `UPDATE` fallaba con `23502` crudo — ahora
`p_status IS NULL OR ...`), M4 (el `COMMENT` de `resolve_discrepancy` seguía
afirmando `P0002` después del fix de B1 — corregido), M5 (`p_items = '[]'`
ahora devuelve el conjunto vacío en vez de lanzar excepción — decisión
documentada arriba; el guard de ownership de `p_source_id` se comprueba
*antes* del `RETURN` temprano, así que un `source_id` ajeno con `p_items`
vacío sigue rechazándose), M6 (TEST 4/5/10 no distinguían `SQLSTATE` — un
mutante que bajara los cuatro `42501` a `P0001` dejaba la suite en verde;
ahora cada uno usa `GET STACKED DIAGNOSTICS`), M7 (`get_discrepancies` perdía
tanto el filtro `p_source_id` como `deleted_at IS NULL` sin que ningún test
lo notara — TEST 12 cubre ambos, verificado por mutación borrando cada uno
por separado). Menores: m1 (`UPDATE` de `resolve_discrepancy` ahora repite
`operator_id`/`deleted_at`, aunque el `FOR UPDATE` de arriba ya lo hacía
seguro — es higiene del no-negociable del repo, no un guard con test propio
distinguible: el `id` es único globalmente), m2 (atribución —
`detected_by_user_id`/`resolved_by_user_id`/`note`/`detected_at` — verificada
en TEST 1/2/6/7, mutación confirmada: sustituir `v_actor` por `NULL` en los
cinco sitios rompe las cuatro), m3 (TEST 3b: dos ítems idénticos en el MISMO
`p_items`, no en dos llamadas separadas), m5 (TEST 9b: el reintento idéntico
`resolved → resolved`, el caso literal que motiva B1), m6 (TEST 10 afirma
`current_user = 'authenticated'` tras `pg_temp.as_operator_b()`), m7
(`REVOKE ALL ... FROM PUBLIC` en las tres RPCs, como fase 1 en
`spec85_backfill_discrepancy_notes`; TEST 15 usa `aclexplode(proacl)`, no
`has_function_privilege()` — llamado como `postgres` (superusuario) ese
siempre da `true` sin importar el `REVOKE`), m10 (TEST 16: `get_discrepancies`
es `SECURITY INVOKER` vía `pg_proc.prosecdef`). Los 22 tests se verificaron
con **mutación real** sobre el contenedor pgTAP en vivo para cada hallazgo de
B1/B2/M3/M6/M7/m2/m5/m7/m10 — no sólo lectura del texto de la migración.

**Ronda de arreglos 2 (adversarial, re-review), cerrada:** el re-review
re-verificó por su cuenta cada mutación de la ronda 1 y confirmó B1, M3, M4,
M7, m2, m3, m5, m6, m10 y la documentación de m4/m8/m9/m12; quedaron tres
bloqueantes y dos mayores:

- **B-1 — B2 quedó a medias.** La rama `reception` de `record_discrepancies`
  tenía el guard de tenencia cubierto (TEST 4b), pero el `INSERT` en sí
  (forma `unexpected`) y su idempotencia (`ON CONFLICT ... DO NOTHING`) nunca
  se ejercían: TEST 4b/5c revientan *antes* del `INSERT`, y TEST 5b sólo cubre
  `missing`. TEST 2b (mirror de TEST 2, `unexpected` en `reception`) y TEST 3c
  (mirror de TEST 3, idempotencia en `reception`) cierran el hueco.
  Mutación confirmada: `'MUTANTE-' || v_barcode` en el `VALUES` de esa rama, y
  borrar los dos `ON CONFLICT` de `reception` dejando los de `pickup` —
  ambos mueren ahora.
- **B-2 — TEST 8(a) probaba otra cosa de la que decía.** `p_status = 'open'`
  sobre una fila `resolved` nunca llega al guard de "evidencia cerrada"
  (`mig:264`) — lo rechaza la validación de enum (`mig:233`) treinta líneas
  antes. Renombrado para decir lo que prueba de verdad, con `GET STACKED
  DIAGNOSTICS` pineando `P0001`. TEST 8c añade el caso real que faltaba:
  `p_status = 'open'` sobre una fila YA `open` — con la mutación
  `p_status NOT IN ('resolved', 'lost', 'open')`, una fila resuelta sigue
  rechazándose (el guard de reapertura la atrapa igual, con `23505`), pero
  una fila `open` NO — el `UPDATE` corre en silencio y deja
  `status='open', resolved_at=NOW()`. TEST 8c mata esa mutación y afirma que
  la fila queda intacta, no sólo que "algo" se lanzó.
- **B-3 — el contrato de `reception` y de errores no estaba firme.**
  (1) `**Downstream:**` no listaba spec-86 — añadido arriba. (2) spec-86
  estaba escrito contra `source_process`, un nombre que nunca existió —
  reconciliado en spec-86 contra `operation_type`/`route_reception_id`/
  `source_id` y los tres RPCs reales, sin implementar nada de spec-86 (sigue
  `[blocked]`). (3) contrato de errores sin prefijos centinela — añadidos,
  tabla completa arriba.
- **M-4 — el reorden de M5 no tenía test.** TEST 14b: `p_items = '[]']` con
  un `p_source_id` ajeno (`44440002-…`) sigue esperando `42501`. Mutación
  confirmada: mover el `RETURN` temprano de vuelta a *antes* del guard de
  tenencia (la disposición original, rechazada en la ronda 1) hacía pasar la
  suite entera; con TEST 14b, no.
- **M-5 — dos `42501` sin cobertura y `anon` con `EXECUTE` real.** TEST 10b/
  10c llaman ambas RPCs de escritura con un `sub` sin fila en `public.users`
  (mismo patrón sintético que `20260813000002:110` — el guard NO lee un
  claim `operator_id` del JWT: `get_operator_id()` resuelve por
  `id = auth.uid()` contra `public.users`). Mutación confirmada: bajar el
  ERRCODE a `P0001`, y quitar el prefijo centinela — ambas mueren ahora.
  Y el ACL real de las tres funciones incluía `anon=X` por default privilege
  de Supabase, no heredado de `PUBLIC` — `REVOKE ALL ... FROM PUBLIC` no lo
  tocaba. Añadido `REVOKE ALL ... FROM anon` explícito en las tres, patrón de
  `20260812000003:298`/`20260812000005:273`/`20260820000003:316`/
  `20260820000005:110`. TEST 15b (`aclexplode` contra el rol `anon`, no sólo
  grantee 0/`PUBLIC`) verificado por mutación: quitar los tres `REVOKE ...
  FROM anon` con las funciones recién creadas (ACL en blanco, `CREATE OR
  REPLACE` sobre una función existente no resetea el ACL) revive el default
  grant y el test lo atrapa.

Menor: **m-6 — `RETURN QUERY` final de `record_discrepancies` (`mig:190`)
sin `operator_id`/`deleted_at`.** Mismo criterio que m1 de la ronda 1: sin
fuga alcanzable hoy (`v_ids` sólo contiene ids ya filtrados por `v_operator`
en los `SELECT` de arriba), pero incoherente con haber añadido esos mismos
filtros al `UPDATE` de `resolve_discrepancy` argumentando que es
no-negociable del repo. Añadido sin test propio — no distinguible por
mutación, misma clase que m1.

Los 7 tests nuevos (2b, 3c, 8c, 14b, 15b, 10b, 10c) se verificaron con
**mutación real** sobre el contenedor pgTAP en vivo para cada hallazgo de
B-1/B-2/M-4/M-5 — no sólo lectura del texto de la migración. Suite completa:
29/29 en verde tras cada fix.

**Ronda de arreglos 3 (adversarial), cerrada — B1/B2/B3, huecos de cobertura
sobre el contrato de errores que la ronda 2 documentó pero no probó:**
- **B1 — 12 de los 13 prefijos centinela de la tabla de arriba no tenían
  ningún test.** Un `sed` que los quita (dejando sólo `NO_OPERATOR_IN_JWT:`)
  daba 29/29 en verde. Se añadió la aserción del prefijo a los tests
  existentes que ya ejercitan cada guard (4, 4b, 5, 5c, 8, 8c, 9, 10, 13) y
  cinco tests nuevos (17-21) para los guards que ningún test alcanzaba:
  `INVALID_ITEMS`, `UNKNOWN_OPERATION_TYPE`, `MISSING_REQUIRES_PACKAGE_ID`,
  `UNEXPECTED_REQUIRES_BARCODE`, `UNKNOWN_KIND` — estos cinco también cierran
  **el m6 de la ronda 3** (los cinco guards que ningún test alcanzaba). Ojo con
  la ambigüedad del nombre: hay **tres** cosas distintas llamadas `m6` en este
  historial. El **m6 de la ronda 2** es otra: la aserción de `current_user` en
  TEST 10, cerrada en su propia ronda (ver línea 433). Y el comentario
  `-- m6 (re-review):` de `20260913000003…sql:190`, sobre el `operator_id` del
  `RETURN QUERY` final, se refiere a un tercero — el hallazgo menor de la ronda
  2 sobre coherencia con m1, declarado y verificado como **no distinguible por
  mutación**. Cuando cites un `m6`, di de qué ronda.
- **B2 — `RESOLUTION_REQUIRED` (mig:257-259) sin test ni respaldo en el
  esquema.** El único `CHECK` de la tabla
  (`discrepancy_resolved_has_when`) no exige `resolution`; mutar el `IF`
  entero a `NULL;` daba 29/29 en verde. TEST 22 llama
  `resolve_discrepancy(<fila abierta>, 'lost', '   ')` y afirma el ERRCODE,
  el prefijo, y — el punto probatorio real — que la fila queda intacta:
  la corrupción silenciosa (`status='lost'` sin motivo escrito) es el fallo
  que importa, no la excepción.
- **B3 — el filtro `p_operation_type` de `get_discrepancies` no
  discriminaba.** El fixture de TEST 11 era 100% `'pickup'`, así que
  sustituir el predicado completo por `TRUE` daba 29/29 en verde. TEST 23
  añade una fila `'reception'` y afirma que filtrar por `'pickup'` la
  excluye y filtrar por `'reception'` la incluye — la costura exacta que
  spec-86 fase 3 usa (`get_discrepancies(p_operation_type := 'reception',
  p_status := 'open')`).
- **m7 (no bloqueante, incluido de paso):** `ORDER BY detected_at DESC`
  (mig:343) sin cobertura — mutarlo a `ASC` daba 29/29 en verde. TEST 24 lo
  fija.

Los cuatro mutantes (B1, B2, B3, m7) se verificaron uno por uno contra el
contenedor pgTAP en vivo: cada uno hace fallar exactamente el test nuevo que
lo cubre, y la migración real (sin cambios — los tres blockers eran huecos de
cobertura, no bugs) vuelve a dar la suite completa en verde tras revertir cada
mutante. Suite completa: 36/36 en verde.

**Documentado, no codificado (aplazamiento deliberado):**
- **m4 — cardinalidad de retorno.** `record_discrepancies` hace
  `WHERE id = ANY(v_ids)` sin `ORDER BY`. Con ítems duplicados dentro de un
  mismo `p_items` (ver TEST 3b), el `SETOF` resultante tiene menos filas que
  ítems de entrada — es el comportamiento correcto (idempotencia), pero el
  llamador no debe asumir "una fila de vuelta por ítem enviado".
- **m8 — el lote es todo-o-nada.** Un `barcode` de más de 100 caracteres
  (`VARCHAR(100)` en la tabla) aborta la transacción completa con `22001`, no
  sólo ese ítem. Para `close_manifest`, que llama a esta RPC con el lote
  completo de discrepancias de un cierre, eso significa que un solo bulto con
  un código de barras corrupto revierte el cierre entero. Defendible como
  comportamiento por ahora — cualquier cambio a inserción parcial es decisión
  del llamador, no de este RPC.
- **m9 — no se valida que el bulto pertenezca a *esa* operación**, sólo al
  operador. Un `package_id` de otro manifiesto/recepción del mismo operador
  pasa el guard de `record_discrepancies`. Aplazamiento deliberado: la spec no
  pedía esa validación cruzada, y añadirla exige decidir qué tabla intermedia
  prueba "este bulto estaba en este manifiesto" (¿`manifest_packages`? ¿el
  propio `packages.order_id` vía el manifiesto?), que no es una decisión de
  esta fase.
- **m12 — tamaño de archivo.** La migración quedó en 359 líneas y el test en
  1025, ambos por encima de las 300 de la guía. Los tests SQL del repo ya
  viven sistemáticamente por encima de esa guía (ver fase 1); no se partió la
  migración porque las tres RPCs comparten cabecera de módulo y no hay un
  corte natural sin duplicar contexto entre archivos.

### Decisión del usuario (2026-09-08): quién declara `lost`

> **«Lost must be declared by the ops manager in a UI screen which we haven't decided yet.»**

Contesta dos de las cuatro preguntas que bloqueaban la fase 3, y conviene ser preciso
sobre cuáles:

- **Qué dispara un `lost`: nada automático.** Es un acto humano deliberado. No hay regla,
  ni temporizador, ni job por lotes que promueva una discrepancia a `lost` por antigüedad
  ni por ninguna otra condición. Esto elimina una rama entera de trabajo que el spec dejaba
  abierta.
- **Quién puede marcarlo: el jefe de operaciones.** El rol `operations_manager` ya existe
  en el RBAC (`20260216170542_create_users_table_with_rbac.sql`), así que no hay que
  inventarlo.

Sigue sin decidirse: **la pantalla** desde la que lo declara, y los **efectos aguas abajo**
— si el bulto pasa a `extraviado`, y si se abre una fila de `exceptions` con
`settlement_id`. La decisión anterior del usuario (2026-09-07) fue que un `lost` «debe
disparar un workflow de indemnización pendiente»; el mecanismo concreto de ese workflow es
lo que queda por decidir.

Por eso la fase se parte en dos: el guard de permiso es backend puro y se puede construir
ya; la pantalla y el workflow siguen esperando diseño.

### Fase 3a — Solo el jefe de operaciones puede declarar `lost` `[done]`

**Archivos:** migración nueva sobre `resolve_discrepancy`, test pgTAP.

**El hueco es real y está abierto en `main` ahora mismo.** `resolve_discrepancy`
(`20260913000003`) valida el tenant y **no comprueba ningún rol**: hoy cualquier usuario
autenticado del operador —un `pickup_crew`, un `warehouse_staff`— puede declarar `lost` una
discrepancia, y `lost` es la rama que abre una indemnización. Eso contradice la decisión de
arriba, y no depende de que exista la pantalla.

- [x] Test pgTAP primero: bajo un JWT de `pickup_crew`, `resolve_discrepancy(id, 'lost', …)`
      se rechaza; bajo `operations_manager`, pasa.
- [x] Decidir y **escribir** si `resolved` también se restringe o sigue abierta a cualquier
      rol del operador. Resolver una discrepancia es operación de andén; declararla perdida
      es una decisión con consecuencia económica. Por defecto: `resolved` abierta, `lost`
      restringida — pero es una decisión, no un detalle, y va argumentada.
- [x] `CREATE OR REPLACE` desde la **última** definición de la función, no desde la
      original — regla no negociable del repo.
- [x] Errcode y centinela coherentes con el contrato ya publicado: `42501` +
      `LOST_REQUIRES_OPERATIONS_MANAGER:` (o el nombre que encaje en la tabla de errores del
      spec), para que el frontend lo mapee por prefijo sin parsear texto libre.
- [x] Mutation-testear el guard: si borrar la comprobación de rol no rompe ningún test, el
      test no vale.

**Decisión: `resolved` sigue abierta a cualquier rol del operador; sólo `lost` se
restringe.** Resolver una discrepancia constata un hecho físico — el bulto apareció — y lo
hace quien lo tiene delante, en andén, igual que hoy. Declarar `lost` es distinto: es una
determinación de que el bulto NO va a aparecer, y esa determinación es la que dispara el
futuro flujo de indemnización (decisión del usuario, 2026-09-07). Restringir también
`resolved` habría bloqueado sin necesidad el flujo de reintento que spec-81 (cola offline)
y los TEST 9/9b de esta suite ya dan por sentado: nadie asume más riesgo económico cuando un
bulto aparece, así que no hay nada que proteger ahí.

**Roles permitidos para `lost`: `operations_manager`, `admin`, `super_admin`.** El usuario
dijo "el jefe de operaciones", pero el repo tiene un patrón establecido y repetido —
`cancel_pickup_route` (`20260821000001`), `add_manifest_to_route`/`remove_manifest_from_route`
(`20260822000001`/`20260824000004`), la variante `ops_leader` de `start_pickup_route`
(`20260824000003`), las RPCs de adyacencia y top-up de spec-73 — donde toda puerta que exige
`operations_manager` deja pasar también a `admin`/`super_admin` como vía de escape
administrativa. Restringir `lost` a únicamente `operations_manager`, dejando fuera a
`admin`/`super_admin`, habría sido la primera excepción a ese patrón en todo el repo, sin que
la frase del usuario pidiera esa excepción explícitamente. Si en el futuro se decide que ni
siquiera un `admin` debe poder declarar `lost` sin ser también `operations_manager`, es una
decisión a tomar aparte, con su propio razonamiento — no algo a inferir aquí.

**Orden del guard dentro de `resolve_discrepancy`:** después del guard "ya resuelta" (23505)
y después de la validación de `p_resolution`, antes del `UPDATE`. Así un reintento
`resolved → lost` de un `pickup_crew` sigue devolviendo `23505` (no un `42501` distinto que
rompería la semántica de "ya pasó, deja de reintentar" que spec-81 depende de leer), y un
`pickup_crew` que manda una razón vacía sigue viendo `RESOLUTION_REQUIRED` antes que el
rechazo de rol — el guard de rol sólo dispara en una transición real `open → lost` hecha por
alguien sin autoridad, que es el caso que importa.

> Implementado por: implementer — rama `feat/spec-85-fase-3a-lost-solo-ops-manager`,
> migración `20260913000005_spec85_lost_requires_ops_manager.sql` (no `20260913000004`: ese
> prefijo ya estaba tomado en el contenedor pgTAP compartido por otra rama en curso —
> `spec80_close_manifest_acl_fix.sql`, sin mergear en `main` — así que se usó `000005` para no
> chocar; `scripts/check-migration-versions.sh` confirma prefijos únicos dentro de este
> repo). Test pgTAP: `TEST 25` (rechazo `pickup_crew`, con aserción de fila intacta —
> `status`, `resolution`, `resolved_at`, `resolved_by_user_id` — no sólo de la excepción),
> `TEST 26` (aceptación `operations_manager`), `TEST 27` (`resolved` sigue abierto a
> `pickup_crew`, regresión explícita e independiente de TEST 6). `TEST 7` (existente, happy
> path `open → lost`) se actualizó para actuar como `operations_manager` — con el guard
> nuevo, el actor por defecto del fixture (`pickup_crew`) ya no puede completar esa
> transición; ver el comentario dejado en el test. RED verificado antes del fix (TEST 25
> falló por la razón correcta: `resolve_discrepancy let a pickup_crew caller declare lost`).
> Mutation test: función mutante con el guard de rol eliminado, aplicada directamente sobre
> el contenedor en vivo — sólo TEST 25 falla, los demás 40 `PASSED` se mantienen (incluidos
> TEST 26/27, que corren después vía `ROLLBACK TO` y no se ven afectados por el abort de la
> transacción interna de TEST 25). Función real restaurada y reconfirmada: 41 `PASSED`, 0
> `ERROR`.
>
> Review: adversarial, **post-merge** (el PR #670 entró con auto-merge sin revisar antes de
> mergear). Verificó el guard fail-closed sobre los seis roles reales del RBAC probándolos
> uno a uno contra la función instalada, confirmó que TEST 25 tiene la forma probatoria
> correcta y que el reclamo de mutación de arriba es exacto, y comprobó carácter por
> carácter que el precedente citado (`operations_manager` deja pasar también `admin`/
> `super_admin`) existe literal en las cuatro funciones citadas
> (`20260821000001:131`, `20260822000001:93`, `20260824000004:141`,
> `20260824000003:84`). Respaldó las tres decisiones de diseño: ampliar a `admin`/
> `super_admin`, dejar `resolved` sin restringir, y el orden del guard (después de
> "ya resuelta" 23505, antes del UPDATE) — verificado con dos mutantes que confirman que ese
> orden es load-bearing. También descartó que el `23505` antes del `42501` filtre estado: no
> lo hace, porque `pickup_crew` ya puede leer ese `status` bajo la RLS con un `SELECT`
> directo. Encontró un hallazgo real (MEDIO): el mutante que estrecha la lista de roles a
> sólo `operations_manager` sobrevivía — ningún test cubría `admin` ni `super_admin`, y el
> bloque de verificación de la propia migración (`20260913000005:207-209`) era vacuo porque
> el texto del `RAISE EXCEPTION` también contiene las palabras "admin"/"super_admin",
> pasando los tres `LIKE` sin importar qué tan corta quedara la lista real. Cerrado en
> `fix/spec-85-fase-3a-seguimiento`: TEST 28 (admin) y TEST 29 (super_admin) añadidos, RED
> verificado contra el mutante estrechado (41 `PASSED`, TEST 28 falla por la razón correcta
> — `LOST_REQUIRES_OPERATIONS_MANAGER` con `caller role: admin`), GREEN contra la función
> real (43 `PASSED`, 0 `ERROR`); el `LIKE` de verificación se cambió para apuntar al literal
> `('operations_manager', 'admin', 'super_admin')` en vez de a las palabras sueltas, y se
> confirmó por mutación que ahora sí detecta el estrechamiento (el mismo mutante que antes
> pasaba en silencio ahora aborta la migración con `RAISE EXCEPTION`). Tres mutantes
> adicionales que el reviewer dejó constancia de que sobreviven y son equivalentes —quitar
> `v_actor_role IS NULL`, quitar `operator_id = v_operator`, o quitar `deleted_at IS NULL`
> del lookup de `public.users`— no se tocaron: son defensa en profundidad idéntica a los
> cuatro precedentes, y el caso que cubrirían (`v_operator` no NULL pero sin fila viva) es
> inalcanzable porque `get_operator_id()` ya resuelve por una fila viva de `auth.uid()`.
>
> QA: n/a por capa. Es un guard de backend sobre una RPC que hoy no tiene ningún caller en
> el frontend con `p_status='lost'` — la pantalla que lo llamaría es la fase 3b, bloqueada
> por diseño (`git grep 'LOST_REQUIRES_OPERATIONS_MANAGER' -- apps/frontend` sin resultados).
> No hay E2E que inventar aquí; el juez `sql` (pgTAP local) es la capa que corresponde y ya
> está verde arriba.
>
> Downstream: revisado spec-86-discrepancias-de-recepcion.md — su fase 2b (`[blocked]`)
> tenía un párrafo, escrito antes de que existiera esta fase 3a (PR #664), que afirmaba que
> el guard de rol no existía y que la 2b estaba bloqueada por eso. Corregido en
> `fix/spec-85-fase-3a-seguimiento`: el guard existe y qué roles admite; la 2b sigue
> `[blocked]`, pero sólo por la decisión de producto sobre el efecto aguas abajo, no por
> falta de guard. También se anotó en fase 3b (esta misma spec) el hueco pendiente de
> traducción al español del centinela `LOST_REQUIRES_OPERATIONS_MANAGER:` y de
> ocultar/deshabilitar la acción en la UI para roles no autorizados — hoy sin caller, así que
> radio de impacto cero, pero documentado donde se va a necesitar.

### Fase 3b — La pantalla y el workflow de indemnización `[blocked]`

Bloqueada por diseño, no por dependencia técnica. Falta decidir:

- [ ] **Dónde vive la pantalla** desde la que el jefe de operaciones declara el `lost`.
      Candidata natural: el panel de resolución de discrepancias que spec-86 fase 3
      describe, pero no está decidido.
- [ ] **Si el bulto pasa a `extraviado`** o el estado de bulto se queda como está y la
      discrepancia es el único registro.
- [ ] **Si se abre una fila de `exceptions` con `settlement_id`**, o el enganche de
      indemnización es otro. La tabla ya reserva una referencia nullable para esto.
- [ ] **Handoff del guard de fase 3a, pendiente para cuando exista un caller.**
      `resolve_discrepancy` lanza `LOST_REQUIRES_OPERATIONS_MANAGER:` **en inglés** —
      distinto de los cuatro precedentes citados en `20260913000005` (`cancel_pickup_route`
      y compañía), que lanzan su mensaje en español porque el hook que los llama
      (`useCancelPickupRoute.ts` y equivalentes) re-lanza `SQLERRM` literal. Hoy
      (`git grep 'DISCREPANCY_ALREADY_RESOLVED\|RESOLUTION_REQUIRED' -- apps/frontend` sin
      resultados) no existe ningún mapeador de los centinelas de `resolve_discrepancy` en el
      frontend — radio de impacto cero porque no hay caller todavía. Cuando esta fase
      construya la pantalla, el hook que llame a `resolve_discrepancy(..., 'lost', ...)`
      necesita: (a) traducir `LOST_REQUIRES_OPERATIONS_MANAGER:` (y los demás centinelas de
      esta RPC) al español antes de mostrarlo, en vez de re-lanzar `SQLERRM`; y (b) ocultar o
      deshabilitar la acción «declarar perdido» en la UI para cualquier rol que no sea
      `operations_manager`/`admin`/`super_admin`, no depender sólo del rechazo 42501 del
      backend como única defensa.

---

## Riesgos

- **Dos sesiones sobre la misma tabla.** El esquema lo posee esta spec. Un consumidor al que le falte un campo lo pide aquí; dos migraciones paralelas sobre `discrepancies` es el choque que esto evita.
- **Borrar `discrepancy_notes` antes de tiempo** rompe la pantalla de Revisión de Recogida, que todavía la lee.
- **Reabrir una discrepancia** parece cómodo y destruye su valor probatorio. El RPC lo rechaza a propósito.
