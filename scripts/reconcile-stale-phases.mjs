#!/usr/bin/env node
/**
 * reconcile-stale-phases.mjs (spec-91 fase 5)
 *
 * La garantía real de "cerrar el token de fase tras un merge" — ningún hook
 * local puede darla, porque el flujo obligatorio de este repo mergea vía
 * `gh pr merge --auto --squash` (CLAUDE.md), que deja el PR `OPEN` hasta que
 * GitHub lo mergea de verdad minutos después, sin ningún comando Bash que un
 * hook pueda interceptar. Corre en CI (push a `main` + cron diario), la
 * misma razón por la que `check-spec-fields.sh` vive en CI y no en un hook.
 *
 * Qué hace: por cada fase `[in_progress]` en docs/specs/, comprueba si
 * existe algún PR ABIERTO cuya rama nombre ese spec. Si no, es rancia — el
 * trabajo se mergeó (o se abandonó) y nadie cerró el token. Mantiene UN
 * issue con la lista viva, actualizado cada corrida, cerrado solo cuando
 * queda vacía. No bloquea nada — el merge ya ocurrió, fallar CI de `main`
 * por esto castigaría los despliegues por un problema de documentación.
 *
 * Diseño testeable sin un `gh` real en PATH: `runReconciliation()` recibe
 * TODA su E/S por inyección (lectura de specs ya hecha, funciones para
 * listar PRs / leer / crear / editar / cerrar el issue). La alternativa —
 * fabricar un `gh` falso en el PATH — se probó primero para el hook de la
 * fase 1 y falló de un modo distinto para este script: `execFileSync`
 * necesita pasar texto ARBITRARIO (el cuerpo del issue) como argumento, no
 * sólo un número validado, así que ni siquiera puede usar el mismo
 * `execSync` de un solo string sin abrir una inyección real. La solución de
 * producción (`execFileSync('gh', args, ...)`, más abajo) sólo corre en CI
 * (Linux) — nunca en un `PATH` de desarrollo con los problemas de `.cmd` de
 * Windows que sí afectan al hook de la fase 1.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  findInProgressPhases,
  extractSpecIdsFromBranches,
  computeStalePhases,
  parseIssueBody,
  renderIssueBody,
  mergeStaleEntries,
} from './reconcile-stale-phases-lib.mjs';

export const ISSUE_TITLE = 'Fases rancias — reconciliación automática (spec-91)';
// Mismo patrón que `qa-drift-watchdog.yml` (`--label qa-drift`): un label
// dedicado identifica el issue de forma estable, sin depender de que la
// búsqueda de texto de `gh issue list --search` calce el título exacto.
export const ISSUE_LABEL = 'stale-phase-reconciliation';

/**
 * Orquestación pura de E/S inyectada — sin `fs`, sin `gh`, sin `Date.now()`
 * directo (recibe `today`). Devuelve un resumen para que quien la invoque
 * (CLI o test) sepa qué pasó sin tener que espiar los mocks.
 */
export function runReconciliation({
  specFiles,
  listOpenPrBranches,
  findTrackingIssue,
  createIssue,
  updateIssue,
  reopenIssue,
  closeIssue,
  today,
  log = () => {},
}) {
  const inProgress = findInProgressPhases(specFiles);
  const openSpecIds = extractSpecIdsFromBranches(listOpenPrBranches());
  const staleNow = computeStalePhases(inProgress, openSpecIds);

  const existing = findTrackingIssue();
  // F5-1 (bloqueante, ronda 3): `null` ("no existe issue") tiene que ser
  // distinguible de "no se pudo determinar" (un blip de la API de gh) —
  // confundirlos creaba un issue DUPLICADO cada vez que la búsqueda fallaba
  // con uno ya abierto. Mismo tratamiento que `listOpenPrBranches` más abajo
  // (fail open: abortar sin tocar nada, nunca inventar un estado).
  if (existing && existing.error) {
    log('reconcile-stale-phases: no se pudo determinar si ya existe un issue de seguimiento — abortando sin tocarlo.');
    return { action: 'error', staleCount: null, issueNumber: null };
  }
  // F5-2 (seguimiento, ronda 3): cerrar el issue A MANO no sirve de nada —
  // la corrida siguiente lo reabre (`updateIssue` + `reopenIssue`) si sigue
  // habiendo algo rancio. Cruzado con el falso positivo ya documentado
  // (rama local sin pushear), alguien con trabajo de días se come el issue
  // reabierto cada vez que corre la reconciliación, aunque el que reabre
  // sea rancio de OTRA persona. Escotilla: el label `wontfix` en el propio
  // issue significa "no lo toques" — se deja tal cual está, cerrado o
  // abierto, hasta que alguien quite el label.
  if (existing && Array.isArray(existing.labels) && existing.labels.includes('wontfix')) {
    log(`reconcile-stale-phases: issue #${existing.number} tiene el label "wontfix" — no se toca.`);
    return { action: 'skipped-wontfix', staleCount: staleNow.length, issueNumber: existing.number };
  }

  const previousEntries = existing ? parseIssueBody(existing.body) : [];
  const merged = mergeStaleEntries(staleNow, previousEntries, today);

  if (merged.length === 0) {
    if (existing && existing.state === 'OPEN') {
      closeIssue(existing.number);
      log(`reconcile-stale-phases: issue #${existing.number} cerrado — lista vacía.`);
      return { action: 'closed', staleCount: 0, issueNumber: existing.number };
    }
    log('reconcile-stale-phases: nada que reportar.');
    return { action: 'none', staleCount: 0, issueNumber: existing ? existing.number : null };
  }

  const body = renderIssueBody(merged);
  if (existing) {
    updateIssue(existing.number, body);
    if (existing.state !== 'OPEN') reopenIssue(existing.number);
    log(`reconcile-stale-phases: issue #${existing.number} actualizado (${merged.length} fase(s) rancia(s)).`);
    return { action: 'updated', staleCount: merged.length, issueNumber: existing.number };
  }

  const number = createIssue(body);
  log(`reconcile-stale-phases: issue #${number} creado (${merged.length} fase(s) rancia(s)).`);
  return { action: 'created', staleCount: merged.length, issueNumber: number };
}

