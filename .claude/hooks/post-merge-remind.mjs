#!/usr/bin/env node
// .claude/hooks/post-merge-remind.mjs — PostToolUse hook (matcher: Bash)
//
// RONDA 2 (review adversarial). Este hook YA NO es la garantía de que un
// token de fase se cierre — esa garantía no puede vivir en un hook local: el
// flujo OBLIGATORIO de este repo (CLAUDE.md) corre
// `gh pr merge --auto --squash` inmediatamente después de `gh pr create`,
// mientras el PR sigue `OPEN` (auto-merge lo encola). Cuando GitHub lo
// mergea de verdad, minutos después, NO CORRE NINGÚN COMANDO BASH — nada que
// un hook pueda interceptar. Las seis fases rancias que motivaron este spec
// vinieron exactamente de ese camino `--auto`. La garantía real es la fase 5
// de este spec (reconciliación en servidor, `gh pr list` contra los tokens
// `[in_progress]`, corre en CI — la misma razón por la que
// `check-spec-fields.sh` vive en CI y no en un hook).
//
// Lo que este hook SÍ sirve: un atajo de latencia cero para el camino
// manual — alguien corre `gh pr merge <N> --squash` (sin `--auto`) y el
// merge es inmediato. En ese caso, confirmar y recordar aquí es más rápido
// que esperar a la próxima corrida de la fase 5.
//
// Bloqueantes de la ronda 1, cerrados en esta reescritura:
//   B2 — el número de PR puede aparecer DESPUÉS de las flags
//        (`gh pr merge --auto --squash 693`) — se escanea CADA token del
//        segmento de comando, no sólo el primero.
//   B3 — un `grep`/mensaje de commit que sólo MENCIONA "gh pr merge" no debe
//        disparar nada — se exige que el comando, partido por los
//        separadores de shell (&&, ||, ;, |), tenga un SEGMENTO que empiece
//        literalmente con `gh pr merge`. Un `grep -rn "gh pr merge" .claude/`
//        tiene un solo segmento (la invocación de grep), que no empieza así.
//
// Avisa, no bloquea: para cuando este hook confirma el estado, el merge (si
// ocurrió) ya es un hecho consumado en GitHub. `exit 2` en un `PostToolUse`
// no deshace nada — inyecta stderr como contexto que el agente tiene que
// leer antes de seguir. Se usa exit 2 en vez de exit 0 + stdout porque este
// repo ya aprendió con keep-going.sh que un mensaje ignorable, se ignora.
//
// Degradación: sin `gh` en PATH, sin red, sin auth, JSON inesperado, rama
// sin `spec-NN` -> silencio (exit 0). Nunca bloquea un turno por un
// problema de infraestructura ajeno al trabajo.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Nota de plataforma (verificado en desarrollo local, no en abstracto):
// `execFileSync('gh', args)` SIN shell no resuelve `PATHEXT` en Windows — un
// `gh` instalado como `gh.cmd`/`gh.exe` da `ENOENT`. Probar el nombre exacto
// (`gh.cmd`) tampoco sirve: Node rehúsa ejecutar un `.cmd`/`.bat` sin
// `shell: true` (EINVAL, política de seguridad de Node desde la mitigación
// de CVE-2024-27980). Y `execFileSync(bin, args, { shell: true })` emite un
// `DEP0190` porque un array de args con `shell: true` no se escapa —
// exactamente el caso que ese aviso existe para señalar.
//
// `execSync` con un ÚNICO string sí pasa por el shell del sistema sin ese
// aviso, y es seguro AQUÍ porque lo único que se interpola es `prArg` —
// validado como puramente numérico (o `null`) por `extractPrArg` antes de
// llegar aquí — el resto de la cadena son literales fijos de este archivo.
// (`reconcile-stale-phases.mjs`, que si necesita pasar texto arbitrario —
// cuerpos de issue — como argumento, usa `execFileSync` con un array real en
// vez de esto, precisamente porque ese texto no está acotado a dígitos.)

