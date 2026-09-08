# Spec-85: Discrepancias — un registro resoluble de lo que faltó o sobró

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (**su fase 2 consume esta tabla en vez de decidir un estado de bulto**), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (la merma de «Cierres de hoy» se lee de aquí), [spec-62](spec-62-reception-mobile.md) (recepción móvil, el otro productor), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (recepción consolidada por ruta), [spec-43](spec-43-failed-delivery-return-flow.md) (entrega fallida y retorno), [spec-55](spec-55-carton-expansion.md) (bultos minteados que también pueden faltar)

**Status:** in progress
**Verify:** unit, sql, e2e-qa
**Downstream:** spec-80-recogida-movil-cierre-de-carga.md, spec-83-recogida-escritorio-datos-faltantes.md

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
> Downstream: revisado spec-80 y spec-83. **Sí hubo cambios**: el cuerpo de
> spec-80 fase 1 seguía describiendo la decisión del enum ya revertida — corregido
> en PR #653; y `spec-83:74` afirmaba que spec-80 fase 1 persistiría el conteo de
> faltantes, que con el alcance corregido es falso — corregido en la rama de
> spec-80 fase 1. spec-84 y spec-86 no requieren cambios: consumen la tabla, no
> su forma interna.

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
`spec85_discrepancies_rpcs.test.sql` (11 tests). `record_discrepancies` valida
que `p_source_id` (manifiesto o recepción según `p_operation_type`) y cada
`package_id` pertenezcan al operador del JWT antes de insertar — nada por
debajo lo hace, porque la RLS efectiva de la tabla es sólo `SELECT` y el RPC
corre `SECURITY DEFINER`. `resolve_discrepancy` rechaza cualquier transición
que no sea `open → resolved|lost` (incluida `resolved → lost`) con `ERRCODE
P0002`, distinto del `P0001` de las validaciones (estado destino inválido,
resolución vacía) — mismo split que `close_manifest` para que la cola offline
de spec-81 distinga "ya cerrada, no reintentar" de "petición mal formada".
`get_discrepancies` es `SECURITY INVOKER`: la tabla ya concede `SELECT` a
`authenticated` y la RLS filtra por `operator_id`, así que una consulta
directa ya queda acotada por tenant; el filtro explícito por
`get_operator_id()` en el cuerpo es defensa en profundidad, no lo único que
impide una fuga cross-tenant.

**Nota sobre `p_resolution`:** el spec no decía si es obligatorio.
`expand_carton`/`delete_minted_carton` exigen `p_reason` no vacío para
cualquier acción que deja rastro sobre evidencia, así que `resolve_discrepancy`
sigue el mismo patrón. Si la pantalla de resolución necesita cerrar sin texto
libre (p.ej. un botón "apareció" sin campo), se ajusta aquí, no inventando una
regla distinta en el frontend.

### Fase 3 — `lost` e indemnización `[blocked]`

Bloqueada por una decisión del usuario: qué dispara exactamente un `lost` — si el bulto pasa a `extraviado`, si se abre una `exceptions` con `settlement_id`, y quién puede marcarlo.

- [ ] Decidir con el usuario antes de tocar nada.

---

## Riesgos

- **Dos sesiones sobre la misma tabla.** El esquema lo posee esta spec. Un consumidor al que le falte un campo lo pide aquí; dos migraciones paralelas sobre `discrepancies` es el choque que esto evita.
- **Borrar `discrepancy_notes` antes de tiempo** rompe la pantalla de Revisión de Recogida, que todavía la lee.
- **Reabrir una discrepancia** parece cómodo y destruye su valor probatorio. El RPC lo rechaza a propósito.
