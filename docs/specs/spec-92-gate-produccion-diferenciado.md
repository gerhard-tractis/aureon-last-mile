# spec-92 — el gate de producción distingue el camino verde de todo lo demás

**Status:** in progress
**Verify:** unit
**Depende de:** spec-57-qa-gate-before-production.md (`completed`)

> **Para agentes:** usa `superpowers:test-driven-development` en cada fase.
> Los tokens de fase van al final de cada heading — ver `docs/specs/CLAUDE.md`.

**Goal:** un merge a `main` cuyo `e2e-qa` está verde **y** cuyo run es el más
reciente contra la punta actual de `main` llega a producción sin esperar un
clic humano. Todo lo demás — `e2e-qa` rojo, un run superado por uno más
nuevo, o cualquier fallo al determinarlo — no se aprueba. Un vigilante
detecta y avisa cuando un run se queda parado sin resolverse.

---

## Decisión de diseño — revisada a mitad de implementación

La primera versión de este spec proponía distinguir migraciones del resto
del diff, conservando el clic humano sólo para cambios que tocaran
`packages/database/supabase/migrations/`. **Esa distinción se descartó**
antes de escribir código, verificada contra el pipeline real:

`deploy-qa` (`.github/workflows/deploy.yml`) corre
`infra/supabase-qa/deploy-qa.sh`, que aplica la migración a QA. `e2e-qa`
(`needs: [changes, deploy-qa]`) corre **contra esa migración ya aplicada**.
`approve-production` exige `needs.e2e-qa.result == 'success'`. **La
migración ya se prueba en QA antes de que producción sea alcanzable** —
antes de que exista ningún clic. Y `check-migration-safety.sh` corre en CI
sobre el PR (`ci.yml`), cazando el patrón DDL+backfill antes del merge. La
red de seguridad automática ya cubre lo que el clic pretendía cubrir, y es
más fuerte: corre siempre, no depende de que alguien esté despierto.

Más decisivo aún: **el clic lo daba el orquestador**, que no tiene forma de
auditar una migración — no revisa el SQL con más criterio que el que ya
aplica `check-migration-safety.sh`. Un control que nadie ejerce con
criterio propio no es un control; es una pausa.

Este spec por tanto **no distingue por tipo de cambio**. Auto-aprueba el
camino verde siempre: `e2e-qa` verde, y el run vigente.

## Por qué esto no contradice a spec-57 — lo afina

spec-57 (`completed`) introdujo `approve-production` para arreglar un
estado medido así: *"merge a `main` = producción, ~10 minutos después, con
cero checkpoint humano"*. Sigue teniendo razón sobre ese problema — el
checkpoint sigue existiendo. Lo que cambia es **quién es el checkpoint**:

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
   pero no es un argumento a favor del clic: el clic nunca verificó eso
   tampoco. Lo que de verdad falta ahí (escala de producción, divergencia
   de entorno) se declara sin tapar más abajo, en vez de fingir que un
   clic humano lo cubría.

Con esos dos hechos, el checkpoint de spec-57 no desaparece — se vuelve
`e2e-qa`, que es más consistente que un humano (corre siempre, no se
olvida, no depende de quién esté de turno) para exactamente lo que el clic
podía comprobar.

## El problema, medido

`Deploy Production` pausaba en `approve-production` para todo merge, sin
excepción. En una sesión se acumularon **cuatro runs sin aprobar**;
durante horas se creyó que producción estaba al día porque los checks de
CI estaban verdes. El costo no fue evitar un despliegue malo: fue no darse
cuenta de que uno bueno no había llegado — y el que debía notarlo no podía
ejercer ningún criterio que el pipeline no aplicara ya.

Dos riesgos distintos:

| Riesgo | Defensa antes de este spec | Defensa después |
|---|---|---|
| Algo malo llega a producción sin que nadie/nada mire | clic humano (spec-57) | `e2e-qa` verde + freshness check (obligatorios, estructurales) |
| Algo bueno no llega y todos creen que sí | ninguna | vigilante (Fase 3) |

## Decisión: sin pausa de GitHub Environment — un chequeo dentro del job

