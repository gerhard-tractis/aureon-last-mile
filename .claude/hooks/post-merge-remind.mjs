#!/usr/bin/env node
// .claude/hooks/post-merge-remind.mjs — PostToolUse hook (matcher: Bash)
//
// Hueco 1 de spec-91: nadie cierra el token de fase tras un merge, y
// keep-going.sh (hook Stop) identifica el spec activo por la rama del
// WORKTREE DEL AGENTE — que casi nunca es la rama que se acaba de mergear
// (el orquestador corre `gh pr merge` desde donde sea). Este hook lee la
// rama REAL del PR mergeado, vía `gh`, y recuerda cerrar el token.
//
// Avisa, no bloquea: dispara DESPUES de que `gh pr merge` ya corrió. Si el
// merge tuvo éxito, ya es un hecho consumado en GitHub — no hay nada que
// "bloquear". `exit 2` en un hook PostToolUse no deshace la herramienta ya
// ejecutada; inyecta stderr como contexto que el agente ve y con el que
// tiene que lidiar antes de seguir limpio. Se usa exit 2 (no exit 0 con
// stdout) porque el repo ya aprendió con keep-going.sh que un mensaje que se
// puede ignorar, se ignora.
//
// Una llamada a `gh` es defendible aquí (no lo sería en un hook Stop, que
// dispara en cada fin de turno): este hook sólo dispara cuando el comando
// bash matchea `gh pr merge`, es decir, una vez por PR mergeado — no una vez
// por turno.
//
// Degradación: sin `gh` en PATH, sin red, JSON inesperado, o el propio
// stdin malformado -> silencio (exit 0). Nunca bloquea un turno por un
// problema de infraestructura ajeno al trabajo.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
 * `gh pr merge 693 --squash` -> "693"
 * `gh pr merge https://github.com/x/y/pull/693 --squash` -> "693"
 * `gh pr merge --squash` (sin argumento posicional -> PR de la rama actual) -> null
 */
export function extractPrArg(command) {
  const m = command.match(/\bgh\s+pr\s+merge\s+(?:(\d+)\b|https?:\/\/\S+\/pull\/(\d+))/);
  if (!m) return null;
  return m[1] || m[2] || null;
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
    'Cierra la fase el orquestador, no el implementer.',
  );
  return lines.join('\n');
}

function main() {
  const payload = readStdinJson();
  if (!payload || payload.tool_name !== 'Bash') process.exit(0);

  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || !/\bgh\s+pr\s+merge\b/.test(command)) {
    process.exit(0);
  }

  // execFileSync('gh', args) sin shell no hace la resolución de PATHEXT que
  // sí hace un shell — en Windows, un `gh` instalado sólo como `gh.cmd`/
  // `gh.exe` sin resolverse por su nombre exacto da ENOENT aunque esté
  // genuinamente en el PATH (confirmado en desarrollo local). execSync SÍ
  // pasa por el shell del sistema (cmd.exe en Windows, /bin/sh en POSIX), que
  // resuelve la extensión correctamente en ambos. Todos los argumentos son
  // internos (dígitos capturados por regex, o literales fijos) — nunca texto
  // de usuario — así que construir un único string de comando es seguro; no
  // hay ninguno que necesite escaparse.
  const prArg = extractPrArg(command);
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
