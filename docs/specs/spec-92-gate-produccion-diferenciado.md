# spec-92 — el gate de producción distingue el camino verde de todo lo demás

**Status:** in progress
**Verify:** unit
**Depende de:** spec-57-qa-gate-before-production.md (`completed`)

> **Para agentes:** usa `superpowers:test-driven-development` en cada fase.
> Los tokens de fase van al final de cada heading — ver `docs/specs/CLAUDE.md`.

**Goal:** un merge a `main` cuyo `e2e-qa` está verde, cuyo run es el más
reciente contra la punta actual de `main`, y cuyo diff no toca el hook de
auth, llega a producción sin esperar un clic humano. Todo lo demás —
`e2e-qa` rojo, un run superado por uno más nuevo, un cambio al hook de auth,
o cualquier fallo al determinarlo — sigue esperando el clic. Un vigilante
detecta y avisa cuando un run se queda parado sin resolverse.

---

## Decisión de diseño — revisada dos veces durante la implementación

**Revisión 1.** La primera versión de este spec proponía distinguir
migraciones del resto del diff, conservando el clic humano sólo para
cambios que tocaran `packages/database/supabase/migrations/`. **Esa
distinción se descartó** antes de escribir código: `deploy-qa` aplica la
migración a QA, `e2e-qa` corre contra esa migración ya aplicada, y
`approve-production` exige `needs.e2e-qa.result == 'success'` — la
migración ya se prueba en QA antes de que producción sea alcanzable, y
`check-migration-safety.sh` ya caza el patrón DDL+backfill en CI sobre el
PR. Más decisivo: el clic lo daba el orquestador, que no audita SQL con más
criterio que el que ya aplica ese chequeo automático. Un control que nadie
ejerce con criterio propio no es un control.

**Revisión 2 — la migración no es la única clase de cambio que QA no
ejercita.** Un review adversarial sobre la revisión 1, ya con el auto-approve
sin excepciones implementado, midió esto:

`custom_access_token_hook` es un hook de GoTrue que producción invoca en
**cada login** para inyectar `operator_id`, `role` y `permissions` en el
JWT. En QA:

1. **No está registrado.** `infra/supabase-qa/docker-compose.yml:152-189`
   no declara ninguna variable `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*`; `git
   grep -i hook -- infra/` no encuentra nada. `docs/specs/spec-88-anon-security-definer-audit.md:191-193`
   ya lo dejó dicho: en QA el hook es código muerto del lado del login.
2. **Y aunque lo estuviera, el E2E no lo vería.**
   `apps/frontend/e2e/support/spec52-fixture.ts:346-364` — `signIn()` hace
   `waitForURL` y nunca lee el JWT. El hook termina en `EXCEPTION WHEN
   OTHERS THEN RAISE WARNING …; RETURN event;`
   (`20260312190110_fix_hook_role_overwrite.sql:60-63`), así que un hook
   degradado emite un token sin claims y el login **sigue siendo verde**.

Para un cambio que toque el hook, `deploy-qa` + `e2e-qa` no ejercitan nada
— «el pipeline no impone nada aquí; sólo lo parece». Este spec por tanto
**sí distingue una clase de cambio**, pero no por el criterio original
(migración sí/no): por **si existe una ruta de QA que ejercite lo que
cambió**. Auto-aprobar exige que exista una prueba que ejercite la ruta
afectada — no que exista una prueba en QA en general. Detección concreta
(ver Fase 1): un archivo cuyo nombre o ruta case con
`custom_access_token_hook`, o una migración cuyo diff toque
`supabase_auth_admin` (cómo el hook queda conectado).

`docs/specs/spec-93-paridad-qa-produccion.md` (otra sesión, no tocar aquí)
cierra esta clase de divergencia de raíz: inventario medido de superficies
de configuración QA↔prod y un check en CI que rompa el build ante una
nueva. Este spec referencia spec-93 como el que irá vaciando, con el
tiempo, la lista de excepciones de aquí — hoy sólo hay una entrada
(el hook de auth), verificada y concreta, no un riesgo genérico.

## Por qué esto no contradice a spec-57 — lo afina

spec-57 (`completed`) introdujo `approve-production` para arreglar un
estado medido así: *"merge a `main` = producción, ~10 minutos después, con
cero checkpoint humano"*. Sigue teniendo razón sobre ese problema — el
checkpoint sigue existiendo para la clase de cambio que de verdad lo
necesita. Lo que cambia es **quién es el checkpoint para casi todo lo
demás**:

