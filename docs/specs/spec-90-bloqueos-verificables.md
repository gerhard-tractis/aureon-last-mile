# Spec-90: Guardarraíl de bloqueos verificables

> **Related:** [spec-87](spec-87-desbloquear-produccion.md) (la cuarentena de tests, `check-quarantine-validate.mjs`, es el precedente directo del horizonte de 30 días y de `::warning file=,line=`), [spec-88](spec-88-anon-security-definer-audit.md) (fase 3 es hoy el `[blocked]` mejor documentado del repo, sin traer todavía la línea que este spec exige), [docs/specs/CLAUDE.md](CLAUDE.md) (documenta el campo `> Bloqueo:` y la evidencia por fase), [feat/spec-89-guardarrail-paralelismo] (rama en paralelo tocando `scripts/check-spec-fields.sh` y `.claude/agents/*.md` — ver sección de coordinación)

**Status:** in progress
**Verify:** unit
**Downstream:** ninguno todavía — este spec construye el guardarraíl; ningún otro spec consume su resultado hasta que alguien escriba un `> Bloqueo:` de verdad

_Date: 2026-09-08_

---

## El problema, con la evidencia de hoy

Un bloqueo declarado se propaga sin verificarse, y una afirmación no
verificada se vuelve permanente porque el siguiente que la lee la hereda.
Pasó hoy en dos niveles.

**Nivel spec.** De ocho fases `[blocked]` del bloque 80–88 que una auditoría
revisó, sólo tres lo estaban de verdad:

- `spec-84` fase 1 y `spec-54:486` afirmaban que `public.users` y
  `public.drivers` «nada las liga». **Falso**:
  `20260318000004_agent_suite_tables.sql:253-254` declara
  `user_id UUID REFERENCES public.users(id)` desde el 2026-03-18. Esa
  afirmación sin comprobar es la raíz de cuatro fases paradas
  (`spec-84` fases 1, 2, 3, 4 — 2 y 4 dependen de 1 y 3).
- `spec-82` fase 4 y `spec-83` fase 2 afirmaban que
  `pickup_points.pickup_locations` es `{name, address, comuna}` y que «no hay
  campo». **Falso**: la misma migración declara además `operating_hours`,
  `lat`, `lng`, `contact_phone`, y `sla_config.pickup_cutoff_time`.
- `spec-86` fase 2b estaba bloqueada por una decisión que el usuario **ya
  había tomado ese mismo día**, en un commit posterior al último toque del
  spec (el propio archivo ya trae hoy la actualización del 2026-09-08 con lo
  decidido, y con lo que sigue legítimamente abierto).

**Nivel agente.** Tres veces un subagente declaró algo imposible que era
falso *para el orquestador*, y el orquestador reenvió el bloqueo al usuario
sin comprobarlo:

- «no tengo acceso a Claude Design» → el orquestador tiene `DesignSync`.
- «solo tú puedes lanzar este workflow» → `gh workflow run` está disponible
  para el orquestador.
- «no tengo credenciales de producción» → el pipeline las tiene como
  secretos, usables desde un workflow (`verify-prod-migrations` las usa en
  cada deploy).