`approve-production` deja de declarar un `environment:` con revisores
requeridos. No hay pausa que forzar ni API de aprobación que llamar — la
opción de aprobar programáticamente vía `gh api .../pending_deployments`
se descartó: requiere que el actor (`github-actions[bot]`) esté en la
lista de revisores del entorno, y GitHub no admite bots como revisores
requeridos. Intentarlo habría cambiado "nadie aprueba" por "el bot se
autoaprueba siempre", que no es una comprobación — es teatro con una
llamada de red de más de la que depender, y una superficie nueva de "qué
hago si `gh api` falla" que la regla de fallar cerrado obliga a resolver
en "no aprobar", el mismo estado que ya existe sin tocar nada.

En su lugar, `approve-production` sigue siendo el job por el que pasa todo
despliegue de producción (sin cambios en esa parte de la arquitectura de
spec-57), pero:

1. **Su `if:` sigue exigiendo `needs.e2e-qa.result == 'success'`** — sin
   cambios respecto a spec-57 Fase 2.
2. **Gana un paso nuevo: "Verify this run is current"**, que compara
   `DEPLOY_SHA` contra la punta actual de `main` (`gh api
   repos/:owner/:repo/commits/main --jq .sha`) y **falla el job** si no
   coinciden. Un run que perdió la carrera contra un merge posterior no
   despliega código viejo encima de uno más nuevo — el riesgo que spec-57
   documentó y nunca cerró ("Known consequence… approving an older queued
   run after a newer one has deployed would put older code in
   production").
3. El entorno `production` (con `required_reviewers`, creado en spec-57)
   **se despoja de esa regla de protección** — cambio de configuración
   viva de GitHub, no de este YAML. Post-merge, manual, igual que spec-57
   Task 5 lo fue en sentido inverso. **No se ejecuta en esta sesión** —
   ver Fase 1, último paso, marcado explícitamente para el orquestador o
   el usuario.

Con eso, `approve-production` corre sin pausar en cuanto sus dos
condiciones (E2E verde, run vigente) se cumplen — sin excepción por tipo
de cambio, sin llamada a ninguna API de aprobación, sin nada que dependa
de que alguien lea algo.

**Reusa, no duplica, el cálculo de "qué tocó esto".** Ninguna condición
nueva de este spec vuelve a calcular un diff de paths — la única señal
nueva es la comparación de SHA contra `main`, que no tiene equivalente
existente en el repo.

**Fail-closed, explícito en cada punto nuevo:**
- Si el paso de "Verify this run is current" no puede determinar la punta
  de `main` (la llamada a `gh api` falla), el paso debe fallar el job —
  nunca asumir "soy el vigente" por defecto. Ver Fase 1, Paso 2.
- Si `e2e-qa` no puede determinarse (el job no corrió, fue cancelado), la
  condición `needs.e2e-qa.result == 'success'` ya es `false` para
  cualquier cosa que no sea exactamente `'success'` — sin cambios,
  heredado de spec-57.

## Decisión: X = 60 minutos para runs sin resolver, cron cada 15

El vigilante nuevo (Fase 3) reporta cuando el run de `deploy.yml` que
corresponde a la punta actual de `main` lleva más de X minutos sin
terminar en éxito — ya sea porque sigue corriendo, porque falló (E2E rojo,
freshness check, cualquier job de la cadena), o porque fue cancelado.
`qa-drift-watchdog.yml` ya usa una ventana de 20 minutos para drift de QA,
pero esa ventana mide *tiempo desde el merge* para un proceso que en
condiciones normales tarda minutos. El incidente medido en este spec fueron
**horas** de cuatro runs acumulados. 60 minutos separa "todavía corriendo
en su orden normal" de "esto se olvidó", sin gritar en cada deploy que
tarda un poco por cola. Cron cada 15 minutos, igual que
`qa-drift-watchdog.yml`, para que el retraso máximo de detección sea 75
minutos.

## Qué NO se auto-aprueba

- **`e2e-qa` rojo** — `approve-production` no corre (su `if:` lo exige).
  Sin cambios de spec-57.
- **Un run superado por uno más nuevo** — el paso "Verify this run is
  current" (Fase 1) lo falla explícitamente. El vigilante (Fase 3) además
  señala cuándo hay más de un run sin resolver a la vez.
- **Cualquier fallo al determinarlo** — la llamada a `gh api` para leer la
  punta de `main` falla, el job `changes` falla, lo que sea: el paso nuevo
  falla cerrado, nunca asume que puede continuar.

## Los huecos que el clic tampoco tapaba — declarados, no construidos aquí

El clic humano nunca fue una defensa real contra estas dos clases de
fallo, y auto-aprobar no las empeora — sólo dejan de tener siquiera la
ilusión de cobertura:

| Hueco | Por qué el clic no lo cubría | Qué lo cubriría (fase futura, no construida aquí) |
|---|---|---|
| **Escala de producción** — ~112k despachos, ~61k paquetes; un backfill que expira ahí y en ningún otro entorno (QA no tiene ese volumen) | Nadie mide el volumen de una tabla al hacer clic; es información que no está en pantalla | Un chequeo en `check-migration-safety.mjs` que, para migraciones con `UPDATE`/`DELETE` masivo sin `WHERE` acotado sobre tablas nombradas en una lista de "grandes" (o mejor, consultadas contra `pg_stat_user_tables` de producción antes de aprobar), avise en el PR — no en el deploy |
| **Divergencia QA/producción** — QA es self-hosted, producción es Supabase gestionado; el modo de GUC de PostgREST y el hook de auth difieren, y un review reciente bloqueó un PR precisamente por inferir QA→prod | El clic ocurría mirando QA; nunca comparó configuración contra producción, porque no hay dónde mirar eso en la UI de aprobación | Un job de paridad que, antes de aprobar, compare valores de configuración conocidos-divergentes (modo GUC, versión de PostgREST) entre ambos proyectos vía API de Supabase, y bloquee sólo si la divergencia no es la ya documentada como esperada |

Ninguna de las dos se construye en este spec — declararlas es el
entregable; construirlas requiere decidir umbrales y falsos positivos que
no se pueden resolver leyendo el código actual.

## File structure

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `.github/workflows/deploy.yml` | `approve-production` sin pausa de entorno, con freshness check | Modificar |
| `scripts/check-deploy-gating-autoapprove.mjs` | Invariantes nuevas: freshness check presente y con fail-closed, `e2e-qa` sigue siendo obligatorio | Crear |
| `scripts/check-deploy-gating.mjs` | Importa y agrega los errores del archivo anterior | Modificar |
| `scripts/check-deploy-gating-autoapprove.test.sh` | Tests + mutation-test de las invariantes nuevas | Crear |
| `.github/workflows/ci.yml` | Corre el test nuevo | Modificar |
| `scripts/deploy-approval-watchdog.mjs` | Decisión pura: ¿el run de la punta de `main` lleva > X sin resolverse? | Crear |
| `scripts/deploy-approval-watchdog.test.mjs` | Tests del anterior | Crear |
| `.github/workflows/deploy-approval-watchdog.yml` | Cron 15min, reúne estado vía `gh api`, abre/actualiza un único issue | Crear |
| `.github/workflows/README.md` | Diagrama y tabla de jobs actualizados | Modificar |
| `docs/runbooks/approve-production-deploy.md` | Reescrito: ya no hay pantalla de aprobación en el camino normal | Modificar |

---

### Fase 1 — sin pausa: `approve-production` se autoaprueba en el camino verde `[pending]`

**Archivos:**
- Modificar: `.github/workflows/deploy.yml`

- [ ] Quitar `environment: production` del job `approve-production`.
- [ ] Añadir un paso `Verify this run is current` **antes** del paso
  existente, que:
  - lee la punta real de `main` vía
    `gh api repos/${{ github.repository }}/commits/main --jq .sha`
  - compara contra `DEPLOY_SHA`
  - si no coinciden, o si la llamada a `gh api` falla (fail-closed:
    `set -euo pipefail`, sin `|| true`), termina el job con `exit 1` y un
    mensaje explicando que un run más nuevo superó a este
- [ ] Actualizar el comentario del job explicando el nuevo comportamiento y
  citando este spec en vez de (o adicional a) spec-57.
- [ ] `node -e "require('js-yaml').load(...)"` para confirmar que el YAML
  sigue parseando.
- [ ] Commit.
- [ ] **Paso manual, post-merge — NO ejecutar en esta sesión:** quitar la
  regla de `required_reviewers` del entorno `production` en GitHub
  (`gh api -X PUT repos/:owner/:repo/environments/production -f
  'reviewers=[]'` o equivalente desde la UI). Documentado aquí para quien
  mergee, siguiendo el mismo patrón de spec-57 Task 5 (orden importa:
  mergear primero, cambiar la config después, para que el propio PR no
  quede esperando una pausa que ya no debería existir en el YAML pero que
  la config vieja todavía impondría).

---

### Fase 2 — el guardarraíl aprende la regla nueva `[pending]`

TDD estricto: escribe primero los tests contra fixtures YAML, corre y
observa que fallan por la razón correcta, luego implementa.

**Archivos:**
- Crear: `scripts/check-deploy-gating-autoapprove.mjs`
- Crear: `scripts/check-deploy-gating-autoapprove.test.sh`
- Modificar: `scripts/check-deploy-gating.mjs` (importa y agrega errores,
  mismo patrón que `check-deploy-gating-quarantine.mjs`)
- Modificar: `.github/workflows/ci.yml`

Invariantes nuevas a afirmar — cada una con un fixture que falla sin el
chequeo:

1. **`approve-production` debe contener un paso cuyo `run:` compare
   `DEPLOY_SHA`/`github.sha` contra la punta de `main` vía `gh api
   .../commits/main`**, y ese paso no puede llevar `continue-on-error:
   true` ni un `|| true` al final de su `run:` — cualquiera de los dos
   convertiría un "no pude determinarlo" en "sigo adelante", exactamente
   lo que la regla de fallar cerrado prohíbe.
2. **`approve-production` sigue exigiendo `needs.e2e-qa.result ==
   'success'`** — invariante ya cubierta por `check-deploy-gating.mjs`
   desde spec-57/spec-87; este spec no la debilita, así que el fixture
   `GOOD` de este archivo nuevo debe seguir pasando el chequeo existente
   también (test de integración entre ambos archivos).
3. **Ningún job de `PROD_JOBS` puede declarar su propio `environment:`
   con revisores** — si alguno reintrodujera una pausa por su cuenta,
   rompería la garantía de "sin excepción" sin que el chequeo de arriba lo
   viera, porque ese job nunca pasa por el paso de freshness de
   `approve-production`.

- [ ] Escribir `check-deploy-gating-autoapprove.test.sh` con fixtures
  `GOOD` (paso de freshness presente, sin `continue-on-error`, sin
  `|| true`), `NO_FRESHNESS_STEP` (falta el paso — debe fallar),
  `SWALLOWED_FRESHNESS` (`continue-on-error: true` en el paso — debe
  fallar), `SILENCED_FRESHNESS` (`|| true` al final del `run:` — debe
  fallar), `PROD_JOB_OWN_ENV` (un job de `PROD_JOBS` con `environment:`
  propio — debe fallar).
- [ ] Correr, confirmar rojo por "no such file" o por falta del chequeo,
  no por un error de fixture.
- [ ] Implementar `check-deploy-gating-autoapprove.mjs`, exportando una
  función que reciba `jobs` y devuelva un array de errores, mismo estilo
  que `check-deploy-gating-quarantine.mjs`.
- [ ] Conectar en `check-deploy-gating.mjs`.
- [ ] Verde.
- [ ] **Mutation-test manual:** contra el YAML real de Fase 1, revertir
  cada uno de los tres chequeos uno por uno (quitar el paso, añadirle
  `continue-on-error: true`, añadirle `|| true`, darle su propio
  `environment:` a un `PROD_JOBS`) y confirmar que el guard se pone rojo
  en cada caso. Documentar el resultado en el reporte de esta fase.
- [ ] Añadir a `ci.yml` junto a los demás `check-deploy-gating*.test.sh`.
- [ ] Commit.

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
- Crear: `scripts/deploy-approval-watchdog.test.mjs`
- Crear: `.github/workflows/deploy-approval-watchdog.yml`

- [ ] TDD: escribir `deploy-approval-watchdog.test.mjs` primero. Casos
  (mismo formato de estado que `qa-drift-check.mjs`: JSON con `now`,
  `mainSha`, `mainCommittedAt`, `graceMinutes`, `runs: [{databaseId,
  headSha, status, conclusion, createdAt}]`):
  - no existe ningún run para la punta de `main` → `action: alert`
    ("nada se está desplegando para este commit")
  - el run de la punta de `main` está `completed`/`success` → `action: ok`
  - el run sigue sin `completed`, dentro de los 60 min desde
    `mainCommittedAt` → `action: in_flight`
  - el run sigue sin `completed`, o terminó en `failure`/`cancelled`,
    ≥ 60 min desde `mainCommittedAt` → `action: alert`, con el número de
    run y minutos transcurridos en el motivo
  - dos o más runs sin `completed` simultáneos para commits distintos →
    `action: alert` señalando cuál corresponde a la punta actual y
    recomendando cancelar los demás (el riesgo de spec-57 nunca cerrado:
    aprobar/dejar correr el viejo tras el nuevo despliega código viejo)
  - **estado incompleto o inválido** (falta `mainSha`, `runs` no es
    array, etc.) → nunca `ok` ni `alert` con datos inventados; exit code
    distinto de 0 y 1, mismo patrón que `qa-drift-check.mjs` línea de
    validación de campos obligatorios — fallar cerrado ante un error
    propio, no confundir "no pude preguntar" con "no hay nada que
    reportar"
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

### Fase 4 — documentación `[pending]`

**Archivos:**
- Modificar: `.github/workflows/README.md`
- Modificar: `docs/runbooks/approve-production-deploy.md`

- [ ] Actualizar el diagrama de flujo: ya no hay pausa humana en el camino
  normal; `approve-production` corre automáticamente si `e2e-qa` está
  verde y el run es vigente.
- [ ] Reescribir el runbook: ya no describe cómo aprobar manualmente en el
  caso normal. Explica: cuándo un run **no** avanza (E2E rojo, run
  superado), qué significa el issue de `deploy-approval-stale`, y cómo
  investigar un run atascado (sigue existiendo el escape manual de
  `docs/runbooks/manual-deployment.md`).
- [ ] Añadir la tabla de huecos declarados (escala, divergencia QA/prod)
  de este spec al runbook o dejarla enlazada — que quien investigue un
  incidente de producción sepa que esas dos clases de fallo no tienen
  comprobación automática todavía.
- [ ] Commit.

**Verify:** unit

---

## Riesgos y lo que se aceptó deliberadamente

| Riesgo | Mitigación |
|---|---|
| El entorno `production` sigue con `required_reviewers` en GitHub porque el paso manual de Fase 1 no se ejecutó | El PR mergeado no se auto-despliega — sigue pausando, visiblemente, hasta que alguien corra ese paso. Falla hacia el lado seguro (más pausa, no menos). |
| El paso de freshness introduce una llamada a red más por deploy (`gh api .../commits/main`) | Barata, de sólo lectura, ya usada por `qa-drift-watchdog.yml` para lo mismo — no es infraestructura nueva. |
| Escala de producción y divergencia QA/prod, huecos reales | Declarados arriba, no fingidos como cubiertos. Cualquier incidente de esa clase es evidencia para priorizar la fase futura correspondiente, no una sorpresa. |
| El vigilante de Fase 3 se queda mudo si `gh api` falla | Sigue la regla de fallar cerrado: un fallo de la consulta no cierra el issue existente ni reporta `ok` — ver el caso de test dedicado en Fase 3. |

## Out of scope

- Aprobar vía `gh api .../pending_deployments` (descartado arriba —
  requiere un revisor que GitHub no permite que sea un bot).
- Construir las dos comprobaciones de la tabla de huecos declarados
  (escala, divergencia QA/prod) — quedan como fases futuras con su
  argumento, no como trabajo pendiente de este spec.
- Cambiar el criterio de `e2e-qa` o su quarantine (spec-87) — sin cambios.
- Promover o degradar cualquier otro job del pipeline.