1. **`e2e-qa` no existía cuando se escribió la Fase 1 de spec-57.** El
   propio spec lo dice: *"los tests E2E existen pero nunca corren"*. El
   clic humano se añadió junto con la Fase 1 como cinturón mientras el E2E
   era hipotético. Hoy `e2e-qa` es bloqueante (spec-57, Fase 2,
   "Promoción a bloqueante": `needs.e2e-qa.result == 'success'` en
   `approve-production`) y tiene historial — cazó una regresión de FK y una
   race de doble envío en cinco superficies antes de que este spec
   existiera.
2. El otro hallazgo de spec-57 — *"la base de datos es forward-only:
   `supabase db push`, sin rollback automático"* — sigue siendo cierto,
   pero no es un argumento a favor del clic universal: el clic nunca
   verificó eso tampoco, ni verificaba el hook de auth hasta que este spec
   lo hizo explícito. Lo que de verdad falta (escala de producción,
   divergencia de entorno más allá del hook) se declara sin tapar más
   abajo, en vez de fingir que un clic humano genérico lo cubría.

Con esos hechos, el checkpoint de spec-57 no desaparece — se reparte: para
la mayoría de los cambios se vuelve `e2e-qa` (más consistente que un
humano: corre siempre, no se olvida), y para la clase de cambio que QA no
puede ejercitar todavía, sigue siendo el clic.

## El problema, medido

`Deploy Production` pausaba en `approve-production` para todo merge, sin
excepción. En una sesión se acumularon **cuatro runs sin aprobar**;
durante horas se creyó que producción estaba al día porque los checks de
CI estaban verdes. El costo no fue evitar un despliegue malo: fue no darse
cuenta de que uno bueno no había llegado — y para la mayoría de esos
cuatro runs, el que debía notarlo no podía ejercer ningún criterio que el
pipeline no aplicara ya.

Dos riesgos distintos:

| Riesgo | Defensa antes de este spec | Defensa después |
|---|---|---|
| Algo malo llega a producción sin que nadie/nada mire | clic humano universal (spec-57) | `e2e-qa` verde + freshness check + clic sólo si toca el hook de auth |
| Algo bueno no llega y todos creen que sí | ninguna | vigilante (Fase 3) |

## Decisión: `environment:` condicional, no una llamada a la API

Dos formas de decidir la pausa se evaluaron:

**A. Un job que aprueba `pending_deployment` vía `gh api` — descartada.**
Requiere que el actor (`github-actions[bot]`) esté en la lista de
revisores del entorno, y GitHub no admite bots como revisores requeridos.
Intentarlo habría cambiado "nadie aprueba" por "el bot se autoaprueba
siempre", que no es una comprobación — es teatro con una llamada de red de
más de la que depender, y una superficie nueva de "qué hago si `gh api`
falla" que la regla de fallar cerrado obliga a resolver en "no aprobar",
el mismo estado que ya existe sin tocar nada.

**B. `environment:` resuelto por expresión — elegida.** GitHub Actions
evalúa expresiones en `jobs.<job>.environment` (contexto `needs` incluido)
antes de decidir si el job debe pausar:

```yaml
environment: ${{ needs.changes.outputs.auth_hook == 'true' && 'production' || 'production-auto' }}
```

- `production` — el entorno que ya existe desde spec-57, con
  `required_reviewers`. Sin cambios en su configuración.
- `production-auto` — nuevo, sin protection rules. GitHub lo crea
  automáticamente la primera vez que un job lo referencia; no hace falta
  aprovisionarlo a mano ni llamar a la API para crearlo.

Cuando el merge toca el hook de auth, el job resuelve a `production` y
pausa para el clic — igual que hoy. Cuando no, resuelve a
`production-auto`, sin revisores, y el job corre sin pausa. Nada llama a
la API para aprobar nada; la aprobación "ocurre" porque el entorno elegido
no la exige. Determinista, no depende de que nadie lea nada.

**Reusa, no duplica, el cálculo de "qué tocó esto".** La condición nueva
(`auth_hook`) es un output más del mismo job `changes` (`Detect changed
paths`) que ya calcula `database`, `edge_functions`, `worker`, etc. — no
una cuarta forma de responder "qué tocó esto" (deuda ya declarada en
spec-90).

