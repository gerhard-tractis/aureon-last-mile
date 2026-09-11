# Spec-93: Paridad QA ↔ producción — que el verde de QA signifique algo

> **Related:** spec-92 (el gate de producción diferenciado — todavía en la rama `feat/spec-92-gate-prod-diferenciado`, sin mergear; el gate descansa **entero** sobre la premisa que este spec pone a prueba), [spec-88](spec-88-anon-security-definer-audit.md) (fase 3 es la instancia medida que abre este spec), [spec-57](spec-57-qa-gate-before-production.md) (el gate original y el clic humano que spec-92 retira), [spec-87](spec-87-desbloquear-produccion.md) (`verify-prod-migrations`, el precedente de un check que compara dos entornos)

**Status:** completed
**Pendiente de una persona (no bloquea el `completed`):** el deploy a producción de #776 está parado en `approve-production` — hasta que se apruebe, `qa-prod-parity` seguirá rojo con **una** divergencia no declarada (`cron_job/archive_old_audit_logs`), que es el comportamiento correcto. Y #777 (correcciones a spec-92) no puede auto-mergear porque su base es la rama abierta de spec-92 (#716).
**Verify:** unit + e2e
**Downstream:** spec-92 (aún sin mergear, ver Related) — si este spec encuentra superficies de divergencia además de la de auth, la tabla «clase de cambio → cobertura» de spec-92 tiene que crecer con ellas
**Depende de:** ninguno. Puede empezar hoy.

_Date: 2026-09-09_

> **Este spec se trabaja en una sesión dedicada, por un orquestador exclusivo.**
> No se despacharon implementadores desde la sesión que lo escribió.

---

## El problema

Estamos retirando el clic humano previo a producción (spec-92) con este
argumento: *la migración ya se prueba en QA antes de que producción sea
alcanzable; la red de seguridad ya existe y es más fuerte que un clic.*

El argumento es correcto **sólo en la medida en que QA ejercite lo que
producción ejecuta**. Hoy hay al menos una clase de cambio donde no lo hace,
y se descubrió por accidente, en un review, no por un control.

### La instancia medida (2026-09-09, review de spec-88 fase 3)

`custom_access_token_hook` es un hook de GoTrue: producción lo invoca en cada
login para inyectar `operator_id`, `role` y `permissions` en el JWT. El PR
#710 cambia su ACL y afirmaba que `e2e-qa` lo cubre porque «hace un login
real vía GoTrue, ejercitando este hook tal cual lo hace producción».

**No lo ejercita, y son dos fallos independientes:**

1. **QA no registra el hook.** `infra/supabase-qa/docker-compose.yml:152-189`
   no declara ninguna variable `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*`.
   `git grep -i hook -- infra/` devuelve **cero** coincidencias. El propio
   spec-88 lo dice en `:191-193`: *«En QA, `custom_access_token_hook` es
   código muerto del lado del login — nada lo invoca en el flujo real.»*
2. **Y aunque lo registrara, el e2e no miraría.**
   `apps/frontend/e2e/support/spec52-fixture.ts:346-364` — `signIn()` rellena
   el formulario y hace `waitForURL(/\/app(\/|$)/)`. **Nunca lee el JWT.**
   Como el cuerpo del hook termina en
   `EXCEPTION WHEN OTHERS THEN RAISE WARNING ...; RETURN event;`
   (`20260312190110_fix_hook_role_overwrite.sql:60-63`), **un hook degradado
   emite un token sin claims y el login sigue siendo exitoso**. El e2e
   comprueba exactamente la mitad que hace falta.

En palabras del review: **«El pipeline no impone nada aquí; sólo lo parece.»**

### La segunda instancia, medida al intentar cerrar la primera

Al arreglar lo anterior apareció una divergencia **más profunda y más
general**, y ésta no es de configuración sino de despliegue:

**`deploy-qa.sh` no recrea el contenedor `auth` nunca.** Sólo hace
`docker compose ... up -d functions` (`infra/supabase-qa/deploy-qa.sh:255-256`).
El `up -d` completo vive en `setup-qa.sh:156`, que es el bootstrap manual de
una sola vez y que `deploy-qa.sh` **no invoca**. El propio comentario de
`deploy-qa.sh:248-252` explica por qué esto importa —un `restart` reutiliza
la configuración que el contenedor ya tenía— pero la lección se aplicó sólo
a `functions`.

Consecuencia: **un cambio en `infra/supabase-qa/docker-compose.yml` puede
mergearse, desplegarse y no llegar nunca al servicio que modifica.** El
entorno declarado y el que corre divergen en silencio, y el siguiente que
lea el compose creerá que QA está configurado así.

Esto generaliza el problema: no basta con que QA *declare* las superficies de
producción — el despliegue de QA tiene que **aplicarlas**. La fase 1 tiene
que medir contra el contenedor vivo, nunca contra el YAML.

Un tercer detalle del mismo review, para la fase 4: `sql_tests_check`
(`deploy-qa.sh:466`) es **advisory** — un pgTAP en rojo contra QA no tumba el
deploy. La única red que bloquea de verdad hoy es `e2e-qa`.

Eso es lo peligroso. No es que falte cobertura — es que la cobertura *se
declara* y nadie la mide, así que el siguiente que lea el PR hereda la
afirmación. Es el mismo patrón que un check verde que no vio nada.

### Por qué importa más ahora que ayer

Con el clic humano, una divergencia QA↔prod costaba un susto: alguien miraba
antes de aprobar. Sin el clic, **la divergencia es el único guardián que
queda, y es invisible**. Cada superficie de configuración que exista en
producción y no en QA es un agujero por el que un cambio llega a producción
sin haber sido ejecutado nunca.

La pregunta que este spec tiene que contestar no es «¿está QA bien
configurado?», es: **¿qué superficies de configuración de producción no
existen en QA, y qué clase de cambio pasa por cada una sin ser ejercitada?**

---

## Alcance

**Paridad de configuración, no de datos.** QA no tiene que tener los datos de
producción — tiene que tener sus *superficies*: hooks, roles, extensiones,
rutas, buckets, variables de entorno de las funciones, jobs. Un cambio se
prueba contra la forma del entorno, no contra su contenido.

**Fuera de alcance:** el volumen de datos. Los backfills sólo revientan por
tamaño en producción (~112k despachos / ~61k bultos); ése es un problema
distinto y no se resuelve haciendo QA más grande.

---

## Fases

### Fase 1 — Inventario medido de divergencia `[done]`

