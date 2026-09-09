# Spec-88: Funciones `SECURITY DEFINER` ejecutables por `anon` — auditoría y cierre

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (su fase 1b ya documentó y arregló exactamente este mismo patrón — `REVOKE ... FROM anon` sin `REVOKE ... FROM PUBLIC` — en `close_manifest`; plantilla de esta spec), [spec-85](spec-85-discrepancias.md) (fase 2 usó el patrón correcto en sus tres RPCs; el otro precedente), [spec-87](spec-87-desbloquear-produccion.md) (dueña de `check-migration-safety.sh`, donde encaja el check automático de la fase 5 de esta spec)

**Status:** in progress
**Verify:** sql
**Downstream:** ninguno todavía — esta spec sólo audita y planifica; nada consume su resultado hasta que una fase de arreglo se implemente

_Date: 2026-09-08_

---

## Qué encontró el review, y qué de eso confirmé yo

Un review adversarial reportó que de 60 funciones `SECURITY DEFINER` en `public`, 34 son invocables (excluye triggers y PostGIS), sólo 13 tienen algún `REVOKE ALL ON FUNCTION` en el historial de migraciones, y nueve no tienen ningún guard efectivo contra un llamante sin JWT — con dos fugas cross-tenant reproducidas.

**Verificado contra la base real de QA** (VPS, `docker exec supabase-qa-db psql`, puerto interno 5433, ver `docs/architecture.md` / runbook de despliegue para el acceso), no contra el contenedor pgTAP del review original:

- **El recuento correcto de invocables es 39, no 34.** `pg_proc.prokind` no distingue funciones de trigger — todas muestran `'f'`; hay que filtrar por `prorettype = 'trigger'::regtype`. Contando así: 60 `SECURITY DEFINER` en `public`, 18 son funciones de trigger, 3 son overloads de `st_estimatedextent` (PostGIS), quedan **39 invocables**. El review subcontó, no sobrecontó — el alcance real es *mayor* que el reportado, no menor.
- **El recuento de "13 con REVOKE" mezclaba funciones no-`SECURITY DEFINER`.** `grep` de `REVOKE ALL ON FUNCTION` sobre todas las migraciones da 13 firmas, pero tres de ellas (`get_discrepancies`, `get_my_active_pickup_route`, `spec85_backfill_discrepancy_notes`) **no son `SECURITY DEFINER`** hoy — confirmado con `SELECT prosecdef` en QA. Entre las 39 invocables `SECURITY DEFINER`, sólo **10** tienen algún `REVOKE` en su historial.
- **De esas 10, sólo 6 están realmente cerradas.** Cuatro (`add_dock_zone_adjacency_pair`, `open_route_reception`, `remove_dock_zone_adjacency_pair`, `reopen_pickup_route`) tienen un `REVOKE ALL ... FROM anon` en su migración, pero **nunca un `REVOKE ... FROM PUBLIC`** — y el `proacl` real en QA todavía trae `=X/postgres` (el grant implícito a PUBLIC, que Postgres pone en toda función nueva y que `anon` hereda igual que cualquier otro rol). El `REVOKE FROM anon` fue, en la práctica, un no-op contra la exposición real: `anon` sigue pudiendo invocar estas cuatro hoy, por PUBLIC, no por un grant propio. **Ninguna de las cuatro es explotable en este momento** — las cuatro tienen guard efectivo en el cuerpo (`get_operator_id() IS NULL → RAISE`), verificado abajo — pero el ACL miente sobre lo que dice proteger. Es el mismo patrón exacto que `docs/specs/spec-80-recogida-movil-cierre-de-carga.md`'s migración `20260913000004` ya documentó y arregló para `close_manifest`, repetido cuatro veces antes de que esa migración existiera.
- **Las dos fugas del review son reales, reproducidas en vivo en QA, sin tocar datos** (ver más abajo).
- **Encontré una tercera fuga que el review no reportó**: `map_comuna_alias` no tiene ningún guard — ni `assert_operator_access`, ni `get_operator_id() IS NULL → RAISE`, nada — y hace un `INSERT ... ON CONFLICT` incondicional en `chile_comuna_aliases`, una tabla de referencia **compartida entre todos los operadores, sin `operator_id`**. Un llamante `anon` puede envenenarla: mapear un alias real (uno que los pedidos de cualquier operador usan) a un `comuna_id` incorrecto, corrompiendo el matching de direcciones de todo el sistema, no de un solo tenant. Reproducido en vivo — ver abajo.
- **Encontré un cuarto hallazgo, de otra naturaleza**: `public.set_config(text,text,boolean)` es un wrapper `SECURITY DEFINER` sobre el `set_config()` nativo de Postgres, sin ningún guard, ejecutable por `anon`. Confirmado en vivo: `anon` puede fijar cualquier GUC de sesión no reservado a superusuario (`statement_timeout`, `search_path`, etc.) con `is_local = false` — es decir, **para el resto de esa conexión, no sólo para la llamada actual**. Postgres sí bloquea los GUCs que exigen superusuario (`session_replication_role` falló con `permission denied`, capturado por el propio `EXCEPTION WHEN OTHERS` de la función). El riesgo real depende de si PostgREST reutiliza conexiones entre peticiones (pooling) — si las reutiliza, un `anon` podría envenenar una conexión que luego atiende a un usuario autenticado. No confirmé el modo de pool de PostgREST en QA (un comando de introspección quedó bloqueado por el clasificador de permisos de esta sesión); queda como pregunta abierta para quien implemente la fase correspondiente, no como hecho asumido.

## La tabla completa — 39 funciones `SECURITY DEFINER` invocables, QA real

`f` = tiene guard efectivo en el cuerpo (`assert_operator_access`, `get_operator_id() IS NULL → RAISE`, `is_super_admin()`, o equivalente) contra un llamante sin `auth.uid()`. `PUBLIC` = el ACL real todavía trae el grant implícito `=X/postgres` (Postgres lo pone en toda función nueva; **`anon` lo hereda salvo que se revoque explícitamente**, es decir, "sin `anon=X` explícito" NO significa "`anon` no puede llamarla" mientras esta columna diga sí).