**Fail-closed, explícito en cada punto nuevo:**
- El operador `&&`/`||` no tiene tercer estado: si `changes` falla, la
  cadena `deploy-qa` (exige `needs.changes.result == 'success'`) →
  `approve-production` (exige `needs.deploy-qa.result == 'success'`) ya
  detiene todo antes de que la expresión del entorno se evalúe siquiera —
  no hace falta un chequeo adicional para eso, es la misma cadena que ya
  existía en spec-57.
- El paso "Verify this run is current" (ver abajo) no usa `|| true` ni
  `continue-on-error`; si la llamada a `gh api` falla, el job falla, en
  ambos caminos (auto-aprobado o humanamente aprobado).

## Decisión: la comprobación de "run vigente" corre en ambos caminos

`approve-production` gana un paso nuevo, "Verify this run is current", que
compara `DEPLOY_SHA` contra la punta real de `main` (`gh api
repos/:owner/:repo/commits/main --jq .sha`) y falla el job si no
coinciden. Corre **después** de que el entorno resuelva — en el camino
`production`, eso significa después de que un humano apruebe. Así, una
aprobación concedida tarde, después de que un merge más nuevo ya
aterrizara, tampoco despliega código viejo — el riesgo que spec-57
documentó y nunca cerró ("Known consequence… approving an older queued run
after a newer one has deployed would put older code in production").

## Decisión: X = 60 minutos para runs sin resolver, cron cada 15

El vigilante nuevo (Fase 3) reporta cuando el run de `deploy.yml` que
corresponde a la punta actual de `main` lleva más de X minutos sin
terminar en éxito — corriendo, fallado (E2E rojo, freshness check),
cancelado, o esperando un clic que nadie dio. `qa-drift-watchdog.yml` ya
usa una ventana de 20 minutos para drift de QA, pero mide *tiempo desde el
merge* para un proceso que en condiciones normales tarda minutos. El
incidente medido en este spec fueron **horas** de cuatro runs acumulados.
60 minutos separa "todavía corriendo/esperando revisión normal" de "esto
se olvidó", sin gritar en cada deploy con hook de auth que tarda un poco
en que alguien lo revise. Cron cada 15 minutos, igual que
`qa-drift-watchdog.yml`, retraso máximo de detección 75 minutos.

## Qué NO se auto-aprueba

- **`e2e-qa` rojo** — `approve-production` no corre (su `if:` lo exige).
  Sin cambios de spec-57.
- **Un cambio que toca el hook de auth** — `environment:` resuelve a
  `production`, con revisor requerido. Detección: ruta de archivo que casa
  con `custom_access_token_hook`, o una migración cuyo diff toca
  `supabase_auth_admin`.
- **Un run superado por uno más nuevo** — el paso "Verify this run is
  current" lo falla explícitamente, en ambos caminos. El vigilante (Fase
  3) además señala cuándo hay más de un run sin resolver a la vez.
- **Cualquier fallo al determinarlo** — `changes` falla, la llamada a `gh
  api` del freshness check falla: todo cae del lado seguro (más pausa o
  job fallido, nunca deploy silencioso).

## Precondición de merge — decisión del review, 2026-09-09

**Este PR no se mergea hasta que `sql_tests_check` (`infra/supabase-qa/deploy-qa.sh:466`)
deje de ser advisory y bloquee `deploy-qa` de verdad.** Hoy hace
`record_advisory "sql: $base" FAIL` y sigue — una migración cuyos pgTAP
están en rojo contra QA pasa `deploy-qa`, pasa `e2e-qa` (que no toca la
mayoría de RPCs), y se auto-aprueba a producción. Ésa es la premisa
completa del spec ("QA ya prueba la migración") resultando falsa para
esta clase específica.

Eso depende de que el harness de pgTAP se arregle primero (PR #717, en
review aparte) — hacerlo bloqueante hoy, con un wrapper que da PASS a un
test rojo, no cambiaría nada. **No se toca aquí.** Es la precondición
explícita de la Fase 1 (la que activa la auto-aprobación) — ver su
checklist.

## Huecos verificados por el review — no construidos aquí, medidos y nombrados

El auth hook fue el primero medido (revisión 2). El review de esta PR
(2026-09-09) midió, contra el código real, seis clases más de cambio que
hoy se auto-aprobarían sin que nada las haya ejercitado. Ninguna se
construye en este spec — declararlas es el entregable; construirlas
requiere decidir umbrales y falsos positivos que no se pueden resolver
leyendo el código actual.