function readStdinJson() {
  let raw;
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Bloqueante 3 (ronda 1): partir el comando por los separadores de shell y
 * exigir que un SEGMENTO empiece con `gh pr merge` — no que el texto
 * completo lo "mencione" en cualquier posición. Así, `grep -rn "gh pr merge"
 * .claude/` (un único segmento, la invocación de grep, que NO empieza con
 * `gh pr merge`) y `git commit -m "gh pr merge era el problema"` (un único
 * segmento, `git commit ...`) nunca casan — le pasó literalmente al reviewer
 * mientras revisaba esto en la ronda 1.
 *
 * Heurística deliberadamente simple (no un parser de shell completo): no
 * entiende comillas que contengan `&&`/`;`/`|` literalmente. Igual que los
 * demás parsers heurísticos de este repo (`keep-going.sh`, el `REF_RE` de
 * check-phase-overlap-depends.mjs), es una aproximación barata, no un
 * intérprete — y es estrictamente más precisa que la sustring que reemplaza.
 */
export function extractMergeSegment(command) {
  if (typeof command !== 'string') return null;
  const segments = command.split(/&&|\|\||;|\|/).map((s) => s.trim());
  return segments.find((s) => /^gh\s+pr\s+merge\b/.test(s)) || null;
}

/**
 * Bloqueante 2 (ronda 1): el número de PR puede aparecer en cualquier
 * posición entre las flags (`gh pr merge --auto --squash 693`), no sólo
 * justo después de `merge`. Escanea TODOS los tokens del segmento, no sólo
 * el primero — y sólo acepta uno que sea puramente numérico, o una URL de
 * pull request completa. `null` si no hay ninguno (el PR se resuelve contra
 * la rama actual).
 */
export function extractPrArg(mergeSegment) {
  if (!mergeSegment) return null;
  const after = mergeSegment.replace(/^gh\s+pr\s+merge\b/, '');
  const urlMatch = after.match(/https?:\/\/\S+\/pull\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const tokens = after.trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (/^\d+$/.test(t)) return t;
  }
  return null;
}

/** Mismo patrón que `keep-going.sh`: 'spec-' + dígitos + letra opcional. */
export function extractSpecId(branch) {
  const m = /spec-[0-9]+[a-z]?/i.exec(branch || '');
  return m ? m[0].toLowerCase() : null;
}

/**
 * Pista de fase, no certeza: separador tolerante entre "fase"/"phase" y el
 * número (mismo espíritu que `phase_taken()` en keep-going.sh), sufijo de
 * letra opcional (fase 1b).
 */
export function extractPhaseHint(branch) {
  const m = /(?:fase|phase)[-_]?(\d+[a-z]?)/i.exec(branch || '');
  return m ? m[1] : null;
}

export function buildReminder({ prNumber, branch, specId, phaseHint }) {
  const lines = [];
  lines.push(
    `post-merge-remind: PR #${prNumber} mergeado (rama ${branch}) -> ${specId}.`,
  );
  if (phaseHint) {
    lines.push(
      `Pista de fase por el nombre de la rama: fase ${phaseHint} — confírmalo contra el spec, no lo asumas.`,
    );
  } else {
    lines.push(
      'No se pudo inferir la fase del nombre de la rama — confirma cuál es contra el spec.',
    );
  }
  lines.push(
    'Si esto cierra una fase, actualiza su token a [done] con las tres líneas de',
    'evidencia (> Implementado por / > Review / > QA) — ver docs/specs/CLAUDE.md.',
    'Cierra la fase el orquestador, no el implementer. (Si nadie lo hace, la',
    'reconciliación de spec-91 fase 5 lo detecta igual en la próxima corrida.)',
  );
  return lines.join('\n');
}

function main() {
  const payload = readStdinJson();
  if (!payload || payload.tool_name !== 'Bash') process.exit(0);

  const command = payload.tool_input && payload.tool_input.command;
  const segment = extractMergeSegment(command);
  if (!segment) process.exit(0);

  const prArg = extractPrArg(segment);
  const ghArgs = ['pr', 'view'];
  if (prArg) ghArgs.push(prArg);
  ghArgs.push('--json', 'number,headRefName,state,mergedAt');

  let out;
  try {
    out = execSync(['gh', ...ghArgs].join(' '), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    process.exit(0); // sin gh, sin red, sin auth, o PR no resoluble -> silencio
  }

  let info;
  try {
    info = JSON.parse(out);
  } catch {
    process.exit(0);
  }

  if (!info || info.state !== 'MERGED' || !info.mergedAt) process.exit(0);

  const branch = info.headRefName || '';
  const specId = extractSpecId(branch);
  if (!specId) process.exit(0); // no todo merge cierra una fase de spec

  const phaseHint = extractPhaseHint(branch);
  const message = buildReminder({ prNumber: info.number, branch, specId, phaseHint });

  process.stderr.write(message + '\n');
  process.exit(2);
}

// Ejecuta sólo si se invoca directamente (CLI), no cuando otro módulo
// importa las funciones puras de arriba para testearlas sin stdin/gh.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