> Implementado por: **el orquestador** — la medición necesita SSH a la VPS y un `workflow_dispatch` con los secretos de producción, capacidades que un implementer no tiene. Ramas `feat/spec-93-fase-1-inventario` (#755), `docs/spec-93-fase-1-columna-produccion` (#760), `fix/spec-93-measure-postgrest-endpoint` (#758), `fix/spec-93-measure-pooler-from-api` (#763).
> Review: **sin review adversarial dedicado** — el entregable es una tabla de mediciones, y cada fila lleva escrito el comando que la produjo, que es su propia verificación. El hueco se declara en vez de maquillarse.
> QA: no aplica — esta fase no toca código de la aplicación. La medición se validó contra los entornos vivos: corrida `34539233402` (producción, ocho superficies en verde) y `docker inspect`/`psql` contra los contenedores de QA.
> Downstream: revisado spec-92 (PR #761) — su tabla de huecos crece con cinco clases de cambio nuevas y sus filas 1 y 2 cambian. Ver fase 5.

**Archivos:** `docs/specs/spec-93-paridad-qa-produccion.md` (la tabla del inventario vive aquí), `docs/qa-environment.md`

Enumerar, **midiendo contra los dos entornos, no leyendo el compose**, qué
superficies de configuración existen en producción y no en QA. Como mínimo:

- **Auth (GoTrue):** hooks registrados, proveedores, expiración del JWT.
  *Aquí ya sabemos la respuesta: divergen.*
- **Postgres:** extensiones instaladas, roles y sus pertenencias, GUCs
  relevantes (`pgrst.*`, `app.*`), `cron`/`pg_net` si aplica.
- **PostgREST / Kong:** esquemas expuestos, rutas, `max-rows`.
- **Storage:** buckets y sus políticas.
- **Edge functions:** cuáles están desplegadas y con qué variables.

Entregable: una tabla en este spec — superficie · producción · QA · ¿alguna
prueba la ejercita hoy?

**Regla de admisión: cada fila se llena con el resultado de un comando, y el
comando queda escrito en la fila.** Una fila leída de un fichero de
configuración no cuenta: el compose declara la intención, no el estado.

Producción es **sólo lectura**, y nunca por SSH ni `docker` (es Supabase
gestionado). QA es un entorno vivo compartido — no tocar los datos de Musan;
lo que sea consulta, en `BEGIN`/`ROLLBACK`.

---

#### Cómo se mide cada lado

Los dos entornos no se leen igual, y ésa es la razón de que este inventario
haya tardado en existir.

**QA** es autohospedado en la VPS: se mide por SSH contra el **contenedor
vivo**, nunca contra `docker-compose.yml`. La distinción no es teórica —
`docker inspect` mostró en su día el contenedor `auth` corriendo un mes con
una configuración que el compose ya no declaraba (fase 2, matiz 2).

```bash
ssh root@<VPS> "docker inspect <contenedor> --format '{{range .Config.Env}}{{println .}}{{end}}'"
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -d postgres -At -c '<SELECT>'"
```

**Producción** es un proyecto Supabase gestionado: no hay SSH ni `docker`. Sus
dos únicas lecturas son la Management API y una sesión `psql` por el pooler
IPv4, y las credenciales de ambas viven como secretos del pipeline. Por eso la
medición corre desde un workflow —
`.github/workflows/measure-prod-surfaces.yml`, PR #755, que copia la forma de
`prod-readonly-query.yml` (spec-87 fase 4). Se dispara con
`gh workflow run measure-prod-surfaces.yml` y vuelca las ocho superficies al
step summary.

#### El inventario

> **Columna «¿lo ejercita algo?»** — se refiere a `e2e-qa`, la única red que
> hoy bloquea de verdad un deploy (ver fase 4 sobre `sql_tests_check`).

Medido el 2026-09-10.

| # | Superficie | QA (medido) | Producción (medido) | ¿Lo ejercita algo? |
|---|---|---|---|---|
| 1 | Hook `custom_access_token_hook` | `ENABLED=true`, `URI=pg-functions://postgres/public/custom_access_token_hook` | `hook_custom_access_token_enabled: true`, mismo URI | **Sí** — `spec52-…spec.ts:97-99` exige `operator_id`/`role`/`permissions` en la **raíz** del JWT (fase 2, matiz 1) |
| 2 | Expiración del JWT | `GOTRUE_JWT_EXP=3600` | `jwt_exp: 3600` | No — pero **converge** |
| 3 | Proveedores de auth | `EXTERNAL_EMAIL=true`, `PHONE=false`, `ANONYMOUS=false` | `external_email_enabled: true`, `phone: false`, `anonymous: false` | Parcial — el login por email sí; que teléfono y anónimo estén apagados, nadie lo comprueba |
| 3b | **`disable_signup`** | `true` — registro cerrado | **`false`** — registro **abierto** | **No** — ⚠️ divergencia |
| 3c | **`mailer_autoconfirm`** | `true` — auto-confirma | **`false`** — exige confirmar por email | **No** — ⚠️ divergencia |
| 3d | **MFA TOTP** | no declarada → default de GoTrue | `mfa_totp_enroll_enabled: true`, `mfa_totp_verify_enabled: true` | **No** — ⚠️ divergencia |
| 3e | **Rotación de refresh tokens** | no declarada → default | `refresh_token_rotation_enabled: true`, `security_refresh_token_reuse_interval: 10` | **No** — ⚠️ divergencia |
| 4 | Extensiones instaladas | las 7 de prod **más `pg_net 0.20.3`** | `pg_cron`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `postgis 3.3.7`, `supabase_vault`, `uuid-ossp` | Indirecto — `postgis` lo usan 9 migraciones. ⚠️ `pg_net` **sólo existe en QA**, y no lo usa ninguna migración |
| 5 | `pgtap` | **NO instalada** (disponible 1.3.3) — la fase 3 la instala | **NO instalada**, y así debe seguir: es una extensión de testing | **No, y peor:** ver «El hallazgo 1» |
| 6 | `pg_graphql` | **NO instalada** (disponible 1.5.11) | **NO instalada** — converge | No — los dos exponen `graphql_public` sin la extensión detrás |
| 7 | Roles y pertenencias | 16 roles. Extra: `supabase_functions_admin` (runtime de edge autohospedado) | 16 roles. Extra: `cli_login_postgres` | Indirecto — cada consulta del e2e pasa por RLS. Los dos extras se explican por la forma de cada entorno: **converge en lo que importa** |
| 8 | **GUCs de base y de rol** | `statement_timeout` (anon 3s, authenticated/authenticator 8s), `lock_timeout=8s`, `idle_in_transaction_session_timeout=60000`, `default_transaction_read_only`, los 4 `search_path`, `session_preload_libraries=supautils, safeupdate`, `app.settings.{jwt_exp,jwt_secret}` | **Lo mismo**, salvo `session_preload_libraries` (sin `supautils`) y `app.settings.jwt_secret` (ausente) | **No** — pero **converge**. Ver «El hallazgo 4 — RETIRADO»: la divergencia que este spec afirmó aquí era un error de medición |
| 9 | `cron.job` | **2** jobs, ambos `postgres`: `nightly-metrics`, `dashboard_monthly_rollup` | **3** — los dos de QA **más `archive_old_audit_logs`** (`0 2 * * *`, `postgres`) | **No** — el e2e no espera a las 02:00. ⚠️ un job que sólo corre en producción |
| 10 | PostgREST — esquemas y `max-rows` | `DB_SCHEMAS=public,graphql_public`, `MAX_ROWS=1000` | `db_schema: public,graphql_public`, `max_rows: 1000` | Parcial — los datos del e2e no rozan `max-rows` |
| 10b | **PostgREST — `extra_search_path`** | `public` | **`public, extensions`** | **No** — ⚠️ divergencia |
| 11 | Rutas de Kong | `/auth/v1/`, `/rest/v1/`, `/storage/v1/`, `/functions/v1/`, `/graphql/v1`, `/realtime/v1/`, `/analytics/v1` | **No comparable** — prod es el gateway gestionado, no Kong | Sólo `/auth/v1/` y `/rest/v1/` |
| 12 | Publicación `supabase_realtime` | **2 tablas**: `orders`, `dock_verifications` | **Las mismas 2** — converge exactamente | **No** — y la convergencia cambia el hallazgo 2 de divergencia a **bug de producto**, ver abajo |
| 13 | Buckets de storage | `files` (privado), `manifests` (privado, 10 MiB, imágenes) | **Idénticos** — converge | **No** — ningún e2e sube un fichero |
| 14 | Políticas de storage | 8 sobre `storage.objects` | **Las mismas 8** — converge | No |
| 15 | Edge functions desplegadas | `beetrack-webhook`, `dispatchtrack-route-poll`, `main` | `beetrack-webhook` (ACTIVE, `verify_jwt=false`, v30), `dispatchtrack-route-poll` (ACTIVE, `verify_jwt=true`, v12) | **No** — ningún e2e invoca `/functions/v1/`. `main` es el router del runtime autohospedado: **converge** |
| 16 | Variables del runtime de edge | `BEETRACK_WEBHOOK_SECRET`, `JWT_SECRET`, `SUPABASE_*`, `VERIFY_JWT` | **No comparable** — la Management API no expone los secretos de una function | No |

Comandos de la columna QA, para que cada fila sea reproducible:

```bash
# filas 1-3   (auth vivo, sin volcar valores secretos)
ssh root@<VPS> "docker inspect supabase-qa-auth --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -iE 'HOOK|EXTERNAL_|JWT_EXP|DISABLE_SIGNUP' | grep -viE 'secret|password|key'"
# filas 4-6
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \
  \"SELECT extname||' '||extversion FROM pg_extension ORDER BY 1;\""
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \
  \"SELECT name||' avail='||default_version FROM pg_available_extensions WHERE name IN ('pgtap','pg_graphql');\""
# fila 7
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \
  \"SELECT r.rolname||' memberof='||coalesce((SELECT string_agg(g.rolname,',' ORDER BY g.rolname) \
     FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid),'-') \
     FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\\_%' ORDER BY 1;\""
# filas 8-9
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \
  \"SELECT datname||' :: '||unnest(setconfig) FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase;\""
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \"SELECT jobid,jobname,username,schedule,active FROM cron.job;\""
# fila 10
ssh root@<VPS> "docker inspect supabase-qa-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SCHEMAS|MAX_ROWS|ANON_ROLE|EXTRA_SEARCH'"
# fila 11
ssh root@<VPS> "docker exec supabase-qa-kong grep -oE '/[a-z0-9._/-]+/v1[a-z0-9._/-]*' /usr/local/kong/kong.yml | sort -u"
# fila 12
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \
  \"SELECT pubname||' -> '||schemaname||'.'||tablename FROM pg_publication_tables ORDER BY pubname, schemaname, tablename;\""
# filas 13-14
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \"SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id;\""
ssh root@<VPS> "docker exec supabase-qa-db psql -U postgres -At -c \
  \"SELECT tablename,policyname,cmd,roles FROM pg_policies WHERE schemaname='storage' ORDER BY tablename, policyname;\""
# filas 15-16
ssh root@<VPS> "docker exec supabase-qa-edge-functions ls /home/deno/functions"
ssh root@<VPS> "docker inspect supabase-qa-edge-functions --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -E 's/=.*//' | sort"
```

#### El bloqueo que hubo, y cómo se salió de él (histórico)

Las tres superficies que lee la **Management API** (auth, PostgREST, edge
functions) se midieron sin problema. Las cinco que necesitan **`psql`** —
extensiones, roles, GUCs/`cron`, realtime, storage — no, y el motivo no es de
este spec:

```
psql: error: connection to server at "aws-0-sa-east-1.pooler.supabase.com",
port 6543 failed: FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found
```

`scripts/resolve-supabase-pooler-host.sh` **construye** el host a partir de la
región (`aws-0-${region}.pooler.supabase.com`) en lugar de leerlo. El prefijo
`aws-0-` no es universal, y para este proyecto es incorrecto.

**Esto no lo arregla spec-93, y no debe arreglarlo por su cuenta.** Ya está
arreglado en el **PR #753** (`fix/pooler-host-from-api`, de otra sesión), que
resuelve la conexión desde la Management API en vez de plantillar la región, y
que toca ese script y los dos workflows de producción. Duplicarlo aquí sería
resolver el mismo bug dos veces y con conflicto seguro.

Dato que conviene tener escrito: **la vía `psql` contra producción no ha
funcionado nunca en este repo.** `prod-readonly-query.yml` no se había
disparado ni una vez, y las tres corridas de
`prod-backfill-loaded-route-id.yml` (2026-09-10) fallaron todas con este mismo
error. El workflow existía, se leía como capacidad disponible, y no lo era —
otra instancia del patrón que este spec persigue, esta vez en la propia
herramienta de medir.

**Resuelto sin esperar a #753.** La regla de `docs/specs/CLAUDE.md` — el
orquestador comprueba si él mismo tiene la capacidad antes de trasladar un
bloqueo — aplica también cuando el bloqueo se lo pone él. `measure-prod-surfaces.yml`
no tenía por qué usar ese script: pregunta
`GET /v1/projects/{ref}/config/database/pooler` por su cuenta (#763), que
devuelve el `connection_string` ya montado. Sin duplicar el arreglo de #753 y
sin tocar el fichero que #753 reescribe.

De paso, el **puerto** y el **usuario** dejaron de estar hardcodeados
(`6543`, `postgres.<ref>`) y también se leen: suponer en vez de leer es la
clase de error exacta que costó las cuatro corridas de arriba.

Corrida completa y verde: `34539233402`.

#### Lo que la columna de producción ya cambió

**La fila 1 converge, y ahora está medida en los dos lados.** La fase 2 cerró
la divergencia de auth de verdad: mismo hook, mismo URI, misma expiración.

**Y aparecieron cinco divergencias que nadie buscaba**, todas en superficies
que el spec sí había nombrado pero que nadie había medido:

| Ajuste | Producción | QA | Qué clase de cambio queda sin cobertura |
|---|---|---|---|
| `disable_signup` | `false` — abierto | `true` — cerrado | Todo el flujo de alta: en producción se puede registrar, en QA no existe |
| `mailer_autoconfirm` | `false` | `true` | La confirmación por email. En QA el usuario nace confirmado |
| `mfa_totp_*` | `true` | no declarada | Cualquier cosa que toque MFA/AAL |
| `refresh_token_rotation_enabled` | `true` (reuse 10s) | no declarada | Refresco de sesión y reuso de token |
| PostgREST `extra_search_path` | `public, extensions` | `public` | Una referencia **sin cualificar** a algo del esquema `extensions` resuelve en producción y falla en QA — o al revés, pasa QA y se comporta distinto en prod |

Las dos primeras se refuerzan entre sí: en producción el registro está
**abierto y exige confirmar por email**; en QA está **cerrado y auto-confirma**.
Un cambio en el alta de usuarios llega a producción sin haberse ejecutado
nunca contra esa forma.

La última es la más silenciosa: `extra_search_path` no rompe nada de golpe,
cambia **cómo se resuelve un nombre sin cualificar**.

**Ninguna se cierra en la fase 1.** Medir es esta fase; cerrar o aceptar es la
fase 3, y aceptar sin haber medido el otro lado es justo lo que el spec
prohíbe.

#### Un hallazgo lateral: `whatsapp-webhook` no está desplegada en ningún sitio

`apps/frontend/supabase/functions/whatsapp-webhook` existe en el repo. Producción
tiene desplegadas dos functions y QA tres (las mismas dos más `main`, el router
del runtime autohospedado). **`whatsapp-webhook` no está en ninguno de los dos.**
No es una divergencia QA↔prod — es código que no corre en ninguna parte, y va
anotado aquí para que quien lo lea no asuma que está vivo.

#### El hallazgo 4 — RETIRADO. Era un error de medición mío, del tipo exacto que este spec persigue

> **Corrección (2026-09-10, posterior).** Este spec afirmó que producción tenía
> `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` y
> `safeupdate` y que **QA no tenía ninguno**. **Es falso.** QA los tiene, y son
> prácticamente los mismos. La fila 8 **converge**.

**Cómo se produjo el error, porque importa más que el error.** La consulta con
la que medí QA era:

```sql
SELECT datname || ' :: ' || unnest(setconfig)
  FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid = s.setdatabase;
```

Sin `coalesce`. Los ajustes por rol a nivel de cluster tienen `setdatabase = 0`,
así que `datname` es **NULL** — y en SQL `NULL || ' :: ' || x` es NULL. Las
quince filas de QA salieron como **líneas en blanco**. Vi cuatro líneas vacías
en la salida y las leí como «QA no tiene nada».

La consulta de producción sí llevaba `coalesce(d.datname, '<cluster>')`, así que
esas mismas filas sí se imprimieron. **Comparé una salida completa contra una
mutilada y llamé divergencia a la diferencia.**

Es literalmente el patrón que este spec existe para cazar —una medición que no
midió, leída como un hecho— cometido por el propio inventario que lo persigue.
Y sobrevivió porque nadie revisó la fase 1: su línea de evidencia dice que no
hubo review adversarial porque «cada fila lleva escrito el comando que la
produjo». El comando estaba escrito, sí, y **era el comando equivocado**. Tener
el comando a la vista no sustituye a que alguien lo lea.

**Medido de nuevo, con `coalesce` en los dos lados:**

| Ajuste | Producción | QA |
|---|---|---|
| `statement_timeout` | `anon` 3s · `authenticated` 8s · `authenticator` 8s | **idéntico** |
| `lock_timeout` | `authenticator` 8s | **idéntico** |
| `idle_in_transaction_session_timeout` | `supabase_auth_admin` 60000 | **idéntico** |
| `default_transaction_read_only` | `supabase_read_only_user` on | **idéntico** |
| `search_path` (4 roles) | `auth`, `storage`, `postgres`, `supabase_admin` | **idéntico** |
| `session_preload_libraries` | `safeupdate` | `supautils, safeupdate` |
| `app.settings.jwt_secret` | *ausente* | presente |

Divergencias reales que quedan, las tres **menores**:

1. **`session_preload_libraries`** — QA carga `supautils` además de
   `safeupdate`. QA tiene de más, no de menos: no abre ningún agujero de
   cobertura.
2. **`app.settings.jwt_secret`** — existe sólo en QA, que es autohospedado y lo
   necesita. Producción gestiona su secreto por otra vía.
3. **`supabase_functions_admin` y su `search_path`** — sólo en QA, por el
   runtime de edge autohospedado. Ya recogido en la fila 7.

**Lo que se cae con esta corrección:** la explicación de que los backfills
revientan en producción «porque QA no tiene reloj». **QA tiene el mismo reloj.**
Vuelve a ser lo que ya se sabía: el volumen de datos (~112k despachos / ~61k
bultos), que el spec declara explícitamente fuera de alcance. La conclusión
anterior —«lo que hay que copiar a QA no son los datos, son los relojes»— era
falsa y queda retirada.

#### El hallazgo 2, resuelto: no es una divergencia, es un bug de producto

La fila 12 era la que iba a decidir la dirección. Ya está medida: **producción
tiene exactamente las mismas dos tablas que QA** (`orders`,
`dock_verifications`).

Así que las cinco suscripciones restantes — `customer_session_messages`,
`customer_sessions`, `intake_submissions`, `packages`, `routes` — **están
muertas en los dos entornos**. No hay nada que alinear entre QA y producción:
hay cinco canales que el frontend abre, que se suscriben sin error, y que no
reciben un evento **en ninguna parte**.

Eso lo saca del alcance de este spec y lo convierte en trabajo de producto:
o esas tablas entran en la publicación, o las suscripciones sobran. Va escrito
aquí para que quien lea el código no dé por vivo un canal que no lo está. **No
se arregla en spec-93** — no es paridad.

#### Lo que converge, dicho también

Media docena de superficies salieron **idénticas**, y decirlo importa tanto
como decir las que no: buckets de storage y sus ocho políticas, la publicación
de realtime, `pg_graphql` (ausente en los dos), los esquemas expuestos y el
`max_rows` de PostgREST, y los roles en todo lo que no sea el extra que cada
entorno se explica solo (`supabase_functions_admin` en QA por el runtime
autohospedado; `cli_login_postgres` en producción).

El spec preguntaba «qué superficies de producción no existen en QA». La
respuesta honesta, después de corregir el error de medición de la fila 8, es
que **QA se parece a producción bastante más de lo que este spec supuso al
empezar**. Lo que queda es real y está arriba —el alta de usuarios, MFA, la
rotación de refresh tokens, el `extra_search_path` de PostgREST, un cron job de
más y `pg_net` de menos— pero ninguna de esas cosas es la catástrofe silenciosa
que la primera lectura creyó ver.

La lección de la fase 1 no acabó siendo una divergencia concreta. Es ésta: **el
inventario se equivocó exactamente igual que el pipeline que audita** — una
consulta que devolvió NULLs, leída como un hecho. La regla de admisión del spec
(«cada fila se llena con el resultado de un comando, y el comando queda escrito
en la fila») es necesaria y **no es suficiente**: el comando estaba escrito y
era el equivocado. Lo que faltó fue que alguien lo leyera.

#### Tres hallazgos que no necesitaban la columna de producción

La pregunta del spec era «qué superficies existen en producción y no en QA».
Tres de los hallazgos son de otra forma: **superficies que existen en QA y no
las ejercita nada**, y se resuelven sin esperar al dispatch.

**Hallazgo 1 — `pgtap` no está instalada, así que 20 ficheros de prueba SQL se
saltan en silencio.** `sql_tests_check` (`deploy-qa.sh:619`) comprueba
`SELECT 1 FROM pg_extension WHERE extname='pgtap'` y, si no la encuentra,
escribe `SKIPPED-NO-PGTAP` por cada fichero que contenga `plan(`. Son **20 de
91**. Y encima el check es advisory: reporta un pase habiendo ejecutado nada.
Es el patrón exacto del spec — cobertura que se declara y no mide.

**Hallazgo 2 — cinco de las siete suscripciones de realtime están muertas en
QA.** El frontend se suscribe por `postgres_changes` a siete tablas
(`customer_session_messages`, `customer_sessions`, `dock_verifications`,
`intake_submissions`, `orders`, `packages`, `routes`). La publicación
`supabase_realtime` de QA tiene **dos**, y son las dos únicas que alguna
migración añadió jamás (`20260313000007` → `orders`, `20260428000006` →
`dock_verifications`). Un canal sobre las otras cinco **se suscribe sin error
y no recibe un evento nunca**. Falta la columna de producción para saber en qué
dirección corre la divergencia: si prod las tiene añadidas a mano por el
dashboard, es configuración fuera de control de versiones; si tampoco las
tiene, son cinco suscripciones muertas en los dos sitios.

**Hallazgo 3 — la fase 2 cerró la instancia, no la clase.** `deploy-qa.sh`
tiene exactamente dos ayudantes de recreación: `restart_functions()` (:390) y
`restart_auth()` (:439). Medido contra los contenedores vivos:

| Contenedor | Arrancado |
|---|---|
| `supabase-qa-auth` | 2026-09-09 |
| `supabase-qa-edge-functions` | 2026-09-09 |
| `supabase-qa-kong` | 2026-08-31 |
| `supabase-qa-rest` | **2026-08-11** |
| `supabase-qa-storage` | **2026-08-11** |
| `realtime-dev.supabase-qa-realtime` | **2026-08-11** |

**Hoy no hay deriva real**: desde el 2026-08-11 los únicos cambios del compose
tocaron `auth` (#710) y el runtime de edge (#497), y los dos servicios sí
tienen ayudante. La divergencia es **latente, no realizada** — y decirlo así
importa, porque la tentación es reportar cuatro contenedores rancios como si
ya estuvieran mal. Lo que está mal es el mecanismo: el siguiente cambio del
compose sobre `rest`, `storage`, `realtime` o `kong` se mergea, se despliega y
**no llega nunca al contenedor que modifica**.

### Fase 2 — Cerrar la divergencia de auth `[done]`

**Archivos:** `infra/supabase-qa/docker-compose.yml`, `apps/frontend/e2e/support/spec52-fixture.ts`

> Implementado por: **spec-88 fase 3** — no por esta fase. PRs #710 (`2d18739`) y #721 (`1ab41eb`).
> Review: seis rondas sobre spec-88 fase 3; los hallazgos que cerraron esto fueron el assert que leía la llave equivocada y el `deploy-qa.sh` que no recreaba `auth`.
> QA: `e2e-qa` **verde** en el run `34395854405` (`41ea770`), con el assert de claims ejecutándose contra QA real.
> Downstream: ninguno — esta fase no habilita trabajo de nadie más.

**Cerrada sin que nadie la trabajara desde aquí (2026-09-09).** La nota
original decía «si el PR #710 ya lo trajo, ciérrala referenciándolo;
compruébalo antes de implementar nada». Se comprobó, contra `origin/main`, y
está:

- `infra/supabase-qa/docker-compose.yml:166-167` — `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: "true"` y `..._URI: pg-functions://${POSTGRES_DB}/public/custom_access_token_hook`.
- `apps/frontend/e2e/spec52-pickup-reception-end-to-end.spec.ts:97-99` — `expect(claims.operator_id).toBe(OPERATOR_ID)` más `permissions` array no vacío.
- `infra/supabase-qa/deploy-qa.sh:411,736` — `restart_auth()` existe **y se llama** desde `main()` cuando cambia el compose.

**Dos matices que valen más que el checkbox, porque cambian lo que hay que
mirar en las otras fases:**

1. **El assert NO va sobre `app_metadata.claims`, va sobre la RAÍZ del JWT.**
   El trigger `sync_claims_to_auth_metadata` rellena `app_metadata.claims`
   **idéntico** con el hook apagado — medido, byte a byte. Un assert sobre esa
   llave habría pasado en verde con el hook muerto. **Cualquier verificación
   futura de un hook de GoTrue tiene que atacar lo que el hook escribe en
   exclusiva**, no lo que además escribe otra cosa.
2. **`restart_auth()` existir no bastaba.** El primer deploy falló porque la
   bandera que lo dispara se calculaba desde la posición de git del checkout y
   no desde el último deploy **terminado** — así que una corrida muerta a mitad
   envenenaba la siguiente. Arreglado en #721. **La fase 1 tiene que medir
   contra el contenedor vivo, nunca contra el YAML**: `docker inspect` mostró
   el contenedor `auth` corriendo **un mes** con una configuración que el
   compose ya no declaraba.

**Hueco heredado, declarado:** el arreglo de #721 está probado en unitarios
pero **nadie lo ha visto aguantar una muerte a mitad de verdad**. Se demostrará
la próxima vez que ocurra.

Lo que tiene que quedar cierto, venga de donde venga:

- `infra/supabase-qa/docker-compose.yml` registra el hook
  (`GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED` +
  `..._URI: pg-functions://postgres/public/custom_access_token_hook`).
- `e2e-qa` lee `session.access_token` tras el login y **exige**
  `operator_id`, `role` y `permissions`. Sin esto, el `EXCEPTION WHEN OTHERS`
  del hook hace que la prueba pase con un token vacío.

### Fase 3 — El resto del inventario `[done]`

> Implementado por: **implementer**, en dos tandas. Primera: rama `feat/spec-93-fase-3-divergencias-qa`, SHAs `cd82d78`→`3a1210f` (PR #764). Segunda: `feat/spec-93-fase-3b-divergencias-declaradas`, `f2c69b1`→`7cb43e1` (PR #775). Más `fix/spec-93-neutralizar-archive-audit-logs` (PR #776) para la decisión del usuario.
> Review: **reviewer** (opus), dos rondas. Primera tanda: 4 bloqueantes, 3 serios, 5 menores — los tres primeros bloqueantes eran guards que pasaban verdes con el arreglo deshecho. Segunda: 1 bloqueante (la fase 3b no estaba escrita en el spec — era del orquestador, cerrado en #774), 1 serio, 5 menores. Todos cerrados con mutation-evidence.
> QA: PRs #764 (2026-09-10T23:00:19Z), #775 (2026-09-11T01:06:05Z) y #776 (2026-09-11T00:56:05Z) merged, CI verde. `e2e-qa` verde en el run `34541476466`, y —lo que de verdad prueba la primera tanda— `sql tests (advisory): pass=91 fail=0 skip=0` con `pgtap extension ok installed`: los 20 ficheros que se saltaban en silencio ahora corren, y pasan.
> Downstream: revisado spec-92 (PRs #761 y #777) — la fila 11 de su tabla se retira (medida: no es divergencia de paridad) y entran dos nuevas, `raw-files` y `pg_net`. Ver fase 5.

**Verificación final, medida y no derivada.** Corrida `34549513271` de
`qa-prod-parity.yml`: **`matched: 47`, 14 aceptadas, `UNDECLARED: 1`**.

La única sin declarar es `cron_job/archive_old_audit_logs`, y **es correcto que
lo siga siendo**: su neutralización está mergeada pero su deploy a producción
espera el clic humano de `approve-production`. La fila desaparece cuando esa
migración se aplique.

**Una corrida antes dio 3, y conviene que quede escrito por qué.** El intento
inmediatamente anterior (`34549321520`) reportó tres sin declarar — las tres que
esta fase acababa de **cerrar en código**. No fallaba ningún arreglo: el
comparador mide el entorno **que corre**, y en ese momento QA todavía no se había
redesplegado. El repositorio decía una cosa y los contenedores otra.

Es la tesis de este spec aplicada contra sí mismo — *el compose declara la
intención, no el estado*. Cerrar esta fase sobre la derivación («deberían ser
0») habría registrado un 0 mientras tres divergencias seguían vivas. Se midió,
se esperó al deploy de QA, y se volvió a medir.

**Depende de:** ninguna — los dos hallazgos que esta fase cierra se midieron enteros contra QA y no esperan la columna de producción.

**Archivos:** `infra/supabase-qa/deploy-qa.sh`, `infra/supabase-qa/docker-compose.yml`, `infra/supabase-qa/env.qa.example`, `scripts/` (los guards de bash y `lib/qa-surface-aliases.sh`), `packages/database/supabase/migrations/` (bucket `raw-files`, neutralización de `archive_old_audit_logs`), `docs/qa-prod-parity-baseline.yml`, `docs/specs/spec-93-paridad-qa-produccion.md`, `docs/qa-environment.md`

Cerrar las divergencias que la fase 1 encuentre, **o declararlas
explícitamente como aceptadas**, cada una con su motivo y con qué clase de
cambio queda sin cobertura. Una divergencia aceptada y escrita es un riesgo
gestionado; una no escrita es una trampa.

**Despachada en dos tandas, a propósito.** La primera cierra los hallazgos 1 y
3 de la fase 1 — `pgtap` ausente y el mecanismo de recreación que sólo cubre
dos de seis servicios — porque los dos se midieron enteros contra QA y no
dependen de la columna de producción. La segunda espera al dispatch de
`measure-prod-surfaces.yml`: hasta saber qué tiene producción no se puede
decidir si una fila se cierra o se acepta, y aceptar una divergencia sin haber
medido el otro lado sería exactamente lo que el spec prohíbe en «Lo que NO hay
que hacer».

Los dos hallazgos van en **un solo implementer, no dos en paralelo**: ambos
tocan `deploy-qa.sh` y el guard de solapamiento los rechazaría con razón.

#### Segunda tanda — las 13 filas que reportó el guardarraíl

La primera comparación real de `qa-prod-parity.yml` (corrida `34545563792`)
dio `matched: 44`, 5 aceptadas y **13 no declaradas**. Ésta es la decisión sobre
cada una, que es lo que la fase 3 existe para tomar. **El criterio está aquí, no
en el fichero de línea base** — una excepción cuyo criterio sólo vive en un
comentario YAML es como se vacía este mecanismo en dos semanas.

**Una no era una divergencia, era un bug del comparador.**

`auth/hook_custom_access_token_hook_enabled` — el alias de QA doblaba el `hook_`.
La clave real de producción es `hook_custom_access_token_enabled`, y los dos
entornos **coinciden** ahí (fila 1 del inventario). Declararla como divergencia
aceptada habría tapado un bug del comparador con el fichero de excepciones, que
es precisamente lo que este spec no puede permitirse. Se arregló el alias y se
auditaron las 15 claves restantes contra el volcado real de producción: ninguna
más tenía el defecto.

**Cerradas en código (3).**

| Fila | Cómo se cerró |
|---|---|
| `postgrest/db_extra_search_path` | `PGRST_DB_EXTRA_SEARCH_PATH: "public, extensions"` literal en el servicio `rest` del compose. Un default `${VAR:-public}` no bastaba: `.env.qa` ya fija la variable a `public` |
| `storage_bucket/raw-files` | Migración que crea el bucket en QA. **Lo usan de verdad**: tres workflows de n8n suben ahí con service role. Nunca hubo migración — mismo hueco que se cerró para `manifests` |
| El alias de arriba | `scripts/lib/qa-surface-aliases.sh`, extraído y con test |

**Aceptadas y declaradas (9).** Cada una con su motivo y su clase de cambio sin
cobertura en `docs/qa-prod-parity-baseline.yml`: `extensions/pgtap` (deliberada
— una extensión de testing no pinta en producción), `extensions/pg_net` (existe
sólo en QA y ninguna migración la usa; **la dirección es la peligrosa**: una
migración que empiece a usar `net.http_post` aplicaría verde en QA y fallaría en
producción), `edge_function/main` (router del runtime autohospedado),
`roles/postgres` (la diferencia de `memberof` es exactamente
`supabase_functions_admin` y `supabase_realtime_admin`, los dos del runtime
autohospedado — producción es subconjunto estricto),
`roles/supabase_functions_admin`, `roles/cli_login_postgres`,
`gucs/app.settings.jwt_secret`, y `postgrest/db_use_legacy_gucs` +
`postgrest/db_anon_role` (**no son mapeo**: se comprobó contra la respuesta real
de `/v1/projects/{ref}/postgrest`, que no las expone bajo ningún nombre).

**La decimotercera fue una decisión de producto, y la tomó el usuario.**

`cron_job/archive_old_audit_logs` — producción agenda un job que hace
`DELETE FROM public.audit_logs WHERE timestamp < CURRENT_DATE - INTERVAL '7 years'`
justo bajo el comentario `-- TODO: Export to S3 before deletion`. La exportación
**nunca se implementó**, y el requisito de retención declarado es de 7 años.

Cómo llegó ahí: la migración `20260217000001` dejó el `cron.schedule`
**comentado a propósito** (`:333-335`), y `apps/frontend/setup-cron-job.js` —un
script manual, fuera del repo como mecanismo de despliegue— lo agendó contra
producción igualmente. `REMEDIATION.md` H3 ya pedía *«neutralizar
`archive_old_audit_logs()` … y confirmar que no está agendada en pg_cron»*.
**Esta fase hizo esa comprobación, y la respuesta es que sí lo está**
(`1 | archive_old_audit_logs | postgres | 0 2 * * * | active=true`).

**Severidad exacta: armada, no realizada.** El predicado borra filas de más de 7
años y los datos de auditoría empiezan hacia 2026-02, así que hoy no califica
ninguna y el job borra cero. No hay pérdida que recuperar. Decirlo de otro modo
sería tan malo como haberlo ignorado.

**Decisión del usuario (2026-09-11): neutralizar.** La función pasa a
`RAISE EXCEPTION` hasta que exista exportación-antes-de-borrado, y el cron se
desagenda; `setup-cron-job.js` se desarma para que nadie lo vuelva a armar sin
querer. Se descartaron las otras dos opciones: agendarlo también en QA cerraría
la paridad extendiendo un riesgo de cumplimiento a un segundo entorno, y
aceptarlo dejaría vivo en producción un job destructivo que el propio repo
documenta como incompleto. La divergencia se cierra **por retirada**, no por
copia.

> **Nota de método, porque es la tercera vez en este spec.**
> `20260913000006_spec88_fase1_revoke_anon.sql:28-30` afirma sobre esta misma
> función que *«su cron está comentado … nadie llama esto por PostgREST hoy»*.
> La primera mitad es **falsa en producción**, y la afirmación se heredó sin
> verificar. La conclusión de esa migración (revocar) no cambia y no se toca.
> Pero es el mismo patrón que el hallazgo 4 y que el bucket `raw-files`: una
> afirmación cómoda que nadie midió, propagándose por herencia.

**Lo que queda sin cubrir, dicho:** producción expone `db_pool` y
`db_pool_acquisition_timeout` y el comparador no los rastrea. Va a la fase 5.
Y `PGRST_DB_EXTRA_SEARCH_PATH` queda como variable muerta en
`infra/supabase-qa/env.qa.example` —borrarla rompería un `.env.qa` existente—
con una nota diciendo que nadie la lee; un operador podría editarla creyendo que
surte efecto.


### Fase 4 — Guardarraíl determinista `[done]`

> Implementado por: **implementer** — rama `feat/spec-93-fase-4-guardarrail`, SHAs `847f038` (implementación) y `8639918` (cierre del review). Más `fix/spec-93-parity-prod-pooler` (#767), del orquestador.
> Review: **reviewer** (opus) — veredicto inicial **no mergeable**: 4 bloqueantes, 3 serios, 7 menores. Todos cerrados en `8639918`, cada guard con mutation-evidence. El bloqueante 1 era una **fuga de credencial** (la password de Postgres de QA hacia un artifact descargable); nunca llegó a ejecutarse — el workflow sólo existía en la rama.
> QA: PR #765 merged 2026-09-10T23:00:48Z, CI verde. Y verificado **en vivo**, que es lo que de verdad cuenta aquí: corridas `34544230110` (falló correctamente, ver abajo) y `34545563792` (`matched: 44`, 5 aceptadas, 13 no declaradas).
> Downstream: revisado spec-92 (PR #761) — su tabla de huecos crece con las clases que este guardarraíl vigila. Ver fase 5.

**Las dos corridas reales valen más que los tests, y por razones opuestas.**

`34544230110` **falló**, y ésa fue la buena noticia: las siete superficies de
producción vía `psql` dieron cero hechos, y el suelo de cobertura no dijo «sin
divergencias» sino *«a file that exists but measured nothing is the same failure
as a missing file»*, exit 3, nombrando las siete. **Sin ese guard —el
bloqueante 2 del review— la corrida habría sido verde**, y el guardarraíl contra
los checks que no miran nada habría nacido siendo uno. La causa era el bug del
pooler por tercera vez (#767).

`34545563792` comparó de verdad. Y encontró **una divergencia que el inventario
de la fase 1 había declarado «idéntica»**: el bucket `raw-files`. Lo que a una
persona se le escapó por grepear sólo lo que esperaba ver, el comparador lo
listó sin más. Ésa es la justificación de esta fase, medida y no argumentada.

**Hueco declarado, no cerrado:** nadie ha verificado empíricamente que
`if: always()` en el job de comparación se dispare cuando el job de QA queda
`cancelled` por queue-timeout con el runner de la VPS caído. El comparador sí da
rojo sin artifact (verificado en `34544230110`), pero eso exige que el job de
producción llegue a correr. Se demostrará la próxima vez que el runner caiga.

**Desviación deliberada del texto del spec:** el spec pide un check que «rompa el
build», con `verify-prod-migrations` como precedente. Esto es `schedule` +
`workflow_dispatch`: **no bloquea ningún deploy**. La mitad de QA necesita QA ya
desplegado, así que meterlo en el camino crítico lo haría más lento y más frágil.
Queda dicho aquí para que sea una decisión y no un descuido.

**Depende de:** ninguna — el mecanismo se construye contra la lista de superficies de la fase 1, que ya está cerrada; qué filas acaban aceptadas es contenido del fichero de línea base, no del comparador.

**Archivos:** `.github/workflows/qa-prod-parity.yml` (nuevo), `scripts/` (el comparador nuevo y sus tests), `docs/qa-environment.md`

Que esto no pueda volver a descubrirse por accidente en un review.

Un check en CI que compare las superficies de la fase 1 entre QA y
producción y **falle** cuando aparezca una nueva divergencia no declarada. El
precedente de forma es `verify-prod-migrations` (spec-87): compara dos
entornos y rompe el build.

Punto de diseño que el orquestador tiene que resolver: producción es sólo
lectura y sus credenciales viven como secretos del pipeline — así que el
check corre **desde un workflow**, no desde la máquina de nadie.

#### Resuelto (2026-09-10): dos jobs y un artifact, no uno

El punto de diseño escondía una pregunta que el spec no había hecho: **ningún
runner puede leer los dos entornos.**

- QA vive en la VPS y se lee con `docker inspect` / `docker exec`. Sólo lo
  alcanza un runner `[self-hosted, vps]` — los que ya usan `deploy-qa` y
  `deploy-worker` (`deploy.yml:578`, `:437`).
- Producción es Supabase gestionado y se lee con la Management API y `psql`
  por el pooler. Eso lo hace cualquier `ubuntu-latest` con los secretos, que
  es lo que hace `measure-prod-surfaces.yml`.

Se podría meter todo en el runner de la VPS —tiene salida a internet y los
secretos del repo le llegan igual— y sería un job en vez de dos. **Se rechaza
a propósito:** eso pondría `SUPABASE_DB_PASSWORD` de producción sobre la VPS
de QA, que es una máquina bastante menos aislada que un runner efímero de
GitHub. Hoy la separación es limpia y conviene conservarla — `deploy-qa` corre
con secretos de QA en la VPS, y `verify-prod-migrations` corre con secretos de
producción en `ubuntu-latest`. Ningún job tiene hoy los dos, y este tampoco
debería ser el primero.

Así que: **un job `[self-hosted, vps]` mide QA y sube el resultado como
artifact; un job `ubuntu-latest` mide producción, se baja el artifact y
compara.** Cada mitad ve sólo las credenciales que le tocan.

**El runner de la VPS puede estar caído, y eso no puede leerse como verde.**
Ya ha pasado en este pipeline. Un job que no corre porque su runner está
offline se queda en `queued` y el comparador de después no debe interpretar la
ausencia del artifact como «no hay divergencias» — tiene que romper. Es el
mismo error que este spec persigue, sólo que en la infraestructura del propio
guardarraíl.

#### La divergencia aceptada se declara en un fichero, no en el código

El comparador no puede exigir igualdad: la fase 3 acepta divergencias a
propósito, y una aceptada y escrita es un riesgo gestionado. Así que la
comparación es contra un **fichero de línea base** que lista cada divergencia
aceptada con su motivo y con qué clase de cambio queda sin cobertura. El check
falla cuando aparece una divergencia que **no está en el fichero** — no cuando
los dos entornos difieren.

Eso es también lo que conecta con la fase 5: cada entrada de ese fichero es
una clase de cambio que no puede auto-aprobarse en spec-92.

### Fase 5 — Realimentar spec-92 `[done]`

> Implementado por: **el orquestador** — el entregable es la edición de otro spec, no código. Rama `docs/spec-93-fase-5-realimentar-spec-92`.
> Review: **sin review adversarial** — es prosa sobre mediciones ya verificadas en la fase 1, y las dos que resultaron mal medidas (los GUCs por rol y el bucket `raw-files`) **nunca llegaron a spec-92**: se escribió antes de medirlas. El hueco se declara igual.
> QA: PR #761 merged 2026-09-10T22:23:41Z contra `feat/spec-92-gate-prod-diferenciado` — no contra `main`, porque el fichero de spec-92 sólo existe en esa rama (PR #716). No aplica `e2e-qa`: sólo documentación.
> Downstream: spec-92 es el único downstream declarado de este spec, y es precisamente lo que esta fase actualiza.

**Depende de:** ninguna — la fase 1 midió ya lo suficiente para realimentar; la fila que sigue a medias (realtime) va declarada como tal, no omitida.

**Archivos:** `docs/specs/spec-92-gate-produccion-diferenciado.md` (vive en la rama `feat/spec-92-gate-prod-diferenciado`, PR #716 — no está en `main`), `docs/specs/spec-93-paridad-qa-produccion.md`

> Realimentada en el **PR #761**, abierto contra `feat/spec-92-gate-prod-diferenciado`
> y no contra `main` a propósito: el fichero de spec-92 sólo existe en esa rama.
> Se prefirió un PR revisable a comitear directamente sobre la rama de otra sesión.

La tabla «clase de cambio → cobertura exigida» de spec-92 se escribió
asumiendo que QA ejercita lo que producción ejecuta. Cada divergencia
aceptada de la fase 3 es una clase de cambio que **no** puede auto-aprobarse.
Actualizar spec-92 con ellas.

---

## Archivos

- `infra/supabase-qa/docker-compose.yml`
- `apps/frontend/e2e/support/spec52-fixture.ts`
- `.github/workflows/deploy.yml` (fase 4)
- `docs/qa-environment.md`
- el fichero de spec-92, cuando exista en `docs/specs/` (fase 5)

## Lo que NO hay que hacer

- **No «arreglar» QA a ojo hasta que se parezca a producción.** Primero
  medir, luego cerrar. Una divergencia que nadie midió no se sabe si importa.
- **No tocar producción.** Lecturas, y sólo por el pipeline.
- **No dar por buena una fila del inventario leída de un fichero de
  configuración.** El estado real y el declarado es justo lo que este spec
  existe para separar.