| Función | REVOKE en migración | PUBLIC en QA | Guard efectivo | Riesgo |
|---|---|---|---|---|
| `_get_or_create_unregistered_vehicle(uuid)` | sí | no | interno, llamado sólo desde `start_pickup_route` | bajo — cerrada |
| `add_dock_zone_adjacency_pair(uuid,uuid)` | sí (sólo `FROM anon`) | **sí** | sí | medio — ACL miente, guard salva |
| `add_manifest_to_route(uuid,uuid)` | no | sí | sí | medio — nunca revocada, guard salva |
| `archive_old_audit_logs()` | no | sí | **no** | **alto — sin guard, aunque no filtra datos de tenant (borra `audit_logs` global por antigüedad)** |
| `assert_operator_access(uuid)` | no | sí | **parcial — ver sección dedicada** | **crítico — es la causa raíz de las dos fugas** |
| `calculate_daily_metrics(date)` | no | sí | **no** | **alto — recalcula métricas de TODOS los operadores por parámetro de fecha; sin daño de lectura, pero cualquiera puede disparar el cómputo** |
| `calculate_dashboard_monthly_rollup(int,int)` | no | sí | **no** | igual que arriba, rollup mensual |
| `cancel_pickup_route(uuid,text)` | no | sí | sí | medio — nunca revocada, guard salva |
| `close_manifest(uuid,jsonb)` | sí (`FROM PUBLIC` + `FROM anon`) | no | sí | bajo — cerrada, patrón correcto (spec-80 fase 1b) |
| `close_pickup_route(uuid)` | no | sí | sí | medio |
| `complete_route_reception(uuid,text)` | no | sí | sí | medio |
| `create_audit_logs_partition(date)` | no | sí | **no** | medio — sólo `RAISE NOTICE`, no ejecuta DDL real hoy (ver cuerpo) |
| `custom_access_token_hook(jsonb)` | no | sí | **no** | **crítico — fuga #2 (ver abajo); fase separada, ver diseño** |
| `delete_minted_carton(uuid,text)` | no | sí | sí | medio |
| `disable_module_for_operator(uuid,text,text)` | no | sí | sí (`is_super_admin()`) | medio |
| `enable_module_for_operator(uuid,text,text)` | no | sí | sí (`is_super_admin()`) | medio |
| `expand_carton(uuid,int,text)` | no | sí | sí | medio |
| `get_active_routes_with_dispatches(uuid,date)` | no | sí | **no (usa `assert_operator_access`, que no guarda)** | **crítico — fuga #1 (ver abajo)** |
| `get_current_user_role()` | no | sí | sí (`auth.uid()` → sin filas → NULL) | bajo |
| `get_enabled_modules_for_operator(uuid)` | no | sí | sí | medio |
| `get_manifest_label_data(uuid,uuid)` | no | sí | sí | medio |
| `get_module_audit_for_operator(uuid)` | no | sí | sí (`is_super_admin()`) | medio |
| `get_operator_id()` | no | sí | sí (`auth.uid()` → sin filas → NULL) | bajo |
| `get_route_reception_snapshot(uuid)` | no | sí | sí | medio |
| `get_unmatched_comunas(uuid)` | no | sí | **no (mismo patrón que la fuga #1)** | **alto — mismo bug de `assert_operator_access`, no reproducido aquí por espacio pero mismo mecanismo exacto** |
| `list_operators_with_module_state()` | no | sí | sí (`is_super_admin()`) | medio |
| `map_comuna_alias(text,uuid,text)` | no | sí | **no** | **alto — fuga #3, hallazgo nuevo, no reportado por el review (ver abajo)** |
| `mark_manifest_labels_printed(uuid)` | no | sí | sí | medio |
| `open_route_reception(uuid)` | sí (sólo `FROM anon`) | **sí** | sí | medio — ACL miente, guard salva |
| `reconcile_abandoned_pickup_routes(timestamptz,uuid)` | sí (`FROM PUBLIC`+`FROM anon`, vía omisión de grant) | no | n/a — sin `anon`/`authenticated` en ACL | bajo — cerrada, uso interno/cron |
| `record_discrepancies(enum,uuid,jsonb)` | sí | no | sí | bajo — cerrada (spec-85 fase 2) |
| `remove_dock_zone_adjacency_pair(uuid,uuid)` | sí (sólo `FROM anon`) | **sí** | sí | medio — ACL miente, guard salva |
| `remove_manifest_from_route(uuid,uuid)` | no | sí | sí | medio |
| `reopen_pickup_route(uuid)` | sí (sólo `FROM anon`) | **sí** | sí | medio — ACL miente, guard salva |
| `resolve_discrepancy(uuid,enum,text)` | sí | no | sí | bajo — cerrada |
| `set_config(text,text,boolean)` | no | sí | **no** | **alto — fuga #4, hallazgo nuevo (ver abajo)** |
| `start_pickup_route(text)` | no | sí | sí (`get_operator_id() IS NULL → RAISE`) | medio — **el overload huérfano** (ver sección dedicada) |
| `start_pickup_route(uuid,uuid[])` | sí (sólo `FROM anon`, `20260820000003:316`) | **sí** | sí | medio — **ACL que miente, mismo patrón que el Grupo B** (corregido: la fila original de esta tabla decía lo contrario — `REVOKE FROM PUBLIC`+`FROM anon`, PUBLIC "no" — invertido respecto al `proacl` real capturado en el mismo dump de QA. Cerrada en fase 1 (`20260913000006`), ver fix de review round 1 / PR #675) |
| `validate_audit_logging()` | no | sí | **no** | bajo — sólo diagnóstico de estructura (nombres de triggers/índices), no datos de negocio, pero expone detalle interno a un llamante anónimo |

**Resumen:** 10 funciones genuinamente sin guard (`archive_old_audit_logs`, `calculate_daily_metrics`, `calculate_dashboard_monthly_rollup`, `create_audit_logs_partition`, `custom_access_token_hook`, `get_active_routes_with_dispatches`, `get_unmatched_comunas`, `map_comuna_alias`, `set_config`, `validate_audit_logging`); 5 con ACL que miente pero guard que salva (`add_dock_zone_adjacency_pair`, `open_route_reception`, `remove_dock_zone_adjacency_pair`, `reopen_pickup_route`, y `start_pickup_route(uuid,uuid[])` — reclasificada en round 1 de review, ver fila corregida arriba); 1 overload huérfano (`start_pickup_route(text)`); 17 nunca revocadas pero con guard efectivo (defensa en profundidad pendiente, no exploit); 5 correctamente cerradas hoy; 1 causa raíz compartida (`assert_operator_access`).

## Las tres fugas de datos, reproducidas en QA (transacción con `ROLLBACK`, sin datos de Musan)

Todas corridas contra `supabase-qa-db` real, rol `anon`, `request.jwt.claims = '{}'` (`auth.uid()` = NULL, el estado exacto de un llamante sin sesión), dentro de `BEGIN; ... ROLLBACK;`. Operador usado: `QA Test Operator` (`00000000-0000-4000-8000-000000000001`) — **no Musan**, por la sesión de usuario activa sobre ese fixture.

### Fuga #1 — `get_active_routes_with_dispatches`

```sql
BEGIN;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{}';
SELECT public.get_active_routes_with_dispatches(
  '00000000-0000-4000-8000-000000000001'::uuid, '2026-09-07'::date);
ROLLBACK;
```

Devuelve, sin ninguna sesión: `driver_name: "QA Driver Uno"`, `external_route_id: "qa-route-001"`, más cada `dispatch` de esa ruta (`order_id`, `status`, `arrived_at`, `completed_at`, `failure_reason`...). El parámetro `p_operator_id` es responsabilidad del **llamante**, y PostgREST lo expone en `POST /rest/v1/rpc/get_active_routes_with_dispatches` — cualquiera con la `anon key` pública del bundle del frontend puede enumerar operadores por UUID (los UUID de operador no son secretos, aparecen en la propia URL de invitación de usuarios) y leer las rutas activas de cualquiera de ellos.

### Fuga #2 — `custom_access_token_hook`

```sql
BEGIN;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{}';
SELECT public.custom_access_token_hook(
  jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000208', 'claims', '{}'::jsonb));
ROLLBACK;
```

Devuelve, para el `user_id` dado, sin ninguna sesión:
```json
{"user_id": "00000000-0000-4000-8000-000000000208",
 "claims": {"role": "authenticated",
            "operator_id": "00000000-0000-4000-8000-000000000001",
            "permissions": ["pickup","reception","distribution","dispatch"]}}
```
Esta es **la fuga más severa de las cuatro**: dado cualquier `user_id` (UUID de `auth.users`, que sí aparece en varias respuestas de API ya autenticadas, y es enumerable en un rango pequeño de usuarios QA), un llamante anónimo recupera `operator_id`, `role` y `permissions` completos de esa cuenta — el mismo contenido que decide qué puede hacer esa persona en cada RPC. No es una fuga de datos operativos: es una fuga del propio modelo de autorización.

### Fuga #3 — `map_comuna_alias` (hallazgo nuevo, no reportado por el review)

```sql
BEGIN;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{}';
SELECT public.map_comuna_alias('ZZZ-SPEC88-POISON-TEST3',
  '66badd23-a40a-4f39-9ada-e992f0c1d16d'::uuid, 'anon-poc3');
RESET ROLE;  -- necesario para que el propio SELECT de verificación no choque con RLS de `anon`
SELECT alias, comuna_id, source FROM public.chile_comuna_aliases
 WHERE alias = 'ZZZ-SPEC88-POISON-TEST3';
ROLLBACK;
```

La fila se escribe: `ZZZ-SPEC88-POISON-TEST3 | 66badd23-... | anon-poc3`. **No es una fuga de lectura — es una escritura no autenticada sobre una tabla compartida entre todos los operadores.** `chile_comuna_aliases` no tiene `operator_id`; es el diccionario global alias→comuna que usa el matching de direcciones. `alias` tiene `UNIQUE`, así que un atacante puede además ocupar ("squattear") un alias real antes de que la operación legítima lo mapee, o remapear uno ya usado (`ON CONFLICT DO UPDATE`) a un `comuna_id` incorrecto, rompiendo el ruteo de direcciones de cualquier operador que use ese alias — no sólo del operador del atacante, porque la tabla no distingue operadores.

**Nota de proceso:** mi primer intento de reproducir esta fuga mostró `0 rows` tras el `INSERT`, que casi leí como "no hay fuga". Era falso: el propio `SELECT` de verificación, corrido todavía como `anon`, estaba bloqueado por la política RLS de la tabla (`chile_comuna_aliases_authenticated_select`, sólo para `authenticated`) — la fila sí se había escrito. `RESET ROLE` antes de verificar lo confirmó. Dejo esto anotado porque es exactamente el tipo de falso negativo que un chequeo automatizado tendría que evitar: "el llamante no puede *ver* el efecto" no es lo mismo que "el efecto no ocurrió".

### Hallazgo adicional — `set_config`, un primitivo de escritura de GUC de sesión (no un leak de datos)

```sql
SET ROLE anon;
SET request.jwt.claims = '{}';
SELECT public.set_config('statement_timeout', '1', false);  -- is_local = false
SHOW statement_timeout;  -- → 1ms, para el resto de ESTA conexión
RESET ROLE; RESET statement_timeout;
```

Confirmado en vivo: `anon` puede fijar cualquier GUC de sesión no reservado a superusuario, con alcance de **sesión**, no de transacción, a través de este wrapper `SECURITY DEFINER`. Postgres bloquea los GUCs de superusuario correctamente (`session_replication_role` → `permission denied`, atrapado por el `EXCEPTION WHEN OTHERS` de la propia función, que lo silencia con un `RAISE WARNING`). El riesgo depende de si la conexión se reutiliza entre peticiones HTTP distintas (pooling de PostgREST) — si sí, un `anon` podría envenenar `statement_timeout`, `search_path` u otro GUC no reservado para la próxima petición que caiga en esa misma conexión, sea de quien sea. **No confirmé el modo de pool de PostgREST en QA** — un `docker inspect supabase-qa-rest` para leer `PGRST_DB_POOL`/similar quedó bloqueado por el clasificador de permisos de esta sesión de auditoría, no por falta de acceso real. Queda como la primera pregunta que quien tome la fase correspondiente debe responder antes de escribir el fix — puede que el riesgo sea menor de lo que parece (una petición por conexión) o mayor (pool compartido).

## El problema de `assert_operator_access` — la decisión de diseño de este spec

```sql
CREATE OR REPLACE FUNCTION public.assert_operator_access(p_operator_id uuid)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Service-role / server-side context: no end user, cross-tenant is intended.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF p_operator_id IS DISTINCT FROM public.get_operator_id() THEN
    RAISE EXCEPTION 'operator_id mismatch: caller may not access another tenant''s data'
      USING ERRCODE = '42501';
  END IF;
END;
$function$
```

El `RETURN` temprano es **correcto** para `service_role` (workers/cron/backend sin usuario final — cross-tenant es el comportamiento deseado ahí) y **catastrófico** para `anon`, porque `auth.uid() IS NULL` es verdadero en ambos casos: no hay forma, con lo que esta función mira hoy, de distinguir "el backend llamando sin usuario, a propósito" de "un cliente sin sesión, por accidente o por ataque".

**Qué NO sirve:**

- **`current_user`/`session_user`** — dentro de una función `SECURITY DEFINER`, `current_user` es el **dueño de la función** (aquí, `postgres`), no el rol con el que PostgREST autenticó la conexión. `session_user` tampoco ayuda: PostgREST conecta como el rol `authenticator` y hace `SET ROLE` (o `SET LOCAL ROLE`, según versión) al rol resuelto del JWT (`anon`/`authenticated`/`service_role`) — `session_user` seguiría siendo `authenticator` en los tres casos. Ninguno de los dos distingue `anon` de `service_role` desde dentro de una función `SECURITY DEFINER`.
- **Confiar en que "si `service_role` llama, siempre pasará `p_operator_id` correcto"** — no es una garantía, es una esperanza. Un bug en un worker que arme mal el parámetro tendría el mismo `RETURN` temprano sin errores, silenciosamente.

**Qué sí sirve, y es lo que propone este spec:** comparar el claim `role` del JWT contra `'service_role'` explícitamente, en vez de inferirlo por ausencia de `auth.uid()`. PostgREST expone ese claim por dos vías, no una — el GUC individual heredado del modo legacy (`request.jwt.claim.role`) y el GUC JSON único (`request.jwt.claims ->> 'role'`) — y cuál de las dos está poblada depende de `PGRST_DB_USE_LEGACY_GUCS`, una variable de despliegue que este spec no controla ni puede confirmar para producción (ver más abajo). **La comprobación correcta lee las dos, coalescidas** — exactamente lo que ya hace `auth.role()`, presente en todo proyecto Supabase, que coalesce `request.jwt.claim.role` y `request.jwt.claims ->> 'role'` en ese orden. `auth.uid()` hace lo mismo para `sub`: lee primero `request.jwt.claim.sub`, y si no está, cae a `request.jwt.claims ->> 'sub'` — no lee sólo la forma JSON, como una versión anterior de esta sección afirmaba.

Reescritura propuesta (a discutir en la fase que la implemente, no cerrada aquí):

```sql
IF auth.uid() IS NULL THEN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  RETURN;  -- service_role confirmado, no inferido por ausencia
END IF;
```

**Corrección tras review de la fase 2 (PR #683):** una primera implementación de esta reescritura leyó *sólo* `request.jwt.claims ->> 'role'`, razonando (correctamente para QA) que `infra/supabase-qa/docker-compose.yml` fija `PGRST_DB_USE_LEGACY_GUCS=false` ahí. El error fue generalizar esa observación de QA a "siempre" — producción es un proyecto Supabase **gestionado**, cuyo modo de GUCs no está bajo el control de este repo y no se puede confirmar sin acceso a producción. Si el PostgREST gestionado corre en modo legacy, esa primera versión habría devuelto `NULL` para *todo* llamante `service_role` real — el mismo tipo de fuga silenciosa que esta fase existe para cerrar, un nivel más abajo. La solución no es elegir cuál de las dos fuentes confiar: es leer ambas, que es exactamente lo que hace `auth.role()`.

Esto cierra la fuga **incluso si alguien vuelve a olvidar un `REVOKE`** en una función futura que reutilice `assert_operator_access` como guard — es la razón por la que esta reescritura merece su propia fase en vez de conformarse con el `REVOKE` de ACL. El `REVOKE` cierra la puerta hoy; esto cierra la clase de bug.

**Riesgo de esta reescritura, por qué no va en fase 1:** si `current_setting('request.jwt.claim.role', true)` no está poblado exactamente como se espera en todo contexto real donde hoy `service_role` sí funciona (cron interno, worker de `apps/agents`, llamadas administrativas), la reescritura rompería esos caminos en silencio — el mismo tipo de "romper lo que hoy funciona" que el spec pide evitar. Necesita probarse contra cada llamante `service_role` real antes de aterrizar, no sólo contra el caso `anon`.

## `custom_access_token_hook` — por qué esto NO se puede arreglar a ciegas

**Medido en QA, no asumido:**

1. **GoTrue en QA no tiene ningún `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*` en su entorno.** `docker inspect supabase-qa-auth` no muestra ninguna variable de hook — sólo `GOTRUE_JWT_*`, `GOTRUE_DB_*`, etc. `packages/database/supabase/config.toml` sí declara el hook (`[auth.hook.custom_access_token]`, `enabled = true`), pero ese archivo es config del **Supabase CLI para desarrollo local** — no se traduce automáticamente a variables de entorno del contenedor GoTrue self-hosted que corre en la VPS. `packages/database/supabase/MANUAL_STEPS.md` lo confirma: el hook requiere registro manual vía "Authentication > Hooks" del Dashboard de Supabase, un paso que el self-hosted de este proyecto no tiene documentado como ejecutado.
2. **El mecanismo que realmente puebla el JWT en QA es un trigger, no el hook.** `sync_claims_to_auth_metadata()` — trigger `sync_claims_on_user_change` sobre `public.users`, confirmado `ENABLED` (`tgenabled = 'O'`) — escribe `operator_id`/`role`/`permissions` directo en `auth.users.raw_app_meta_data` en cada INSERT/UPDATE de `public.users`. GoTrue incluye `app_metadata` en el JWT sin necesitar ningún hook. **En QA, `custom_access_token_hook` es código muerto del lado del login** — nada lo invoca en el flujo real, sólo sigue siendo alcanzable por PostgREST como cualquier otra función. **Esto era cierto hasta la fase 3 (ronda 2 de review, PR #710): `infra/supabase-qa/docker-compose.yml` ganó `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED`/`..._URI`, igualando QA a producción — el hook deja de ser código muerto en QA a partir de ese PR.** Se deja el punto 2 completo, sin editar el resto, porque explica correctamente por qué `e2e-qa` no lo ejercitaba antes de esa fase — era la tercera afirmación falsa que sostenía spec-88, y el error real fue de otro (el argumento de apoyo de la fase 3 que la citaba como "sigue siendo cierto en producción" sin volver a medirlo ahí), no de este párrafo en sí.
3. **Producción SÍ tiene el hook activo — confirmado 2026-09-09, ver fase 3. Quien lo invoca es GoTrue, con su propio rol de conexión (`supabase_auth_admin`, tomado de `GOTRUE_DB_DATABASE_URL`), nunca `anon` ni `authenticated`.** `supabase_auth_admin` existe como rol separado en QA (confirmado con `SELECT rolname FROM pg_roles`). Esto es la pieza central del argumento: **revocar el `EXECUTE` de `anon` (y de PUBLIC) sobre `custom_access_token_hook` no puede romper la llamada de GoTrue**, porque GoTrue nunca fue `anon` para empezar — hoy `supabase_auth_admin` tiene acceso sólo por heredar el grant implícito de PUBLIC (`=X`), nunca por un grant propio. **Lo que sí rompería el hook, si producción lo usa,** es revocar PUBLIC sin añadir, en la misma migración, un `GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin` explícito.

**Confirmado (2026-09-09), ya no es una incógnita:** el hook está activo en producción (`hook_custom_access_token_enabled=true`, ver fase 3). La fase que toque esta función debe: (a) incluir el `GRANT ... TO supabase_auth_admin` en la misma migración que cualquier `REVOKE`; (b) probar el login end-to-end en QA primero, y sólo después en producción, antes de dar la fase por cerrada. Esto no es una tarea de una línea — es la razón por la que el spec la separa del resto. ("Los seis usuarios `qa-*@qa.test`" del borrador original resultó sobre-especificación — ver la corrección más abajo, en el bloque "Lo que esta fase debe hacer".)

**Corrección — el `docker inspect` de producción que este documento pedía originalmente es imposible, y nadie lo comprobó durante horas.** Producción **no es self-hosted como QA**: es un proyecto Supabase gestionado (ref `wfwlcpnkkxxzdvhvvsxb`, visible en la URL del check "Supabase Preview" de cualquier PR). No hay contenedor GoTrue de producción que inspeccionar — `~/.ssh/config` (`aureon-vps`) sólo tiene los contenedores de QA (`supabase-qa-auth`, `supabase-qa-db`, etc.). La comprobación equivalente es la **Management API de Supabase**: `GET https://api.supabase.com/v1/projects/<ref>/config/auth` devuelve `hook_custom_access_token_enabled` y `hook_custom_access_token_uri`. Necesita un PAT — existe como secreto de GitHub (`SUPABASE_ACCESS_TOKEN`, junto con `SUPABASE_PROJECT_REF`, confirmados con `gh secret list`), pero el valor no es legible fuera de un workflow.

**Comprobación real, hecha en esta fase:** `.github/workflows/check-prod-auth-hook.yml` — un `workflow_dispatch` de una sola tarea que hace ese `curl` contra la Management API y sólo imprime el booleano `hook_custom_access_token_enabled` (nunca el PAT ni el cuerpo completo de la respuesta). El usuario lo lanzó (`workflow_dispatch`, run `34240504022`, 2026-09-08T14:47:08Z) y el resultado ya está leído — ver fase 3, más abajo.

**Argumento de apoyo, no prueba — refutado por la medición (2026-09-09), se deja para explicar por qué se creyó lo contrario:** el mecanismo que puebla los claims en QA es un **trigger** (`sync_claims_on_user_change` sobre `public.users`, vía `sync_claims_to_auth_metadata()`, escribiendo en `auth.users.raw_app_meta_data`), definido en `packages/database/supabase/migrations/20260312120000_sync_app_metadata_claims.sql`. Esa migración está aplicada en producción — spec-87 documenta el ledger de producción coincidiendo con el repo, 190 migraciones aplicadas (`docs/specs/spec-87-desbloquear-produccion.md:369`). El razonamiento era: si el trigger es lo que puebla los claims en ambos entornos, el hook sería redundante en producción igual que en QA. **La Management API dice lo contrario: `hook_custom_access_token_enabled=true` en producción.** El trigger estar aplicado en ambos entornos no implica que el hook esté inactivo en ambos — la inferencia estructural se equivocó de lado. Ver fase 3.

## El overload huérfano — `start_pickup_route`

Dos firmas: `start_pickup_route(uuid, uuid[])` (spec-61, `20260820000003`) y `start_pickup_route(text)` (spec-47/spec-52, anterior). El `REVOKE ALL ... FROM anon` de `20260820000003` sólo apunta a la firma de 2 argumentos por tipo — Postgres resuelve `REVOKE ON FUNCTION nombre(tipos)` por firma exacta, no por nombre. `start_pickup_route(text)` nunca recibió su propio `REVOKE`, en ninguna de las dos migraciones que la crearon (`20260625000001`, `20260812000003`), y hoy conserva `anon=X` **y** PUBLIC.

**No es una fuga de datos** — confirmado en vivo: `start_pickup_route('TEST-999')` como `anon` sin JWT falla limpio con `no operator in JWT` (42501), porque `get_operator_id()` devuelve NULL y la función lo comprueba antes de escribir nada. Pero es exactamente la lección que este spec quiere dejar escrita: **un `REVOKE` por firma no alcanza a un overload que exista o que se cree después**, y nada en el repo lo detecta hoy. Ver fase 5.

## Producción — lo que no puedo comprobar, y qué haría falta

No tengo credenciales de producción en esta sesión — sólo acceso a la VPS de QA (el mismo host físico, pero la base `supabase-qa-db` es una instancia Docker separada de la de producción, si existe como contenedor propio, o un proyecto Supabase alojado distinto; no lo sé, y no voy a asumirlo). Todo lo anterior de este spec está medido contra QA. **No hay ninguna cifra de este documento presentada como cierta para producción** salvo por inferencia estructural (el código de las funciones es el mismo código, porque es el mismo repo — pero el `proacl` real, que es lo que decide si el ataque funciona, puede diferir si alguien aplicó un `REVOKE` manual fuera de una migración, o si producción está detrás en migraciones, como spec-87 documenta que lo está).

**Qué haría falta para comprobarlo:** acceso SSH/docker al host de producción (o a quien lo tenga) para correr, contra la base de producción, exactamente las mismas dos consultas usadas aquí:
```sql
SELECT p.oid::regprocedure, coalesce(array_to_string(p.proacl, ','), 'NULL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND p.proname IN (/* las 10 sin guard */);
```
y, para el estado del hook, la Management API de Supabase (`GET /v1/projects/<ref>/config/auth`, ver fase 3 — producción no tiene contenedor GoTrue que inspeccionar, a diferencia de QA). Sin eso, cualquier fase que toque producción (fase 3, la del hook) tiene que empezar por esa comprobación — no puede asumir que QA y producción coinciden.

## Fases

Ordenadas por riesgo y por lo que se puede hacer sin arriesgar el login.

| Fase | Qué entrega | Toca `custom_access_token_hook`/`assert_operator_access` |
|---|---|---|
| **1 — REVOKE mecánico** | Cierra las tres fugas de datos que no dependen de reescribir `assert_operator_access`, más el ACL-que-miente y el overload huérfano | no |
| **2 — Reescritura de `assert_operator_access`** | Distingue `service_role` real de `anon` por rol de conexión, no por ausencia de `auth.uid()` | sí, ella misma |
| **3 — `custom_access_token_hook`** | Confirma producción, `GRANT` a `supabase_auth_admin`, prueba login end-to-end, sólo entonces `REVOKE` | sí |
| **4 — Check automático de ACL huérfana** | `check-migration-safety.sh` (spec-87 fase 5) detecta un overload sin `REVOKE` propio y un `REVOKE FROM anon` sin `REVOKE FROM PUBLIC` que le corresponda | no |
| **5 — Defensa en profundidad del resto** | `REVOKE` sobre las 17 funciones guardadas-pero-nunca-revocadas — sin urgencia, sin riesgo, cierre de higiene | no |
| **6 — `set_config` deja de ser un bypass genérico de GUC** | Allowlist de `setting_name` o `REVOKE` de `authenticated`, según lo que muestre el inventario de llamantes reales — cierra la vía hallada en el review de la fase 2 (no alcanzable por HTTP, sí por sesión Postgres directa) | no |

### Fase 1 — REVOKE mecánico `[done]`

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, `packages/database/supabase/tests/spec88_fase1_revoke_anon.test.sql`

Cierra, con una sola migración (`CREATE OR REPLACE` no es necesario donde el cuerpo no cambia — sólo el ACL), las funciones donde revocar `anon`/PUBLIC no cambia ningún comportamiento legítimo, porque **ningún llamante legítimo del sistema es `anon`** sobre estas RPCs: el frontend siempre llama autenticado, y el patrón correcto (spec-80 fase 1b, spec-85 fase 2) es `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated [, service_role]; REVOKE ALL ... FROM anon;`.

**Funciones a cerrar en esta fase — 16 en total (corregido en round 1 de review, PR #675 — ver nota abajo):**
- Las 9 confirmadas sin guard, salvo `custom_access_token_hook` (fase 3, aparte): `archive_old_audit_logs`, `calculate_daily_metrics`, `calculate_dashboard_monthly_rollup`, `create_audit_logs_partition`, `get_active_routes_with_dispatches`, `get_unmatched_comunas`, `map_comuna_alias`, `set_config`, `validate_audit_logging`. De estas nueve, cinco (`archive_old_audit_logs`, `calculate_dashboard_monthly_rollup`, `create_audit_logs_partition`, `validate_audit_logging`, y `start_pickup_route(text)` más abajo) nunca tuvieron un `GRANT` explícito a `authenticated` — sólo el `=X` implícito que Postgres pone en toda función nueva. Un `REVOKE FROM PUBLIC`+`FROM anon` sin también `FROM authenticated` las deja invocables por cualquier sesión autenticada sin ningún guard — el `REVOKE` debe alcanzar a `authenticated` también en esas cinco.
- Las 5 con ACL-que-miente (guard salva, pero PUBLIC sigue expuesto): `add_dock_zone_adjacency_pair`, `open_route_reception`, `remove_dock_zone_adjacency_pair`, `reopen_pickup_route`, y **`start_pickup_route(uuid,uuid[])`** — la firma viva de `start_pickup_route`, mal clasificada originalmente como "ya cerrada" (ver fila corregida en la tabla arriba). Aquí sí hace falta `REVOKE ALL ... FROM PUBLIC` explícito.
- El overload huérfano: `start_pickup_route(text)`.
- `assert_operator_access(uuid)` misma: **no** tiene por qué ser invocable directamente por nadie fuera de otra función `SECURITY DEFINER` — no hay ningún llamante legítimo desde PostgREST. Revocar PUBLIC y `anon`/`authenticated` aquí (dejar sólo `service_role`, si acaso) no rompe nada porque las funciones que la usan como guard interno la llaman como su propio dueño (`SECURITY DEFINER`, ejecuta con privilegios del dueño de la función, no del rol PostgREST del llamante original) — confirmar esto en la implementación antes de aplicar, no asumirlo de esta prosa.

**Por qué `map_comuna_alias` y `set_config` no necesitan la reescritura de `assert_operator_access` (fase 2) para cerrarse:** ninguna de las dos usa `assert_operator_access` como guard — de hecho, no usan ningún guard. El `REVOKE` de ACL, sin más, ya es suficiente para las dos.

**Verificación de esta fase:** re-correr, contra QA, las tres fugas reproducidas arriba y el intento de `set_config('statement_timeout', ...)` como `anon` — las cuatro deben fallar con `permission denied for function` (Postgres, no la propia función) tras el `REVOKE`. Ningún flujo autenticado existente debe romperse — correr al menos un E2E que use `get_active_routes_with_dispatches` (buscar el consumer real en `apps/frontend` antes de escribir la migración) contra QA autenticado, antes y después.

**Excepción declarada al límite de 300 líneas por archivo:** `packages/database/supabase/tests/spec88_fase1_revoke_anon.test.sql` es SQL repetitivo — cada una de las 16 funciones necesita su propio `has_function()` + de 2 a 4 aserciones `aclexplode()` casi idénticas (PUBLIC, `anon`, a veces `authenticated`/`service_role`), y partirlo por grupo (A/B/C) rompería la sección `plan(N)` única que pgTAP exige por transacción. Se deja como un solo archivo en vez de dividirlo artificialmente.

> Implementado por: rama `feat/spec-88-fase-1-revoke-anon`, SHA `a9aeb646`,
> PR #675 (merge `d77fe792`, 2026-09-08T10:38:42Z).
> Review: al menos una ronda — corrigió la clasificación de
> `start_pickup_route` (la firma viva `uuid,uuid[]` estaba mal marcada como
> "ya cerrada"; el total de funciones subió a 16) y confirmó por test, no
> por suposición, que `assert_operator_access` sigue funcionando como guard
> interno tras el `REVOKE` (`SECURITY DEFINER` ejecuta con los privilegios
> del dueño, no del rol del llamante).
> QA: `gh pr checks 675` verde (Lint/Type-Check/Test/Build en ambos jobs,
> Vercel deploy). La migración está aplicada en producción — confirmado
> `git merge-base --is-ancestor d77fe792 32667d0d`, el `headSha` del run
> `34265192142` ("Deploy Production"), cuyo job `Verify Production
> Migrations` cerró en verde. ACL real verificado en QA antes/después,
> citado en el PR (`aclexplode` sobre las 16 funciones).
> Downstream: ninguno declarado para este spec (`**Downstream:** ninguno
> todavía`, cabecera). Fase 2 de este mismo spec depende de que
> `assert_operator_access` siga revocada de PUBLIC/anon/authenticated tras
> esta fase — sin cambios sobre esa premisa.

### Fase 2 — Reescritura de `assert_operator_access` `[done]`

**Archivos:** `packages/database/supabase/migrations/20260913000008_spec88_fase2_assert_operator_access_service_role.sql`, `packages/database/supabase/tests/spec88_fase2_assert_operator_access_service_role.test.sql`, `packages/database/supabase/tests/cross_tenant_definer_rpcs_test.sql`

Implementa la distinción `service_role` real vs. `anon`/ausencia de sesión, propuesta en la sección de diseño arriba (`auth.role() = 'service_role'`, no ausencia de `auth.uid()`). Requiere:
- Inventariar cada llamante `service_role` real de `assert_operator_access` (directo o vía `get_active_routes_with_dispatches`/`get_unmatched_comunas`) — grep en `apps/agents`, `apps/frontend/src/app/api`, cualquier cron/worker — y confirmar que cada uno de verdad manda una conexión cuyo JWT claim `role` es `service_role` antes de fiarse de la reescritura.
- Probar contra QA con ambos roles: `service_role` real (debe seguir pasando, cross-tenant intencional) y `anon` (debe fallar con 42501, no con un `RETURN` silencioso).
- Esta fase **no depende** de la fase 1 — puede ir en paralelo, pero conceptualmente cierra la clase de bug que la fase 1 sólo tapa función por función.

**Desviación deliberada de la propuesta literal del spec, corregida tras review (PR #683):** una primera versión de esta migración usó `current_setting('request.jwt.claims', true)::jsonb ->> 'role'` en vez del GUC individual `request.jwt.claim.role` que el snippet original de diseño mostraba, razonando que `infra/supabase-qa/docker-compose.yml` fija `PGRST_DB_USE_LEGACY_GUCS: "false"` para el contenedor `rest` de QA, así que el GUC individual nunca se puebla ahí. Eso es cierto para QA, pero QA no describe producción — producción es un proyecto Supabase **gestionado** (`apps/frontend/docs/deployment-runbook.md:137`), cuyo modo de GUCs no está bajo control de este repo. Si el PostgREST gestionado corre en modo legacy, esa primera versión habría leído `NULL` para todo llamante `service_role` real (el GUC JSON nunca se puebla en ese modo) y lo habría rechazado — el mismo bug que esta fase existe para cerrar, un nivel más abajo. La conclusión correcta no era cambiar de una fuente única a la otra: es leer **ambas**, coalescidas — que es exactamente lo que ya hace `auth.role()` (presente en todo proyecto Supabase, sin necesidad de reimplementarlo aquí) y lo que ya hace `auth.uid()` para `sub`. La migración final llama `auth.role()` directamente; la razón queda documentada en el propio archivo de migración y en el test (caso `legacy-GUC-mode`, TEST 3b).

**Inventario de llamantes `service_role` reales — hecho, resultado: cero.** `assert_operator_access` sólo se invoca desde `get_active_routes_with_dispatches` y `get_unmatched_comunas` (confirmado con `git grep -n "PERFORM public.assert_operator_access"` sobre todas las migraciones). Los únicos consumidores reales de esas dos RPCs en todo el repo (`git grep`/`grep -rl` sobre `apps/agents`, `apps/worker`, `apps/frontend/src/app/api`, `packages/database/supabase/functions`, `apps/frontend/supabase/functions`, `scripts/*.mjs`, `n8n/workflows`) son `apps/frontend/src/hooks/useActiveRoutes.ts` y `apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts`, ambos vía `createSPAClient()` — sesión de navegador autenticada, nunca `service_role`. **No existe hoy ningún llamante `service_role` real de este guard** en el código que se despliega; la reescritura no puede romper un camino que no existe, y sólo cierra la posibilidad de que uno futuro se confíe en falso. Detalle completo en el header de `20260913000008_spec88_fase2_assert_operator_access_service_role.sql`.

**Probado contra QA con ambos roles:** no se probó contra QA en vivo (sin credenciales VPS en esta sesión de implementación) — probado contra el contenedor `spec52-pg` local (pgTAP). `service_role` con `role` confirmado en el JWT sigue pasando cross-tenant (`spec88_fase2_assert_operator_access_service_role.test.sql`, tests 4-5), incluido el caso donde sólo el GUC legacy `request.jwt.claim.role` está poblado y `request.jwt.claims` no existe en absoluto (test 6, `lives_ok`); `anon`/sin sesión/`role:anon` ahora falla con 42501 en vez de `RETURN` silencioso (mismo archivo, tests 1-3, y `cross_tenant_definer_rpcs_test.sql` TEST 5, reescrito porque codificaba la premisa vieja "sin `sub` = service-role"); un caller `authenticated` con `operator_id` ajeno sigue rechazado (test 8, ancla el `IF p_operator_id IS DISTINCT FROM get_operator_id()` que TEST 4/7 por sí solo no cubría). Mutation-testeado: instalar el cuerpo con sólo `request.jwt.claims ->> 'role'` (la primera versión de esta fase, antes del review) hace fallar exactamente el test 6, ningún otro; instalar el cuerpo con el segundo `IF` borrado hace fallar exactamente el test 8. Quien mergee y despliegue a QA real debe confirmar el mismo comportamiento ahí antes de dar la fase por cerrada — ver `> QA:` pendiente.

**Alcance real de "cierra la clase de bug" — acotado tras review (PR #683):** esta fase cierra la inferencia de `service_role` por ausencia de `auth.uid()` — el bug original. No cierra `public.set_config(text,text,boolean)`: es `SECURITY DEFINER`, sin allowlist de nombre de GUC, y conserva `GRANT EXECUTE ... TO authenticated` desde la fase 1 (`20260913000006:134`). Un caller `authenticated` puede ejecutar `SELECT public.set_config('request.jwt.claims','{"role":"service_role"}',true)` y la siguiente llamada en la misma sesión pasaría el guard de esta fase. No es una regresión de esta fase (el cuerpo viejo con `RETURN` temprano lograba el mismo resultado) y **no es alcanzable por HTTP real**: PostgREST abre una transacción nueva por request y refija los claims JWT en cada una, así que no hay una segunda llamada dentro de la misma sesión donde el `set_config` del paso anterior siga vigente. Sigue siendo una vía real desde `psql`/cualquier cliente directo a Postgres autenticado como `authenticated`. Ver fase 6.

> Implementado por: rama `feat/spec-88-fase-2-assert-operator-access`, SHA
> `291a5e76`, PR #683 (merge `ffcf5972`, 2026-09-08T17:47:04Z).
> Review: dos rondas. La ronda 1 bloqueó porque el discriminador leía sólo
> el GUC JSON individual (`request.jwt.claim.role`, que nunca se puebla con
> `PGRST_DB_USE_LEGACY_GUCS=false`); se cambió a `auth.role()`, que coalesce
> ambas fuentes. El reviewer reprodujo el RED (`not ok 6` sólo con el cuerpo
> viejo) y comparó el comportamiento de `auth.role()` contra un contenedor
> Supabase de otro proyecto con la imagen oficial — hash del `prosrc`
> idéntico. Esa misma ronda abrió la fase 6 (`set_config`) al acotar la
> afirmación de "cierra la clase de bug" a lo que de verdad cierra (arriba).
> QA: `gh pr checks 683` verde (Lint/Type-Check/Test/Build en ambos jobs,
> Vercel deploy). La migración `20260913000008` está aplicada en
> producción — confirmado `git merge-base --is-ancestor ffcf5972 32667d0d`,
> el `headSha` del run `34265192142` ("Deploy Production"), cuyo job
> `Verify Production Migrations` cerró en verde — cierra el "ver `> QA:`
> pendiente" que dejó el párrafo de arriba: no se probó contra QA en vivo en
> el momento de implementar (sin credenciales VPS en esa sesión), pero la
> migración sí llegó a producción y su verificación de ledger pasó. Suites
> citadas en el PR: 8/8, 64/64, 4/4, 5/5, sobre salida cruda de `psql`.
> Downstream: ninguno declarado para este spec (`**Downstream:** ninguno
> todavía`, cabecera).

### Fase 3 — `custom_access_token_hook` `[in_progress]`

> Implementado por: implementer — rama `feat/spec-88-fase-3-auth-hook`,
> SHA `63d20f7` (ronda 1), más ronda 2 tras review (ver abajo). Migración
> `20260922000001` — `GRANT` a `supabase_auth_admin` junto a
> `REVOKE ALL ... FROM PUBLIC/anon/authenticated`; `service_role` intacto
> (mismo criterio que fase 1). `authenticated` se cierra también, más allá
> de lo que pedía el texto de esta fase — decisión propia, confirmada en
> ronda 2 reproduciendo la fuga en vivo como `authenticated` (no sólo
> `anon`): con `SET LOCAL ROLE authenticated` y un `sub` ajeno, el hook
> devolvía el `operator_id` de una cuenta `super_admin` que no era la del
> llamante — el cuerpo lee `WHERE id = (event->>'user_id')::uuid` y nunca
> mira `auth.uid()`. TDD: test pgTAP
> (`spec88_fase3_custom_access_token_hook_acl.test.sql`) confirmado en rojo
> contra el ACL real de `spec52-pg` antes de escribir la migración (5/6
> asserts fallando por la razón correcta), verde después, con `throws_ok`
> exigiendo `permission denied` real de `anon` — no sólo el ACL. Sin
> regresión en `spec88_fase1_revoke_anon`,
> `spec88_fase2_assert_operator_access_service_role`,
> `spec88_assert_operator_access_internal_guard`.
>
> **Ronda 2 (review adversarial, mutation-testeado):** confirmó que el
> `GRANT`/`REVOKE` y el test son correctos, y encontró dos bloqueantes de
> cobertura, cerrados en `21174ea`/siguiente commit:
> 1. `e2e-qa` **no ejercitaba el hook en QA** — `infra/supabase-qa/docker-compose.yml`
>    no traía ninguna `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*`, y el propio spec
>    ya lo decía (línea ~193, "código muerto del lado del login" en QA — cierto
>    hasta este PR). Arreglado: se añadieron `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`
>    y `..._URI=pg-functions://${POSTGRES_DB}/public/custom_access_token_hook`,
>    igualando QA a producción.
> 2. Aun con el hook activo, `signIn()` en `spec52-fixture.ts` sólo comprobaba
>    que el login no fallara — nunca leía el JWT, y el hook degrada en
>    silencio (`EXCEPTION WHEN OTHERS ... RETURN event`) sin romper el login.
>    Arreglado: nuevo helper `getAccessTokenClaims()` (decodifica la cookie
>    `sb-*-auth-token` de `@supabase/ssr`) más una aserción en
>    `spec52-pickup-reception-end-to-end.spec.ts`, justo después de
>    `signIn(driver, DRIVER)` — **corregida en ronda 3, ver abajo: el
>    assert original miraba el lugar equivocado del JWT.**
> 3. Corregido el comentario "ORDEN NO NEGOCIABLE" de la migración — el
>    orden `GRANT`/`REVOKE` es conmutativo dentro de una transacción
>    (verificado moviendo el `GRANT` al final: mismo ACL, 6/6 verde); lo
>    crítico es que el `GRANT` exista, no su posición, y eso ya lo cubren el
>    test y el `DO` block de la propia migración.
> 4. Los "seis `qa-*@qa.test`" eran sobre-especificación mía, no del spec:
>    la migración no toca el cuerpo de la función, sólo el ACL, y `EXECUTE`
>    es binario — un solo login real con el hook activo, leyendo los claims,
>    es prueba completa. (Y `docs/qa-environment.md` lista **ocho**, no
>    seis.) El punto 2 de arriba cierra esto de forma permanente, no sólo
>    para este PR: cualquier PR futuro que rompa el hook ahora falla
>    `e2e-qa`.
>
> **Plan de rollback**, pedido en ronda 2 — si el `GRANT`/`REVOKE` de
> producción rompe el login (el `DO` block de la propia migración debería
> impedir que llegue a `COMMIT`, pero por si el `GRANT` se pierde en un
> `REPLACE` posterior): salida rápida vía el editor SQL del proyecto
> gestionado (Supabase Dashboard → SQL Editor, ref `wfwlcpnkkxxzdvhvvsxb`),
> `GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO
> supabase_auth_admin;` — un `GRANT` de una línea, sin necesitar una
> migración nueva ni pasar por el pipeline de deploy, restaura el acceso de
> GoTrue de inmediato. Confirmar con
> `SELECT rolname FROM pg_roles r JOIN aclexplode((SELECT proacl FROM
> pg_proc WHERE proname='custom_access_token_hook')) a ON a.grantee=r.oid
> WHERE r.rolname='supabase_auth_admin';` — una fila de vuelta, login
> restaurado sin esperar al gate de CI.
>
> **Nota sobre el contenedor local:** `spec52-pg` se encontró en ronda 2 con
> `proacl` ya migrado pero sin la fila correspondiente en el ledger, y con
> `/supabase/migrations` de otra rama copiado dentro — no invalida los
> resultados citados arriba (se verificó el objeto vivo, no el ledger), pero
> "reejecuté las tres suites en el mismo contenedor" de la ronda 1 describía
> un contenedor que ya no era limpiamente el mío; ronda 2 no dependió de esa
> afirmación para nada nuevo.
>
> **Ronda 3 (review adversarial, ejecutando código real contra
> `@supabase/ssr@0.5.2` instalado):** confirmó que `getAccessTokenClaims`
> reconstruye correctamente una sesión partida en 3 chunks reales
> percent-encodeados, que la preocupación por `permissions` vacío no
> aplicaba (`handle_new_user` mapea `pickup_leader → ARRAY['pickup']`), que
> la corrección del comentario "ORDEN NO NEGOCIABLE" es exacta (`DO` block
> ejecutado quitando el `GRANT` → `ERROR` real, no hipotético), que el plan
> de rollback es ejecutable por un tercero, y que mi sospecha sobre la URI
> del hook (`${POSTGRES_DB}` vacío) era una falsa alarma — están definidos y
> usados en diez sitios del mismo compose, el `GRANT USAGE ON SCHEMA public
> TO supabase_auth_admin` ya existía. Dos bloqueantes reales, cerrados aquí:
> 1. **El assert de ronda 2 no distinguía hook-ejecutado de hook-ausente.**
>    `sync_claims_to_auth_metadata()` (trigger, no el hook —
>    `20260312120000_sync_app_metadata_claims.sql:31-40`) escribe la misma
>    llave `app_metadata.claims`, con la misma forma, directo en
>    `auth.users.raw_app_meta_data` — y GoTrue la copia al JWT sin pasar por
>    el hook. Medido por el revisor: `app_metadata.claims` sale
>    byte-idéntico con y sin el hook. Lo único que el hook añade en
>    exclusiva es la raíz del payload (`claims := claims || custom_claims`,
>    `20260312190110_fix_hook_role_overwrite.sql:36`). Arreglado: el assert
>    ahora mira `claims.operator_id`/`claims.permissions` en la **raíz**, no
>    `app_metadata.claims` — `role` no sirve de discriminante porque el
>    hook lo resetea a `"authenticated"` en la raíz justo después del merge.
>    Verificado con una simulación en Node (payload sin hook, sólo
>    `app_metadata.claims` poblado por el trigger, root sin
>    `operator_id`/`permissions`): el assert nuevo falla
>    (`operator_id mismatch: got undefined`); el assert viejo de ronda 2
>    habría pasado igual.
> 2. **El compose nuevo nunca llegaba al contenedor `auth`.**
>    `deploy-qa.sh` sólo hace `docker compose ... up -d functions` — nunca
>    `auth`. El `up -d` completo de `setup-qa.sh` es bootstrap manual, no
>    invocado por `deploy-qa.sh`. Resultado: mergear no habría cambiado el
>    entorno real de `supabase-qa-auth`, que habría seguido sin las
>    `GOTRUE_HOOK_*` — silencioso, y compuesto con el bloqueante 1 (el
>    assert tampoco lo habría detectado). Arreglado: nuevo flag
>    `CHANGED_QA_COMPOSE` (widened sólo contra
>    `infra/supabase-qa/docker-compose.yml`, separado de
>    `CHANGED_EDGE_FUNCTIONS` para no recrear `auth` en cada cambio de
>    `functions/`) y `restart_auth()` (mismo patrón `up -d`, no `restart`,
>    que `restart_functions()`), invocado en `main()` cuando el flag es
>    `true`. No resuelto en general — spec-93 (PR #714) ya recoge la
>    divergencia QA↔prod más amplia; esto sólo arregla que `auth` se recree.
>
> **Corrección al propio texto de esta fase:** la frase "ya no depende de
> que alguien lo haga a mano" (ronda 2) era ella misma una afirmación de
> cobertura sin medir — exactamente lo que ronda 3 encontró falso, dos
> veces. Retirada; ver la línea de QA de abajo para el estado real.
>
> **Ronda 4 (review adversarial, ejecutando contra `@supabase/ssr@0.5.2`
> instalado y un compose de juguete real):** declarada **mergeable con
> correcciones** — confirmó que el assert discrimina en las dos direcciones
> (payload construido con el hook real ejecutado contra un `pickup_leader`
> de `handle_new_user` → `PASS`; sin hook → `FAIL: operator_id got
> undefined` — la ronda 2 daba `PASS` en los dos), que `up -d auth` sí
> recrea por cambio de config (`docker compose` compara el config-hash, no
> la imagen — probado: `Container ... Recreated`, ID de `auth` cambiado, el
> de `db` no), que `CHANGED_QA_COMPOSE` dispara con diffs acumulados/
> agrupados, que no hay regresión en `functions`, que el orden
> `restart_functions → restart_auth → apps → post_checks` no deja ventana
> para `e2e-qa` (job aparte, `needs: [deploy-qa]`), y cerró también mi
> propia falsa alarma de ronda 3 sobre la URI del hook con evidencia
> ejecutada (`gotrue:v2.192.0` arrancado con las tres variantes de URI —
> `POSTGRES_DB` vacío también valida, el segmento se ignora; sólo una URI
> genuinamente malformada mata el arranque, con mensaje explícito). Tres
> hallazgos, cerrados aquí:
> 1. **El arreglo de B2 (ronda 3) no tenía test**, pese a que
>    `deploy-qa.functions.test.sh` ya existe para exactamente este patrón
>    (`restart` reutiliza config, sólo `up -d` relee el compose) y ya corre
>    en `.github/workflows/ci.yml:161`. Añadidos 8 tests: 4 para
>    `restart_auth()` (recreate no restart, servicio correcto, env file,
>    `--no-deps` — ver punto 3) y 3 para el widen de `CHANGED_QA_COMPOSE`
>    (compose dispara, `functions/`-only NO dispara, no relacionado no
>    dispara). Mutation-verificado: revertir `--no-deps` → 1 test rojo;
>    borrar la línea de widen → 1 test rojo (el resto se mantuvo verde en
>    ambos casos, confirmando que no son falsos positivos).
> 2. **`post_checks()` no comprobaba `auth` en absoluto.** `up -d auth`
>    espera a que `db` (su dependencia) esté sana, no a que `auth` mismo lo
>    esté — y una config de hook mala mata a GoTrue en el arranque (ronda 4
>    lo demostró). Nueva `container_health_check()`, leyendo
>    `docker inspect --format='{{.State.Health.Status}}'` del contenedor
>    (no un `http_check`: `auth` no publica puerto al host, y Kong no
>    enruta `GET /auth/v1/health` — sólo `/verify`, `/callback`,
>    `/authorize`, `/.well-known/jwks.json` y `/sso/*` son rutas abiertas),
>    cableada en `post_checks()` sin condicionar a ningún `CHANGED_*` (igual
>    que `db_check`, porque `auth` debe estar sano en todo deploy, no sólo
>    en los que tocan el compose). 6 tests nuevos cubriendo healthy/
>    unhealthy/starting/contenedor ausente, mutation-verificado forzando el
>    check a pasar siempre → 4 de los 6 rojos.
> 3. **`--no-deps` en `restart_auth()`** — sin él, `up -d auth` también
>    recrearía `db` (Postgres de QA, con Musan) si SU config-hash cambiara
>    por cualquier PR futuro que tocara el bloque `db:` del mismo compose,
>    cortando conexiones vivas unos segundos como efecto colateral de un
>    cambio ajeno a `auth:`. Seguro aquí porque `restart_auth()` corre
>    después de que `apply_migrations`/`apply_seed`/`apply_qa_users` ya
>    probaron `db` sano en el mismo `main()`. Anotado, no arreglado, en
>    `restart_functions()`: misma exposición preexistente, fuera de
>    alcance de esta fase.
>
> **Archivos** actualizado (índice de la fase completo, ver más abajo) —
> ronda 4 encontró que seguía describiendo sólo el plan de ronda 1.
>
> **Ronda 5 (review adversarial):** un hallazgo — cada test de rondas 3/4
> probaba las funciones (`restart_auth`, `container_health_check`)
> aisladas, nunca `main()`/`post_checks()` llamándolas; medido: borrar la
> llamada a cualquiera de las dos dejaba 21/21 en verde. Arreglado con dos
> `check_contains` grepando el `main()`/`post_checks()` reales, mutation-
> verificado (borrar cada línea de llamada → 1 rojo cada vez). `gh pr checks
> 710` verde (SHA `76efe83`).
>
> **PR #710 mergeado por el usuario — y el assert de la raíz del JWT
> (ronda 3) cazó algo real en el primer deploy real.** Run `34388997942`
> (commit `2d18739`, el merge de este PR): `Sync QA Environment` success,
> `E2E against QA` **failure**, exactamente en el assert de
> `spec52-pickup-reception-end-to-end.spec.ts:97`:
> `expect(claims.operator_id).toBe(OPERATOR_ID)` — recibido `undefined`.
> Los otros 16 tests de esa suite pasaron; el login en sí funcionó. **Esto
> es el gate funcionando, no el gate fallando**: antes de esta fase esto
> habría salido verde y `approve-production` se habría abierto con GoTrue
> sirviendo JWTs sin `operator_id`/`role`/`permissions`.
>
> **Ronda 6 — diagnóstico con evidencia ejecutada, causa raíz confirmada.**
> El run había reintentado (`run_attempt=2` vía la API de Actions). En el
> intento 1 (job `102592417542`), `QA_PREV_SHA=4157950697...`,
> `QA_SYNCED_SHA=2d18739` (el merge de este PR), `compose=true` — **correcto**
> — pero `restart_functions()` murió en `rm -rf "$merge_dir"/*` con
> `Permission denied` (ficheros de otro uid, arreglado después en #718), y
> `set -euo pipefail` abortó el script **antes** de llegar a `restart_auth()`,
> aunque `sync_checkout()` ya había hecho `git reset --hard 2d18739` sobre
> el checkout. En el intento 2 (el que se ve en el run), `sync_checkout()`
> leyó `QA_PREV_SHA` del `git rev-parse HEAD` del checkout — que el intento
> 1 ya había dejado en `2d18739` — lo diffeó contra el nuevo target
> (`a3caa7b2`, main había avanzado con otro merge mientras tanto), y ese
> diff **no incluía** `docker-compose.yml` porque ambos extremos ya lo
> tenían: `compose=false`, `restart_auth()` nunca se llamó. Confirmado con
> `docker inspect supabase-qa-auth` (SSH, sólo lectura): contenedor vivo
> desde `2026-08-11T17:07:55Z` — un mes antes de este PR, sin ninguna
> `GOTRUE_HOOK_*` en su entorno real, pese a que el `docker-compose.yml` en
> disco (`/home/aureon/aureon-qa`) sí las tenía. Esto descarta las hipótesis
> 2 y 3 del todo — no hay degradación del hook que investigar, ni una URI
> mal armada: el contenedor simplemente nunca se recreó, ni una sola vez.
>
> **Causa raíz real, más profunda que "falta una línea": `QA_PREV_SHA` medía
> la posición del checkout, no si un deploy anterior había terminado.**
> `sync_checkout()` hace `git reset --hard` de forma incondicional al
> principio de cada corrida, **antes** de cualquier restart — así que el
> HEAD del checkout después de una corrida que murió a mitad de camino ya
> apunta al commit nuevo, aunque los restarts de ese commit nunca se
> completaran. La siguiente corrida hereda ese HEAD ya avanzado como "prev",
> y cualquier fichero que ya estuviera en el commit que la corrida muerta
> alcanzó a hacer checkout desaparece silenciosamente del diff. Esto no es
> específico de `auth` — `restart_functions()` tiene la misma exposición —
> pero fue `auth` quien la sufrió esta vez, porque fue la única víctima con
> un assert capaz de notarlo.
>
> **Arreglo:** nuevo `QA_STATE_FILE` (`/home/aureon/.qa-last-deployed-sha`),
> escrito sólo al final de `main()`, **después** de que `post_checks()` no
> haya hecho `exit 1` — es decir, sólo cuando todo lo que esa corrida
> intentó restar/reconstruir terminó y pasó los health checks. Nueva función
> `read_qa_prev_sha()` (extraída de `sync_checkout()` para poder testearla
> sin un `git fetch` real): lee `QA_STATE_FILE` si existe, y sólo cae a
> `git rev-parse HEAD` la primera vez que corre en un host nuevo (el
> archivo no existe todavía). Una corrida que muere a mitad de camino ya
> **no** avanza el marcador, así que la siguiente corrida diffea desde el
> último commit que **de verdad** terminó, no desde donde el checkout
> quedó parado. 3 tests nuevos en `deploy-qa.drift.test.sh`
> (`read_qa_prev_sha()`), mutation-verificados: reducir la función a sólo
> `git rev-parse HEAD` (quitando la lectura del marcador) → 2 de 3 en rojo.
> Sin regresión: las 4 suites de shell existentes (`drift`, `functions`,
> `guard-sudo`, `seed`, `sql-tests`) siguen en verde.
>
> **Catch-up manual de una sola vez, hecho por mí vía SSH (sólo esta
> operación de escritura; todo lo demás de esta ronda fue lectura):**
> `docker compose -f infra/supabase-qa/docker-compose.yml --env-file
> /home/aureon/.env.qa up -d --no-deps auth` — el mismo comando exacto que
> `restart_auth()` ejecuta. Confirmado después: `docker inspect
> supabase-qa-auth` muestra `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`,
> `..._URI=pg-functions://postgres/public/custom_access_token_hook`,
> `StartedAt=2026-09-09T19:04:43Z`, `Health.Status=healthy`. Y la prueba que
> esta fase pedía desde el principio, ahora genuinamente cierta: login real
> contra Kong (`POST /auth/v1/token?grant_type=password`) como
> `qa-admin@qa.test`, JWT decodificado — `operator_id:
> 00000000-0000-4000-8000-000000000001`, `permissions: [pickup, warehouse,
> loading, operations, admin, dispatch]`, `app_metadata.claims.role: admin`.
> El hook corre, y corre bien. También sembré `QA_STATE_FILE` a
> `a3caa7b2ef1978293ab39b858b77c225ae30e475` (el HEAD real del checkout en
> ese momento) para que la corrida que aplique este PR arranque desde un
> estado consistente con la realidad, no desde "archivo ausente" otra vez.
>
> **Este catch-up manual NO sustituye el arreglo en código.** Sin
> `QA_STATE_FILE`, el próximo `restart_functions()` que muera a mitad de
> camino por cualquier otra razón reproduce exactamente este mismo patrón
> para cualquier flag `CHANGED_*`, no sólo `CHANGED_QA_COMPOSE`.
>
> PR: nuevo, rama `feat/spec-88-fase-3-ronda-6-qa-state-marker`, **sin
> auto-merge** — pendiente número y `gh pr checks` verde.
> Review: pendiente — ronda 6 en curso, no revisada todavía por nadie más.
> QA: **la prueba de login en vivo, pedida desde el inicio de esta fase, se
> ejecutó de punta a punta contra la VPS real esta ronda — y salió roja la
> primera vez**, exactamente como predijo la ronda 3 y exactamente lo que
> el assert de esa ronda existe para cazar. Diagnosticada, arreglada en
> código, y el estado en vivo de QA corregido a mano una vez. El PR de
> ronda 6 todavía no se ha mergeado ni desplegado — la próxima corrida real
> de `deploy-qa` es la que prueba que `QA_STATE_FILE` sostiene esto sin
> intervención manual la próxima vez que algo se caiga a mitad de camino.
> Downstream: `**Downstream:** ninguno todavía` en la cabecera del spec —
> sin cambios.

**Archivos:** (actualizado en ronda 4 — el índice se había quedado en el plan
de ronda 1, ver el hallazgo C de la ronda 4 en la evidencia de arriba):

- `packages/database/supabase/migrations/20260922000001_spec88_fase3_custom_access_token_hook_acl.sql`
  — `GRANT EXECUTE ... TO supabase_auth_admin`, `REVOKE ALL ... FROM PUBLIC`,
  `REVOKE ALL ... FROM anon`, **y `REVOKE ALL ... FROM authenticated`**
  (decisión propia de ronda 2, no en el plan original — ver evidencia).
- `packages/database/supabase/tests/spec88_fase3_custom_access_token_hook_acl.test.sql`
  — patrón de `20260913000006` (fase 1).
- `infra/supabase-qa/docker-compose.yml` — `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED`/`..._URI` en el servicio `auth` (ronda 2).
- `infra/supabase-qa/deploy-qa.sh` — flag `CHANGED_QA_COMPOSE` y `restart_auth()` para que ese cambio de compose llegue al contenedor real (ronda 3), `--no-deps` en esa llamada y `container_health_check()`/su uso en `post_checks()` (ronda 4).
- `infra/supabase-qa/deploy-qa.functions.test.sh` — cobertura TDD de lo anterior (ronda 4).
- `apps/frontend/e2e/support/spec52-fixture.ts` — helper `getAccessTokenClaims()` (ronda 2).
- `apps/frontend/e2e/spec52-pickup-reception-end-to-end.spec.ts` — assert sobre la raíz del JWT tras `signIn()` (ronda 2, corregido en ronda 3).

**Corrección sobre el planteamiento original de esta fase:** el spec pedía confirmar el estado del hook con `docker inspect` contra "el contenedor de GoTrue de producción". **Eso es imposible y estaba mal** — producción no es self-hosted como QA, es un proyecto Supabase gestionado (ref `wfwlcpnkkxxzdvhvvsxb`), y no existe ningún contenedor GoTrue de producción que inspeccionar. `~/.ssh/config` (`aureon-vps`) sólo aloja QA. Este error se sostuvo sin comprobarse durante horas; ver la sección de arriba ("Corrección — el `docker inspect`...") para el detalle.

**Resultado confirmado (2026-09-09) — la fase ya no espera nada.** El usuario
lanzó `.github/workflows/check-prod-auth-hook.yml`
(`workflow_dispatch`, run `34240504022`, éxito, 2026-09-08T14:47:08Z). El log
imprime:

```
hook_custom_access_token_enabled=true
```

**Producción SÍ usa el hook.** Es la rama menos probable de las dos que este
spec contemplaba, y la peligrosa — la que exige el `GRANT` antes del `REVOKE`.

**El "argumento de apoyo" de abajo queda refutado por la medición, no borrado
— explica por qué se creyó lo contrario.** ~~Argumento de apoyo (no prueba)
mientras ese resultado no llega: en QA, quien puebla los claims del JWT es el
trigger `sync_claims_on_user_change`
(`packages/database/supabase/migrations/20260312120000_sync_app_metadata_claims.sql`),
no el hook — confirmado `ENABLED` en QA. Esa migración está aplicada en
producción (ledger de producción documentado coincidiendo con el repo en
spec-87, 190 migraciones). Si el mismo trigger puebla los claims en ambos
entornos, el hook es redundante en producción igual que en QA~~ — **falso**:
producción tiene el hook activo además del trigger. El trigger estar aplicado
en ambos entornos no implica que el hook esté inactivo en ambos; la inferencia
estructural se equivocó de lado.

**Lo que esta fase debe hacer, ahora que el booleano es `true`:**

- La migración **debe** incluir `GRANT EXECUTE ON FUNCTION
  public.custom_access_token_hook(jsonb) TO supabase_auth_admin` **antes** del
  `REVOKE ALL ... FROM PUBLIC`. Sin ese `GRANT`, el `REVOKE` **rompe el login
  de todos los usuarios de producción** — GoTrue invoca el hook como
  `supabase_auth_admin`, y ese rol hoy sólo tiene acceso por heredar el grant
  implícito de PUBLIC (`=X`), nunca por un grant propio.
- **El criterio de aceptación no es que el RPC rechace a `anon`.** Es que **un
  login normal siga emitiendo un JWT con `operator_id`, `role` y `permissions`
  correctos** — probado end-to-end **antes** de que la migración llegue a
  producción. Que `custom_access_token_hook(...)` devuelva `permission
  denied` a una sesión `anon` no prueba nada sobre si GoTrue puede seguir
  invocándolo.
  **Corrección (ronda 2 de review, fase 3):** "los seis usuarios `qa-*@qa.test`"
  era sobre-especificación — la migración no toca el cuerpo de la función,
  sólo el ACL, y `EXECUTE` es binario: un solo login real, con el hook
  activo, leyendo los claims del JWT, es prueba completa. Lo que faltaba no
  era más usuarios, era que algo leyera el JWT — `e2e-qa` no lo hacía (ver
  fase 3). Y la lista real en `docs/qa-environment.md` trae ocho cuentas, no
  seis.
- Orden de la migración: `GRANT ... TO supabase_auth_admin` → login QA
  end-to-end verificado → `REVOKE ALL ... FROM PUBLIC` → `REVOKE ALL ... FROM
  anon` (redundante tras el `REVOKE FROM PUBLIC`, pero explícito por
  simetría con el resto del spec) → test pgTAP con `has_function()` +
  `aclexplode()` confirmando `supabase_auth_admin` presente y `anon`/PUBLIC
  ausentes tras el `REVOKE`.

Esta fase queda **desbloqueada para tomarse** — la investigación que la
bloqueaba ya se hizo y el resultado ya se leyó.

### Fase 4 — Check automático de ACL huérfana `[pending]`

**Archivos:** `scripts/check-migration-safety.sh`, `scripts/check-migration-safety-rule1-match.mjs`, `+ test`

Extiende `scripts/check-migration-safety.sh` (spec-87 fase 5, en construcción en paralelo — coordinar antes de duplicar trabajo) con dos chequeos nuevos, ambos basados en lo encontrado aquí:

1. **Overload sin `REVOKE` propio.** Si una migración crea `CREATE [OR REPLACE] FUNCTION public.f(tipos_A)` y existe, en cualquier migración anterior, un `REVOKE ... ON FUNCTION public.f(tipos_B)` con `tipos_A ≠ tipos_B`, advertir que el `REVOKE` histórico no cubre la firma nueva. Éste es exactamente el bug de `start_pickup_route`.
2. **`REVOKE ... FROM anon` sin `REVOKE ... FROM PUBLIC` que lo acompañe**, dentro de la misma o de una migración posterior sobre la misma firma. Éste es el bug de `add_dock_zone_adjacency_pair`/`open_route_reception`/`remove_dock_zone_adjacency_pair`/`reopen_pickup_route`. El check no puede saber si PUBLIC *sigue* expuesto sin consultar el ACL real (algo que un check estático sobre el SQL de las migraciones no puede hacer con certeza — dos migraciones pueden aplicar `REVOKE FROM PUBLIC` y `GRANT ... TO PUBLIC` en cualquier orden) — por eso el check correcto no es "cada `REVOKE FROM anon` debe ir con un `REVOKE FROM PUBLIC` en la misma migración" (demasiado rígido, rompería patrones legítimos donde PUBLIC nunca tuvo el grant para empezar), sino "toda migración `CREATE [OR REPLACE] FUNCTION` nueva que declare guardar el resultado con `GRANT EXECUTE ... TO authenticated` sin ningún `REVOKE` en la misma migración debe fallar" — que es el chequeo que spec-80 fase 1b ya necesitó a mano y que `check-migration-safety.sh` puede aplicar mecánicamente sobre el SQL de cada migración nueva, sin necesitar el ACL en vivo.

### Fase 5 — Defensa en profundidad del resto `[pending]`

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP en `packages/database/supabase/tests/`

Las 17 funciones con guard efectivo pero sin `REVOKE` nunca aplicado (`add_manifest_to_route`, `cancel_pickup_route`, `close_pickup_route`, `complete_route_reception`, `delete_minted_carton`, `disable_module_for_operator`, `enable_module_for_operator`, `expand_carton`, `get_current_user_role`, `get_enabled_modules_for_operator`, `get_manifest_label_data`, `get_module_audit_for_operator`, `get_operator_id`, `get_route_reception_snapshot`, `list_operators_with_module_state`, `mark_manifest_labels_printed`, `remove_manifest_from_route`). Sin riesgo activo — cada una falla limpio ante `anon` hoy — pero dejar el ACL real coherente con la intención de cada función es higiene que cierra la clase de "hoy no hay guard porque alguien lo olvidó" antes de que ocurra, no después. Baja prioridad, sin fecha — se puede tomar en cualquier momento sin coordinar con nada más de este spec.

### Fase 6 — `set_config` deja de ser un bypass genérico de GUC `[pending]`

Abierta tras el review de la fase 2 (PR #683): `public.set_config(text,text,boolean)` (`20260217000002_fix_audit_logging_critical_issues.sql:14-36`) es `SECURITY DEFINER`, sin allowlist de `setting_name`, y conserva `GRANT EXECUTE ... TO authenticated` desde la fase 1 de este spec (`20260913000006:134`) porque revocarlo entonces habría roto sus llamantes legítimos. Reproducido en `spec52-pg` como `authenticated`: `SELECT public.set_config('request.jwt.claims', '{"role":"service_role"}', true)` seguido de cualquier RPC que use `assert_operator_access` como guard pasa el chequeo de la fase 2 — porque `set_config` puede escribir *cualquier* GUC de sesión, incluido el que la fase 2 acaba de aprender a confiar. No es una regresión de la fase 2 (el `RETURN` temprano del cuerpo viejo lograba el mismo resultado) y **no es alcanzable desde PostgREST real** — cada request de PostgREST abre su propia transacción y refija los claims JWT al principio, así que no existe una segunda llamada HTTP dentro de la misma sesión donde el `set_config` de la primera siga vigente. Sigue siendo alcanzable por cualquier cliente que abra una sesión Postgres persistente autenticado como `authenticated` (`psql`, un pooler mal configurado, una función futura que reutilice la misma conexión).

**Qué entrega:** una de las dos, a decidir en la implementación —
- Allowlist de `setting_name`: `IF setting_name NOT LIKE 'app.%' THEN RAISE EXCEPTION ...` (o el prefijo que de verdad usan los llamantes reales de `set_config` — inventariarlos antes de fijar el prefijo), preservando el uso legítimo documentado en `20260217000002` y cerrando la escritura arbitraria de GUCs de autenticación.
- O revocar `EXECUTE` de `authenticated` sobre `public.set_config` directamente, si el inventario de llamantes reales muestra que ninguno lo necesita desde una sesión `authenticated` (los llamantes de auditoría del spec original pueden ser `service_role`).

**Archivos:** `packages/database/supabase/migrations/<nueva>_spec88_fase6_set_config_allowlist.sql`, `packages/database/supabase/tests/spec88_fase6_set_config_allowlist.test.sql`.

---

## Nota sobre el alcance de esta tarea

Esta spec **audita y planifica**. Ninguna fase se implementó — el encargo fue explícito: confirmar y escribir, no arreglar. Las cinco fases de arriba son el plan; la primera que se tome debe abrir su propia rama (`feat/spec-88-fase-1-...`), seguir TDD (`sql` como juez, vía `scripts/pgtap-local.sh`, ⚠️ contenedor compartido entre worktrees — comprobar que nadie más lo está usando antes de correr), y traer su propia evidencia de `> Implementado por:` / `> Review:` / `> QA:` antes de marcarse `[done]`.

## Deuda anotada, no arreglada en esta fase (round 1 de review, PR #675)

Dos hallazgos del review de fase 1 son deuda real, pero **fuera del alcance de un `REVOKE` mecánico** — se dejan escritos aquí para que nadie los reabra por accidente ni los confunda con un incendio activo:

- **El harness de pgTAP local es ciego a `not ok`.** `scripts/pgtap-local.sh` decide pass/fail con `grep -qE "ERROR:|^psql: error:"` sobre la salida de `psql` — un fichero de test que corre limpio pero cuyas aserciones fallan (`not ok`, sin `ERROR:` de Postgres) se reporta como PASS igual. Medido: de 73 ficheros en `packages/database/supabase/tests/`, sólo **6** usan aserciones pgTAP (`plan()`/`is()`/`finish()`) — el resto usa `RAISE EXCEPTION`, que sí produce `ERROR:` y sí lo detecta el harness. Los 6 ficheros pgTAP se corrieron a mano para esta fase y **son genuinamente verdes** (confirmado contando `ok`/`not ok` en la salida cruda de `psql`, no en el resumen del script). No es un incendio — es una laguna de cobertura del harness que merece su propia spec (arreglarla aquí sería tocar infraestructura compartida por otras 5 fases de tests pgTAP fuera del alcance de spec-88).
- **`set_config(text,text,boolean)` con `is_local = true` es código muerto bajo PostgREST, y ya lo era antes de esta fase.** `createSSRClient()` en el frontend llama a `setSupabaseSessionIp` (`apps/frontend/src/lib/utils/ipAddress.ts`), que invoca este RPC vía `set_config(..., true)`. PostgREST abre una transacción nueva por cada petición HTTP — el `SET LOCAL` que produce `is_local = true` muere al terminar esa transacción, antes de que la query que se suponía debía auditar (el `INSERT` en `audit_logs` de esa misma request) llegue a correr. La llamada está envuelta en `try/catch` con `console.warn`, así que no rompe nada — simplemente no hace lo que su nombre sugiere. Esta fase **no** lo introduce ni lo arregla: cerrar `set_config` a `authenticated` (lo que sí hace esta migración) no cambia este comportamiento. Se anota explícitamente para que nadie, al ver el guard cerrado, decida "arreglar" esto reabriendo el grant a `anon` — el bug es la transacción de PostgREST, no el ACL.
