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

### Fase 3 — `custom_access_token_hook` `[done]`

> Implementado por: implementer — rama `feat/spec-88-fase-3-auth-hook`, SHA `76efe83` (PR #710, mergeado como `2d18739`), más la ronda 6 en `feat/spec-88-fase-3-ronda-6-qa-state-marker`, SHA `1ab41eb` (PR #721).
> Review: reviewer — **seis rondas**, todos los hallazgos cerrados. Los dos que cambiaron el resultado: el assert original leía `app_metadata.claims`, que el trigger `sync_claims_to_auth_metadata` rellena **idéntico** con el hook apagado (medido: JWT con y sin hook, byte a byte iguales ahí), y `deploy-qa.sh` sólo recreaba el contenedor `functions`, así que las variables `GOTRUE_HOOK_*` nunca llegaban a `auth`.
> QA: PR #710 merged 2026-09-09T18:16Z. **`e2e-qa` verde en el run `34395854405`** (`41ea770`), con el assert de claims en la raíz del JWT ejecutándose contra QA real.
> Downstream: revisado spec-93 — su fase 2 (registrar el hook en QA + assert de JWT en e2e) **queda cerrada por esta fase**; el orquestador que tome spec-93 arranca por la fase 1. Revisado spec-92 — la divergencia de auth deja de ser un hueco de su tabla.

**Cómo se cerró, porque la historia importa más que el diff.** El primer deploy
tras mergear **falló**, y falló en el sitio correcto: el assert nuevo recibió
`claims.operator_id === undefined`. Los otros 16 tests pasaron y **el login
funcionaba** — o sea, GoTrue emitía un token sin los claims del hook y la
aplicación no se enteraba. **Ese es el gate funcionando en su primera
ejecución**: con el assert anterior habría salido verde y `approve-production`
se habría abierto.

La causa raíz no era el hook: **`QA_PREV_SHA` medía la posición de git del
checkout, no si un deploy anterior había terminado.** Como `sync_checkout()`
hace `git reset --hard` al principio, la corrida que murió a mitad (por un
problema ajeno de permisos en el directorio de edge-functions) dejó el HEAD ya
en el commit nuevo; la siguiente lo heredó como «previo», el compose ya no
aparecía en el diff, y **`restart_auth` nunca se llamó**. La prueba
definitiva: `docker inspect` mostraba el contenedor `auth` **vivo desde el 11
de agosto**, un mes antes de este PR, sin las variables del hook. No se
degradó — **nunca se recreó**. Eso lo arregla la ronda 6 (PR #721) con un
marcador escrito **sólo tras un `post_checks()` exitoso**, y generaliza: ese
fallo envenenaba **todas** las banderas `CHANGED_*`, no sólo la del compose.

**Hueco declarado, no cerrado:** el arreglo del marcador está probado en
unitarios y razonado contra el incidente real, pero **nadie lo ha visto
aguantar una muerte a mitad de verdad** — eso sólo se demuestra la próxima vez
que ocurra.


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
>
> **Corregido en ronda 7 (#732) — esta frase ya no es cierta.** El fallback a
> `git rev-parse HEAD` **se eliminó**. Al hacer no fatal la escritura del
> marcador aparecieron dos formas de no tener marcador, no una: host nuevo
> **y corrida degradada**. Con el fallback puesto, la segunda reabría por la
> puerta de atrás el mismo bug que esta ronda elimina — corrida N degradada
> (sin marcador), corrida N+1 muere tras el `git reset --hard`, corrida N+2
> lee `prev = HEAD = sha_{N+1}` y los ficheros de la corrida muerta
> desaparecen del diff. Ahora **marcador ausente = sin baseline = reconstruir
> todo**; sólo un marcador *presente pero rancio* (el caso del incidente
> real: dueño equivocado pero legible) se sigue usando como baseline. El
> coste es una corrida lenta en un host nuevo, que es justo el caso donde
> reconstruir todo ya era lo correcto.
> Sin regresión: las 4 suites de shell existentes (`drift`, `functions`,
> `guard-sudo`, `seed`, `sql-tests`) siguen en verde.
>
> **Catch-up manual de una sola vez, hecho por mí vía SSH (sólo esta
> operación de escritura; todo lo demás de esta ronda fue lectura):**
> ```
> docker compose -f infra/supabase-qa/docker-compose.yml \
>   --env-file /home/aureon/.env.qa up -d --no-deps auth
> ```
> — el mismo comando exacto que `restart_auth()` ejecuta. Confirmado
> después: `docker inspect supabase-qa-auth` muestra
> `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`,
> `..._URI=pg-functions://postgres/public/custom_access_token_hook`,
> `StartedAt=2026-09-09T19:04:43Z`, `Health.Status=healthy`.
>
> **Y la prueba que esta fase pedía desde la ronda 1, hasta hoy sólo
> afirmada, ahora genuinamente ejecutada:**
> ```
> ANON_KEY="$(grep -E '^ANON_KEY=' /home/aureon/.env.qa | cut -d= -f2- | tr -d '\r')"
> curl -s -X POST "http://localhost:8100/auth/v1/token?grant_type=password" \
>   -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
>   -d '{"email":"qa-admin@qa.test","password":"QaTest123!"}'
> # → access_token, JWT decodificado:
> ```
> Root del JWT: `operator_id: 00000000-0000-4000-8000-000000000001`,
> `role: authenticated`, `permissions: [pickup, warehouse, loading,
> operations, admin, dispatch]`. `app_metadata.claims`: `{operator_id:
> 00000000-0000-4000-8000-000000000001, permissions: [pickup, warehouse,
> loading, operations, admin, dispatch], role: admin}`. El hook corre, y
> corre bien — `operator_id`/`role`/`permissions` correctos, exactamente lo
> que un login normal debía emitir desde el principio de esta fase.
>
> También sembré `QA_STATE_FILE` a `a3caa7b2ef1978293ab39b858b77c225ae30e475`
> (el HEAD real del checkout en ese momento) para que la corrida que aplique
> este PR arranque desde un estado consistente con la realidad, no desde
> "archivo ausente" otra vez.
>
> **⚠️ Esto no fue un arreglo: fue la causa del corte de cinco deploys.** El
> `printf` se ejecutó por SSH como **root**, así que el fichero quedó
> `root:root 0644` dentro de `/home/aureon`. El runner corre como `aureon`,
> de modo que la escritura del marcador al final de `main()` daba EACCES y,
> bajo `set -Eeuo pipefail`, abortaba el deploy. Cinco `Deploy Production`
> seguidos (`34397163949` → `34422244965`) murieron en esa última línea con
> todo lo real en verde, y como spec-57 hace del sync de QA la precondición
> de producción, bloquearon los deploys a producción del día. Misma clase
> que #718. Diagnosticado y arreglado en ronda 7 (#732).
>
> **Este catch-up manual NO sustituye el arreglo en código**, y el arreglo
> en código **tampoco está verificado de punta a punta todavía** — hueco
> honesto, no una casilla marcada de más: `QA_STATE_FILE` está unit-testeado
> (3 tests, mutation-verificados) y razonado contra el incidente real que lo
> motivó, pero **nadie lo ha visto sostener un deploy que muere a mitad de
> camino**, porque desde que se escribió no ha ocurrido otro. Se verificará
> genuinamente la próxima vez que algo se caiga a mitad de `main()` — que
> ojalá no sea pronto — y hasta entonces sigue siendo una corrección
> razonada, no una observada dos veces.
>
> **Rebase sobre `origin/main` (pedido en ronda 6, tras mergear #718 —
> mismo fichero: `clear_merge_dir()`, el trap `on_err()`, el health-check
> de `edge-functions`):** limpio, sin conflictos — `git rebase origin/main`
> resolvió solo. Verificado explícitamente que ninguna de las dos
> intervenciones se pisa: `read_qa_prev_sha()` y `on_err()` tocan puntos
> distintos de `main()` (lectura de `QA_PREV_SHA` al principio de
> `sync_checkout()` vs. el trap `ERR` instalado justo antes de
> `guard_provisioned`), y las 4 suites de shell (`drift` con mis 3 tests
> nuevos, `functions` con sus 8 tests nuevos + los míos, `guard-sudo`,
> `seed`, `sql-tests`) corren juntas en verde: 10+36+6+10+15.
>
> PR: #721, **sin auto-merge**.
> Review: pendiente — ronda 6 en curso, no revisada todavía por nadie más.
> QA: **la prueba de login en vivo, pedida desde el inicio de esta fase, se
> ejecutó de punta a punta contra la VPS real esta ronda — y salió roja la
> primera vez**, exactamente como predijo la ronda 3 y exactamente lo que
> el assert de esa ronda existe para cazar. Diagnosticada, arreglada en
> código, y el estado en vivo de QA corregido a mano una vez — comando y
> resultado del login arriba, ya no una promesa. El PR de ronda 6 todavía
> no se ha mergeado ni desplegado — la próxima corrida real de `deploy-qa`
> es la que prueba que `QA_STATE_FILE` sostiene esto sin intervención
> manual la próxima vez que algo se caiga a mitad de camino.
> Downstream: `**Downstream:** ninguno todavía` en la cabecera del spec —
> sin cambios. Nota para spec-93 (paridad QA↔prod, fase 1): el contenedor
> `auth` llevando un mes sin recrearse mientras el compose declaraba otra
> cosa es exactamente la clase de divergencia QA↔prod que ese spec
> inventaría — no se actúa aquí, sólo se deja dicho para que encaje ahí.

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

#### Ronda 7 (#732) — la escritura del marcador pasa a ser no fatal, y a degradar hacia el lado seguro

**Decisión, y vive aquí y no sólo en el cuerpo del PR:** `QA_STATE_FILE` es una
**optimización** del diff de `widen_changed_flags()`, no una garantía de
corrección. No poder guardarlo **no puede tumbar** un deploy cuyos pasos
reales pasaron todos. Lo tumbó: cinco `Deploy Production` seguidos
(`34397163949` → `34422244965`) murieron en la última sentencia de `main()`
con migraciones, seed, usuarios, reinicios, `post_checks` y tests SQL en
verde, porque el fichero sembrado a mano por SSH en ronda 6 quedó
`root:root` y el runner corre como `aureon`.

Tres piezas, y la segunda es la que casi se me escapa:

1. **No fatal.** `record_deploy_marker()` avisa (anotación `::warning::` por
   stderr, dueño y modo del fichero, el `chown` exacto) y devuelve 0.
2. **Degradar hacia el lado seguro.** El primer intento heredaba el `HEAD` del
   checkout cuando faltaba el marcador — o sea, reabría por la puerta de
   atrás el bug de baseline rancia que ronda 6 elimina. Corregido: **marcador
   ausente = sin baseline = reconstruir todo**. La distinción que importa es
   **rancio vs ausente**: un marcador presente pero de dueño equivocado sigue
   siendo legible y sigue siendo una baseline válida, más vieja.
3. **La escritura se auto-repara.** Temporal + `rename()`, que sólo necesita
   permiso en el **directorio**: el caso exacto del incidente se arregla solo
   y el marcador pasa a ser del runner. Verificado con un fichero root real —
   código viejo `exit 1`, código nuevo `exit 0` y marcador actualizado.

Un aviso amarillo sobre una corrida verde no tiene dueño ni caducidad, así que
las corridas degradadas **consecutivas** se cuentan
(`QA_DEGRADED_FILE`, por defecto `<marcador>.degraded`) y a las
`QA_DEGRADED_MAX` (3) el deploy se pone **rojo**. Una corrida degradada es
ruido; una racha es un host que producirá el próximo #718. Hueco honesto: si
el directorio tampoco es escribible no hay dónde llevar la cuenta, así que
eso no escala solo — lo dice en el log en vez de fingir que el contador vigila.

Tests en `infra/supabase-qa/deploy-qa.marker.test.sh` (cableado en `ci.yml`,
que es donde las suites de `infra/` llevaban sin correr) más los de
`read_qa_prev_sha()` en `deploy-qa.drift.test.sh`. Los casos que dependen de
permisos hacen *probe* por separado de fichero y de directorio y se **saltan
declarándolo** donde `chmod` no se aplica (Git Bash, root) en vez de pasar en
falso; en el runner de CI, que es Linux no-root, corren los tres bloques.
Verificado en Linux como el usuario `aureon` real: **39 + 11 verdes, cero
skips**, y **14 mutantes, cero supervivientes**.

Dos de esos mutantes cambiaron el diseño en vez de sólo confirmarlo: `mv -f`
sobre un path que es **directorio** mete el fichero dentro y sale 0 (de ahí la
guarda `-d`), y `record_deploy_marker` llamado dentro de `$(...) || rc=$?`
**desactiva `errexit` y el trap ERR**, así que la red del test no mordía en
los cuatro casos de fallo — se llaman en pelado.

##### Los cuatro verdes falsos de esta ronda, y por qué se escriben aquí

Ninguno lo encontró un review: los cuatro los produjo **medir**, y los cuatro
eran verdes que no probaban nada. Van al spec porque el patrón se repite, no
el bug.

1. **Baseline en rojo, mutantes «todos muertos».** La primera pasada de
   mutación usaba `rc != 0` como criterio de muerte, con la suite ya en rojo en
   Linux por dos bugs **del test**. Los 14 salieron «muertos» sin que ninguno
   probara nada. Ahora hay puerta explícita: si la baseline no está verde, la
   corrida de mutación se aborta.
2. **Dos asserts que medían el entorno, no el código.** `chmod` no se aplica
   igual en todas partes — Git Bash lo respeta en **ficheros** y lo ignora en
   **directorios**, y root lo salta entero — y un assert que exigía `stdout`
   vacío chocaba con `log()`, que escribe en stdout con todo derecho. De ahí
   los *probes* separados por fichero y por directorio, y que un caso que no
   puede morder se **salte declarándolo** en vez de pasar.
3. **El arnés de mutación con la estructura de directorios plana.** Los
   ficheros copiados a un solo directorio hacían que
   `$HERE/../../.github/workflows/deploy.yml` no resolviera, así que el bloque
   que asserta contra el workflow **se saltaba** y la suite salía **0** con
   seis asserts desaparecidos. Tres mutantes salieron «muertos» sin que nada
   los tocara. Doble arreglo: el árbol de mutación replica el del repo, y un
   `deploy.yml` ausente es ahora **fallo duro**, no skip — los skips de
   `chmod` son entornos legítimos, un checkout sin su workflow no lo es.

4. **`QA_EXIT_MARKER_STREAK` sin definir en el test.** `extract()` sólo saca
   funciones, así que la variable no existía; `exit "$QA_EXIT_MARKER_STREAK"`
   tropezaba con `set -u` y salía **1**, y el assert que decía «esperado 1»
   pasaba **sin verificar nada** del código de salida que existe para fijar. El
   test lee ahora el valor del propio script y se cae si sale vacío.

> **Un verde no es evidencia; tampoco un rojo.** Los tres casos de arriba
> pasaban en verde sin mirar nada, y el rojo de la ronda 2 en `Sync QA
> Environment` era un deploy correcto. En este repo la pregunta no es de qué
> color salió, sino **contra qué entrada real se comprobó y qué mutación lo
> pone del otro color**.

##### Seguimiento (ronda 8) — la red muda y el diagnóstico falso

Dos cosas que el propio arreglo introdujo, y que son la misma clase que el
incidente que lo motivó:

- **La red del arnés mataba en silencio, y el `exec 3>&2` es el arreglo.**
  Bajo `set -e` una función puede fallar de dos formas, y sólo una mantiene
  viva la redirección del llamante cuando corre el trap ERR:

  | | sin `fd 3` | con `fd 3` |
  |---|---|---|
  | **A** — la función hace `return 1` | se ve el mensaje | se ve el mensaje |
  | **B** — falla un comando **dentro** | **nada** | se ve el mensaje |

  En la forma B el mensaje se va a `$TMP/invoke.out` y el trap EXIT lo borra:
  rojo y mudo, que es exactamente lo que `on_err()` existe para abolir.
  Medido en bash 5.2.15, 5.2.21 (el VPS y el runner) y 5.2.37.

  **Y yo declaré esa línea decorativa y la quité, midiéndola con la forma A**
  — la única que no puede reproducir el fallo. Sobre el artefacto de #732 ya
  mergeado, el mutante del `rm` desnudo da `>> rc=1` y nada más. El guard
  vuelve, el self-check falla ahora **en forma B**, y se genera a partir del
  propio fichero: antes ejecutaba una **réplica** dentro de un heredoc, así
  que mutar el `harness_abort` de verdad era invisible para él.

Nit de la misma ronda: el barrido de temporales vive ahora **dentro de
`write_atomic()`**, así que cubre también el temporal del contador
(`<marcador>.degraded.tmp.<pid>`), que el glob anclado al nombre del marcador
no casaba — un byte huérfano para siempre tras un SIGKILL.

Deuda anotada, no pagada: `deploy-qa.sh` está en **900 líneas** y la regla del
repo son 300. Ya estaba en 813 antes de este incidente; las rondas han sumado
87, casi todo comentario que explica por qué existe cada guarda — que es justo
lo que evitó reintroducir el bug de #718 dos veces. `deploy-qa.marker.test.sh`
creció en paralelo y está en **582 líneas**; es un fichero de test, no de
producción, así que no cuenta contra la regla de 300 — se anota aquí por la
misma razón que la deuda de arriba: que quede medido, no asumido.

**La razón que escribí para no partirlo era falsa y la corrijo**, porque un
motivo equivocado en el spec se convierte en el precedente que bloquea la
partición para siempre. Dije que un fichero hermano sería «la clase de fallo
que este spec lleva tres rondas cazando». **No lo es.** El job clona el repo
en `$HOME/qa-deploy-src` al commit probado y ejecuta desde ahí, así que un
hermano llega por el mismo `git reset --hard`, con el mismo dueño, en cada
corrida. El marcador y el directorio de #718 se crearon **a mano y fuera de
control de versiones** — nada que ver. Y `deploy-qa.sh` **ya depende de tres
hermanos** en ese árbol: `apply-migrations.sh` (`:268`), `create-qa-users.sh`
(`:320`) y el `docker-compose.yml` de al lado (`:415`, `:442`). El riesgo ya
está tomado tres veces y nunca ha sido el modo de fallo.

El motivo real para aplazarlo es más simple: son 85 líneas de forensia de tres
incidentes, añadidas en caliente, y no hay ninguna razón para reestructurar el
script de deploy durante el seguimiento de un corte. Merece su propia tarea —
y ahora se puede hacer con red, que antes no había.

##### Seguimiento (PR #739, ronda 4) — el mensaje mentía sobre STALE vs ABSENT

`record_deploy_marker()` ya distinguía correctamente STALE de ABSENT en
`read_qa_prev_sha()` (comentario de diseño desde ronda 6), pero el mensaje que
lee el operador cuando la escritura falla **no** — decía «the next run has NO
baseline, so it rebuilds every app» sin condición, en tres sitios: el
`::warning::` del propio script, el mensaje de escalada a rojo, y el paso
`Report failure` de `deploy.yml`. Es falso en el caso real que más importa:
`write_atomic()` sólo puede fallar **antes** del `rename(2)`, así que un
marker escrito por un run anterior sobrevive intacto a un run cuya escritura
falla, y el siguiente run lo lee y difunde desde ahí — un diff seguro, nunca
un rebuild completo. Reescrito a «falls back to the last recorded marker, or
to a full rebuild if there is none — never to the checkout's HEAD» en los
tres sitios, con un test que fuerza el escenario exacto (bloqueando el path
temporal de `write_atomic` con un directorio, sin depender de `chmod`, que
Git Bash no aplica igual en directorios) y verifica tanto el contenido del
marker como el texto del mensaje — en el propio script y en `deploy.yml`.

Dos verdes falsos más de la misma ronda, ambos en el arnés de test, no en el
código bajo prueba:

- El `grep '^exec 3>&2$' "$0"` que reconstruye el hijo del self-check corría
  bajo `errexit` sin `|| true`: al borrar esa línea, `grep` salía 1 y la
  suite moría **antes** de imprimir ningún `FAIL` — mudo, la misma forma que
  `on_err()` existe para abolir, reproducida dentro del propio arnés que la
  detecta en el código bajo prueba.
- La línea que generaba el `trap` del hijo (`echo "trap '\'harness_abort
  \$?\' ERR"`) no escapaba nada dentro de comillas dobles: emitía un texto
  que bash tokeniza como un signal spec inválido junto a uno válido que SÍ se
  instalaba, pero atado a `harness_abort` sin ningún argumento. El hijo
  reportaba `(exit )` en vez del código real, y un mutante que quitaba `$?`
  del trap **de verdad** sobrevivía porque el hijo ya estaba roto igual.

Y un tercero en el propio arnés nuevo: `set -eE` propaga el trap ERR a las
sustituciones de comando, no sólo a la llamada directa de
`record_deploy_marker()`. Un `$(cat "$TMP/persist/marker")` que falla porque
un mutante borró ese fichero disparaba `harness_abort` **dentro del subshell**
de la sustitución, imprimiendo «record_deploy_marker aborted the deploy» —
que nunca abortó nada — **sin incrementar `$fail`**, porque ese contador vive
en el shell padre, no tocado por el subshell. Rojo con razón falsa, aplicado
a quien mutation-testee esta misma suite. `harness_abort()` ahora comprueba
`[ "$BASHPID" = "$$" ]` antes de reportar: sólo el shell de nivel superior,
el que `invoke()` usa de verdad, puede imprimir y salir.

Cada uno de estos cuatro arreglos se mutation-testeó de uno en uno.

### Fase 4 — Check automático de ACL huérfana `[in_progress]`

**Archivos:** (actualizado tras la implementación — el plan original citaba
`check-migration-safety-rule1-match.mjs`, que resultó no ser donde encajó
la lógica nueva)
- `scripts/check-migration-safety-acl.mjs` (nuevo) — reglas 4/5 y `buildRevokeIndex`
- `scripts/check-migration-safety-acl.test.sh` (nuevo) — TDD, 12 assertions
- `scripts/check-migration-safety.mjs` — wiring de las reglas 4/5 en `checkFile()`/`main()`
- `scripts/check-migration-safety-rule23.mjs` (nuevo) — reglas 2/3 extraídas para mantener `check-migration-safety.mjs` bajo 300 líneas
- `scripts/check-migration-safety-real.test.sh` — actualizado: 3 archivos históricos reales ahora esperan rechazo por la regla 5
- `.github/workflows/ci.yml` — nuevo paso, mismo job duro (no advisory)

Extiende `scripts/check-migration-safety.sh` (spec-87 fase 5, en construcción en paralelo — coordinar antes de duplicar trabajo) con dos chequeos nuevos, ambos basados en lo encontrado aquí:

1. **Overload sin `REVOKE` propio.** Si una migración crea `CREATE [OR REPLACE] FUNCTION public.f(tipos_A)` y existe, en cualquier migración anterior, un `REVOKE ... ON FUNCTION public.f(tipos_B)` con `tipos_A ≠ tipos_B`, advertir que el `REVOKE` histórico no cubre la firma nueva. Éste es exactamente el bug de `start_pickup_route`.
2. **`REVOKE ... FROM anon` sin `REVOKE ... FROM PUBLIC` que lo acompañe**, dentro de la misma o de una migración posterior sobre la misma firma. Éste es el bug de `add_dock_zone_adjacency_pair`/`open_route_reception`/`remove_dock_zone_adjacency_pair`/`reopen_pickup_route`. El check no puede saber si PUBLIC *sigue* expuesto sin consultar el ACL real (algo que un check estático sobre el SQL de las migraciones no puede hacer con certeza — dos migraciones pueden aplicar `REVOKE FROM PUBLIC` y `GRANT ... TO PUBLIC` en cualquier orden) — por eso el check correcto no es "cada `REVOKE FROM anon` debe ir con un `REVOKE FROM PUBLIC` en la misma migración" (demasiado rígido, rompería patrones legítimos donde PUBLIC nunca tuvo el grant para empezar), sino "toda migración `CREATE [OR REPLACE] FUNCTION` nueva que declare guardar el resultado con `GRANT EXECUTE ... TO authenticated` sin ningún `REVOKE` en la misma migración debe fallar" — que es el chequeo que spec-80 fase 1b ya necesitó a mano y que `check-migration-safety.sh` puede aplicar mecánicamente sobre el SQL de cada migración nueva, sin necesitar el ACL en vivo.

> Implementado por: implementer — rama `feat/spec-88-fase-4-check-acl-huerfana`.
> TDD (skill `superpowers:test-driven-development`): test primero
> (`scripts/check-migration-safety-acl.test.sh`, 12 assertions), confirmado
> en rojo por la razón correcta (las reglas 4/5 no existían — los casos
> positivos fallaban, los negativos pasaban vacuamente porque no había nada
> que las hiciera disparar), luego implementación mínima.
>
> **Regla 4 (WARN, no reject)** — `findOrphanedOverloadWarnings` en
> `scripts/check-migration-safety-acl.mjs`: para cada `CREATE [OR REPLACE]
> FUNCTION` en el archivo que se está chequeando, compara su firma
> normalizada (sólo tipos, nombres de parámetro descartados) contra un
> índice `nombre -> Set(firmas)` construido de TODO el corpus de
> migraciones (no sólo el archivo tocado — el `REVOKE` histórico casi
> siempre vive en una migración anterior). Si existe algún `REVOKE` para ese
> nombre pero ninguno coincide exactamente con la firma nueva, avisa. Un
> literal implementado tal como lo pide el texto de la fase — no intenta
> inferir si la firma nueva "ya tiene su propio REVOKE en otro lado";
> devuelve `::warning::`, nunca rompe el build.
>
> **Regla 5 (REJECT)** — `findGrantWithoutRevokeViolations`: para cada
> `CREATE [OR REPLACE] FUNCTION` en el archivo que también tiene un `GRANT
> EXECUTE ... TO authenticated` para esa misma firma, si el archivo no
> contiene NINGÚN `REVOKE ALL ON FUNCTION` (para ninguna función), rechaza.
> Decisión explícita del texto de la fase misma ("sin ningún REVOKE en la
> misma migración" — literal, no "sin un REVOKE que apunte a esta misma
> función"), verificada contra el bug real que motivó la fase:
> `20260913000002` (`close_manifest`, fase 1 de spec-80, antes de que
> `20260913000004`/fase 1b lo arreglara) — `CREATE OR REPLACE FUNCTION` +
> `GRANT EXECUTE ... TO authenticated` sin un solo `REVOKE` en todo el
> archivo. Un `GRANT` a `service_role` solo, o un `CREATE FUNCTION` sin
> ningún `GRANT`, no dispara — ambos son patrones legítimos y frecuentes en
> el repo.
>
> **Corrida contra el corpus real de migraciones (sin `--base`, sanity
> check manual, no parte de CI): la regla 5 encontró tres instancias
> genuinas y previamente desconocidas del mismo bug**, verificadas a mano
> leyendo cada archivo — `recompute_dispatch_stage`
> (`20260907000001_spec76_en_bodega_not_dock_ready.sql`),
> `get_pre_route_snapshot` (`20260908000001_spec77_force_split.sql`), y
> `close_manifest` en su forma original
> (`20260913000002_spec80_close_manifest.sql`, el mismo archivo que motivó
> esta fase — la fila de `close_manifest` en la tabla de fase 0 sólo cita el
> ACL final, después de `20260913000004`; este archivo, por sí solo, sigue
> teniendo el bug). Además una docena de casos históricos más, todos los
> `SECURITY DEFINER` de la tabla de fase 0 marcados "nunca revocada" (fase
> 5 de este mismo spec). Ninguno de estos rompe CI hoy: `ci.yml` invoca
> `check-migration-safety.sh` siempre con `--base`, que sólo mira archivos
> AÑADIDOS/MODIFICADOS por el PR — exactamente el mismo diseño que ya
> protegía la regla 1 (spec-87 fase 5) contra los 90+ archivos históricos
> que preceden ese guard. `scripts/check-migration-safety-real.test.sh`
> (existente, spec-87 fase 5) corre estos 12 archivos reales SIN `--base`
> como set de validación — actualizado para esperar el rechazo de estos
> tres por nombre, con la razón documentada in situ, en vez de esconder que
> la regla 5 los encuentra.
>
> **Wiring/CI**: `.github/workflows/ci.yml` corre
> `check-migration-safety-acl.test.sh` como paso duro del job único
> `Lint, Type-Check, Test, Build` (sin `continue-on-error`) — no es
> advisory. El propio `check-migration-safety.sh --base "$BASE"` (ya
> cableado desde spec-87 fase 5, sin cambios de wiring necesarios) ahora
> ejecuta las reglas 4/5 sobre cualquier migración nueva de cualquier PR
> futuro.
>
> **Límite de 300 líneas**: `check-migration-safety.mjs` superó las 300
> líneas al añadir el glue de las reglas 4/5; se dividieron las reglas 2/3
> a `scripts/check-migration-safety-rule23.mjs` (mismo patrón que
> `rule1.mjs`) y `buildRevokeIndex` se movió a `check-migration-safety-acl.mjs`
> junto al resto de la lógica ACL. Los tres archivos quedan bajo 300 líneas
> (209/132/259).
>
> **Mutation-testing — probados 6 mutantes, uno a uno, cada uno restaurado
> antes del siguiente** (no en bloque):
> 1. Quitar el `if (hasAnyRevoke) return [];` de la regla 5 → mató
>    exactamente los 2 tests del patrón correcto (REVOKE/GRANT/REVOKE deja
>    de aceptarse).
> 2. Quitar el `if (revokedSignatures.has(fn.signature)) continue;` de la
>    regla 4 → mató exactamente 1 test (el de firma exacta ya cubierta deja
>    de silenciarse).
> 3. Quitar el filtro `role === 'authenticated'` de la regla 5 (cualquier
>    `GRANT` cuenta) → mató exactamente 1 test (`GRANT ... TO service_role`
>    empieza a rechazar cuando no debe).
> 4. Borrar la línea que engancha `findOrphanedOverloadWarnings` en
>    `checkFile()` → mató exactamente los 2 tests positivos de la regla 4
>    (deja de avisar del todo).
> 5. Vaciar el `for (const violation of result.aclRejections)` de `main()`
>    (equivalente a `for (const violation of [])`) → mató exactamente los 3
>    tests positivos de la regla 5 (deja de rechazar del todo — esto es el
>    mutante que "ciega" el check pidiendo específicamente el spec: el guard
>    deja de ver su propia señal de entrada y su self-test lo cazó).
> Los 6 mutantes probados individualmente contra
> `check-migration-safety-acl.test.sh`; cada uno restaurado a verde (12/12)
> antes de aplicar el siguiente. No se afirma "todos mueren" sobre mutantes
> no probados — éstos son los 6 que se probaron, contra la superficie nueva
> de esta fase (reglas 4/5 y su wiring); no se mutó rule1/rule23/git.mjs
> (fuera del alcance de esta fase, ya mutation-testeados en su propia
> historia de review).
>
> **Regresión**: las 7 suites existentes de `check-migration-safety*`
> siguen en verde (13, 11, 10, 12, 10, 8, 6 — 70 asserts), más las 12 nuevas
> de esta fase. `node --check` limpio en los tres archivos `.mjs` tocados o
> creados.
>
> **No corrido**: `scripts/verify.sh` (turbo lint/type-check/test:run) —
> este worktree no tiene `node_modules` (regla del repo: nunca `npm
> install`/`npm ci` en un worktree, ver `project_worktree_node_modules_junction`),
> y el diff de esta fase no toca ningún workspace de la monorepo (sólo
> `scripts/*.mjs`, `*.test.sh`, `.github/workflows/ci.yml` y este spec) — no
> hay TS/JS de aplicación que lint/type-check/test:run pudiera ejercitar de
> forma distinta a lo que las 8 suites de bash ya prueban directamente con
> `node`/`bash`, sin dependencias npm. Decisión, no descuido.
>
> **Ronda 2 (review adversarial, ejecutado contra el objeto vivo, PR #723):**
> declarada **mergeable con correcciones** — confirmó que el check tiene
> dientes reales en el camino de CI (repo de cero + migración maliciosa +
> `--base` → `::error::`/`EXIT=1` en el job duro), que la partición en tres
> ficheros es limpia, que `extractParenGroup`/`splitTopLevelCommas` manejan
> tipos anidados y firmas multilínea, y que el mutante nº5 de ronda 1 (y una
> variante suya) sí muere. Tres bloqueantes, todos en la regla 5 — la
> premisa de diseño de ronda 1 era falsa, probado contra la base real,
> envenenando el ACL a propósito y en `ROLLBACK`:
> - **B1**: `DROP FUNCTION; CREATE FUNCTION;` (sin `GRANT`, sin `REVOKE`) en
>   un objeto cuyo ACL fase 1b había endurecido a mano vuelve a traer
>   `anon=X` — Postgres re-concede `EXECUTE` a PUBLIC en toda función
>   (re)creada, con o sin `GRANT` explícito. La regla 5 original disparaba
>   sólo con `GRANT ... TO authenticated` presente — un `CREATE` sin ningún
>   `GRANT` pasaba limpio, y el propio test de ronda 1
>   (`rule5-no-grant-no-reject`) consagraba esa premisa falsa como "patrón
>   seguro".
> - **B2**: `hasAnyRevoke` era global al fichero, no por función — un
>   `REVOKE` sobre CUALQUIER otra función apagaba la regla para las cinco
>   que `20260616000004` crea en un solo fichero (caso normal, no
>   hipotético).
> - **B3**: `GRANT_RE`/`FROM\s+(\w+)` capturaban sólo el PRIMER rol de una
>   lista — `TO anon, authenticated` se detectaba, `TO authenticated, anon`
>   no, con SQL semánticamente idéntico.
>
> **Rediseño completo de la regla 5** (no un parche): en vez de disparar por
> "hay `GRANT ... TO authenticated` y cero `REVOKE` en el fichero", ahora
> dispara por función: toda `CREATE [OR REPLACE] FUNCTION ... SECURITY
> DEFINER` sin un `REVOKE {ALL|EXECUTE} ... FROM PUBLIC` para su firma EXACTA
> en el mismo fichero rechaza — el `GRANT` es irrelevante (B1), el chequeo es
> por función (B2), y el rol se busca en la lista completa, no sólo el
> primero (B3). Requirió una pieza nueva: `isSecurityDefinerClause()` en
> `check-migration-safety-acl-parse.mjs`, que busca `SECURITY DEFINER` en la
> ventana entre el cierre de paréntesis de parámetros y el inicio del cuerpo
> (delimitado por el primer `$tag$`) — nunca dentro del cuerpo mismo, para
> que un cuerpo que mencione esas palabras no produzca un falso positivo.
> `SECURITY INVOKER` (o la ausencia de la cláusula, default de Postgres)
> queda fuera de alcance: corre con los privilegios del LLAMANTE, así que
> `anon` pudiendo invocarla no es escalamiento de privilegio.
>
> **La cifra de "instancias históricas genuinas" de ronda 1 era incorrecta,
> y el propio rediseño lo expuso.** Ronda 1 afirmó 3
> (`recompute_dispatch_stage`, `get_pre_route_snapshot`, `close_manifest`).
> Verificado leyendo cada migración directamente: **dos de las tres son
> `SECURITY INVOKER`, no DEFINER** — `recompute_dispatch_stage`
> (`20260907000001:80`, `LANGUAGE plpgsql SECURITY INVOKER`) y
> `get_pre_route_snapshot` (`20260908000001:121`, `LANGUAGE sql STABLE
> SECURITY INVOKER`). Ninguna de las dos es explotable por este patrón — el
> filtro `SECURITY DEFINER` que el rediseño añadió (por B1, no por esto) las
> excluye correctamente. Sólo `close_manifest` (`20260913000002`, `SECURITY
> DEFINER` confirmado) era genuina; sigue siéndolo bajo el diseño nuevo.
> `scripts/check-migration-safety-real.test.sh` corregido: de los 12
> archivos de la ventana de validación, sólo `close_manifest` se espera
> rechazado por la regla 5 ahora (antes decía tres).
>
> **La cifra real sobre el corpus completo, medida de nuevo tras el
> rediseño** (`node scripts/check-migration-safety.mjs
> packages/database/supabase/migrations`, sin `--base`, sanity check manual,
> no parte de CI): **87 violaciones de regla 5 en 50 ficheros distintos** —
> más que el "3" de ronda 1 (que subcontaba, al no exigir `SECURITY
> DEFINER`+`PUBLIC` específicamente) y más que el "63/33" que ronda 2 citó
> contra el diseño de ronda 1 (ese diseño exigía `GRANT ... TO
> authenticated`; el nuevo, más estricto — cualquier `SECURITY DEFINER` sin
> `REVOKE ... FROM PUBLIC` propio, con o sin `GRANT` — encuentra más).
> Ninguna de las 50 rompe CI hoy por la misma razón que protege a las 90+
> migraciones de la regla 1: `ci.yml` siempre invoca `--base`, que sólo mira
> archivos tocados por el PR.
>
> **Medios cerrados:** `REVOKE_RE` acepta ahora `ALL [PRIVILEGES]` o
> `EXECUTE` (antes exigía literalmente `REVOKE ALL`, rechazando una
> migración que cerraba correctamente con `REVOKE EXECUTE`). El mensaje de
> resumen de rechazo separa `rule1Rejected` de `aclRejected`: cuando sólo
> dispara la regla 5, ya no imprime el texto de la regla 1 ("mixes DDL with
> an unbounded top-level backfill"), que mandaba a buscar un backfill
> inexistente. `GRANT ... TO PUBLIC` (rol distinto de `authenticated`) y
> `GRANT` sin paréntesis (legal en PG14+) **no se cerraron** — ya no son
> relevantes para el disparo de la regla 5 tras el rediseño (que dejó de
> mirar `GRANT` en absoluto), y arreglarlos en la utilidad exportada
> `findGrantExecuteSignatures` sin que nada consuma el resultado no tenía
> valor observable por CLI; documentado como deuda menor, no cerrado.
> `GRANT ... ON ALL FUNCTIONS IN SCHEMA` tampoco se maneja — fuera de
> alcance, no bloqueante per el propio review.
>
> **Bajo cerrado:** las advertencias de la regla 4 llevan ahora
> `file=…,line=…` (formato de anotación de GitHub Actions), usando el
> `index` que `findCreateFunctionSignatures` ya calculaba y que antes se
> tiraba — nueva `lineNumberAt()` en el módulo de parseo.
>
> **Contexto para la fase 5, anotado sin auditar (dato del reviewer, no
> verificado por mí):** el objeto vivo tiene **37 funciones `SECURITY
> DEFINER` que `anon` puede ejecutar hoy** (`add_manifest_to_route`,
> `expand_carton`, `get_route_reception_snapshot`,
> `enable_module_for_operator`, entre otras) — el patrón que si sería
> explotable. Nadie las ha auditado una por una. Ver nota añadida en fase 5
> más abajo.
>
> **TDD de la ronda 2**: 11 tests nuevos escritos primero (B1×2, invoker
> fuera de alcance, patrón correcto, `REVOKE FROM PUBLIC` sin `GRANT`, ACL
> que miente con `FROM anon` solo, B2×2, comentario que no cuenta, `REVOKE
> EXECUTE`, lista de roles con PUBLIC no-primero, mensaje sin ruido de regla
> 1, más 2 fixtures `--base` nuevas) — confirmados en rojo contra el código
> de ronda 1 antes de reescribir (11/23 fallando por la razón correcta), 23/23
> verde después.
>
> **Mutation-testing de ronda 2 — 8 mutantes nuevos, uno a uno, restaurado
> antes de cada siguiente** (además de los 6 de ronda 1, no repetidos aquí):
> 1. Quitar el filtro `isSecurityDefiner` de la regla 5 → mató exactamente
>    el test de SECURITY INVOKER fuera de alcance.
> 2. Volver `hasPublicRevoke` global al fichero (B2 reintroducido) → mató
>    exactamente los 2 tests de B2.
> 3. Quitar `r.roles.includes('public')` (cualquier revoke cuenta) → mató
>    exactamente el test "REVOKE FROM anon only rejects".
> 4. Volver `splitRoleList` a capturar sólo el primer rol (B3 reintroducido)
>    → mató exactamente el test "PUBLIC no-primero en la lista".
> 5. Quitar `stripLineComments` de `findRevokeSignatures` → mató exactamente
>    el test del REVOKE comentado.
> 6. Volver `REVOKE_RE` a exigir sólo `ALL` → mató exactamente el test de
>    `REVOKE EXECUTE`.
> 7. Volver `corpusFiles` a `= files` (el mutante que el propio reviewer
>    describió como "sobrevive 12/12 y deja la regla 4 muda en CI bajo
>    `--base`") → mató exactamente el nuevo test `--base: rule 4 sees a
>    REVOKE from a migration the PR did not touch` — el hueco de cobertura
>    que ronda 2 pidió cerrar explícitamente.
> 8. Volver el mensaje de rechazo a imprimir siempre el texto de regla 1
>    (quitar el `if (rule1Rejected)`) → mató exactamente el test del mensaje
>    sin ruido.
> Los 8 probados individualmente contra los 23 tests de
> `check-migration-safety-acl.test.sh` (que ahora incluye cobertura real de
> `--base`, la ausencia que ronda 2 señaló como el hueco más importante); no
> se afirma "todos mueren" sobre mutantes no probados.
>
> **Split adicional**: `check-migration-safety-acl.mjs` volvió a superar 300
> líneas al añadir `isSecurityDefinerClause`/roles completos — el parseo de
> bajo nivel (`findCreateFunctionSignatures`, `findRevokeSignatures`,
> `findGrantExecuteSignatures`, `lineNumberAt`, y los helpers privados) se
> movió a `check-migration-safety-acl-parse.mjs` nuevo; `acl.mjs` queda sólo
> con las dos reglas y `buildRevokeIndex` (138 líneas; parse: 208; main: 232).
>
> **Regresión**: las 7 suites preexistentes de `check-migration-safety*`
> siguen en verde (13, 11, 10, 10, 10, 8, 6 — 68 asserts; `real.test.sh` bajó
> de 12 a 10 asserts al corregir la cifra de 3→1 hallazgos genuinos), más las
> 23 de `check-migration-safety-acl.test.sh`. `node --check` limpio en los
> cuatro `.mjs` tocados o creados.
>
> **Ronda 3 (review adversarial, contra el objeto vivo, PR #723): la
> premisa del rediseño de ronda 2 era falsa, no sólo su ejecución.**
> Medido contra la base viva, en `ROLLBACK`: `CREATE OR REPLACE FUNCTION`
> **preserva** el ACL existente — no lo resetea al grant `PUBLIC` por
> defecto. Sólo `DROP FUNCTION; CREATE FUNCTION;` (o una función
> genuinamente nueva) resetea. Esto ya está documentado y **asegurado en
> SQL, en este mismo repo**: `20260913000008` (fase 2 de este spec) tiene
> un comentario (`:115-117`) y una aserción **que aborta la migración**
> (`:169-175`) si `CREATE OR REPLACE` reabriera PUBLIC — y esa aserción ha
> pasado, contra la base real, desde que esa migración se mergeó.
> Consecuencia medida: la regla de ronda 2 rechazaba esa migración
> correcta, y (encontrado en vivo, en CI, en este mismo PR) una función de
> **trigger** de otro spec (`20261001000001`, `trg_reception_scan_advance_package_status`,
> `RETURNS TRIGGER`) que su propio comentario ya decía "no REVOKE/GRANT
> needed" — exactamente el tipo de función que la fase 0 de este spec
> excluyó del conteo de invocables desde el principio.
>
> **Rediseño de la regla 5, de scan-por-fichero a máquina de estados
> acumulativa.** `buildAclTimeline()` (en `check-migration-safety-acl.mjs`)
> recorre TODO el corpus de migraciones en orden cronológico (por nombre de
> archivo, que en este repo es el timestamp) y registra cada evento
> `REVOKE`/`GRANT` que mencione `PUBLIC` — incluido un `GRANT ... ON ALL
> FUNCTIONS IN SCHEMA public` que reabre cualquier función que cubra, aunque
> nunca la nombre (punto 4b), y un `REVOKE` sin lista de argumentos (legal
> en PG14+ cuando el nombre no es ambiguo), que cubre cualquier overload de
> ese nombre. `isPublicOpenAt()` responde: como de este fichero (inclusive),
> ¿cuál es el ÚLTIMO evento que afecta a esta función exacta (por
> nombre+firma, un comodín del mismo nombre, o un grant de esquema
> completo)? Ningún evento en absoluto significa que nunca se tocó — el
> grant por defecto de Postgres sigue en pie, abierto. Esto también cierra
> el hueco de sensibilidad al orden que ronda 2 se saltó por completo:
> `REVOKE FROM PUBLIC` seguido de `GRANT TO PUBLIC` (mismo fichero) reabre —
> medido contra la base viva por el reviewer, `exit 0` antes, `exit 1`
> ahora (punto 4a).
>
> **Verificado contra los dos precedentes reales que motivaron la ronda:**
> `20260913000008` (la migración que ronda 2 rechazaba) ya NO se rechaza al
> escanear el corpus completo (`node scripts/check-migration-safety.mjs
> packages/database/supabase/migrations` — sin `::error::` para ese
> archivo; escaneado solo, sí rechaza, correctamente, porque en aislamiento
> no ve el `REVOKE` de fase 1 en `20260913000006`, que es justo lo que la
> máquina de estados existe para resolver mirando el corpus completo).
> `20261001000001` (el archivo que tumbó CI) tampoco se rechaza —
> verificado con el contenido real de `origin/main` (`git show
> origin/main:.../20261001000001_....sql`, escaneado solo).
>
> **Menores cerrados:** `REVOKE ... FROM PUBLIC CASCADE` ya no corrompe el
> rol en `"public cascade"` (CASCADE/RESTRICT se despoja antes de partir la
> lista). `REVOKE ON FUNCTION nombre FROM PUBLIC` sin lista de argumentos
> (legal PG14+, nombre no ambiguo) ya no es invisible para el parser — antes
> exigía el paréntesis y la firma no se registraba en absoluto.
>
> **La cifra, re-medida con el diseño final** (mismo comando, corpus
> completo): **56 violaciones de regla 5 en 35 ficheros** (baja de
> 87/50 de ronda 2, porque la máquina de estados ahora reconoce
> correctamente las migraciones que endurecieron una función más tarde y
> deja de recontarlas en cada re-creación). Contando por **firma distinta,
> no por fichero** (la métrica que más se acerca a "cuántas funciones están
> abiertas hoy"): de 41 firmas `SECURITY DEFINER` no-trigger creadas alguna
> vez, **18 siguen abiertas a `anon` según el historial de migraciones**
> (script ad-hoc, no parte de la suite permanente — ver comando en el PR).
> Esta cifra es un análisis estático del texto SQL, no una consulta contra
> la base viva — puede diferir del "37" que el reviewer midió contra
> `pg_proc`/`aclexplode` en vivo (fuente de verdad real). Las 18 coinciden
> en su mayoría con las 17 de la fase 5 de este spec (más
> `start_pickup_route(uuid)`, un overload de 1 argumento de
> `20260812000003` que quedó huérfano antes de que se le añadiera el
> parámetro de tripulación).
>
> **TDD de la ronda 3**: 12 tests nuevos escritos primero (B1 con historial
> endurecido, exclusión de función trigger ×2 para regla 4 y regla 5, punto
> 4a, punto 4b, CASCADE, revoke sin paréntesis, cobertura B2 con overload
> distinto del mismo nombre, ventana de `SECURITY DEFINER` acotada al
> cuerpo, dirección de la línea de tiempo (un evento futuro no debe filtrar
> hacia atrás) — confirmados en rojo contra el código de ronda 2 antes de
> reescribir (5/34 fallando por la razón correcta la primera vez; luego 2
> más al reforzar cobertura de B2/trigger que pasaban por la razón
> equivocada), 36/36 verde después.
>
> **Mutation-testing de ronda 3 — 8 mutantes nuevos, uno a uno, restaurado
> antes de cada siguiente** (además de los 14 de rondas 1-2, no repetidos
> aquí):
> 1. Quitar `fn.returnsTrigger` del filtro de la regla 5 → mató exactamente
>    el test de exclusión de trigger para la regla 5.
> 2. Quitar `fn.returnsTrigger` del filtro de la regla 4 → sobrevivió contra
>    el fixture original (sin historial de REVOKE, nunca llegaba a esa
>    rama) — añadido un segundo fixture con historial de REVOKE para una
>    firma distinta del mismo nombre; con él, el mutante muere.
> 3. Quitar el recorte de `CASCADE`/`RESTRICT` → mató exactamente el test
>    de CASCADE.
> 4. Forzar `continue` cuando no hay paréntesis (revertir el soporte de
>    referencia desnuda) → mató exactamente el test de REVOKE sin lista de
>    argumentos.
> 5. Quitar `timeline.schemaWide` del array de eventos de `isPublicOpenAt`
>    → mató exactamente el test del punto 4b.
> 6. Tomar `events[0]` en vez de `events[events.length - 1]` tras ordenar
>    (invertir la sensibilidad al orden) → mató el punto 4a **y** el punto
>    4b (ambos dependen del evento terminal correcto — esperado, no un
>    falso positivo).
> 7. Quitar el filtro `e.fileIdx <= uptoFileIdx` → mató exactamente el test
>    de "un evento futuro no debe filtrar hacia atrás".
> 8. Forzar `fileIdxOf` a devolver siempre `0` → mató exactamente el test
>    del punto 4b (el evento de grant de esquema completo, en un fichero
>    intermedio, deja de verse si todos los ficheros se tratan como
>    posición 0).
> Los 8 probados individualmente contra los 36 tests de
> `check-migration-safety-acl.test.sh`; no se afirma "todos mueren" sobre
> mutantes no probados.
>
> **Regresión**: las 7 suites preexistentes de `check-migration-safety*`
> siguen en verde (13, 11, 10, 10, 10, 8, 6 — 68 asserts), más las 36 de
> `check-migration-safety-acl.test.sh`. `node --check` limpio en los tres
> `.mjs` de la superficie ACL. `check-migration-safety-acl.mjs` volvió a
> superar 300 líneas al añadir la línea de tiempo; se separó el parseo de
> bajo nivel (incluida la detección de `RETURNS TRIGGER` y las referencias
> `ON FUNCTION` sin paréntesis) a `check-migration-safety-acl-parse.mjs`.
> Los tres archivos quedan en 258/225/250 líneas.
>
> **No cerrado, documentado como deuda menor (no bloqueante per el propio
> review):** `findGrantExecuteSignatures` dejó de estar "muerta" — la
> reutiliza `buildAclTimeline` para detectar `GRANT ... TO PUBLIC` que
> reabre una función — así que ese hallazgo de ronda 2 quedó resuelto por
> el rediseño mismo, no por una limpieza aparte.
>
> **Ronda 4 (rebase de #723 sobre `main`, dos falsos negativos señalados en
> el encargo de rebase): la regla 5 seguía ciega a dos formas de abrir
> `anon`.**
>
> 1. **`DROP FUNCTION` + `CREATE FUNCTION`.** Ronda 3 ya documentó que
>    `CREATE OR REPLACE` **preserva** el ACL — por eso la máquina de estados
>    no necesitaba ver un `CREATE OR REPLACE` como un reseteo. Pero un
>    `DROP FUNCTION` **sí** destruye el objeto entero, y el `CREATE` que le
>    sigue recibe el grant a `PUBLIC` por defecto de Postgres, sin importar
>    qué `REVOKE` existiera antes del `DROP`. La línea de tiempo no
>    registraba `DROP FUNCTION` en absoluto — un `REVOKE FROM PUBLIC` en una
>    migración vieja seguía "vigente" para siempre, aunque una migración
>    posterior hubiera `DROP`eado y recreado la función sin volver a
>    cerrarla. Confirmado antes de tocar código: la migración maliciosa
>    (`REVOKE FROM PUBLIC` en un fichero, `DROP FUNCTION; CREATE FUNCTION;`
>    sin ACL propio en el siguiente) pasaba con `exit 0`.
> 2. **`GRANT ... TO anon` directo.** La línea de tiempo sólo registraba
>    eventos que nombraran `PUBLIC` — un `GRANT EXECUTE ... TO anon` sin
>    mencionar `PUBLIC` nunca se veía, aunque abriera acceso a `anon`
>    exactamente igual. Confirmado antes de tocar código: `REVOKE ... FROM
>    PUBLIC` seguido de `GRANT ... TO anon` en la misma migración pasaba con
>    `exit 0`.
>
> **Arreglo, mismo patrón de máquina de estados que ronda 3, no un chequeo
> nuevo aparte:** `buildAclTimeline` gana `findDropFunctionSignatures`
> (`check-migration-safety-acl-parse.mjs`, mismo soporte de referencia sin
> paréntesis que ya tenía `REVOKE`) y una segunda línea de tiempo,
> `anonPerKey`, que registra sólo eventos que nombren `anon` explícitamente
> (independiente de `PUBLIC`). Un `DROP FUNCTION` se registra como
> `'grant'` en `perKey` (el estado vuelve a abierto, mismo efecto que un
> `GRANT` explícito para esta regla) y como `'revoke'` en `anonPerKey` (un
> `GRANT ... TO anon` anterior desaparece junto con la función borrada).
> `findGrantWithoutRevokeViolations` ahora rechaza si `PUBLIC` está abierto
> **o** si `anon` tiene un grant directo vigente — `anon` no necesita el
> grant heredado de `PUBLIC` cuando tiene el suyo propio.
>
> **TDD**: 6 tests nuevos escritos primero — DROP+CREATE reabre,
> DROP bare (sin paréntesis) reabre, DROP de un overload distinto no resetea
> el hermano, `GRANT ... TO anon` directo rechaza con `PUBLIC` cerrado,
> `GRANT ... TO authenticated` (no `anon`) no rechaza (guarda de regresión),
> y DROP también resetea un `GRANT ... TO anon` previo (el fichero #1, que
> abre por `anon`, se rechaza solo por sí mismo; el fichero #2, que
> `DROP`ea+recrea y cierra bien, no debe arrastrar el hallazgo del #1) —
> confirmados en rojo por la razón correcta (3 fallando con "expected exit
> 1, got 0"; 2 guardas de regresión pasando vacuamente porque nada las
> disparaba todavía) antes de escribir la implementación mínima.
>
> **El sexto test encontró un defecto en el propio test, no en el código**:
> la primera versión de "DROP resetea un GRANT previo a anon" esperaba
> `exit 0` sobre el directorio completo — pero el fichero #1, tomado solo,
> es una migración genuinamente mala (abre `anon` sin `REVOKE` después), así
> que el chequeo lo rechaza correctamente y el `exit 0` esperado era
> incorrecto. Corregido a comprobar que el fichero #2 específicamente no
> aparece en la salida `::error::`, no el código de salida del directorio
> completo.
>
> **Mutation-testing — 4 mutantes, uno a uno, cada uno restaurado a verde
> antes del siguiente. Corrección (ronda 5, B6): esta lista afirmaba que el
> mutante 1 mataba "exactamente 1 test" — es falso, medido de nuevo con el
> comando de abajo y no de memoria: mata 3, incluido el de reseteo de
> `anon` vía `DROP` (que SÍ depende de esa rama — `pushEvent(anonPerKey, ...
> type: 'revoke')` vive dentro del mismo bucle). La conclusión ("el mutante
> murió, restaurado") seguía siendo correcta; la razón escrita al lado no
> lo era.**
> 1. Quitar el bucle de `findDropFunctionSignatures` de `buildAclTimeline`
>    → mata 3 tests: los 2 de DROP+CREATE (con y sin paréntesis) y el de
>    "DROP también resetea un GRANT previo a anon" (verificado:
>    `bash scripts/check-migration-safety-acl.test.sh 2>&1 | grep -c FAIL`
>    → `3`). El test del overload distinto no depende de esa rama y sigue
>    en verde, como se esperaba.
> 2. Cambiar `if (publicOpen || anonOpen)` a `if (publicOpen)` en
>    `findGrantWithoutRevokeViolations` → mató exactamente el test de
>    `GRANT ... TO anon` directo.
> 3. Quitar la rama `if (g.roles.includes('anon'))` de la construcción de
>    `anonPerKey` en `buildAclTimeline` → mató exactamente el mismo test
>    (la vía de entrada distinta a la misma señal).
> 4. Quitar el `pushEvent(anonPerKey, ..., { type: 'revoke' })` del bloque
>    de `DROP FUNCTION` → mató exactamente el test de reseteo de `anon` vía
>    `DROP` (el fichero #2 volvía a arrastrar el hallazgo del #1).
> Los 4 probados individualmente contra las 42 aserciones de
> `check-migration-safety-acl.test.sh`; ninguno se probó en lote ni se
> afirma "todos mueren" sobre mutantes no probados.
>
> **Cifras — verificadas, no heredadas.** El corpus real
> (`packages/database/supabase/migrations`) tiene **16** ficheros que
> contienen `DROP FUNCTION` (`grep -rEli '^\s*DROP\s+FUNCTION\b'
> packages/database/supabase/migrations | wc -l`) y **0** que contengan un
> `GRANT EXECUTE ... TO anon` directo (`grep -rEli 'GRANT\s+EXECUTE\s+ON\s+
> FUNCTION.*TO\s+anon\b' packages/database/supabase/migrations | wc -l`).
> **Corrección (ronda 5, B5): la frase de abajo ("los rechazos siguen
> siendo exactamente los mismos 3 de siempre") es falsa, y es la cuarta
> cifra sin verificar que se propaga en este spec.** El reviewer la midió:
> `node scripts/check-migration-safety.mjs packages/database/supabase/migrations`
> da, con el código de esta ronda (4), **56 rechazos en 35 ficheros sobre
> 33 funciones distintas** — no 3. La conclusión que SÍ se sostiene (y es
> la que de verdad importaba comprobar) es la más estrecha: de esos 56, ni
> uno es un falso positivo nuevo introducido por el soporte de `DROP
> FUNCTION`/`anon` directo de esta ronda — son violaciones reales,
> preexistentes, que la regla 5 ya encontraba desde antes de esta ronda
> (documentadas en la fase 5 de este mismo spec). "Los rechazos no
> cambiaron" habría sido la frase honesta; "son 3" no lo era.
>
> **Regresión**: las 8 suites preexistentes de `check-migration-safety*`
> siguen en verde tras el rebase (13, 11, 10, 10, 10, 8, 6, y ahora 42 —
> antes 36 — de `check-migration-safety-acl.test.sh`). `node --check`
> limpio en los dos `.mjs` tocados. Límite de 300 líneas respetado:
> `check-migration-safety-acl.mjs` 278, `check-migration-safety-acl-parse.mjs`
> 284, `check-migration-safety.mjs` 258 (sin cambios, no tocado esta ronda).
>
> PR: #723, **sin auto-merge**, rebaseado sobre `main` (conflictos resueltos
> en `docs/specs/spec-88-anon-security-definer-audit.md` conservando la fase
> 3 ronda 7 y la fase 5 ronda 3 que se mergearon en `main` mientras este PR
> estaba abierto — ninguna evidencia de esas dos fases se perdió).
> Review: pendiente sobre esta ronda 4.
> QA: pendiente — PR sin auto-merge, a la espera de review.
> Downstream: ninguno declarado en la cabecera del spec — sin cambios.

> **Ronda 5 (review adversarial, PR #723) — "no mergeable". Seis
> hallazgos Alto/Medio cerrados, uno (B10) era una decisión de diseño del
> reviewer que se implementó, cuatro (B7/B9/B11/B12) quedan como deuda
> declarada abajo.**
>
> **Lo que el review verificó y se sostiene** (no se repite el trabajo,
> se cita): salida del corpus byte-a-byte idéntica entre rondas 3 y 4;
> la máquina de estados respeta el orden real de sentencias (`DROP;
> CREATE; GRANT auth; REVOKE FROM PUBLIC` → `rc=0`; orden invertido →
> `rc=1`); la precisión por sobrecarga (mutar la clave del DROP a
> comodín, y por separado borrar el parseo de la firma, matan ambos);
> `GRANT TO PUBLIC` seguido de `REVOKE FROM anon` sigue rechazando
> (correcto — `REVOKE FROM anon` no borra el grant de PUBLIC que anon
> hereda).
>
> **B1 [Alto] — rol entrecomillado invisible.** `splitRoleList` hacía
> `.toLowerCase()` pero nunca quitaba comillas: `TO "anon"` (la forma que
> emite `supabase db diff`, precedente real en el repo:
> `20250130181641_todo_list.sql:23`) no coincidía con `'anon'`. Arreglado:
> `.replace(/^"|"$/g, '')` tras el `toLowerCase()`. TDD: 1 test, rojo por
> la razón correcta (`expected exit 1, got 0`) antes del fix. Mutation:
> revertir el `.replace` mata exactamente ese test, ninguno más.
>
> **B2 [Alto] — `GRANT ALL`/`GRANT ALL PRIVILEGES` invisibles.**
> `GRANT_HEADER_RE` sólo aceptaba `EXECUTE`, mientras `REVOKE_HEADER_RE`
> ya aceptaba `ALL(\s+PRIVILEGES)?|EXECUTE` — la asimetría estaba en el
> lado que abre, no en el que cierra. Arreglado: mismo patrón `ALL(\s+
> PRIVILEGES)?|EXECUTE` en `GRANT_HEADER_RE`. TDD: 2 tests (`GRANT ALL`,
> `GRANT ALL PRIVILEGES`), ambos rojos por la razón correcta. Mutation:
> revertir a sólo `EXECUTE` mata exactamente esos 2 tests.
>
> **B3 [Alto] — grant de esquema completo a `anon` invisible.** La ronda
> 3 sólo trackeaba `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` para
> `PUBLIC`; el eje "esquema completo" y el eje "anon directo" (ronda 4)
> nunca se cruzaban. Arreglado: `buildAclTimeline` gana `anonSchemaWide`
> (mismo patrón que `schemaWide`), consultado por `isAnonOpenDirectly`.
> TDD: 1 test (`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon`
> reabre una función ya cerrada por `PUBLIC`), rojo por la razón correcta.
> Mutation — 2 mutantes, uno a uno: (a) quitar la rama `anon` de la
> construcción de `anonSchemaWide` → mata exactamente ese test; (b) quitar
> `...timeline.anonSchemaWide` del array de eventos en
> `isAnonOpenDirectly` → mata exactamente ese test.
>
> **B4 [Medio] — rama comodín de `isAnonOpenDirectly` sin test.** Cierto:
> ningún test existente disparaba `GRANT EXECUTE ON FUNCTION nombre TO
> anon` (referencia sin paréntesis, PG14+). Añadido. Mutation: quitar
> `...(timeline.anonPerKey.get(...WILDCARD_SIGNATURE) || [])` del array
> de `isAnonOpenDirectly` → mata exactamente ese test nuevo, ninguno de
> los 46 anteriores.
>
> **B5/B6 [cifras falsas] — corregidas in situ, arriba, donde se
> escribieron originalmente** (no aquí, para que quien lea la ronda 4 vea
> la corrección junto a la afirmación que corrige). Regla seguida desde
> aquí en adelante: cada cifra que seguía se verificó con el comando al
> lado, no se copió.
>
> **B8 [barato, arreglado aunque no estaba en la lista Alto/Medio] — DROP
> dentro de un cuerpo `$$...$$` contaba como reset real.**
> `findCreateFunctionSignatures` ya acota su ventana de opciones al
> exterior del cuerpo (ronda 3); `findDropFunctionSignatures` no tenía la
> misma protección — la asimetría era interna, no del reviewer.
> Arreglado: `stripFunctionBodies` (ya existente,
> `check-migration-safety-rule1.mjs`, blanquea `AS $$...$$` pero no
> `DO $$...$$`, que sí corre) aplicado antes de escanear. TDD: 1 test
> (una función que `RETURN`a el texto literal `'DROP FUNCTION
> public.internal_helper();'` no cuenta como DROP real), rojo por la
> razón correcta. Mutation: quitar `stripFunctionBodies(...)` del scan →
> mata exactamente ese test.
>
> **B10 [decisión del reviewer, implementada] — la regla 5 degrada bajo
> `--base` igual que la regla 1.** `buildBaseAclTimeline` (nuevo, en
> `check-migration-safety-git.mjs` — se extrajo de `main()` para no
> volver a superar 300 líneas) construye una SEGUNDA línea de tiempo
> reflejando el estado del corpus AL momento de `base`: ficheros sin
> tocar se leen de disco (idénticos a como estaban en `base`, por
> definición de `base` como ancestro); ficheros `M`/`R` se leen vía
> `git show base:<oldPath>`; ficheros `A` reciben un override explícito
> `null` (no existían en `base`, así que nada de lo que contengan cuenta
> como "ya presente antes de este PR"). Una violación de la regla 5 sobre
> un fichero `M`/`R` se degrada (`::warning::`) si `isPublicOpenAt`/
> `isAnonOpenDirectly` contra la línea de tiempo de `base` **también** la
> encuentran abierta; si no, rechaza. Un fichero `A` nunca degrada — no
> hay "antes" en el que pudiera haber estado a salvo.
>
> TDD: 3 tests — violación preexistente sobre fichero tocado degrada;
> violación genuinamente introducida (el PR borra el `REVOKE`) sigue
> rechazando bajo `--base`; un fichero `A` insertado antes (por nombre)
> de un fichero tocado no contamina la línea de tiempo de `base` de ese
> fichero tocado (el caso cruzado que demuestra por qué el override
> `null` para `A` importa, no sólo documenta intención). Los tres rojos
> por la razón correcta antes de implementar.
>
> Mutation — 5 mutantes, uno a uno, cada uno restaurado antes del
> siguiente:
> 1. `preexisting = false` fijo → mata exactamente el test de
>    "preexistente degrada".
> 2. `preexisting = true` fijo → mata **20** tests (todo lo que no usa
>    `--base`, porque `base` deja de ser la única condición que hace
>    falso el flag) — el radio de explosión confirma que la guarda
>    `base &&` es la que de verdad protege el modo sin `--base`.
> 3. Quitar el filtro `status === 'M' || status === 'R'` → mata
>    exactamente el test "--base: rule 5 rejects a newly added migration
>    with the B1 bug" (un fichero `A` empezaba a degradar).
> 4. Quitar la rama `override.set(corpusPath, readFileAtBase(...))` para
>    `M`/`R` → mata exactamente el test de "violación genuinamente
>    introducida" (deja de rechazar, la trata como preexistente porque
>    el fallback a disco lee el contenido ACTUAL, no el de `base`).
> 5. **Retractado (ronda 6, B2).** Este punto afirmaba que quitar el
>    override `null` para `A` "sobrevive los 50 tests existentes" y que
>    la rama no era observable con la arquitectura actual — **falso, y el
>    argumento escrito al lado también lo era.** El error: sostenía que
>    "cualquier evento de un fichero `A` que cambia el veredicto de
>    `baseTimeline` también colapsa la violación en `timeline`", cuando
>    los eventos que SÍ cambian `baseTimeline` de cerrado a abierto son
>    GRANTs — y un GRANT en `timeline` no colapsa la violación: **la
>    crea**. Fixture que lo mata: `base` con un `CREATE` SD +
>    `REVOKE ... FROM PUBLIC` (cerrado); el PR AÑADE un fichero que
>    ordena ANTES con `GRANT EXECUTE ... TO anon` (abre directamente vía
>    `anon`) y TOCA el fichero original sin tocar su ACL. En `timeline`
>    (la real), el GRANT del fichero añadido es exactamente lo que hace
>    que la violación exista — sin él, no hay violación que reportar en
>    absoluto. Con el override `null` correcto, `baseTimeline` excluye el
>    fichero añadido → sigue cerrado en `base` → rechaza (correcto: el
>    GRANT lo introdujo este PR). Sin él (mutante), `baseTimeline` incluye
>    el GRANT del fichero añadido → lee "también abierto en base" →
>    degrada a warning — un GRANT que el propio PR introdujo pasaría como
>    preexistente. Test añadido, mutante muere exactamente en ese test.
>    La rama es load-bearing, no higiene decorativa.
>
> **Refactor de tamaño (los dos ficheros que el reviewer no midió pero
> que crecieron por los arreglos de arriba):** `check-migration-safety.mjs`
> pasó a 308 líneas y `check-migration-safety-acl.mjs` a 311 —ambos sobre
> el límite de 300. La construcción de `baseTimeline` se extrajo a
> `buildBaseAclTimeline` en `check-migration-safety-git.mjs` (292→174,
> quedaba hueco); la regla 4 completa
> (`findOrphanedOverloadWarnings`/`buildRevokeIndex`) se extrajo a
> `check-migration-safety-acl-rule4.mjs` (nuevo, 71 líneas) — este fichero
> ya no mezcla las dos reglas. Líneas finales: `check-migration-safety.mjs`
> 292, `check-migration-safety-acl.mjs` 263, `check-migration-safety-acl-parse.mjs`
> 296, `check-migration-safety-acl-rule4.mjs` 71, `check-migration-safety-git.mjs`
> 174 — los cinco bajo 300.
>
> **Corrección (ronda 6, B3): la frase de abajo es la sexta cifra falsa de
> este spec, y comete el mismo error de clase que las cinco anteriores —
> comparar un total de TODAS las reglas contra un conteo previo de UNA
> sola regla, sin desglosar.** El reviewer corrió el barrido con el código
> de la ronda 4 y con el de la ronda 5/6: el conjunto de `::error::` es
> **byte a byte idéntico**, 68 y 68 — **B1-B4 no cazan ni un solo caso
> nuevo en este corpus real.** El desglose correcto, verificado con
> `grep -c` sobre las dos categorías de mensaje:
> `grep "::error::" | grep -c "SECURITY DEFINER and"` → **56** (regla 5 —
> exactamente la cifra que la ronda 5 "retractó" creyéndola inflada; era
> la correcta) + `grep "::error::" | grep -c "top-level\|DDL and both
> declares"` → **12** (regla 1, DDL + backfill sin acotar, preexistentes,
> ajenos por completo a esta fase). 56 + 12 = 68. La frase original
> abajo, que atribuía el salto a B1-B4, queda retractada.
> `grep -rEli '^\s*DROP\s+FUNCTION\b' packages/database/supabase/migrations
> | wc -l` → **16** (anclado — el mismo comando que la regla usa
> internamente para su header). Sin anclar (`grep -rEl 'DROP\s+FUNCTION'`)
> → **17** — el 17º sólo aparece en un comentario, que `stripLineComments`
> ya elimina; confirma B11 (medir con el instrumento equivocado da una
> cifra plausible pero no real).
>
> **Deuda declarada — no arreglada esta ronda, con su forma exacta:**
> - **B7.** `DROP FUNCTION a(), b();` (lista separada por comas, SQL
>   válido) sólo registra el primer nombre — la segunda función queda sin
>   resetear (falsamente cerrada si tenía un `REVOKE` histórico que ya no
>   aplica tras el DROP real). No reproducido en el corpus actual
>   (`grep -rEl 'DROP\s+FUNCTION\s+\w+\s*\([^;]*,' packages/database/supabase/migrations`
>   → vacío), pero es SQL legal y el parser no lo distingue.
> - **B9.** Un `DROP FUNCTION nombre;` (sin paréntesis, referencia
>   desnuda) que aparece DESPUÉS de un `CREATE FUNCTION nombre(tipos)`
>   correctamente cerrado, en el mismo fichero, reabre la firma vía la
>   entrada comodín — falso positivo sobre un fichero que en realidad
>   está bien. Requiere que la firma exacta y el comodín se resuelvan de
>   forma consciente del ORDEN, no sólo unidos en un array — cambio de
>   diseño, no una línea.
> - **B11.** Corregido como hallazgo de medición arriba (16 anclado, 17
>   sin anclar) — no requiere cambio de código, la regla ya usa el patrón
>   anclado internamente.
> - **B12.** `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON
>   FUNCTIONS TO anon` pasa en verde (falla ABIERTO — el que preocupa,
>   confirmado con un fixture: `exit 0` sin ningún `::warning::`/
>   `::error::` que lo mencione). Modelar `ALTER DEFAULT PRIVILEGES`
>   requiere un tercer eje en la línea de tiempo (afecta sólo a funciones
>   creadas DESPUÉS del `ALTER`, no a las existentes) — diseño nuevo, no
>   una línea; 0 ocurrencias en el corpus real; se deja fuera de esta
>   ronda a propósito en vez de improvisar una regla a medias que podría
>   introducir sus propios falsos positivos/negativos. **Corrección
>   (ronda 6, B5): el párrafo original decía que `REVOKE ALL ... ON
>   ROUTINE` (el sinónimo per-función, no el `ALTER DEFAULT PRIVILEGES`
>   de arriba) "tampoco se ve — falla CERRADO (más seguro)". Falso: sólo
>   se midió el lado `REVOKE`. El lado `GRANT EXECUTE ON ROUTINE
>   public.f() TO anon` fallaba ABIERTO — confirmado con un fixture,
>   `exit 0` sin diagnóstico — que es la dirección peligrosa, no la
>   segura. Una deuda declarada que dice "falla cerrado" cuando falla
>   abierto es peor que no declararla. Corregido en esta misma ronda
>   (`ON ROUTINE`, tanto `GRANT` como `REVOKE`, per-función, es ahora
>   reconocido — B5 arriba); ya no es deuda.
> **Regresión final**: 8 suites de `check-migration-safety*`, **119
> aserciones, 0 fallos** (13, 11, 10, 10, 10, 8, 6, y 51 —antes 36— de
> `check-migration-safety-acl.test.sh`). `node --check` limpio en los
> cinco `.mjs` de la superficie ACL.
>
> PR: #723, **sin auto-merge**. Review: pendiente sobre esta ronda 5.
> QA: pendiente. Downstream: ninguno declarado en la cabecera del spec —
> sin cambios.

> **Ronda 6 (review adversarial, PR #723) — "no mergeable", y el
> bloqueante nace de una decisión de ronda 5 mal especificada, no de la
> implementación. Lo que el review confirmó sólido, primero:** `TO
> anonymous`/`TO anon_readonly` NO casan con B1 (comparación por
> igualdad, no subcadena — más robusto de lo declarado); todas las
> cifras de mutación de ronda 5 son exactas; los 56 rechazos de regla 5
> son hallazgos legítimos (los tres candidatos a falso positivo son el
> patrón `GRANT TO authenticated; REVOKE FROM anon;` **sin** `FROM
> PUBLIC` — `anon` hereda de PUBLIC y sigue abierto).
>
> **B1 [Crítico] — la degradación con `--base` tragaba CUALQUIER
> violación nueva en un fichero `M`/`R`.** `isPublicOpenAt` devuelve
> `true` cuando NO hay ningún evento (el default de Postgres) — y ésa es
> también, exactamente, la lectura de una función que **no existía en
> `base`**: cero eventos, "abierta en base", preexistente, warning. Y
> `ci.yml:67` invoca la regla 5 **siempre** con `--base` — no era un
> caso límite, era la única ruta real que la regla tomaba en CI. Medido
> antes del arreglo: una migración vieja editada para añadir una función
> nueva abierta a `anon` degradaba a `::warning::` bajo `--base` y
> rechazaba (`::error::`) sin él — la misma violación, dos veredictos.
> **La regla 1, que ronda 5 debía imitar, hace lo inverso**:
> `violationsAtBase` falla CERRADO cuando el blob no existe (`return []`
> → "nada preexistía" → rechaza); `readFileAtBase` fallaba ABIERTO. No
> era el mismo patrón — era el opuesto.
>
> **Arreglo: dos condiciones, no una.** `functionExistedAtBase` (nuevo,
> `check-migration-safety-git.mjs`) — el `CREATE FUNCTION` violador debe
> haber existido YA en el contenido del fichero a `base` (identidad por
> nombre+firma vía `findCreateFunctionSignatures`, mismo principio que
> `newViolationsSinceBase` usa por identidad de sentencia para la regla
> 1). `preexisting` ahora exige `functionExistedAtBase(...) &&
> (isPublicOpenAt(...) || isAnonOpenDirectly(...))` — ambas, no cualquiera.
>
> TDD: 1 test rojo primero — función nueva con `GRANT TO anon` añadida
> editando un fichero `M` existente debe rechazar bajo `--base`;
> confirmado en rojo por la razón correcta (`::warning::` con "already
> present before this PR", `exit=0`, cuando debía ser `::error::`/
> `exit=1`) antes de escribir `functionExistedAtBase`.
>
> Mutation — 2 mutantes, uno a uno, restaurados entre cada uno:
> 1. Quitar `functionExistedAtBase(...) &&` de la condición en
>    `check-migration-safety.mjs` → mata exactamente el test nuevo.
> 2. Vaciar el cuerpo de `functionExistedAtBase` a `return true` → mata
>    exactamente el mismo test (la vía de entrada distinta a la misma
>    señal).
> Ninguno de los 51 tests preexistentes se movió — la nueva condición no
> cambia ningún veredicto que ya fuera correcto.
>
> **B2 [Medio] — retractado el argumento de "mutante no observable" de
> ronda 5, arreglo completo abajo, en el punto 5 de la lista de mutación
> de esa misma ronda** (no se duplica aquí — la corrección vive junto a
> la afirmación que corrige, mismo criterio que B5/B6 de ronda 5). Test
> nuevo añadido con la construcción exacta del reviewer; mutante
> reproducido y muerto por ese test específico.
>
> **B3 [Medio] — sexta cifra falsa, corregida in situ arriba** (bloque
> "Cifras del corpus real"): el salto de 56 a 68 no lo causan B1-B4 de
> ronda 5 — el barrido con código de ronda 4 y con el de ronda 5/6 da el
> **mismo conjunto, byte a byte**. Son 56 de regla 5 + 12 de regla 1
> (preexistentes, ajenos a esta fase), verificado con `grep -c` sobre
> las dos categorías de mensaje.
>
> **B4 [Medio] — `SCHEMA_WIDE_GRANT_RE` seguía exigiendo `GRANT
> EXECUTE`.** `GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon` y
> `GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO anon` pasaban en
> silencio — el mismo argumento de B2 (ronda 5: ser estricto del lado
> que ABRE es el error) sin aplicar al eje que B3 de ronda 5 acababa de
> estrenar (esquema completo). Arreglado: mismo patrón
> `ALL(\s+PRIVILEGES)?|EXECUTE` que `GRANT_HEADER_RE` ya tenía, más
> `FUNCTIONS|ROUTINES`. TDD: 2 tests (`GRANT ALL ON ALL FUNCTIONS`,
> `GRANT EXECUTE ON ALL ROUTINES`), ambos rojos por la razón correcta.
> Mutation — 2 mutantes, uno a uno: quitar `ALL(...)?|` → mata
> exactamente el test de `GRANT ALL`; quitar `|ROUTINES` → mata
> exactamente el test de `ROUTINES`.
>
> **B5 [Medio] — la nota de deuda de B12 (ronda 5) caracterizaba mal
> `ON ROUTINE`.** Sólo se había medido el lado `REVOKE` ("falla
> CERRADO — más seguro"); el lado `GRANT EXECUTE ON ROUTINE public.f()
> TO anon` fallaba ABIERTO — confirmado con fixture, `exit 0` sin
> diagnóstico, la dirección peligrosa. Corregido in situ en la nota de
> B12 arriba, y arreglado (no sólo redocumentado, per el criterio "una
> línea de regex cada uno" del review): `REVOKE_HEADER_RE` y
> `GRANT_HEADER_RE` ahora aceptan `ON (?:FUNCTION|ROUTINE)`. TDD: 2
> tests — `GRANT EXECUTE ON ROUTINE ... TO anon` rechaza; `REVOKE ALL ON
> ROUTINE ... FROM PUBLIC` cierra correctamente (sin falso rechazo) —
> ambos rojos por la razón correcta (el segundo por sobre-rechazo, no
> por no-rechazo: la regla veía la función como nunca cerrada y
> rechazaba un fichero correcto). Mutation — 2 mutantes, uno a uno:
> revertir `GRANT_HEADER_RE` a sólo `FUNCTION` → mata exactamente el
> test de `GRANT ... ON ROUTINE`; revertir `REVOKE_HEADER_RE` a sólo
> `FUNCTION` → mata exactamente el test de `REVOKE ... ON ROUTINE`
> (tarda ~2 min en correr por el volumen de fixtures del archivo
> completo — confirmado con el arnés imprimiendo el `FAIL`, no con un
> timeout mudo).
>
> **B7/B9/B11 confirmados sin cambios** — siguen siendo deuda declarada
> correctamente (B11 ya no requería código, sólo corrección de cifra,
> hecha en ronda 5). **B12 queda diferido**, con su nota corregida (B5
> arriba) — 0 ocurrencias en el corpus, requiere un tercer eje temporal
> en la línea de tiempo, decisión explícita de no improvisarlo.
>
> **Regresión final**: 8 suites de `check-migration-safety*`, **127
> aserciones, 0 fallos** (13, 11, 10, 10, 10, 8, 6, y 59 —antes 51— de
> `check-migration-safety-acl.test.sh`). Las 2 últimas, por encargo
> explícito de verificación: un fichero **renombrado** (`R`, no sólo
> `M`) con una función nueva abierta — sigue rechazando (`git mv` en
> este caso lo registra como `A`/`D`, no `R`, así que este test pasa por
> el mismo motivo ya cubierto que el original, no por una rama nueva —
> confirmado, no forzado); y una violación **preexistente** y una
> **nueva** en el MISMO fichero — mutation-verificado que el split es
> por violación, no por fichero: forzar `functionExistedAtBase` a
> `true` incondicional mata este test y el de "brand-new function in a
> modified file" (2 de los 59), sin tocar el del rename (esa rama no
> pasa por `functionExistedAtBase` con este `git mv`, así que queda
> fuera del radio de este mutante concreto — no una brecha, sino la
> guarda de estado `M`/`R` haciendo su trabajo). `node --check` limpio en los
> cinco `.mjs` de la superficie ACL. Límite de 300 líneas respetado tras
> recortar comentario en dos ficheros que lo habían superado por los
> arreglos de esta ronda: `check-migration-safety.mjs` 294,
> `check-migration-safety-acl.mjs` 263, `check-migration-safety-acl-parse.mjs`
> 284, `check-migration-safety-acl-rule4.mjs` 71,
> `check-migration-safety-git.mjs` 197.
>
> PR: #723, **sin auto-merge**. Review: pendiente sobre esta ronda 6.
> QA: pendiente. Downstream: ninguno declarado en la cabecera del spec —
> sin cambios.


### Fase 5 — Defensa en profundidad del resto `[in_progress]`

> **Auditoría ejecutada (2026-09-09). Resultado: 0 de 16 explotables. Es
> higiene — pero con dos minas que hay que desactivar ANTES de escribir la
> migración de esta fase.**
>
> Cada una de las 16 se ejecutó **como `anon`**, en `BEGIN`/`ROLLBACK`, contra
> un contenedor propio desde `origin/main` (nunca `spec52-pg`, que es
> compartido; cero ejecución contra producción). Y también **como
> `authenticated` de otro operador**, con UUIDs reales de un fixture. Las 16
> fallan en las dos direcciones.
>
> **El alcance real es 16, no 32.** El «32» salió de un check estático y se
> repitió sin verificar — es la **cuarta** cifra de este spec que se propaga
> así (ya se corrigieron 34→39 y 13→10). Confirmado en QA con el mismo número.
> El desglose: 60 `SECURITY DEFINER` en `public`, 18 de trigger, 42 invocables,
> **16 ejecutables por `anon`**. El 37 que también circuló incluye triggers y
> overloads de PostGIS; su autor lo re-midió y lo corrigió a **17**.
>
> **Dos mediciones independientes, 16 y 17, y no las reconcilié yo.** Difieren
> probablemente en los overloads de PostGIS o en cómo cuentan las sobrecargas
> históricas. **Escribo las dos en vez de elegir una:** cualquiera sirve para
> decidir (es higiene, no incidente), y fijar un número que no he verificado
> sería repetir exactamente el error que este bloque corrige. Quien implemente
> la fase 5 **mide otra vez y deja el comando escrito**.
>
> **Ninguna dependía de la RLS que `SECURITY DEFINER` desactiva.** Las 14 que
> tocan datos filtran por `operator_id` **explícitamente**, y todas hacen
> `get_operator_id()` → `RAISE 42501` **antes** de leer nada. Ninguna tiene
> bloque `EXCEPTION WHEN`, así que «murió con RAISE» significa «no persistió
> nada», medido y no supuesto.
>
> **MINA 1 — revocar `get_operator_id()` de `authenticated` tumba producción
> entera.** **61 políticas RLS sobre 38 tablas** la invocan en su
> `USING`/`WITH CHECK`. Medido: tras el `REVOKE`, un `SELECT` cualquiera de la
> aplicación da `permission denied for function get_operator_id` — no devuelve
> cero filas, **falla**. La fase 1 sí revocó `FROM authenticated` en cinco
> funciones; aplicar ese mismo reflejo aquí es un incidente.
> **Regla: sobre `get_operator_id()` y `get_current_user_role()`, revocar sólo
> `PUBLIC` y `anon`. JAMÁS `authenticated`.**
> (Para `anon` no hay riesgo simétrico: no tiene `SELECT` de tabla, así que la
> política nunca llega a invocar la función.)
>
> **MINA 2 — `get_operator_id()` es la única de las 16 SIN `SET search_path`.**
> No es explotable hoy (`anon` y `authenticated` no tienen `CREATE` sobre
> `public`, medido, y el cuerpo cualifica `public.users`/`auth.uid()`). Pero es
> **el guard de 10 de las 16 y de las 61 políticas**. Si una migración futura
> concede `CREATE` en `public`, o un esquema de extensión precede a `public`,
> esto pasa de higiene a bypass de autenticación en un paso.
> **Es la corrección de una línea con mejor relación coste/riesgo del informe.**
>
> **Lo que esta fase compra, dicho con precisión:** que el ACL deje de depender
> del cuerpo. Hoy las 14 están **a una línea** de una fuga cross-tenant
> completa — borrar el `IF v_operator IS NULL THEN RAISE` en un
> `CREATE OR REPLACE` (justo lo que pasa al usar la definición *original* en
> vez de la última) reabre `delete_minted_carton` a un llamante anónimo con
> sólo el UUID del bulto.
>
> **Dos guards que no hacen lo que dicen, dos líneas cada uno:**
> - `get_enabled_modules_for_operator(NULL)` **esquiva su propio `RAISE`**:
>   `NULL IS DISTINCT FROM NULL` es `FALSE`. Devuelve `{}` en vez de
>   `access denied`. No filtra nada, pero es el patrón que alguien copiará mal.
> - `get_manifest_label_data` devuelve `0 rows` cross-tenant en vez de `42501`
>   — un `0 rows` no distingue «bloqueado» de «no hay datos», que es la trampa
>   que este spec ya documentó con `map_comuna_alias`.
>
> **Para la fase 4 (el check automático):** debe añadir
> `has_schema_privilege(rol, nspname, 'USAGE')` y excluir
> `prorettype = 'trigger'::regtype`. Sin lo primero da falsos positivos
> (`authenticative.is_user_authenticated` tiene ACL abierto y muere con
> `permission denied for schema`); sin lo segundo cuenta los 18 triggers, que
> mueren con `trigger functions can only be called as triggers`. **Y su test
> necesita control positivo**: en la auditoría, 6 de 16 sondas «morían» también
> para el dueño legítimo hasta rehacerlas — no probaban nada.
>
> **Los 16 tienen consumidores exclusivamente bajo
> `apps/frontend/src/app/app/**`** (área autenticada tras el middleware);
> ninguno llama sin sesión. Verificado por grep, no asumido — así que el
> `REVOKE` no rompe ningún camino vivo.


**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP en `packages/database/supabase/tests/`

Las 17 funciones con guard efectivo pero sin `REVOKE` nunca aplicado (`add_manifest_to_route`, `cancel_pickup_route`, `close_pickup_route`, `complete_route_reception`, `delete_minted_carton`, `disable_module_for_operator`, `enable_module_for_operator`, `expand_carton`, `get_current_user_role`, `get_enabled_modules_for_operator`, `get_manifest_label_data`, `get_module_audit_for_operator`, `get_operator_id`, `get_route_reception_snapshot`, `list_operators_with_module_state`, `mark_manifest_labels_printed`, `remove_manifest_from_route`). Sin riesgo activo — cada una falla limpio ante `anon` hoy — pero dejar el ACL real coherente con la intención de cada función es higiene que cierra la clase de "hoy no hay guard porque alguien lo olvidó" antes de que ocurra, no después. Baja prioridad, sin fecha — se puede tomar en cualquier momento sin coordinar con nada más de este spec.

**Recuento re-medido en la implementación (no heredado de las dos cifras sin reconciliar de arriba): 16, no 17.** Comando y resultado — contra un contenedor pgTAP propio (`PGTAP_LOCAL_CONTAINER=spec88f5-pg`, nunca `spec52-pg`), levantado desde `origin/main` con las fases 1-3 de este spec ya aplicadas:

```sql
SELECT count(*) FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND has_schema_privilege('anon', n.nspname, 'USAGE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
    WHERE d.objid = p.oid AND d.deptype = 'e'
  );
-- => 16
```

`complete_route_reception` de la lista de 17 de arriba ya no pertenece a este conjunto: tiene hoy una tercera firma en vivo, `(uuid,text,jsonb)` (no la `(uuid,text)` que esa lista todavía nombra), con ACL ya cerrado — `postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres`, sin PUBLIC ni `anon` — confirmado con `aclexplode` contra el objeto real, no asumido. El recuento de 17 que el otro agente dejó sin reconciliar usaba la lista estática de la tabla de este spec, no el ACL en vivo — el mismo tipo de cifra propagada sin verificar que esta spec ya corrigió dos veces antes (34→39, 13→10).

**Implementado:**

- `packages/database/supabase/migrations/20261002000001_spec88_fase5_defense_in_depth.sql`
  — `REVOKE ALL ... FROM PUBLIC` + `REVOKE ALL ... FROM anon` sobre las 16
  (`authenticated` intacto en las 16, incluidas `get_operator_id`/
  `get_current_user_role` — **MINA 1** respetada explícitamente, con
  comentario y verificación `DO` block dedicados). `get_operator_id` gana
  `SET search_path = public, pg_temp` (**MINA 2**), plantilla = su última
  `CREATE OR REPLACE` real (`20260216170542_create_users_table_with_rbac.sql`
  — no `20260209000001_auth_function.sql`, la original). Dos correcciones de
  guard, ambas `CREATE OR REPLACE` sobre la plantilla más reciente:
  `get_enabled_modules_for_operator` ahora también falla cuando
  `p_operator_id IS NULL` (antes: `NULL IS DISTINCT FROM NULL` = `FALSE`
  esquivaba el `RAISE`); `get_manifest_label_data` ahora lanza `42501`
  cuando el manifest **existe** pero pertenece a otro operador — un
  manifest inexistente sigue devolviendo 0 filas (eso sí es "no hay datos").
- `packages/database/supabase/tests/spec88_fase5_defense_in_depth.test.sql`
  — pgTAP, `plan(68)`. `has_function()` antes de cada bloque de `aclexplode`
  (patrón `spec88_fase1_revoke_anon.test.sql:10-14`), assert explícito de
  que `authenticated` sobrevive en las 16 (no sólo que PUBLIC/anon se
  fueron), dos pruebas de comportamiento para los guards corregidos, y una
  tercera confirmando que un manifest genuinamente inexistente sigue dando
  0 filas sin error. Excepción declarada al límite de 300 líneas, mismo
  motivo que `spec88_fase1_revoke_anon.test.sql` (partirlo por grupo rompe
  el `plan(N)` único que pgTAP exige por transacción).
- `packages/database/supabase/tests/spec53_package_labels_rls.sql` —
  actualizado: la aserción que codificaba el bug ("0 rows cross-tenant es
  correcto") ahora exige `42501`. Confirmado en rojo antes del cambio de
  comportamiento (falló exactamente en la línea del `RAISE` nuevo, por la
  razón correcta), verde después.

**TDD y mutation-testing, uno a uno (no en bloque) — 5 mutaciones, las 5 cazadas por la razón exacta esperada, restauradas entre cada una:**
1. Quitar `p_operator_id IS NULL OR` de `get_enabled_modules_for_operator` →
   falla exactamente en "did not raise — bypass not fixed" (RED confirmado
   también contra el estado pre-migración real, no sólo simulado).
2. Quitar el bloque `IF EXISTS (...) RAISE` de `get_manifest_label_data` →
   falla exactamente en "did not raise for a cross-tenant manifest".
3. Re-`GRANT ... TO PUBLIC` sobre `get_operator_id` → `not ok 2` (sólo esa
   aserción, 67/68 el resto).
4. `REVOKE ... FROM authenticated` sobre `get_operator_id` (simulando el
   reflejo de la fase 1 que el spec pide no repetir aquí) → `not ok 4`,
   "authenticated KEEPS EXECUTE" — la aserción que existe específicamente
   para detectar la MINA 1.
5. `CREATE OR REPLACE` de `get_operator_id` sin `SET search_path` → `not ok
   5`, la aserción de MINA 2 — y confirmado por separado que `CREATE OR
   REPLACE` preserva el ACL real (`authenticated` seguía con `EXECUTE` tras
   la mutación, sin necesidad de volver a `GRANT`), verificando en la
   práctica la regla del repo sobre `CREATE OR REPLACE` vs. `DROP FUNCTION`.
   Mutación de control adicional: re-`GRANT ... TO PUBLIC` sobre
   `delete_minted_carton` (uno de los 14, elegido para confirmar que el
   patrón repetido 14 veces no es vacuo) → `not ok 59`, sólo esa función.

**Regresión — sin `spec52-pg` compartido, contenedor propio, `up` desde cero
usando el archivo de migración real (no los `psql` manuales de la
mutation-testing):** 206 migraciones sincronizadas, 203 aplicadas (3 fallos
pre-existentes y ajenos a esta fase — `20250130165844_example_storage`,
`20260409000003_spec30_dashboard_rpcs`, `20260430000001_...storage_bucket`,
los tres reproducidos **antes** de escribir esta migración, contra el mismo
`origin/main` limpio, y documentados como fricción conocida entre el
`supabase/postgres` stock y el proyecto real — no algo que esta fase
introdujo). Suites corridas en verde tras el rebuild limpio:
`spec88_fase5_defense_in_depth` (68), `spec53_package_labels_rls` (1),
`spec88_fase1_revoke_anon` (64), `spec88_fase2_assert_operator_access_service_role`,
`spec88_fase3_custom_access_token_hook_acl`,
`spec88_assert_operator_access_internal_guard`,
`cross_tenant_definer_rpcs_test`, `spec45_module_activation_test` — 153
aserciones/archivos en total, 0 fallos. Además, sin rebuild (mismo
contenedor, antes del rebuild final), se corrieron y pasaron todas las
suites que tocan las 16 funciones o sus vecinas directas:
`add_manifest_to_route_authz`, `rbac_users_test`,
`recogida_visible_when_carga_verified`, `rls_operators_test`,
`route_reception_snapshot_contract`, `spec47_close_route_zero_packages_fails`,
`spec47_pickup_routes_rls`, `spec52_open_route_reception`,
`spec52_start_route_text_wrapper`, `spec52_vehicle_constraints`,
`spec52_vehicles_rls`, `spec55_carton_expansion`, `spec61_cancel_route_authz`,
`spec61_pending_excludes_routed`, `spec62_snapshot_scans_ordering`,
`spec64_remove_manifest_from_route`, `spec66_ops_leader_route_authz`,
`spec72_phase5_actual_sequence`, `spec73_phase3_adjacency_management`,
`spec74_phase3_partially_staged`, `spec80_close_manifest`,
`spec80_fase3_manifest_documents`, `spec84_fase1_drivers_user_id`,
`spec85_discrepancies_rpcs`, `spec85_discrepancies_schema`,
`spec86_fase3_ops_control_discrepancies_view` — 106 aserciones/archivos,
0 fallos.

**Ronda 2 de review (PR #733) — mergeable con correcciones, todas cerradas
aquí:**

- **A — el failsafe del `DO` block sólo cubría `get_operator_id`, no
  `get_current_user_role` ni las otras 14.** Reproducido: revocar
  `authenticated` sobre `get_current_user_role` (simulando un prod donde
  esa función sólo tuviera el `EXECUTE` implícito de PUBLIC) dejaba el
  bloque decir "✓ complete" y `COMMIT`ear una caída total del RPC/guard.
  Arreglado: el `DO` block ahora es un `FOREACH` sobre las 16, cada una
  comprobada por `regprocedure` exacto (PUBLIC fuera, anon fuera,
  authenticated dentro) — no sólo `get_operator_id`. Re-verificado
  reproduciendo el mismo envenenamiento: la migración ahora aborta con
  `ERROR: get_current_user_role() lost its authenticated EXECUTE grant`,
  `ROLLBACK` limpio, `get_operator_id` sin tocar (confirmado con
  `aclexplode` tras el intento fallido).
- **B — "anon no tiene SELECT de tabla" era falso, medido.** `anon` tiene
  `SELECT` explícito sobre tablas de `public` (confirmado:
  `information_schema.role_table_grants`). **Corrección de ronda 3: la
  cifra "20" de esta misma línea también estaba inflada** — ver el bloque
  de ronda 3 más abajo para el desglose exacto (18 tablas en prod, de las
  cuales sólo 5 cambian de comportamiento). Revocar `EXECUTE` sobre
  `get_operator_id`/`get_current_user_role` cambia el comportamiento de esas
  5 tablas para `anon`/JWT expirado — de "0 rows silencioso" (la política
  RLS obtenía NULL y filtraba todo) a "42501 permission denied" (la función
  falla antes de que la política pueda evaluar nada). No es una fuga; es un
  comportamiento distinto (500 en vez de lista vacía). Ningún camino vivo
  depende de la respuesta silenciosa — confirmado por el reviewer: el
  lector de `operators` en `apps/frontend` está condicionado a
  `enabled: !!operatorId`, los escritores de `audit_logs` corren como
  `service_role`, y no hay uso de la clave anónima en
  `apps/worker`/`apps/agents`/edge functions.
- **C — contrapartida del oráculo de `get_manifest_label_data` documentada,
  no presentada como mejora gratis.** Añadido al comentario de la migración:
  un `authenticated` de A ahora distingue "existe y es de B" (42501) de
  "no existe" (0 rows), donde antes ambos casos eran indistinguibles.
  Aceptado porque `p_manifest_id` es un UUIDv4 no enumerable.
- **D — la aserción de MINA 1/2 era ciega a overloads.** Filtraba por
  `proname` sin argumentos: un overload con su propio grant satisfaría el
  check aunque la firma real lo hubiera perdido, y la aserción de
  `search_path` reventaba con `more than one row returned by a subquery` en
  cuanto existiera un segundo overload — mismo patrón que
  `start_pickup_route` en fase 1. Arreglado: todas las 68 aserciones del
  test (y el `DO` block de la migración) ahora filtran por
  `p.oid = 'public.f(...)'::regprocedure`, nunca por `proname`. Mutation-
  verificado creando un segundo overload real de `get_operator_id(uuid)`
  en el contenedor: el test sigue en 68/68 verde (no revienta con
  "more than one row"), y tras borrarlo sigue verde — confirma que la
  reescritura no es sólo cosmética.

Regresión tras las cuatro correcciones — mismo conjunto de suites que antes,
mismo contenedor propio, rebuild limpio desde el archivo de migración real:
`spec88_fase5_defense_in_depth` (68), `spec53_package_labels_rls` (1),
`spec88_fase1_revoke_anon` (64), `spec88_fase2_assert_operator_access_service_role`,
`spec88_fase3_custom_access_token_hook_acl`,
`spec88_assert_operator_access_internal_guard`,
`cross_tenant_definer_rpcs_test`, `spec45_module_activation_test` — 153
aserciones/archivos, 0 fallos.

**Ronda 3 de review (PR #733, mergeado — este seguimiento va en PR aparte,
sin auto-merge) — aprobado, cambió el veredicto de despliegue de "no hoy" a
"sí" precisamente por el bucle sobre las 16. Tres hallazgos, cerrados aquí:**

- **La cifra de la corrección de ronda 2 seguía inflada — quinto caso de
  este spec, y esta vez mío.** Medido tabla por tabla, no de nuevo por
  cantidad de filas de `role_table_grants`: de las tablas con `SELECT` de
  `anon`, sólo **5** pasan de "0 filas" a "42501" al revocar
  `get_operator_id`/`get_current_user_role`
  (`operators`, `audit_logs`, `return_receptions`, `return_reception_scans`,
  `dashboard_monthly_rollup` — confirmado por sus políticas RLS en
  `pg_policies.qual` invocando alguna de las dos funciones); 2 más cambian
  de un error a otro (mensaje distinto, mismo resultado); las **13**
  restantes no cambian en absoluto porque sus políticas no invocan estas
  funciones. Y el "20" original tampoco era la cifra de producción: incluye
  3 vistas de PostGIS y 2 de pgTAP — pgTAP no está instalado en prod, así
  que ahí son **18**, no 20. Corregido el comentario de la migración y el
  bullet B de ronda 2 arriba, con las cifras exactas en vez de una única
  cifra total que sonaba medida pero mezclaba tres cosas distintas.
- **`COMMENT ON FUNCTION public.get_operator_id` sin `()` — la única línea
  de la migración sin cualificar la firma.** Con un overload presente, la
  migración moriría ahí (línea de `COMMENT`), antes de llegar al `DO` block
  que existe para blindar exactamente ese escenario — falla seguro hoy
  (no hay overload), pero es la función de la que depende todo lo demás.
  Arreglado: `COMMENT ON FUNCTION public.get_operator_id()`. Verificado
  creando un overload real `get_operator_id(uuid)` en el contenedor: la
  migración corre limpia de principio a fin (`COMMIT`, `NOTICE: ✓ ...
  complete`) con el overload presente.
- **El mensaje de error del `FOREACH` arrastraba el paréntesis de MINA 1
  (61 políticas RLS) a las 16, no sólo a las 2 que lo justifican.** Un fallo
  real de, por ejemplo, `delete_minted_carton` habría impreso "...61 RLS
  policies" — manda a mirar políticas RLS ante un problema que no tiene
  nada que ver con RLS. Arreglado: el mensaje ahora es condicional —
  `get_operator_id`/`get_current_user_role` citan las 61 políticas
  explícitamente; las otras 14 dicen sólo "breaks its real caller
  outright". Mutation-verificado en las dos direcciones: envenenar
  `delete_minted_carton` da el mensaje genérico (sin RLS); envenenar
  `get_current_user_role` da el mensaje específico (con las 61 políticas).
- **Anotado, no cambiado:** el reviewer probó y descartó la sospecha de que
  quitar `p.proacl IS NULL OR` de las aserciones (ronda 2) las volviera
  vacuas — los `ALTER DEFAULT PRIVILEGES` de Supabase materializan el ACL
  completo en toda función nueva, así que `proacl` nunca queda `NULL` en
  este proyecto. Comentario añadido en el test para que nadie lo revierta
  "por precaución" sin volver a medirlo.

Regresión tras estas tres correcciones — mismo contenedor propio, rebuild
limpio desde el archivo de migración real: mismas 8 suites de antes, 153
aserciones/archivos, 0 fallos. Migración y test siguen bajo 300 líneas
(297 y 249).

**No cerrado.** Esta fase implementa y trae su propia evidencia de tests
(arriba), pero no trae `> Implementado por:`/`> Review:`/`> QA:` — eso
requiere una PR, un review de otra sesión, y confirmación de CI/deploy que
todavía no existen. Queda `[in_progress]`; el orquestador la cierra tras el
review y QA.

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
