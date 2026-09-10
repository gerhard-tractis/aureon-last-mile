# Spec-93: Paridad QA ↔ producción — que el verde de QA signifique algo

> **Related:** spec-92 (el gate de producción diferenciado — todavía en la rama `feat/spec-92-gate-prod-diferenciado`, sin mergear; el gate descansa **entero** sobre la premisa que este spec pone a prueba), [spec-88](spec-88-anon-security-definer-audit.md) (fase 3 es la instancia medida que abre este spec), [spec-57](spec-57-qa-gate-before-production.md) (el gate original y el clic humano que spec-92 retira), [spec-87](spec-87-desbloquear-produccion.md) (`verify-prod-migrations`, el precedente de un check que compara dos entornos)

**Status:** backlog
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

### Fase 1 — Inventario medido de divergencia `[pending]`

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

### Fase 3 — El resto del inventario `[pending]`

**Archivos:** por determinar en la fase 1 — depende de qué superficies aparezcan. `docs/specs/spec-93-paridad-qa-produccion.md` y `docs/qa-environment.md` en todo caso.

Cerrar las divergencias que la fase 1 encuentre, **o declararlas
explícitamente como aceptadas**, cada una con su motivo y con qué clase de
cambio queda sin cobertura. Una divergencia aceptada y escrita es un riesgo
gestionado; una no escrita es una trampa.

### Fase 4 — Guardarraíl determinista `[pending]`

**Archivos:** `.github/workflows/deploy.yml`, `scripts/` (el comparador nuevo)

Que esto no pueda volver a descubrirse por accidente en un review.

Un check en CI que compare las superficies de la fase 1 entre QA y
producción y **falle** cuando aparezca una nueva divergencia no declarada. El
precedente de forma es `verify-prod-migrations` (spec-87): compara dos
entornos y rompe el build.

Punto de diseño que el orquestador tiene que resolver: producción es sólo
lectura y sus credenciales viven como secretos del pipeline — así que el
check corre **desde un workflow**, no desde la máquina de nadie.

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