// ── Wiring real: fs + gh, sólo se usa cuando el script corre como CLI ──────

function readSpecFiles(specsDir) {
  return readdirSync(specsDir)
    .filter((f) => /^spec-\d+[a-z]?-.*\.md$/.test(f))
    .map((filename) => ({ filename, content: readFileSync(path.join(specsDir, filename), 'utf8') }));
}

/** Sólo corre en CI (ubuntu-latest) — nunca necesita el rodeo de `.cmd` de Windows del hook de la fase 1. */
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * F5-1 (bloqueante, ronda 3): `null` DEBE significar "confirmado: no existe
 * issue" — nunca "no lo sé". Un fallo de `gh` (red, auth, rate limit) o una
 * salida que no parsea como JSON no es lo mismo que un repo limpio sin
 * issues, y tratarlos igual crea un duplicado en cada corrida que tropieza
 * con la API mientras el issue real sigue abierto.
 */
function findTrackingIssueReal() {
  let out;
  try {
    out = gh(['issue', 'list', '--state', 'all', '--label', ISSUE_LABEL, '--json', 'number,body,state,labels', '--limit', '1']);
  } catch {
    return { error: true };
  }
  let issues;
  try {
    issues = JSON.parse(out);
  } catch {
    return { error: true };
  }
  if (!issues[0]) return null;
  const { number, body, state, labels } = issues[0];
  return { number, body, state, labels: (labels || []).map((l) => l.name) };
}

/** El label puede no existir todavía en un repo nuevo — se intenta crear y se ignora si ya está (mismo patrón que qa-drift-watchdog.yml). */
function ensureLabel() {
  try {
    gh(['label', 'create', ISSUE_LABEL, '--color', 'B08800', '--description', 'spec-91: fase [in_progress] sin PR abierto que la respalde']);
  } catch {
    // ya existe, o no se pudo crear — `gh issue create --label` fallará
    // igual más abajo si de verdad no existe, con un mensaje propio de gh.
  }
}

function main() {
  const repoRoot = process.argv[2] || process.cwd();
  const specsDir = path.join(repoRoot, 'docs', 'specs');
  const specFiles = readSpecFiles(specsDir);
  const today = new Date().toISOString().slice(0, 10);

  runReconciliation({
    specFiles,
    listOpenPrBranches: () => {
      // F5-4 (ronda 3): el `JSON.parse` tiene que estar DENTRO del mismo
      // try que el `gh` — un `gh` que sale 0 con salida no-JSON (raro, pero
      // no imposible: un mensaje de estado inesperado en stdout) lanzaba sin
      // capturar, contradiciendo el "fail open" que el comentario de al lado
      // ya prometía.
      let branches;
      try {
        const out = gh(['pr', 'list', '--state', 'open', '--json', 'headRefName', '--limit', '200']);
        branches = JSON.parse(out).map((p) => p.headRefName);
      } catch (e) {
        // Fail open, a propósito: un fallo de red/auth/parseo listando PRs
        // no debe crear ruido falso ("todo está rancio") — se aborta sin
        // tocar el issue.
        console.error('reconcile-stale-phases: no se pudo listar PRs abiertos, abortando sin tocar el issue:', e.message);
        process.exit(0);
      }
      return branches;
    },
    findTrackingIssue: findTrackingIssueReal,
    createIssue: (body) => {
      ensureLabel();
      const out = gh(['issue', 'create', '--title', ISSUE_TITLE, '--label', ISSUE_LABEL, '--body', body]);
      const m = /\/issues\/(\d+)/.exec(out);
      return m ? Number(m[1]) : null;
    },
    updateIssue: (number, body) => gh(['issue', 'edit', String(number), '--body', body]),
    reopenIssue: (number) => gh(['issue', 'reopen', String(number)]),
    closeIssue: (number) =>
      gh(['issue', 'close', String(number), '--comment', 'Todas las fases quedaron cerradas o respaldadas por un PR abierto.']),
    today,
    log: console.log,
  });
}

// Ejecuta sólo si se invoca directamente (CLI), no cuando otro módulo
// importa `runReconciliation` para testearla sin `gh`/`fs` reales.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
