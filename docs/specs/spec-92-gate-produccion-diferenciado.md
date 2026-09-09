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

## Los huecos que siguen sin comprobación automática — declarados, no construidos aquí

El auth hook fue el primero medido; hay al menos otra clase para la que
"el clic" tampoco era, en rigor, una defensa real — sólo dejan de tener
siquiera la ilusión de cobertura al auto-aprobar:

| Hueco | Por qué ni el clic ni `auth_hook` lo cubren | Qué lo cubriría (fase futura, no construida aquí) |
|---|---|---|
| **Escala de producción** — ~112k despachos, ~61k paquetes; un backfill que expira ahí y en ningún otro entorno (QA no tiene ese volumen) | Nadie medía el volumen de una tabla al hacer clic; es información que no está en pantalla, y no es una superficie de config QA↔prod que `spec-93` vaya a inventariar | Un chequeo en `check-migration-safety.mjs` que, para migraciones con `UPDATE`/`DELETE` masivo sin `WHERE` acotado sobre tablas nombradas en una lista de "grandes", avise en el PR — no en el deploy |
| **Divergencia QA/producción, superficies distintas del hook de auth** — QA es self-hosted, producción es Supabase gestionado; el modo de GUC de PostgREST y otras diferencias de configuración pueden existir sin haberse medido todavía | `spec-93` es exactamente el inventario que cierra esto de raíz — pero mientras no exista, cualquier otra superficie de config divergente que aún no se ha medido tiene el mismo problema que tenía el hook antes de este spec | `spec-93` — su check en CI de "superficie nueva detectada" es lo que iría vaciando esta fila |

Ninguna de las dos se construye en este spec — declararlas es el
entregable; construirlas requiere decidir umbrales y falsos positivos que
no se pueden resolver leyendo el código actual, y en el caso de la
segunda, requiere el inventario que `spec-93` está construyendo aparte.

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

**Implementado** — commit `8c077a2` en esta rama.

- [x] `changes` job: nuevo output `auth_hook`, calculado en el paso
  "Filter paths" — verdadero si algún path cambiado casa con
  `custom_access_token_hook`, o si el diff de
  `packages/database/supabase/migrations/` contiene `supabase_auth_admin`.
- [x] `approve-production.environment` pasa de `production` a
  `${{ needs.changes.outputs.auth_hook == 'true' && 'production' ||
  'production-auto' }}`.
- [x] Nuevo paso "Verify this run is current": lee la punta real de `main`
  vía `gh api repos/${{ github.repository }}/commits/main --jq .sha`,
  compara contra `DEPLOY_SHA`, `exit 1` si no coincide o si la llamada
  falla (`set -euo pipefail`, sin `|| true`).
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

- [ ] TDD: escribir `deploy-approval-watchdog.test.sh` primero. Casos
  (mismo formato de estado que `qa-drift-check.mjs`: JSON con `now`,
  `mainSha`, `mainCommittedAt`, `graceMinutes`, `runs: [{databaseId,
  headSha, status, conclusion, createdAt}]`):
  - no existe ningún run para la punta de `main` → `action: alert`
    ("nada se está desplegando para este commit")
  - el run de la punta de `main` está `completed`/`success` → `action: ok`
  - el run sigue sin `completed` (incluye "esperando aprobación del hook
    de auth"), dentro de los 60 min desde `mainCommittedAt` → `action:
    in_flight`
  - el run sigue sin `completed`, o terminó en `failure`/`cancelled`,
    ≥ 60 min desde `mainCommittedAt` → `action: alert`, con el número de
    run y minutos transcurridos en el motivo
  - dos o más runs sin `completed` simultáneos para commits distintos →
    `action: alert` señalando cuál corresponde a la punta actual y
    recomendando cancelar los demás (el riesgo de spec-57 nunca cerrado:
    dejar correr/aprobar el viejo tras el nuevo despliega código viejo)
  - **estado incompleto o inválido** (falta `mainSha`, `runs` no es
    array, etc.) → nunca `ok` ni `alert` con datos inventados; exit code
    distinto de 0 y 1, mismo patrón que `qa-drift-check.mjs` — fallar
    cerrado ante un error propio, no confundir "no pude preguntar" con
    "no hay nada que reportar"
- [ ] Confirmar rojo por "no such file", implementar
  `deploy-approval-watchdog.mjs` (función pura + CLI, mismo estilo que
  `qa-drift-check.mjs`).
- [ ] Verde.
- [ ] Escribir `.github/workflows/deploy-approval-watchdog.yml`: cron cada
  15 min + `workflow_dispatch`, un job `ubuntu-latest`, reúne los runs de
  `deploy.yml` vía `gh api
  repos/:owner/:repo/actions/workflows/deploy.yml/runs?per_page=20` (mismo
  llamado que ya hace `qa-drift-watchdog.yml`), corre el script, y con su
  veredicto abre/actualiza/cierra un único issue con label
  `deploy-approval-stale` — mismo patrón de alarma/standdown que
  `qa-drift-watchdog.yml` (`gh issue list --label ... | comment o create`,
  `gh issue close` cuando vuelve a `ok`).
- [ ] El cuerpo del issue linkea directamente al run (o runs) sin
  resolver y al runbook `docs/runbooks/approve-production-deploy.md`.
- [ ] Commit.

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