**Recuento propio, contra la realidad del repo al escribir este spec**
(`grep -rnE '^#{2,4} .*\[blocked\]' docs/specs/*.md`, 2026-09-08): **10**
headings `[blocked]` reales en 6 specs — `spec-75` (1), `spec-82` (2),
`spec-83` (1), `spec-84` (4), `spec-86` (1), `spec-88` (1). Ninguno trae hoy
una línea `> Bloqueo:` porque el campo no existía antes de este spec. El
número de "ocho" del encargo original contaba probablemente sólo el rango
80–88 con un criterio ligeramente distinto de qué cuenta como fase — la
discrepancia no cambia la conclusión: la mayoría de los bloqueos declarados
no traían evidencia verificable, y con la regla nueva, ninguno la trae
todavía. **Es una foto del 2026-09-08, no una invariante** — `bbc6eb7`
(PR #687) backfilleó la decisión de spec-86 esa misma tarde y la sacó de la
lista horas después de escribirse este párrafo; por eso ningún test de este
spec fija ya un recuento ni una lista de nombres (ver pieza 1).

## Las tres piezas

### 1. `scripts/check-blocked-evidence.sh` — evidencia obligatoria en toda fase bloqueada

Nuevo script, hermano de `check-spec-fields.sh` (no lo modifica — ver
*Coordinación con spec-89* más abajo), que exige un bloque `> Bloqueo:` en el
cuerpo de toda fase `[blocked]`, con cuatro cosas. Puede ser una línea o
varias líneas de blockquote consecutivas — el guard concatena el bloque
completo antes de validar, porque el propio ejemplo canónico las reparte en
tres para que quepan sin desbordar (**round 2 de review**: un spec que
siguiera el ejemplo de `docs/specs/CLAUDE.md` al pie de la letra se comía un
rojo reclamándole justo los tres campos que sí había escrito, porque el guard
original sólo leía la primera línea):

```
> Bloqueo: se intentó resolver "asignados a ti" contra manifests.assigned_to_user_id
> — verificado en el esquema QA: la columna existe y está NULL en todas las filas
> — 2026-09-08 — desbloquea: usuario (quién asigna y desde dónde: spec-82 §1)
```

- **Qué se intentó** — heurística: la línea debe nombrar el intento
  (cualquier conjugación de "intentar"), y no ser la negación vacía
  "(no) se intentó nada".
- **Contra qué se verificó** — heurística: debe nombrar la verificación
  (cualquier conjugación de "verificar", incluida "verifiqué") — fichero:línea,
  consulta, o salida de comando — y tampoco vale como negación vacía
  "(no) se verificó nada".
- **Cuándo** — una fecha real de calendario, `YYYY-MM-DD` (mismo chequeo de
  fecha-real que `check-quarantine-validate.mjs`: `2026-02-30` no cuela).
- **Quién puede desbloquearlo** — `desbloquea: usuario | agente | dependencia`
  (singular o plural). `dependencia` exige nombrar el spec
  (`dependencia (spec-81)`); una dependencia sin nombrar no es información,
  es la misma frase de siempre con una palabra nueva.

**Escape hatch desde el primer día:** `(indeterminado — <razón real>)`
reemplaza "qué se intentó"/"contra qué se verificó" cuando de verdad no se
puede articular todavía contra qué se verificó — fecha y quién desbloquea
siguen siendo obligatorios porque sí son conocidos. Un relleno ("razón",
"TODO", "???") no pasa. Es la misma lección que `**Depende de:**` (spec-91,
#699) documentó primero: un campo obligatorio sin salida honesta convierte
una negativa correcta en un build rojo, y no se retrofitea después de romper
CI una vez — nace con la salida desde el día uno.

**«No tengo acceso a X» no es un bloqueo válido por sí solo.** El guard no
puede leer intención, pero la regla queda escrita en `docs/specs/CLAUDE.md` y
en los tres `.claude/agents/*.md`: sólo cuenta si «qué se intentó» dice a
quién se escaló y «contra qué se verificó» dice qué contestó (o que no
contestó). Es la corrección directa a los tres casos de hoy, donde "no tengo
acceso" se usó para bajar el listón de verificación sin escalar nada.

**Diff-scoped, igual que `check-spec-fields.sh` en intención, ya no en
mecanismo.** El guard sólo mira los specs que el PR **toca** — los specs
viejos migran cuando alguien los toca, mismo patrón que ya usa `**Verify:**`
en este mismo archivo. Pero **cómo** se calcula "qué toca el PR" cambió tres
veces en `ci.yml` durante el review (round 2, 3 y 4; diagnóstico completo en
*Decisión explícita* más abajo):

- Localmente (`check-blocked-evidence.sh --base <ref>` o con archivos
  explícitos), sigue siendo un diff de `git` — no hay merge-ref inflado en un
  checkout normal, así que no hace falta más.
- En CI, para `pull_request`, el paso ya **no** usa `git diff` en absoluto:
  usa `gh api repos/.../pulls/<N>/files`, la lista autoritativa de GitHub —
  inmune al `HEAD` inflado (`refs/pull/<N>/merge`, el merge sintético de esta
  rama con el `main` del momento del checkout) que rompió los dos intentos
  anteriores con `git`.
- Para `merge_group`, sigue el diff con `git` y `--base` — no confirmado si
  le afecta algún defecto equivalente; no está activo todavía en este repo.
- Para `push` (sin PR del que pedir la lista), el paso **se salta** — round 4
  encontró que la base `github.event.before` tenía el mismo bug que el
  `HEAD` inflado, sólo que por el lado del `push`: un diff de tres puntos
  contra `before` abarca cualquier fusión de `main` que venga en el rango
  (medido sobre el propio commit de sincronización de esta rama: 10 specs
  en vez de 0). La corrida de `pull_request` ya es autoritativa y cubre el
  caso real, así que se salta en vez de buscar una base mejor — mismo
  criterio que ya usa `check-spec-fields.sh`.

**Cuántos fallarían hoy si el guard fuera repo-wide en vez de diff-scoped:**
no se cuenta aquí a propósito — cualquier número fijo se pudre en cuanto se
backfillea o se rompe un spec más. `scripts/check-blocked-evidence.test.sh`
lo mide **dinámicamente** contra el corpus real en cada corrida (recorre
`docs/specs/spec-*.md`, junta los `[blocked]` sin `> Bloqueo:` de hoy, y
afirma que el conjunto no está vacío y que cada miembro falla contra el
guard) — así el número correcto es "el que sea hoy", no una foto congelada.

### 2. `scripts/check-blocked-freshness.sh` — caducidad, en modo aviso

Un bloqueo verificado hace cinco meses no es un bloqueo verificado — el caso
de `drivers.user_id` lo demuestra: la afirmación tenía razón el día que se
escribió (marzo) y dejó de tenerla sin que nadie lo notara.

**Horizonte: 30 días**, igual que `MAX_HORIZON_DAYS` en
`check-quarantine-validate.mjs` para la cuarentena de tests. Mismo mecanismo
análogo, ya probado en este repo, y misma pregunta detrás: «¿sigue siendo
cierto lo que se afirmó?». No hay una razón específica de dominio para que un
bloqueo de spec caduque en un plazo distinto al de un test en cuarentena —
ambos son "una afirmación que alguien tiene que revalidar antes de que se
vuelva invisible", y usar el mismo número evita inventar una segunda
constante que hay que justificar por separado.

**Avisa, no rompe — decisión tomada, no accidente.** Romper CI por un
bloqueo caducado hace que alguien desactive el guard; un aviso no. El script:

- corre sobre **todos** los specs del repo, no sólo los tocados — un
  bloqueo puede caducar sin que nadie vuelva a tocar ese archivo, y un aviso
  no tiene el problema de transición que sí tiene el guard duro;
- nunca falla (`exit 0` siempre);
- usa `::warning file=…,line=…::` — **no** `::warning::` a secas. El review
  de `spec-87` encontró que un aviso sin `file=`/`line=` anota el job y
  **no aparece en el diff ni en `gh pr checks`**, invisible en un flujo con
  auto-merge. Los `::warning::` existentes en `check-migration-safety.mjs`
  tienen exactamente ese defecto — no se tocan aquí (fuera de alcance), pero
  quedan como el ejemplo de lo que no repetir;
- vuelca también a `$GITHUB_STEP_SUMMARY` una tabla legible, como respaldo
  del `::warning::` línea por línea.

Corrida real contra el repo el 2026-09-08 (`--today 2026-09-08`, antes de que
`bbc6eb7`/PR #687 backfilleara spec-86 esa misma tarde): 10 avisos, uno por
cada fase `[blocked]` sin `> Bloqueo:` en ese momento. Ese número ya no es el
de hoy — es una foto, no una invariante — y no se vuelve a fijar aquí por la
misma razón que la pieza 1 dejó de contar specs por nombre: `exit 0` siempre,
sea cual sea el recuento del día.

### 3. Los agentes declaran capacidad que les falta, no imposibilidad

En `.claude/agents/implementer.md`, `reviewer.md` y `qa-e2e.md`: nueva
sección `## No declares algo imposible — declara qué capacidad falta y quién
la tiene`, con la tabla de lo que el orquestador tiene y ellos no:

| Capacidad | Orquestador | Subagente |
|---|---|---|
| `DesignSync` (mocks de Claude Design) | sí | no |
| `gh workflow run` / `gh run view` | sí | no |
| Aprobación de despliegue a producción | sí, delegada por el usuario | no |
| Secretos de CI (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`) | usables desde un workflow disparado por él | no directamente |

Y la regla simétrica para el orquestador, en `docs/specs/CLAUDE.md`: **antes
de trasladar un bloqueo al usuario, verificarlo contra su propia tabla de
capacidades.** Hoy falló tres veces exactamente ahí.

`scripts/check-harness-present.sh` se extendió (barato: un `grep -qE '^##
No declares algo imposible'` por agente, mismo patrón que ya usa para
`name:`/`description:`) para que la ausencia de esa sección en cualquiera de
los tres agentes rompa CI — igual de duro que la ausencia del agente mismo,
porque un agente sin esa sección vuelve a poder repetir el error de hoy.

## Decisión explícita: qué queda fuera, a propósito

- **No se reescriben los `::warning::` sin `file=`/`line=` que ya existen en
  `check-migration-safety.mjs`.** Es el mismo defecto que este spec evita
  cometer de nuevo, pero arreglarlo ahí es una fase de otro spec — tocar ese
  archivo no es necesario para el guardarraíl de bloqueos.
- **No se retrofitea `> Bloqueo:` en los specs reales que hoy carecen de él.**
  Es tentador —para varios ya sé exactamente qué deberían decir— pero esos
  specs pertenecen a fases activas de otros implementers y escribir contenido
  de dominio ahí no es "construir el guardarraíl", es "usar el guardarraíl",
  que le toca a quien tome esa fase la próxima vez que la toque. El guard se
  prueba contra el corpus real de forma dinámica (ver *Verify* y
  `check-blocked-evidence.test.sh`), así que la validación no depende de
  retrofitear ninguno en concreto ni de mantener una lista.
- **No se valida contenido semántico del `> Bloqueo:`** más allá de los
  chequeos heurísticos descritos — el guard no puede juzgar si "se intentó Y"
  es verdad, sólo que el bloque tiene la forma que un bloqueo real necesita
  (y, desde la ronda 2 de review, que no es una negación vacía de sí mismo:
  "se intentó nada" y "no se verificó nada" ya fallan explícitamente). Es un
  nivel de rigor más alto que el que `check-spec-fields.sh` ya aplica a
  `> Implementado por:`/`> Review:`/`> QA:`: comprueba presencia, no verdad.
- **No se cambia el horizonte por tipo de bloqueo** (usuario vs. dependencia
  vs. agente). Un solo número, documentado y justificado contra el
  precedente de cuarentena — introducir tres horizontes distintos sin un
  caso real que lo pida sería complejidad sin evidencia detrás.
- **No se arreglan los pasos gemelos de `ci.yml` que comparten el mismo
  defecto de diff-scoping** (`check-spec-fields.sh` en "Check spec fields on
  touched specs", y `check-migration-safety.sh` en "Check new migrations for
  unsafe patterns") — diagnóstico completo abajo, a propósito escrito aquí y
  no sólo en el PR, para que quien retome esto no tenga que redescubrirlo.

### Diagnóstico: tres pasos de `ci.yml` calculan "qué tocó este PR" de tres
### formas distintas, y ninguna de las otras dos está arreglada

Round 3 de review encontró que el propio arreglo de esta fase para
`check-blocked-evidence` estaba incompleto (ver más abajo), y que confirmar
eso llevó a mirar los pasos hermanos: **los tres pasos diff-scoped de
`ci.yml` tienen hoy tres respuestas distintas al mismo problema**:

1. **`check-spec-fields.sh`** (`ci.yml`, paso "Check spec fields on touched
   specs"): conserva el patrón original completo — `--base
   "${{ github.event.pull_request.base.sha }}"` diffeado con `git` contra el
   `HEAD` implícito del checkout, sin fallback de `merge_group`, y con el
   defecto de fondo (`HEAD` en `pull_request` es `refs/pull/<N>/merge`, el
   merge sintético de esta rama con el `main` del momento del checkout — ver
   el diagnóstico de la pieza 1 abajo). Es el bug tal cual round 2 lo
   encontró en `check-blocked-evidence`, sin ninguno de los dos arreglos.
2. **`check-migration-safety.sh`** (`ci.yml`, paso "Check new migrations for
   unsafe patterns"): tiene el fallback de tres niveles
   (`pull_request`/`merge_group`/`push`) desde antes de spec-90 (m10, review
   round 1), pero **no se revisó** si el mismo defecto de fondo le afecta
   igual — y round 4 encontró que el defecto de fondo tiene **dos** formas,
   no una: el `HEAD` inflado en `pull_request` (que este paso no sufre,
   porque no usa el `HEAD` implícito del checkout para nada propio — corre
   sobre los ficheros de migración, no sobre un diff de specs) y la base
   `github.event.before` en `push`, que **si** afecta a este paso, porque su
   fallback de `push` es textualmente el mismo patrón que rompió round 4 en
   `check-blocked-evidence` (un diff de tres puntos contra `before` que
   puede abarcar una fusión entera de `main`). No confirmado con una prueba
   aquí — fuera de alcance de esta fase — pero el mecanismo es idéntico, no
   análogo, así que la sospecha es alta.
3. **`check-blocked-evidence.sh`** (esta pieza): arreglado — para
   `pull_request`, `gh api .../pulls/<N>/files` en vez de `git diff` (round
   3), inmune al `HEAD` inflado porque no depende de qué haya en el disco
   del runner. Para `push` (sin PR del que pedir la lista), round 4 encontró
   que la base `github.event.before` tenía el mismo bug por una vía
   distinta —medido sobre el propio commit de sincronización de esta rama,
   10 specs en el diff en vez de 0— y la respuesta elegida fue **saltar en
   `push`**, no buscar una base mejor: la corrida de `pull_request` ya es
   autoritativa y cubre el caso real, y es el mismo criterio que
   `check-spec-fields.sh` ya usa (ver punto 1). `merge_group` se mantiene
   con diff por `git` sin cambios — no confirmado si comparte el bug de
   `push`, y no está activo todavía en este repo.

**Por qué se aplaza arreglar los otros dos aquí, con la salida barata
identificada:** la forma correcta y barata es una sola función/paso que
calcule la lista de ficheros del PR vía API, reutilizada por los tres —
elimina la posibilidad de que la próxima persona "arregle" uno de los otros
dos reinventando una tercera variante distinta del mismo diff con `git`, o
peor, copiando el fallback de `push` de `check-migration-safety.sh` sin
saber que puede compartir el mismo bug. Tocar `check-migration-safety.sh` y
su wiring no es necesario para el guardarraíl de bloqueos que este spec
construye, y esos pasos pertenecen a spec-87 (migration-safety) y spec-89/91
(spec-fields), no a éste. Queda declarado aquí, con el diagnóstico completo
—incluida la sospecha sobre `check-migration-safety.sh` en `push`, sin
confirmar—, para que quien lo tome no tenga que volver a encontrar el mismo
síntoma que ya rompió tres corridas distintas esta semana.

## Coordinación con `feat/spec-89-guardarrail-paralelismo`

Esa rama toca `scripts/check-spec-fields.sh` y `.claude/agents/*.md` en
paralelo. Decisiones tomadas aquí para minimizar el choque:

- **`check-spec-fields.sh` no se modifica.** La pieza 1 es un script nuevo,
  `check-blocked-evidence.sh`, hermano y no extensión — mismo patrón que ya
  usa este repo para separar preocupaciones dentro del límite de 300 líneas
  (`check-quarantine.mjs` / `check-quarantine-validate.mjs`,
  `check-deploy-gating.mjs` / `check-deploy-gating-quarantine.mjs`). Cero
  colisión de líneas con spec-89 en ese archivo.
- **`.claude/agents/{implementer,reviewer,qa-e2e}.md` sí se tocan aquí**, y
  spec-89 también los toca — esto **es** un choque real, no evitable, porque
  el encargo pide explícitamente la tabla de capacidades en esos tres
  archivos. Cada edición de esta rama es una sección nueva y delimitada
  (`## No declares algo imposible…`), añadida al final del cuerpo existente,
  no una reescritura de líneas existentes — así que un merge de las dos
  ramas debería resolverse como una concatenación sin conflicto de línea,
  pero **alguien tiene que revisar las dos diffs juntas antes de mergear
  cualquiera de las dos**, no resolverlo en automático. No se intenta
  adivinar aquí qué toca spec-89 en esos archivos.
- **`docs/specs/CLAUDE.md` se toca aquí** (nueva sección `> Bloqueo:` +
  regla del orquestador) — no confirmado si spec-89 también lo toca; mismo
  criterio: secciones nuevas y delimitadas, revisar diffs juntas.

## Fases

### Fase 1 — `check-blocked-evidence.sh` y `check-blocked-freshness.sh` `[in_progress]`

**Archivos:** `scripts/check-blocked-evidence.sh`,
`scripts/check-blocked-evidence.test.sh`, `scripts/check-blocked-freshness.sh`,
`scripts/check-blocked-freshness.test.sh`, `.github/workflows/ci.yml`

- [x] TDD: tests primero (`check-blocked-evidence.test.sh`,
      `check-blocked-freshness.test.sh`), RED confirmado por la razón
      correcta (`127`, script inexistente), luego implementación.
- [x] `check-blocked-evidence.sh`: diff-scoped, exige `> Bloqueo:` con los
      cuatro campos en toda fase `[blocked]` de los specs tocados.
- [x] `check-blocked-freshness.sh`: repo-wide, warn-only, horizonte 30 días,
      `::warning file=,line=`, vuelca a `$GITHUB_STEP_SUMMARY`.
- [x] Validado contra la realidad, **round 2**: `check-blocked-evidence.test.sh`
      ya no fija una lista de specs por nombre — round 1 la fijó
      (spec-75/82/83/84/86/88) y `bbc6eb7` (PR #687) sacó a spec-86 de la
      realidad 18 minutos antes de que ese fixture se escribiera, tumbando CI
      por deriva de corpus, no por un bug del guard. Ahora recorre
      `docs/specs/spec-*.md` en cada corrida, construye el conjunto de
      `[blocked]` sin `> Bloqueo:` **hoy**, y afirma que no está vacío y que
      cada miembro falla contra el guard real — el número y los nombres ya no
      importan. `check-blocked-freshness.test.sh` nunca tuvo una lista fija;
      su prueba contra la realidad es "correr sobre `docs/specs/` completo no
      rompe nunca" (sí la tiene, sin cambios en round 2).
- [x] Mutation-test, **round 2** (contra el guard reescrito): comentar el
      `FAILED=1` de la rama "falta `> Bloqueo:`" (la detección de que una
      fase `[blocked]` no trae nada) mata 8 tests, incluidos los 5+ del
      smoke dinámico contra el corpus real — es el mutante que de verdad
      importaba (`check-blocked-evidence: ok` pese a que el guard dejó de ver
      fases bloqueadas) y round 1 lo había probado ya. Además: la negación
      vacía ("se intentó nada y no se verificó nada") ahora tiene su propio
      test (`bingo de palabras clave sin evidencia real falla`) que falla si
      se retira cualquiera de los dos chequeos de negación nuevos.
- [x] Wireado en `.github/workflows/ci.yml`, junto a los guards hermanos.
      S4 (round 2): `merge_group` ya no se salta en silencio. Round 3: para
      `pull_request`, la lista de ficheros viene de `gh api .../pulls/<N>/files`
      en vez de `git diff`, inmune al `HEAD` inflado del merge-ref. Round 4:
      `push` se salta en vez de diffear contra `github.event.before`, que
      compartía el mismo bug por un camino distinto (medido sobre el propio
      commit de sincronización de esta rama: 10 specs en el diff en vez de 0).

Construido en esta sesión, rama `feat/spec-90-bloqueos-verificables`. Sin
review ni PR todavía — se abre el PR **sin auto-merge**, a propósito, para
que el review y QA ocurran antes de que alguien la mueva a `[done]`.

### Fase 2 — Agentes declaran capacidad, no imposibilidad `[in_progress]`

**Archivos:** `.claude/agents/implementer.md`, `.claude/agents/reviewer.md`,
`.claude/agents/qa-e2e.md`, `docs/specs/CLAUDE.md`,
`scripts/check-harness-present.sh`, `scripts/check-harness-present.test.sh`

- [x] Sección `## No declares algo imposible — declara qué capacidad falta y
      quién la tiene` en `implementer.md`, `reviewer.md`, `qa-e2e.md`, con la
      tabla de capacidades del orquestador.
- [x] Regla simétrica para el orquestador en `docs/specs/CLAUDE.md` (harness).
- [x] `check-harness-present.sh` extendido para exigir la sección en los
      tres agentes; fixture y test nuevo (`agente sin seccion de
      capacidades falla`), resto de la suite sigue verde.
- [x] Documentación del campo `> Bloqueo:` en `docs/specs/CLAUDE.md`.

Construido en esta sesión, misma rama. Sin review ni PR todavía — mismo
motivo que la fase 1.

## Riesgos

- **Rendimiento de `check-blocked-freshness.sh` en Windows/Git Bash**: la
  corrida real contra ~90 specs tardó ~3 minutos en este entorno de
  desarrollo (fork/exec de `awk`/`grep`/`date` por archivo es caro en Git
  Bash para Windows), pero `user`+`sys` fueron ~30s — el resto es overhead
  del entorno de desarrollo, no del script. Los runners de CI son Linux; si
  igual resulta lento ahí, es una optimización de un guard *que ya no
  bloquea nada* (warn-only), no una corrección.
- **El heurístico de "qué se intentó"/"contra qué se verificó" es léxico, no
  semántico** — el guard no puede juzgar si "se intentó Y" es verdad, sólo la
  forma. Round 2 de review encontró que esto tenía un agujero más grave de lo
  que esta línea admitía: "se intentó nada y no se verificó nada" pasaba
  literalmente, con las palabras mágicas puestas y negando explícitamente
  haber hecho algo. Se cierra **esa frase concreta** (el guard rechaza
  "intentó"/"verificó" seguido directamente de "nada"/"ninguna"), no la
  clase — round 3 lo confirmó con un test dedicado que documenta el límite a
  propósito: "se intentó **absolutamente** nada y no se verificó
  **absolutamente** nada" sigue pasando, porque la palabra extra separa la
  negación del verbo y el regex ya no coincide. Es un parche puntual, no una
  prueba semántica, y el nombre del test lo dice explícitamente para que
  nadie lo lea como "cerrado". Mismo trade-off de fondo que
  `check-spec-fields.sh` acepta para `> Implementado por:`, con un listón más
  alto: el guard fuerza la forma y bloquea la negación más obvia, la revisión
  humana (o del `reviewer`) sigue juzgando el contenido.
- **`reason_ok()` del escape hatch es, en el fondo, un contador de
  caracteres** (`>= 12`, sin espacios) más una lista de placeholders — no
  verifica que la razón diga algo real. Round 3 subió el listón mínimo
  (exige al menos dos palabras separadas por un espacio, así que un solo
  "token" repetido — `aaaaaaaaaaaaaa` — ya no cuela) y cerró **las tres
  frases literales** "no tengo acceso"/"no puedo"/"sin acceso" sin nombrar a
  quién se escaló (ver la sección `> Bloqueo:` de `docs/specs/CLAUDE.md`),
  pero sigue siendo el mismo nivel de heurística léxica que el resto: una
  paráfrasis que evite esas tres frases exactas —"no me dejan entrar al
  panel de producción", por ejemplo— sigue pasando sin nombrar ninguna
  escalada. Cerrado el caso literal que se demostró, no la clase; mismo
  trade-off que F2/F3, dicho aquí con la misma honestidad.
- **Residual de CI, tras los arreglos de round 3 y 4**: para `pull_request`,
  la lista de ficheros viene de `gh api .../pulls/<N>/files` (autoritativa,
  inmune al `HEAD` inflado). Para `push`, round 4 encontró que la base
  `github.event.before` tenía el mismo bug por una vía distinta —no el
  `HEAD` inflado, sino un diff de tres puntos que puede abarcar una fusión
  entera de `main` (medido sobre `3a3892f`, el propio commit de
  sincronización de esta rama: 10 specs en el diff en vez de 0)— así que el
  paso ahora se salta en `push`, no busca una base mejor. Sólo `merge_group`
  sigue con diff por `git` y `--base`, sin revisar si comparte alguno de los
  dos defectos — bajo impacto hoy porque la cola de merge no está activa en
  este repo, pero sin confirmar. `check-migration-safety.sh` tiene el mismo
  fallback de `push` con `before` que ya demostró estar roto aquí — sospecha
  alta, no confirmada, documentada en *Decisión explícita*.
