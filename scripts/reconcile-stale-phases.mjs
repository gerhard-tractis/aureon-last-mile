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

function findTrackingIssueReal() {
  let out;
  try {
    out = gh(['issue', 'list', '--state', 'all', '--label', ISSUE_LABEL, '--json', 'number,body,state', '--limit', '1']);
  } catch {
    return null;
  }
  let issues;
  try {
    issues = JSON.parse(out);
  } catch {
    return null;
  }
  return issues[0] || null;
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
      let out;
      try {
        out = gh(['pr', 'list', '--state', 'open', '--json', 'headRefName', '--limit', '200']);
      } catch (e) {
        // Fail open, a propósito: un fallo de red/auth listando PRs no debe
        // crear ruido falso ("todo está rancio") — se aborta sin tocar el issue.
        console.error('reconcile-stale-phases: no se pudo listar PRs abiertos, abortando sin tocar el issue:', e.message);
        process.exit(0);
      }
      return JSON.parse(out).map((p) => p.headRefName);
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
