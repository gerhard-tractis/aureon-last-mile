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

**Qué sí sirve, y es lo que propone este spec:** `current_setting('request.jwt.claims', true)` — el GUC que PostgREST fija por request con el JWT decodificado, o su ausencia — **combinado con el rol Postgres real de la conexión**, que sí es observable: `pg_has_role(session_user, 'service_role', 'member')` o, más directo, comparar `current_setting('request.jwt.claim.role', true)` (el claim `role` del JWT, que PostgREST también expone como GUC individual) contra `'service_role'` explícitamente, en vez de inferirlo por ausencia de `auth.uid()`.

Reescritura propuesta (a discutir en la fase que la implemente, no cerrada aquí):

```sql
IF auth.uid() IS NULL THEN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  RETURN;  -- service_role confirmado, no inferido por ausencia
END IF;
```

Esto cierra la fuga **incluso si alguien vuelve a olvidar un `REVOKE`** en una función futura que reutilice `assert_operator_access` como guard — es la razón por la que esta reescritura merece su propia fase en vez de conformarse con el `REVOKE` de ACL. El `REVOKE` cierra la puerta hoy; esto cierra la clase de bug.

**Riesgo de esta reescritura, por qué no va en fase 1:** si `current_setting('request.jwt.claim.role', true)` no está poblado exactamente como se espera en todo contexto real donde hoy `service_role` sí funciona (cron interno, worker de `apps/agents`, llamadas administrativas), la reescritura rompería esos caminos en silencio — el mismo tipo de "romper lo que hoy funciona" que el spec pide evitar. Necesita probarse contra cada llamante `service_role` real antes de aterrizar, no sólo contra el caso `anon`.

## `custom_access_token_hook` — por qué esto NO se puede arreglar a ciegas

**Medido en QA, no asumido:**

1. **GoTrue en QA no tiene ningún `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*` en su entorno.** `docker inspect supabase-qa-auth` no muestra ninguna variable de hook — sólo `GOTRUE_JWT_*`, `GOTRUE_DB_*`, etc. `packages/database/supabase/config.toml` sí declara el hook (`[auth.hook.custom_access_token]`, `enabled = true`), pero ese archivo es config del **Supabase CLI para desarrollo local** — no se traduce automáticamente a variables de entorno del contenedor GoTrue self-hosted que corre en la VPS. `packages/database/supabase/MANUAL_STEPS.md` lo confirma: el hook requiere registro manual vía "Authentication > Hooks" del Dashboard de Supabase, un paso que el self-hosted de este proyecto no tiene documentado como ejecutado.
2. **El mecanismo que realmente puebla el JWT en QA es un trigger, no el hook.** `sync_claims_to_auth_metadata()` — trigger `sync_claims_on_user_change` sobre `public.users`, confirmado `ENABLED` (`tgenabled = 'O'`) — escribe `operator_id`/`role`/`permissions` directo en `auth.users.raw_app_meta_data` en cada INSERT/UPDATE de `public.users`. GoTrue incluye `app_metadata` en el JWT sin necesitar ningún hook. **En QA, `custom_access_token_hook` es código muerto del lado del login** — nada lo invoca en el flujo real, sólo sigue siendo alcanzable por PostgREST como cualquier otra función.
3. **Si producción SÍ tiene el hook activo (no puedo confirmarlo — ver más abajo), quien lo invoca es GoTrue, con su propio rol de conexión (`supabase_auth_admin`, tomado de `GOTRUE_DB_DATABASE_URL`), nunca `anon` ni `authenticated`.** `supabase_auth_admin` existe como rol separado en QA (confirmado con `SELECT rolname FROM pg_roles`). Esto es la pieza central del argumento: **revocar el `EXECUTE` de `anon` (y de PUBLIC) sobre `custom_access_token_hook` no puede romper la llamada de GoTrue**, porque GoTrue nunca fue `anon` para empezar — hoy `supabase_auth_admin` tiene acceso sólo por heredar el grant implícito de PUBLIC (`=X`), nunca por un grant propio. **Lo que sí rompería el hook, si producción lo usa,** es revocar PUBLIC sin añadir, en la misma migración, un `GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin` explícito.

