#!/usr/bin/env node
/**
 * check-phase-overlap.mjs (spec-89 fase 1)
 *
 * "¿Estas fases, si se despachan en paralelo, pueden pisarse?" — el
 * orquestador la corre ANTES de dispatchar dos o más `implementer` a la vez.
 * No es un gate de CI: dos fases nuevas casi nunca tienen aún una rama con
 * commits, así que la única superficie disponible es la que el spec DECLARA
 * (`**Archivos:**`). Cuando la rama sí existe, su diff real se une a lo
 * declarado — lo real siempre gana sobre lo prometido.
 *
 * Uso:
 *   node check-phase-overlap.mjs <target...> [--base <ref>] [--repo <path>] [--max-depth N]
 *
 *   target = "<specPath>#<faseMatch>[@<branch>]"
 *   ej:     "docs/specs/spec-81-recogida-cola-offline.md#Fase 2@feat/spec-81-fase-2-drenado"
 *
 * Exit codes:
 *   0  sin conflicto duro (puede haber acoplamiento blando — se imprime, no bloquea)
 *   1  conflicto duro: dos targets escriben el mismo fichero
 *   2  error de uso (menos de 2 targets, spec o fase no encontrados)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseTarget, extractArchivosFiles, normalizeFrontendPath } from './check-phase-overlap-parse.mjs';
import { buildClosure, computeOverlap } from './check-phase-overlap-closure.mjs';

function usageError(msg) {
  console.error(`check-phase-overlap: ${msg}`);
  console.error('Uso: node check-phase-overlap.mjs <specPath#fase[@branch]>... [--base <ref>] [--repo <path>] [--max-depth N]');
  process.exit(2);
}

function parseArgv(argv) {
  const targets = [];
  let base = 'origin/main';
  let repo = process.cwd();
  let maxDepth = 2;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') base = argv[++i];
    else if (a === '--repo') repo = argv[++i];
    else if (a === '--max-depth') maxDepth = Number(argv[++i]);
    else if (a.startsWith('-')) usageError(`opción desconocida: ${a}`);
    else targets.push(a);
  }
  return { targets, base, repo, maxDepth };
}

/** `git show <ref>:<path>` — null (not an error) when the path doesn't exist at that ref. */
function gitShow(repo, ref, filePath) {
  try {
    // stderr is 'ignore', not 'pipe': probing extension candidates
    // (path, path.ts, path.tsx, ...) makes a "does not exist" miss the
    // expected, common case, and letting git print it would spam every
    // real run with noise nobody reads.
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** `git diff --name-only base...branch` — the branch's REAL write set, when it has commits. */
function gitDiffFiles(repo, base, branch) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...${branch}`], {
      cwd: repo,
      encoding: 'utf8',
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    console.error(`check-phase-overlap: 'git diff ${base}...${branch}' falló: ${e.message}`);
    process.exit(2);
  }
}

function readWorkingTree(repo, filePath) {
  const full = path.join(repo, filePath);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

/**
 * Content resolver for one target: branch content wins when the branch has
 * touched the file; otherwise base; otherwise the working tree (covers a
 * freshly-declared file that has no commit anywhere yet — buildClosure then
 * just can't extend past it, which is the honest outcome for undeclared,
 * unwritten code).
 *
 * Known limitation, not engineered around: a branch that DELETES a file
 * relative to base makes `git show branch:path` fail, and this falls back
 * to base's (stale) content for that path. Rare — and a phase that deletes
 * a shared file is exactly the kind of change a human should be looking at
 * anyway, not something this guard should paper over by guessing.
 */
function makeResolver(repo, base, branch) {
  return function resolveContent(filePath) {
    if (branch) {
      const fromBranch = gitShow(repo, branch, filePath);
      if (fromBranch !== null) return fromBranch;
    }
    const fromBase = gitShow(repo, base, filePath);
    if (fromBase !== null) return fromBase;
    return readWorkingTree(repo, filePath);
  };
}

function buildTarget(targetStr, { repo, base, maxDepth }) {
  const { specPath, faseMatch, branch } = parseTarget(targetStr);
  const specFull = path.join(repo, specPath);
  if (!existsSync(specFull)) {
    usageError(`spec no encontrado: ${specPath}`);
  }
  const specMd = readFileSync(specFull, 'utf8');
  const { headingFound, files: declaredRaw } = extractArchivosFiles(specMd, faseMatch);
  if (!headingFound) {
    usageError(`fase no encontrada en ${specPath}: "${faseMatch}"`);
  }
  const declared = declaredRaw.map(normalizeFrontendPath);

  const diffFiles = branch ? gitDiffFiles(repo, base, branch) : [];

  const writeSet = new Set([...declared, ...diffFiles]);
  const resolveContent = makeResolver(repo, base, branch);
  const closure = buildClosure([...writeSet], { resolveContent, maxDepth });

  return {
    name: `${specPath}#${faseMatch}`,
    declared,
    diffFiles,
    writeSet,
    closure,
  };
}

function printReport(targets, overlap) {
  console.log('check-phase-overlap: superficies declaradas/reales por target\n');
  for (const t of targets) {
    console.log(`  ${t.name}`);
    console.log(`    declarado (**Archivos:**): ${t.declared.length ? t.declared.join(', ') : '(ninguno)'}`);
    console.log(`    diff real: ${t.diffFiles.length ? t.diffFiles.join(', ') : '(sin commits aún)'}`);
  }

  console.log('');
  if (overlap.hard.length === 0) {
    console.log('CONFLICTO DURO: ninguno.');
  } else {
    console.log(`CONFLICTO DURO — ${overlap.hard.length} fichero(s) escritos por más de un target:`);
    for (const h of overlap.hard) {
      console.log(`  ${h.file}  <-  ${h.targets.join(' Y ')}`);
    }
  }

  console.log('');
  if (overlap.soft.length === 0) {
    console.log('ACOPLAMIENTO BLANDO: ninguno.');
  } else {
    console.log(`ACOPLAMIENTO BLANDO (no bloquea) — ${overlap.soft.length} caso(s):`);
    for (const s of overlap.soft) {
      const viaDesc = s.via ? ` (vía import ${s.via.isType ? 'de tipo ' : ''}"${s.via.specifier}" desde ${s.via.from})` : '';
      console.log(`  ${s.file}  —  escrito por ${s.writer}, alcanzado por ${s.reacher}${viaDesc}`);
    }
  }

  console.log('');
  if (overlap.hard.length > 0) {
    console.log('VEREDICTO: NO despachar en paralelo — hay conflicto duro.');
  } else if (overlap.soft.length > 0) {
    console.log('VEREDICTO: despachable en paralelo — sólo acoplamiento blando, revisar los casos de arriba.');
  } else {
    console.log('VEREDICTO: despachable en paralelo — superficies disjuntas.');
  }
}

function main() {
  const { targets: targetStrs, base, repo, maxDepth } = parseArgv(process.argv.slice(2));
  if (targetStrs.length < 2) {
    usageError('hacen falta al menos 2 targets para comparar solapamiento.');
  }

  const targets = targetStrs.map((s) => buildTarget(s, { repo, base, maxDepth }));
  const overlap = computeOverlap(targets);
  printReport(targets, overlap);

  process.exit(overlap.hard.length > 0 ? 1 : 0);
}

main();
