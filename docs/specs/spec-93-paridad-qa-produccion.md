# Spec-93: Paridad QA ↔ producción — que el verde de QA signifique algo

> **Related:** spec-92 (el gate de producción diferenciado — todavía en la rama `feat/spec-92-gate-prod-diferenciado`, sin mergear; el gate descansa **entero** sobre la premisa que este spec pone a prueba), [spec-88](spec-88-anon-security-definer-audit.md) (fase 3 es la instancia medida que abre este spec), [spec-57](spec-57-qa-gate-before-production.md) (el gate original y el clic humano que spec-92 retira), [spec-87](spec-87-desbloquear-produccion.md) (`verify-prod-migrations`, el precedente de un check que compara dos entornos)

**Status:** in progress
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

### Fase 1 — Inventario medido de divergencia `[in_progress]`

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
| 4 | Extensiones instaladas | `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `postgis 3.3.7`, `supabase_vault`, `uuid-ossp` | ⛔ **sin medir** — ver «El bloqueo» | Indirecto — `postgis` lo usan 9 migraciones; `pg_net` **ninguna** |
| 5 | `pgtap` | **NO instalada** (disponible 1.3.3) | ⛔ sin medir | **No, y peor:** ver «El hallazgo 1» |
| 6 | `pg_graphql` | **NO instalada** (disponible 1.5.11), aunque `graphql_public` existe y PostgREST lo expone | ⛔ sin medir | No |
| 7 | Roles y pertenencias | 16 roles; `authenticator` ∈ {anon, authenticated, service_role} | ⛔ sin medir | Indirecto — cada consulta del e2e pasa por RLS |
| 8 | GUCs de base | `app.settings.jwt_secret`, `app.settings.jwt_exp` | ⛔ sin medir | No |
| 9 | `cron.job` | 2 jobs, ambos `postgres`: `nightly-metrics`, `dashboard_monthly_rollup` | ⛔ sin medir | **No** — el e2e no espera a las 02:00 |
| 10 | PostgREST — esquemas y `max-rows` | `DB_SCHEMAS=public,graphql_public`, `MAX_ROWS=1000` | `db_schema: public,graphql_public`, `max_rows: 1000` | Parcial — los datos del e2e no rozan `max-rows` |
| 10b | **PostgREST — `extra_search_path`** | `public` | **`public, extensions`** | **No** — ⚠️ divergencia |
| 11 | Rutas de Kong | `/auth/v1/`, `/rest/v1/`, `/storage/v1/`, `/functions/v1/`, `/graphql/v1`, `/realtime/v1/`, `/analytics/v1` | **No comparable** — prod es el gateway gestionado, no Kong | Sólo `/auth/v1/` y `/rest/v1/` |
| 12 | Publicación `supabase_realtime` | **2 tablas**: `orders`, `dock_verifications` | ⛔ **sin medir** — es la fila que decide la dirección del hallazgo 2 | **No** — ver «El hallazgo 2» |
| 13 | Buckets de storage | `files` (privado), `manifests` (privado, 10 MiB, imágenes) | ⛔ sin medir | **No** — ningún e2e sube un fichero |
| 14 | Políticas de storage | 8 sobre `storage.objects` | ⛔ sin medir | No |
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

#### El bloqueo: cinco superficies de producción siguen sin medir

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

Cuando #753 mergee: adaptar `measure-prod-surfaces.yml` a la nueva interfaz del
script y volver a disparar. La fase 1 no se cierra hasta entonces.

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

### Fase 3 — El resto del inventario `[in_progress]`

**Depende de:** ninguna — los dos hallazgos que esta fase cierra se midieron enteros contra QA y no esperan la columna de producción.

**Archivos:** `infra/supabase-qa/deploy-qa.sh`, `infra/supabase-qa/setup-qa.sh`, `scripts/` (los tests de bash de los dos guards), `docs/specs/spec-93-paridad-qa-produccion.md`, `docs/qa-environment.md`

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

### Fase 4 — Guardarraíl determinista `[in_progress]`

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

### Fase 5 — Realimentar spec-92 `[pending]`

**Archivos:** el fichero de spec-92 en `docs/specs/`, `docs/specs/spec-93-paridad-qa-produccion.md`

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
