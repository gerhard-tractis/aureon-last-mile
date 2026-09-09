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
todavía.

## Las tres piezas

### 1. `scripts/check-blocked-evidence.sh` — evidencia obligatoria en toda fase bloqueada

Nuevo script, hermano de `check-spec-fields.sh` (no lo modifica — ver
*Coordinación con spec-89* más abajo), que exige una línea `> Bloqueo:` en el
cuerpo de toda fase `[blocked]`, con cuatro cosas en una sola línea:

```
> Bloqueo: se intentó resolver "asignados a ti" contra manifests.assigned_to_user_id
> — verificado en el esquema QA: la columna existe y está NULL en todas las filas
> — 2026-09-08 — desbloquea: usuario (quién asigna y desde dónde: spec-82 §1)
```

- **Qué se intentó** — heurística: la línea debe nombrar el intento
  (`intentó`/`intentó`), no "falta X".
- **Contra qué se verificó** — heurística: debe nombrar la verificación
  (`verificado`/`verificó`) — fichero:línea, consulta, o salida de comando.
- **Cuándo** — una fecha real de calendario, `YYYY-MM-DD` (mismo chequeo de
  fecha-real que `check-quarantine-validate.mjs`: `2026-02-30` no cuela).
- **Quién puede desbloquearlo** — `desbloquea: usuario | agente | dependencia`.
  `dependencia` exige nombrar el spec (`dependencia (spec-81)`); una
  dependencia sin nombrar no es información, es la misma frase de siempre con
  una palabra nueva.

**«No tengo acceso a X» no es un bloqueo válido por sí solo.** El guard no
puede leer intención, pero la regla queda escrita en `docs/specs/CLAUDE.md` y
en los tres `.claude/agents/*.md`: sólo cuenta si «qué se intentó» dice a
quién se escaló y «contra qué se verificó» dice qué contestó (o que no
contestó). Es la corrección directa a los tres casos de hoy, donde "no tengo
acceso" se usó para bajar el listón de verificación sin escalar nada.

**Diff-scoped, igual que `check-spec-fields.sh` y por la misma razón.**
Validar los ~10 `[blocked]` reales de hoy —ninguno trae la línea, porque no
existía— haría que el primer PR que toque cualquiera de esos seis specs
fallara en masa por deuda acumulada, no por algo que ese PR introdujo. El
guard sólo mira los specs que el PR **toca** (mismo mecanismo de resolución
de base que `check-spec-fields.sh`: `--base`, o archivos explícitos). Los
specs viejos migran cuando alguien los toca — es el mismo patrón que ya
usa `**Verify:**` en este mismo archivo, y ya está probado: no es una
transición nueva, es la que este repo ya eligió para el mismo problema.

**Cuántos fallarían hoy si el guard fuera repo-wide en vez de diff-scoped:**
las 10 fases de los 6 specs de arriba. Es exactamente por eso que no lo es.

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

Corrida real contra el repo hoy (`--today 2026-09-08`): 10 avisos, uno por
cada fase `[blocked]` sin `> Bloqueo:` — coincide exactamente con el recuento
de la pieza 1. `exit 0` en los 10 casos.

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
- **No se retrofitea `> Bloqueo:` en los 6 specs reales que hoy carecen de
  él.** Es tentador —ya sé exactamente cuáles son y qué deberían decir— pero
  esos specs pertenecen a fases activas de otros implementers (82–88) y
  escribir contenido de dominio ahí no es "construir el guardarraíl", es
  "usar el guardarraíl", que le toca a quien tome esa fase la próxima vez que
  la toque. El guard mismo se probó contra esos 6 ficheros tal como están hoy
  (ver *Verify*), así que la validación no depende de retrofitearlos.
- **No se valida contenido semántico del `> Bloqueo:`** más allá de los
  cuatro chequeos heurísticos descritos — el guard no puede juzgar si "se
  intentó Y" es verdad, sólo que la línea tiene la forma que un bloqueo real
  necesita. Es el mismo nivel de rigor que `check-spec-fields.sh` ya aplica a
  `> Implementado por:`/`> Review:`/`> QA:`: comprueba presencia, no verdad.
- **No se cambia el horizonte por tipo de bloqueo** (usuario vs. dependencia
  vs. agente). Un solo número, documentado y justificado contra el
  precedente de cuarentena — introducir tres horizontes distintos sin un
  caso real que lo pida sería complejidad sin evidencia detrás.

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
- [x] Validado contra la realidad: los 6 specs reales con `[blocked]`
      (spec-75, 82, 83, 84, 86, 88) se usan como fixtures directamente en
      ambos `.test.sh` — hoy fallan/avisan todos, como debe ser.
- [x] Mutation-test: desactivar el chequeo `desbloquea:` mata 3 tests
      (`falta desbloquea falla`, `desbloquea con valor invalido falla`,
      `desbloquea dependencia sin nombrar spec falla`); restaurado y verde.
- [x] Wireado en `.github/workflows/ci.yml`, junto a los guards hermanos.

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
  semántico.** Alguien puede escribir "se intentó nada y se verificó nada"
  con las palabras correctas y pasar el guard. Es el mismo trade-off que
  `check-spec-fields.sh` ya acepta para `> Implementado por:` — el guard
  fuerza la forma, la revisión humana (o del `reviewer`) juzga el contenido.