| # | Clase | Verificado | Qué lo cubriría |
|---|---|---|---|
| 1 | Migraciones con sus pgTAP en rojo contra QA | `sql_tests_check` es advisory (`deploy-qa.sh:466`) — ver precondición de merge arriba | `sql_tests_check` bloqueante (PR #717 primero) |
| 2 | Cambios al compose de QA fuera de `functions` | Los cambios a `infra/supabase-qa/docker-compose.yml` fuera del bloque de Edge Functions nunca llegan al contenedor que modifican en un ciclo normal de CI/CD (requieren un redeploy manual de infra) | Un job que redepliegue infra de QA cuando ese fichero cambia, o al menos un check que lo señale |
| 3 | Reescrituras del cuerpo del hook que no casan las señales de detección (M1) | Medido: `supabase_auth_admin` aparece en cero migraciones de la historia completa del repo; de 8 migraciones históricas que tocan el hook, la señal de ruta cazó 5, y en algún caso sólo porque *otro* fichero co-modificado llevaba el literal en su ruta — detección incidental, ya ampliada a contenido en esta ronda (ver B1/M1 más abajo) pero un `CREATE OR REPLACE` sin tocar ninguno de los dos literales seguiría sin detectarse | Un chequeo semántico (parseo del cuerpo de la función, no grep de texto) — fuera de alcance de un guard bash |
| 4 | Migraciones del hook aplicadas de rebote por `--include-all` | Era B1 — cerrado en esta ronda: `auth_hook` ahora se calcula contra el rango acumulado desde el último deploy exitoso, no el commit único | — (cerrado) |
| 5 | Backlogs completos vía `workflow_dispatch` + `force_db` | Mismo mecanismo que B1 — el rango acumulado cubre también este camino, porque no depende de qué disparó el run, sólo de qué se ha aplicado ya | — (cerrado) |
| 6 | Diffs de migraciones >64 KB | Era M2 — cerrado en esta ronda: la captura por variable antes de grepear elimina el SIGPIPE bajo `pipefail` | — (cerrado) |

Filas 4–6 se verificaron cerradas por el propio review round 2 (ver más
abajo); se listan igual porque el hallazgo original las nombró así y la
tabla es el registro de qué se midió, no sólo de qué queda abierto.
Filas 1–3 siguen abiertas.

## Revisión de código — review 2026-09-09, PR #716, ronda 2

Bloqueantes B1–B3, mayores M1–M4 y tres menores. Los seis mutantes que
sobrevivían al guard round-1 contra el `deploy.yml` **real** (no contra
fixtures) fueron el hallazgo más serio — cada uno se reprodujo en vivo
antes de arreglarse, y se re-verificó después:

| # | Hallazgo | Cerrado en | Evidencia |
|---|---|---|---|
| B1 | `auth_hook` se calculaba sólo del diff de un commit; `db push --include-all` aplica todo lo pendiente en cada run aprobado — un hook migration podía colarse sin pausa vía un merge posterior sin relación | `changes` job ahora usa el rango acumulado desde el último `Deploy Production` exitoso (`gh api .../runs?status=success`), fail-closed si no se puede establecer | commit del código |
| B2 | El vigilante nace en alerta permanente: runs `cancelled`/`failure` de hace 36h contaban como "sin resolver" para siempre | `liveUnresolved` ahora excluye un run completado-y-fallido una vez pasada su propia ventana de gracia | Reproducido contra el `decide()` pre-fix (alert) y confirmado el fix (in_flight) sobre el mismo fixture |
| B3 | Seis mutantes desarmaban el gate con el guard round-1 en verde contra el `deploy.yml` real | Ver tabla de mutantes abajo | 6/6 cazados en vivo, post-fix |
| M1 | La detección del hook era incidental (sólo rutas); `supabase_auth_admin` nunca ha aparecido en ninguna migración histórica | Señal de contenido añadida: el diff de migraciones se grepea por `custom_access_token_hook` además de `supabase_auth_admin`, cazando un hotfix `CREATE OR REPLACE` | commit del código |
| M2 | SIGPIPE: `git diff \| grep -q` bajo `pipefail` falla abierto (rc 141 → `AUTH_HOOK` queda `false`) en un diff mayor al buffer de la tubería | Captura por variable antes de grepear, en todos los content-checks de `auth_hook` | commit del código |
| M3 | Nada vigilaba si el entorno `production` pierde su `required_reviewers` | Vigilante gana `productionGateProtected`, consultado en cada corrida; `false` (incluida la propia consulta fallando) anula todo lo demás y alerta | commit del código, test dedicado |
| M4 | El vigilante declaraba `ok` con un deploy fallido sin atender, si un commit posterior desplegaba bien | `decide()` ya no cierra sobre un run `liveUnresolved` de otro commit aunque el de la punta de `main` haya tenido éxito | Reproducido contra el `decide()` pre-fix (ok) y confirmado el fix (alert) sobre el mismo fixture |

**Mutantes B3, cazados en vivo contra el `deploy.yml` real (antes → después):**

| Mutación | Antes | Después |
|---|---|---|
| `if: false` en el paso de frescura | sobrevivía | cazado — "must run unconditionally" |
| Comparación neutralizada conservando los tres tokens como decoy | sobrevivía | cazado — el guard ahora exige que el mismo nombre de variable conecte la asignación, la comparación `!=` y el `exit 1` posterior, no sólo presencia textual |
| Borrar la señal `custom_access_token_hook` del job `changes` | sobrevivía | cazado — nuevo chequeo inspecciona el `run:` del paso que calcula `auth_hook=` |
| Job de producción nuevo sin pasar por el gate | sobrevivía (lista estática duplicada en dos ficheros) | cazado — `PROD_JOBS` ahora se deriva de `jobs:` menos una lista negativa corta; un job nuevo no tiene ninguna lista a la que "olvidarse" de añadirse |
| `continue-on-error: true` sobre `approve-production` mismo | sobrevivía (sólo se comprobaba en `e2e-qa` y en el *step* de frescura) | cazado — chequeo nuevo a nivel de job |
| Quitar `auth_hook` de `changes.outputs` | sobrevivía | cazado — nuevo chequeo exige que el output exista y referencie `auth_hook` |

**Nota de proceso:** al escribir el mutante 3 (borrar la señal) por
primera vez, el guard NO lo cazó — no porque el chequeo estuviera mal,
sino porque la propia prosa explicativa de B1/M1/M2 se había escrito
como comentarios bash *dentro* del bloque `run:` del paso (para
documentar el porqué junto al código), y esa prosa mencionaba
`custom_access_token_hook` como ejemplo — dejando el string presente en
el script aunque el patrón funcional de grep se hubiera borrado. Se
corrigió moviendo esa prosa a un comentario YAML *por encima* del paso
(fuera de `run:`), y el mutante volvió a cazarse. Ejemplo directo de por
qué mutation-testear contra el fichero real, no sólo contra fixtures
sintéticas, encuentra cosas que un fixture no puede: el fixture nunca
tuvo esa prosa para empezar.

**Menores:**
- Los runs superados por uno más nuevo ahora fallan en rojo (antes:
  esperaban en silencio). Con la cadencia real de merges esto puede
  pintar "Deploy Production" rojo con cierta frecuencia — aceptado
  deliberadamente: fallar visible es preferible a esperar en silencio, y
  si el run que supera a otro también falla su propio CI, el escape es
  `workflow_dispatch` manual (documentado en el runbook).
- Añadida señal de ruta para `infra/supabase-qa/docker-compose.yml` y
  `volumes/db/roles.sql` — un cambio ahí altera lo que "e2e-qa verde"
  significa, aunque nunca llegue a producción.
- El paso "Report" del vigilante interpolaba `${{ steps.decide.outputs.reason }}`
  directo en `run:` — pasado ahora por `env:`, mismo patrón que ya usaba
  "Raise the alarm".

## File structure

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `.github/workflows/deploy.yml` | `changes` gana el output `auth_hook`; `approve-production` resuelve `environment:` condicional + freshness check | Modificar |
| `scripts/check-deploy-gating-autoapprove.mjs` | Invariantes nuevas: polaridad del condicional, freshness step con fail-closed, ningún `PROD_JOBS` con `environment:` propio | Crear |
| `scripts/check-deploy-gating.mjs` | Relaja su chequeo de `environment:` para aceptar también la forma condicional válida; importa y agrega los errores del archivo anterior | Modificar |
| `scripts/check-deploy-gating-autoapprove.test.sh` | Tests + mutation-test de las invariantes nuevas | Crear |
| `.github/workflows/ci.yml` | Corre el test nuevo | Modificar |
| `scripts/deploy-approval-watchdog.mjs` | Decisión pura: ¿el run de la punta de `main` lleva > X sin resolverse? | Crear |
| `scripts/deploy-approval-watchdog.test.sh` | Tests del anterior | Crear |
| `.github/workflows/deploy-approval-watchdog.yml` | Cron 15min, reúne estado vía `gh api`, abre/actualiza un único issue | Crear |
| `.github/workflows/README.md` | Diagrama y tabla de jobs actualizados | Modificar |
| `docs/runbooks/approve-production-deploy.md` | Reescrito: la pausa ahora es la excepción (hook de auth), no la norma | Modificar |

---

### Fase 1 — `changes` gana `auth_hook`; `approve-production` se autoaprueba salvo esa clase `[in_progress]`

**Archivos:**
- Modificar: `.github/workflows/deploy.yml`

**Precondición de merge (no de esta fase, del PR entero — ver sección
arriba):** no mergear hasta que `sql_tests_check` sea bloqueante en
`infra/supabase-qa/deploy-qa.sh` (depende de PR #717, en review aparte).

**Implementado** — commit `8c077a2` (base), `0daaa67` (B1/M1/M2/B3, review
round 2) en esta rama.

- [x] `changes` job: nuevo output `auth_hook`, calculado en el paso
  "Filter paths" contra el **rango acumulado desde el último `Deploy
  Production` exitoso** (no el commit único — corregido en round 2, B1):
  verdadero si algún path del rango casa con `custom_access_token_hook` o
  con las rutas de wiring de QA (`infra/supabase-qa/docker-compose.yml`,
  `volumes/db/roles.sql`), o si el diff de
  `packages/database/supabase/migrations/` en ese mismo rango contiene
  `custom_access_token_hook` o `supabase_auth_admin`. Fail-closed
  (`AUTH_HOOK=true`) si el rango no puede establecerse.
- [x] `approve-production.environment` pasa de `production` a
  `${{ needs.changes.outputs.auth_hook == 'true' && 'production' ||
  'production-auto' }}`.
- [x] Nuevo paso "Verify this run is current": lee la punta real de `main`
  vía `gh api repos/${{ github.repository }}/commits/main --jq .sha`,
  compara contra `DEPLOY_SHA`, `exit 1` si no coincide o si la llamada
  falla (`set -euo pipefail`, sin `|| true`). Corre en ambos caminos,
  incluido después de un clic humano.
- [x] Comentarios del job y del header del workflow reescritos citando
  este spec y explicando la exención del hook de auth.
- [x] YAML verificado con `js-yaml` (parsea).
- [ ] **Paso manual, post-merge — NO se ejecuta en esta sesión:** ninguno.
  A diferencia de la Revisión 1 (que retiraba `required_reviewers` de
  `production`), esta versión **conserva** esa configuración sin cambios
  — `production` sigue existiendo con su revisor tal como spec-57 lo dejó,
  y `production-auto` la crea GitHub automáticamente al primer uso. No hay
  ninguna acción de infraestructura pendiente.

---

### Fase 2 — el guardarraíl aprende la regla nueva `[in_progress]`

**Archivos:**
- Crear: `scripts/check-deploy-gating-autoapprove.mjs`
- Crear: `scripts/check-deploy-gating-autoapprove.test.sh`
- Modificar: `scripts/check-deploy-gating.mjs`
- Modificar: `.github/workflows/ci.yml`

**Implementado** — commit `8c077a2` en esta rama.
`scripts/check-deploy-gating-autoapprove.mjs`,
`scripts/check-deploy-gating-autoapprove.test.sh` (14/14 verde),
`scripts/check-deploy-gating.mjs` modificado (su chequeo de `environment:`
ahora acepta también la forma condicional válida — un `'production'`
literal sigue siendo válido porque es estrictamente más cauto, no una
regresión de seguridad), añadido a `ci.yml`.

**Invariantes que afirma**, cada una con fixture rojo antes de la
implementación (ver el test file):

1. `approve-production.environment`, si es una expresión condicional, debe
   mapear exactamente `needs.changes.outputs.auth_hook == 'true'` a
   `'production'` y el resto a `'production-auto'` — nunca invertida,
   nunca sobre otro output, nunca `'production-auto'` incondicional.
2. `approve-production` debe contener un paso cuyo `run:` compare
   `DEPLOY_SHA` contra `commits/main` y haga `exit 1` en discrepancia, sin
   `continue-on-error: true` ni un `|| true` que lo neutralice. Sólo se
   exige cuando la fixture declara `steps:` en absoluto (convención de
   esta familia de tests: fixtures mínimas a propósito; el `deploy.yml`
   real siempre tiene `steps:`).
3. Ningún job de `PROD_JOBS` puede declarar su propio `environment:`.

**Mutation-test manual, contra el `deploy.yml` real (6/6 mutantes
cazados):**

| Mutación | Resultado |
|---|---|
| Invertir el condicional (`auth_hook == 'true'` → `production-auto`) | ROJO — "not the expected shape" |
| Condicional sobre `database` en vez de `auth_hook` | ROJO — mismo mensaje |
| Quitar el paso "Verify this run is current" | ROJO — "no freshness step" |
| Añadir `continue-on-error: true` al paso | ROJO — "continue-on-error: true" |
| Añadir `\|\| true` al final del `run:` del paso | ROJO — "ends with `\|\| true`" |
| `environment: production-auto` en `deploy-vercel` | ROJO — "declares its own environment" |

**Sin regresión en las suites existentes:** las 8 familias de
`check-deploy-gating*.test.sh` preexistentes (`check-deploy-gating.test.sh`,
`-always`, `-concurrency`, `-quarantine`, `-quarantine-r4/r5/r6`,
`-quarantine-differential`) siguen en verde sin modificar ninguna de sus
fixtures — el chequeo relajado en `check-deploy-gating.mjs` acepta el
`'production'` literal que todas ellas usan.

**Ronda 2 (review 2026-09-09, PR #716, B3)** — commit `0daaa67`. Los 6
mutantes de la tabla de arriba pasaban contra fixtures sintéticas pero
**sobrevivían contra el `deploy.yml` real**: `if: false` en el paso,
comparación neutralizada conservando los tokens como decoy,
`continue-on-error: true` en `approve-production` mismo (no sólo el
paso), un job de producción nuevo sin ninguna lista a la que añadirse,
borrar `auth_hook` de `changes.outputs`, y borrar las señales de
detección del propio script de `changes`. Los 6 se cazan ahora, **en
vivo contra el fichero real**, no sólo contra fixtures nuevas — ver la
tabla de mutantes en la sección "Revisión de código" más arriba.
`scripts/check-deploy-gating-autoapprove-r2.test.sh` (14/14) cubre los
mismos casos como regresión de CI. `PROD_JOBS` ya no es una lista
estática duplicada en dos ficheros — se deriva de `jobs:` menos una
lista negativa corta (`computeProdJobs`), así que un job nuevo no puede
"olvidarse" de añadirse a ninguna parte.

**Verify:** unit

---

### Fase 3 — vigilante de runs sin resolver `[pending]`

Mismo patrón que `qa-drift-watchdog.yml`/`qa-drift-check.mjs`: lógica de
decisión pura y testeable, wiring de E/S real sólo en el workflow, un
único issue autocurativo por label. A diferencia de `qa-drift-watchdog.yml`,
este no necesita el runner self-hosted — todo el estado sale de la API de
GitHub, no de leer un checkout en el VPS.

**Archivos:**
- Crear: `scripts/deploy-approval-watchdog.mjs`
- Crear: `scripts/deploy-approval-watchdog.test.sh`
- Crear: `.github/workflows/deploy-approval-watchdog.yml`

- [x] TDD: `deploy-approval-watchdog.test.sh` escrito primero, confirmado
  rojo por "no such file", luego implementado
  `deploy-approval-watchdog.mjs` (función pura + CLI, mismo estilo que
  `qa-drift-check.mjs`). 20/20 verde (commits `a82cacc` base,
  `d36cd78` ronda 2).
- [x] `.github/workflows/deploy-approval-watchdog.yml`: cron cada 15 min
  + `workflow_dispatch`, un job `ubuntu-latest`, reúne los runs de
  `deploy.yml` vía `gh api .../deploy.yml/runs?per_page=20`, corre el
  script, y con su veredicto abre/actualiza/cierra un único issue con
  label `deploy-approval-stale`.
- [x] El cuerpo del issue linkea al run implicado y al runbook.
- [x] Commit.

**Ronda 2 (review 2026-09-09, PR #716)** — commit `d36cd78`:

- **B2** (bloqueante): `decide()` trataba cualquier run que alguna vez
  hubiera fallado/cancelado como "sin resolver" para siempre. Medido
  contra el estado real del repo: 15 runs `cancelled`/`failure` de las
  últimas 36h producían `action=alert` permanente, sin autocurarse
  jamás. Corregido: un run `completed`-y-fallido sólo cuenta como
  "en vivo" dentro de su propia ventana de gracia; más viejo que eso, se
  ignora. Reproducido contra el `decide()` anterior a la ronda 2 (alert)
  y confirmado el fix (in_flight) sobre el mismo fixture.
- **M4** (mayor): `decide()` comprobaba el éxito de la punta de `main`
  primero y devolvía `ok` incondicionalmente, cerrando el issue aunque
  un commit MÁS VIEJO tuviera un run fallido reciente sin atender — la
  forma exacta del incidente 2026-08-17→22. Corregido: un `ok` para la
  punta de `main` ya no cierra sobre un run `liveUnresolved` de otro
  commit. Reproducido (ok) y confirmado el fix (alert, nombra el run
  viejo) sobre el mismo fixture.
- **M3** (mayor): nada vigilaba si el entorno `production` perdía su
  regla `required_reviewers` — configuración viva de GitHub, invisible
  para cualquier guard de YAML. Nuevo campo opcional
  `productionGateProtected` en el estado; `false` (incluida la propia
  consulta fallando — fail closed) anula todo lo demás y alerta. El
  workflow consulta `environments/production` antes de decidir.
- Menor: el paso "Report" pasó de interpolar
  `${{ steps.decide.outputs.reason }}` directo en `run:` a pasarlo por
  `env:`.

20/20 tests verdes tras la ronda 2, incluidos los tres casos nuevos (B2,
M4, M3) — ver `scripts/deploy-approval-watchdog.test.sh`.

**Verify:** unit

---

### Fase 4 — documentación `[in_progress]`

**Archivos:**
- Modificar: `.github/workflows/README.md`
- Modificar: `docs/runbooks/approve-production-deploy.md`

- [x] Actualizado el diagrama de flujo: `approve-production` corre
  automáticamente si `e2e-qa` está verde y el run es vigente; pausa sólo
  cuando el diff toca el hook de auth. Corregida además una imprecisión
  preexistente en la tabla de jobs (`e2e-qa` decía "advisory" — es
  bloqueante desde el 2026-09-03).
- [x] Runbook reescrito: la pausa deja de ser el caso normal. Explica
  cuándo aparece (hook de auth, con el porqué medido), cómo verificar qué
  commit se está aprobando (incluyendo el freshness check), qué significa
  el issue de `deploy-approval-stale`, y el escape manual
  (`docs/runbooks/manual-deployment.md`). Corregido de paso el nombre del
  entorno en los comandos `gh api` (era `Production`, capitalizado; el
  real en `deploy.yml` es `production`, minúscula).
- [x] Añadida la tabla de huecos declarados (escala, divergencia QA/prod
  más allá del hook) al runbook, referenciando `spec-93`.
- [x] Commit.

**Verify:** unit

---

## Riesgos y lo que se aceptó deliberadamente

| Riesgo | Mitigación |
|---|---|
| La detección de `auth_hook` (regex de ruta + grep de `supabase_auth_admin`) tiene falsos negativos si el hook se referencia de una forma que no casa ninguno de los dos patrones | Ambos patrones son deliberadamente amplios (nombre de función, no una ruta de archivo específica). `spec-93` es la mitigación estructural: un inventario medido, no un detector ad-hoc, que cierra esto de raíz en vez de parche a parche. |
| El paso de freshness introduce una llamada a red más por deploy (`gh api .../commits/main`) | Barata, de sólo lectura, ya usada por `qa-drift-watchdog.yml` para lo mismo — no es infraestructura nueva. |
| Escala de producción, huecos reales fuera de lo que `spec-93` cubre | Declarado arriba, no fingido como cubierto. Cualquier incidente de esa clase es evidencia para priorizar la fase futura correspondiente, no una sorpresa. |
| El vigilante de Fase 3 se queda mudo si `gh api` falla | Sigue la regla de fallar cerrado: un fallo de la consulta no cierra el issue existente ni reporta `ok` — ver el caso de test dedicado en Fase 3. |

## Out of scope

- Aprobar vía `gh api .../pending_deployments` (descartado arriba —
  requiere un revisor que GitHub no permite que sea un bot).
- Construir las dos comprobaciones de la tabla de huecos declarados
  (escala, resto de divergencia QA/prod) — quedan como fases futuras con
  su argumento, no como trabajo pendiente de este spec.
- El inventario y check de `spec-93` — otra sesión, no tocar aquí.
- Cambiar el criterio de `e2e-qa` o su quarantine (spec-87) — sin cambios.
- Promover o degradar cualquier otro job del pipeline.