**Lo que no puedo confirmar sin credenciales de producción:** si el `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*` está activo ahí. Si lo está, la fase que toque esta función debe: (a) confirmarlo primero, con acceso real a producción — `docker inspect` del contenedor GoTrue de producción, exactamente como hice aquí en QA; (b) incluir el `GRANT ... TO supabase_auth_admin` en la misma migración que cualquier `REVOKE`; (c) probar el login end-to-end en QA primero (los seis usuarios `qa-*@qa.test`), y sólo después en producción, antes de dar la fase por cerrada. Esto no es una tarea de una línea — es la razón por la que el spec la separa del resto.

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
y `docker inspect <contenedor-auth-de-producción>` para el `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*`. Sin eso, cualquier fase que toque producción (fase 4, la del hook) tiene que empezar por esa comprobación — no puede asumir que QA y producción coinciden.

## Fases

Ordenadas por riesgo y por lo que se puede hacer sin arriesgar el login.

| Fase | Qué entrega | Toca `custom_access_token_hook`/`assert_operator_access` |
|---|---|---|
| **1 — REVOKE mecánico** | Cierra las tres fugas de datos que no dependen de reescribir `assert_operator_access`, más el ACL-que-miente y el overload huérfano | no |
| **2 — Reescritura de `assert_operator_access`** | Distingue `service_role` real de `anon` por rol de conexión, no por ausencia de `auth.uid()` | sí, ella misma |
| **3 — `custom_access_token_hook`** | Confirma producción, `GRANT` a `supabase_auth_admin`, prueba login end-to-end, sólo entonces `REVOKE` | sí |
| **4 — Check automático de ACL huérfana** | `check-migration-safety.sh` (spec-87 fase 5) detecta un overload sin `REVOKE` propio y un `REVOKE FROM anon` sin `REVOKE FROM PUBLIC` que le corresponda | no |
| **5 — Defensa en profundidad del resto** | `REVOKE` sobre las 17 funciones guardadas-pero-nunca-revocadas — sin urgencia, sin riesgo, cierre de higiene | no |

### Fase 1 — REVOKE mecánico `[in_progress]`

Cierra, con una sola migración (`CREATE OR REPLACE` no es necesario donde el cuerpo no cambia — sólo el ACL), las funciones donde revocar `anon`/PUBLIC no cambia ningún comportamiento legítimo, porque **ningún llamante legítimo del sistema es `anon`** sobre estas RPCs: el frontend siempre llama autenticado, y el patrón correcto (spec-80 fase 1b, spec-85 fase 2) es `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated [, service_role]; REVOKE ALL ... FROM anon;`.

**Funciones a cerrar en esta fase — 16 en total (corregido en round 1 de review, PR #675 — ver nota abajo):**
- Las 9 confirmadas sin guard, salvo `custom_access_token_hook` (fase 3, aparte): `archive_old_audit_logs`, `calculate_daily_metrics`, `calculate_dashboard_monthly_rollup`, `create_audit_logs_partition`, `get_active_routes_with_dispatches`, `get_unmatched_comunas`, `map_comuna_alias`, `set_config`, `validate_audit_logging`. De estas nueve, cinco (`archive_old_audit_logs`, `calculate_dashboard_monthly_rollup`, `create_audit_logs_partition`, `validate_audit_logging`, y `start_pickup_route(text)` más abajo) nunca tuvieron un `GRANT` explícito a `authenticated` — sólo el `=X` implícito que Postgres pone en toda función nueva. Un `REVOKE FROM PUBLIC`+`FROM anon` sin también `FROM authenticated` las deja invocables por cualquier sesión autenticada sin ningún guard — el `REVOKE` debe alcanzar a `authenticated` también en esas cinco.
- Las 5 con ACL-que-miente (guard salva, pero PUBLIC sigue expuesto): `add_dock_zone_adjacency_pair`, `open_route_reception`, `remove_dock_zone_adjacency_pair`, `reopen_pickup_route`, y **`start_pickup_route(uuid,uuid[])`** — la firma viva de `start_pickup_route`, mal clasificada originalmente como "ya cerrada" (ver fila corregida en la tabla arriba). Aquí sí hace falta `REVOKE ALL ... FROM PUBLIC` explícito.
- El overload huérfano: `start_pickup_route(text)`.
- `assert_operator_access(uuid)` misma: **no** tiene por qué ser invocable directamente por nadie fuera de otra función `SECURITY DEFINER` — no hay ningún llamante legítimo desde PostgREST. Revocar PUBLIC y `anon`/`authenticated` aquí (dejar sólo `service_role`, si acaso) no rompe nada porque las funciones que la usan como guard interno la llaman como su propio dueño (`SECURITY DEFINER`, ejecuta con privilegios del dueño de la función, no del rol PostgREST del llamante original) — confirmar esto en la implementación antes de aplicar, no asumirlo de esta prosa.

**Por qué `map_comuna_alias` y `set_config` no necesitan la reescritura de `assert_operator_access` (fase 2) para cerrarse:** ninguna de las dos usa `assert_operator_access` como guard — de hecho, no usan ningún guard. El `REVOKE` de ACL, sin más, ya es suficiente para las dos.

**Verificación de esta fase:** re-correr, contra QA, las tres fugas reproducidas arriba y el intento de `set_config('statement_timeout', ...)` como `anon` — las cuatro deben fallar con `permission denied for function` (Postgres, no la propia función) tras el `REVOKE`. Ningún flujo autenticado existente debe romperse — correr al menos un E2E que use `get_active_routes_with_dispatches` (buscar el consumer real en `apps/frontend` antes de escribir la migración) contra QA autenticado, antes y después.

**Excepción declarada al límite de 300 líneas por archivo:** `packages/database/supabase/tests/spec88_fase1_revoke_anon.test.sql` es SQL repetitivo — cada una de las 16 funciones necesita su propio `has_function()` + de 2 a 4 aserciones `aclexplode()` casi idénticas (PUBLIC, `anon`, a veces `authenticated`/`service_role`), y partirlo por grupo (A/B/C) rompería la sección `plan(N)` única que pgTAP exige por transacción. Se deja como un solo archivo en vez de dividirlo artificialmente.

### Fase 2 — Reescritura de `assert_operator_access` `[in_progress]`

Implementa la distinción `service_role` real vs. `anon`/ausencia de sesión, propuesta en la sección de diseño arriba (`current_setting('request.jwt.claim.role', true) = 'service_role'`, no ausencia de `auth.uid()`). Requiere:
- Inventariar cada llamante `service_role` real de `assert_operator_access` (directo o vía `get_active_routes_with_dispatches`/`get_unmatched_comunas`) — grep en `apps/agents`, `apps/frontend/src/app/api`, cualquier cron/worker — y confirmar que cada uno de verdad manda una conexión cuyo JWT claim `role` es `service_role` antes de fiarse de la reescritura.
- Probar contra QA con ambos roles: `service_role` real (debe seguir pasando, cross-tenant intencional) y `anon` (debe fallar con 42501, no con un `RETURN` silencioso).
- Esta fase **no depende** de la fase 1 — puede ir en paralelo, pero conceptualmente cierra la clase de bug que la fase 1 sólo tapa función por función.

**Desviación deliberada de la propuesta literal del spec, confirmada antes de escribir la migración:** el snippet de diseño arriba usa `current_setting('request.jwt.claim.role', true)` — el GUC individual heredado del modo "legacy" de PostgREST. `infra/supabase-qa/docker-compose.yml` fija `PGRST_DB_USE_LEGACY_GUCS: "false"` para el contenedor `rest`; con eso, PostgREST **nunca** puebla `request.jwt.claim.*` — sólo el GUC JSON único `request.jwt.claims`, que es exactamente lo que ya lee `auth.uid()` (`request.jwt.claims::json->>'sub'`, definición estándar de Supabase) y lo que ya usa este mismo repo para leer `role` en RLS (`20260413000004_spec33_pickup_points_write_rls.sql`). Usar el GUC literal del spec habría dejado la comprobación siempre en `NULL` — cerrando el paso a **todo** llamante `service_role`, no sólo a `anon` — reproduciendo la misma clase de bug un nivel más abajo. La migración usa `current_setting('request.jwt.claims', true)::jsonb ->> 'role'` en su lugar; la razón queda documentada en el propio archivo de migración y en el test.

**Inventario de llamantes `service_role` reales — hecho, resultado: cero.** `assert_operator_access` sólo se invoca desde `get_active_routes_with_dispatches` y `get_unmatched_comunas` (confirmado con `git grep -n "PERFORM public.assert_operator_access"` sobre todas las migraciones). Los únicos consumidores reales de esas dos RPCs en todo el repo (`git grep`/`grep -rl` sobre `apps/agents`, `apps/worker`, `apps/frontend/src/app/api`, `packages/database/supabase/functions`, `apps/frontend/supabase/functions`, `scripts/*.mjs`, `n8n/workflows`) son `apps/frontend/src/hooks/useActiveRoutes.ts` y `apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts`, ambos vía `createSPAClient()` — sesión de navegador autenticada, nunca `service_role`. **No existe hoy ningún llamante `service_role` real de este guard** en el código que se despliega; la reescritura no puede romper un camino que no existe, y sólo cierra la posibilidad de que uno futuro se confíe en falso. Detalle completo en el header de `20260913000008_spec88_fase2_assert_operator_access_service_role.sql`.

**Probado contra QA con ambos roles:** no se probó contra QA en vivo (sin credenciales VPS en esta sesión de implementación) — probado contra el contenedor `spec52-pg` local (pgTAP), que replica la config real de PostgREST (`PGRST_DB_USE_LEGACY_GUCS=false`) por eso mismo motivo de diseño. `service_role` con `role` confirmado en el JWT sigue pasando cross-tenant (`spec88_fase2_assert_operator_access_service_role.test.sql`, tests 4-5); `anon`/sin sesión/`role:anon` ahora falla con 42501 en vez de `RETURN` silencioso (mismo archivo, tests 1-3, y `cross_tenant_definer_rpcs_test.sql` TEST 5, reescrito porque codificaba la premisa vieja "sin `sub` = service-role"). Quien mergee y despliegue a QA real debe confirmar el mismo comportamiento ahí antes de dar la fase por cerrada — ver `> QA:` pendiente.

### Fase 3 — `custom_access_token_hook` `[blocked]`

Bloqueada en el usuario: necesita a alguien con acceso a producción para correr, contra el contenedor GoTrue de producción, el mismo `docker inspect` hecho aquí contra QA. Sin esa confirmación no se puede saber si `GRANT EXECUTE ... TO supabase_auth_admin` es necesario antes del `REVOKE`, ni si el `REVOKE` en sí es seguro.

Una vez confirmado:
- Si producción **no** usa el hook (igual que QA): `REVOKE ALL ... FROM PUBLIC; REVOKE ALL ... FROM anon;` sin más — cierra la fuga #2 sin riesgo.
- Si producción **sí** lo usa: la misma migración debe incluir `GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin` antes del `REVOKE FROM PUBLIC`, y el login de los seis usuarios QA (`qa-*@qa.test`) debe probarse end-to-end **antes** de que la migración llegue a producción — no basta con que el RPC en sí devuelva `permission denied` a `anon`; el criterio de aceptación real es "un login normal sigue emitiendo un JWT con `operator_id`/`role`/`permissions` correctos".

### Fase 4 — Check automático de ACL huérfana `[pending]`

Extiende `scripts/check-migration-safety.sh` (spec-87 fase 5, en construcción en paralelo — coordinar antes de duplicar trabajo) con dos chequeos nuevos, ambos basados en lo encontrado aquí:

1. **Overload sin `REVOKE` propio.** Si una migración crea `CREATE [OR REPLACE] FUNCTION public.f(tipos_A)` y existe, en cualquier migración anterior, un `REVOKE ... ON FUNCTION public.f(tipos_B)` con `tipos_A ≠ tipos_B`, advertir que el `REVOKE` histórico no cubre la firma nueva. Éste es exactamente el bug de `start_pickup_route`.
2. **`REVOKE ... FROM anon` sin `REVOKE ... FROM PUBLIC` que lo acompañe**, dentro de la misma o de una migración posterior sobre la misma firma. Éste es el bug de `add_dock_zone_adjacency_pair`/`open_route_reception`/`remove_dock_zone_adjacency_pair`/`reopen_pickup_route`. El check no puede saber si PUBLIC *sigue* expuesto sin consultar el ACL real (algo que un check estático sobre el SQL de las migraciones no puede hacer con certeza — dos migraciones pueden aplicar `REVOKE FROM PUBLIC` y `GRANT ... TO PUBLIC` en cualquier orden) — por eso el check correcto no es "cada `REVOKE FROM anon` debe ir con un `REVOKE FROM PUBLIC` en la misma migración" (demasiado rígido, rompería patrones legítimos donde PUBLIC nunca tuvo el grant para empezar), sino "toda migración `CREATE [OR REPLACE] FUNCTION` nueva que declare guardar el resultado con `GRANT EXECUTE ... TO authenticated` sin ningún `REVOKE` en la misma migración debe fallar" — que es el chequeo que spec-80 fase 1b ya necesitó a mano y que `check-migration-safety.sh` puede aplicar mecánicamente sobre el SQL de cada migración nueva, sin necesitar el ACL en vivo.

### Fase 5 — Defensa en profundidad del resto `[pending]`

Las 17 funciones con guard efectivo pero sin `REVOKE` nunca aplicado (`add_manifest_to_route`, `cancel_pickup_route`, `close_pickup_route`, `complete_route_reception`, `delete_minted_carton`, `disable_module_for_operator`, `enable_module_for_operator`, `expand_carton`, `get_current_user_role`, `get_enabled_modules_for_operator`, `get_manifest_label_data`, `get_module_audit_for_operator`, `get_operator_id`, `get_route_reception_snapshot`, `list_operators_with_module_state`, `mark_manifest_labels_printed`, `remove_manifest_from_route`). Sin riesgo activo — cada una falla limpio ante `anon` hoy — pero dejar el ACL real coherente con la intención de cada función es higiene que cierra la clase de "hoy no hay guard porque alguien lo olvidó" antes de que ocurra, no después. Baja prioridad, sin fecha — se puede tomar en cualquier momento sin coordinar con nada más de este spec.

---

## Nota sobre el alcance de esta tarea

Esta spec **audita y planifica**. Ninguna fase se implementó — el encargo fue explícito: confirmar y escribir, no arreglar. Las cinco fases de arriba son el plan; la primera que se tome debe abrir su propia rama (`feat/spec-88-fase-1-...`), seguir TDD (`sql` como juez, vía `scripts/pgtap-local.sh`, ⚠️ contenedor compartido entre worktrees — comprobar que nadie más lo está usando antes de correr), y traer su propia evidencia de `> Implementado por:` / `> Review:` / `> QA:` antes de marcarse `[done]`.

## Deuda anotada, no arreglada en esta fase (round 1 de review, PR #675)

Dos hallazgos del review de fase 1 son deuda real, pero **fuera del alcance de un `REVOKE` mecánico** — se dejan escritos aquí para que nadie los reabra por accidente ni los confunda con un incendio activo:

- **El harness de pgTAP local es ciego a `not ok`.** `scripts/pgtap-local.sh` decide pass/fail con `grep -qE "ERROR:|^psql: error:"` sobre la salida de `psql` — un fichero de test que corre limpio pero cuyas aserciones fallan (`not ok`, sin `ERROR:` de Postgres) se reporta como PASS igual. Medido: de 73 ficheros en `packages/database/supabase/tests/`, sólo **6** usan aserciones pgTAP (`plan()`/`is()`/`finish()`) — el resto usa `RAISE EXCEPTION`, que sí produce `ERROR:` y sí lo detecta el harness. Los 6 ficheros pgTAP se corrieron a mano para esta fase y **son genuinamente verdes** (confirmado contando `ok`/`not ok` en la salida cruda de `psql`, no en el resumen del script). No es un incendio — es una laguna de cobertura del harness que merece su propia spec (arreglarla aquí sería tocar infraestructura compartida por otras 5 fases de tests pgTAP fuera del alcance de spec-88).
- **`set_config(text,text,boolean)` con `is_local = true` es código muerto bajo PostgREST, y ya lo era antes de esta fase.** `createSSRClient()` en el frontend llama a `setSupabaseSessionIp` (`apps/frontend/src/lib/utils/ipAddress.ts`), que invoca este RPC vía `set_config(..., true)`. PostgREST abre una transacción nueva por cada petición HTTP — el `SET LOCAL` que produce `is_local = true` muere al terminar esa transacción, antes de que la query que se suponía debía auditar (el `INSERT` en `audit_logs` de esa misma request) llegue a correr. La llamada está envuelta en `try/catch` con `console.warn`, así que no rompe nada — simplemente no hace lo que su nombre sugiere. Esta fase **no** lo introduce ni lo arregla: cerrar `set_config` a `authenticated` (lo que sí hace esta migración) no cambia este comportamiento. Se anota explícitamente para que nadie, al ver el guard cerrado, decida "arreglar" esto reabriendo el grant a `anon` — el bug es la transacción de PostgREST, no el ACL.
