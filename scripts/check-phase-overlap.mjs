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
 *   3  no se puede juzgar la superficie: dos causas posibles, distinguidas en
 *      el mensaje —
 *        (a) el target no declara **Archivos:** y su rama (si se dio) no
 *            tiene commits — no hay ninguna superficie con la que comparar;
 *        (b) **Archivos:** SÍ está declarado, pero su contenido no resolvió
 *            a ningún fichero ni directorio (p.ej. "(indeterminado — ...)",
 *            ver spec-91 fase 2 / PR #695) — el campo existe, sólo no
 *            resuelve.
 *      Nunca se informa como "disjunto": eso sería decir "lo comprobé y está
 *      limpio" cuando en realidad no se comprobó nada.
 *   4  dependencia declarada en **Depende de:** no satisfecha (spec-91 fase
 *      3): un target depende de otra fase que no está `[done]`. Se calcula
 *      ANTES que el solapamiento de superficie — si el orden no está listo,
 *      la pregunta de si los ficheros chocan todavía no toca.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseTarget, extractArchivosFiles, normalizeFrontendPath } from './check-phase-overlap-parse.mjs';
import { extractDependsField, findPhaseTokenByNumber, scanUndeclaredReferences } from './check-phase-overlap-depends.mjs';
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

/**
 * Performance (review round 1, medium 7): resolving one import specifier
 * probes up to 7 candidate paths (no ext, .ts, .tsx, .js, .jsx, two barrel
 * suffixes) against `resolveContent`. Spawning `git show` per candidate —
 * most of which don't exist — is what made this slow: measured 86s for 2
 * targets, >15min for the real 4-target acceptance case, which is dead on
 * arrival for a `PreToolUse` hook (the stated destination for this guard).
 *
 * `git ls-tree -r --name-only <ref>` lists a ref's ENTIRE file tree in one
 * process — one spawn per distinct ref for the whole run, not one per
 * candidate path. Existence becomes a `Set.has()` (free); `git show` is
 * then called at most ONCE per file, only for a candidate already confirmed
 * to exist, and its result is cached too (the same shared file is resolved
 * repeatedly — once per importer that reaches it).
 */
const treeCache = new Map(); // ref -> Set<path>
function listTreeFiles(repo, ref) {
  if (treeCache.has(ref)) return treeCache.get(ref);
  let files;
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    files = new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    files = new Set();
  }
  treeCache.set(ref, files);
  return files;
}

const showCache = new Map(); // `${ref}\0${path}` -> content|null
/** `git show <ref>:<path>` — null (not an error) when the path doesn't exist at that ref. Cached per (ref, path). */
function gitShow(repo, ref, filePath) {
  const key = `${ref}\0${filePath}`;
  if (showCache.has(key)) return showCache.get(key);
  let content;
  try {
    content = execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    content = null;
  }
  showCache.set(key, content);
  return content;
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

/**
 * A resolveSpecifier candidate with no extension (e.g. `@/lib/offline` ->
 * `apps/frontend/src/lib/offline`) can match a real DIRECTORY on disk, not
 * just a missing file. `existsSync` returns true for both; `readFileSync`
 * on a directory throws EISDIR, not "file not found" — crashing the whole
 * run instead of correctly reporting "no content here, try the next
 * candidate". `statSync().isFile()` is the actual question being asked.
 */
function readWorkingTree(repo, filePath) {
  const full = path.join(repo, filePath);
  if (!existsSync(full)) return null;
  try {
    if (!statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return readFileSync(full, 'utf8');
}

/**
 * Content resolver for one target. A branch's tree already contains every
 * file it inherited unchanged from base — a branch's `git ls-tree` is a
 * strict superset of base's except for what that branch itself deleted — so
 * there is no separate "try branch, then fall back to base" step needed:
 * resolve everything against `branch` (when given) or `base` otherwise, via
 * the cheap `listTreeFiles` existence check, and only fall back to the
 * working tree for a file that exists in neither ref's history yet (a
 * freshly-declared file with no commit anywhere — buildClosure then just
 * can't extend past it, the honest outcome for undeclared, unwritten code).
 *
 * This also changes one behavior, for the better: a branch that DELETES a
 * file relative to base used to silently fall back to base's stale content
 * for that path. Now `listTreeFiles(branch)` correctly omits it, and
 * resolution correctly falls through to the working-tree check instead of
 * pretending the deleted file still exists.
 */
function makeResolver(repo, base, branch) {
  const ref = branch || base;
  return function resolveContent(filePath) {
    if (listTreeFiles(repo, ref).has(filePath)) {
      return gitShow(repo, ref, filePath);
    }
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
  const {
    headingFound,
    fieldPresent: archivosFieldPresent,
    files: declaredRaw,
    directories: declaredDirs,
    warnings: archivosWarnings,
    raw: archivosRaw,
  } = extractArchivosFiles(specMd, faseMatch);
  if (!headingFound) {
    usageError(`fase no encontrada en ${specPath}: "${faseMatch}"`);
  }
  const declared = declaredRaw.map(normalizeFrontendPath);
  const name = `${specPath}#${faseMatch}`;

  // spec-91 fase 3/4: id propio del spec (para no autorreferenciarse al
  // escanear) + estado declarado de **Depende de:**.
  const ownSpecId = (path.basename(specPath).match(/^spec-(\d+[a-z]?)-/i) || [])[1] || null;
  const depends = extractDependsField(specMd, faseMatch);

  // Red heurística (fase 4): avisa, no bloquea — el campo tarda en
  // backfillearse. Sólo nombra lo que NO está ya en **Depende de:**.
  const undeclaredRefs = scanUndeclaredReferences(specMd, faseMatch, ownSpecId);
  for (const r of undeclaredRefs) {
    console.error(
      `::warning:: ${name} — menciona spec-${r.specId} fase ${r.faseNum} en prosa pero no la declara en **Depende de:**. Si es una dependencia de orden real, decláralo.`,
    );
  }

  // Blocker 5 (review round 1): a rejected/degraded **Archivos:** entry
  // (a bare filename with no directory to inherit, a directory declaration)
  // must be visible, not silently absorbed into nothing. `resolveContent`
  // can't act on `declaredDirs` — there is no single file to read — so it is
  // surfaced here as a warning instead of pretending it became a file.
  for (const w of archivosWarnings) {
    console.error(`::warning:: ${name} — ${w}`);
  }

  const diffFiles = branch ? gitDiffFiles(repo, base, branch) : [];

  const writeSet = new Set([...declared, ...diffFiles]);
  const resolveContent = makeResolver(repo, base, branch);
  const closure = buildClosure([...writeSet], { resolveContent, maxDepth });

  return {
    name,
    declared,
    // Field name MUST match what computeOverlap/directoryConflicts reads
    // (check-phase-overlap-closure.mjs): `a.directories`. A mismatch here
    // is silent — `a.directories ?? []` in that function swallows it into
    // an empty array with no error, so directoryConflicts never iterates
    // anything and the whole rule is dead code with a passing test suite
    // (the unit tests build their own fixture objects with the right key,
    // so they never exercise this seam). Found by review round 3 against
    // real data, not by any test.
    directories: declaredDirs,
    // spec-91 fase 2: si el campo **Archivos:** existe pero no resolvió a
    // ningún fichero (p.ej. "(indeterminado — <razón>)", PR #695), el
    // mensaje de exit 3 necesita saberlo para no decir "declara
    // **Archivos:**" a una fase que ya lo hizo.
    archivosFieldPresent,
    archivosRaw,
    ownSpecId,
    depends,
    diffFiles,
    writeSet,
    closure,
  };
}

/**
 * Resuelve una entrada de **Depende de:** (spec-91 fase 3) contra el repo
 * real: busca `docs/specs/spec-<N>-*.md` y lee el token de su fase `M`. Lee
 * SIEMPRE del disco de trabajo (no de una rama/ref) — el estado de "¿está
 * [done]?" de OTRA fase es una propiedad del repo, no de la rama del target
 * que se está evaluando.
 */
function resolveDependency(repo, dep) {
  const dir = path.join(repo, 'docs', 'specs');
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return { specFound: false };
  }
  const match = files.find((f) => f === `spec-${dep.specId}.md` || f.startsWith(`spec-${dep.specId}-`));
  if (!match) return { specFound: false };
  const md = readFileSync(path.join(dir, match), 'utf8');
  const tokenInfo = findPhaseTokenByNumber(md, dep.faseNum);
  return { specFound: true, specFile: match, ...tokenInfo };
}

function printReport(targets, overlap) {
  console.log('check-phase-overlap: superficies declaradas/reales por target\n');
  for (const t of targets) {
    console.log(`  ${t.name}`);
    console.log(`    declarado (**Archivos:**): ${t.declared.length ? t.declared.join(', ') : '(ninguno)'}`);
    if (t.directories && t.directories.length) {
      console.log(`    directorios declarados (no resueltos a fichero — ver warning arriba): ${t.directories.join(', ')}`);
    }
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

  // Review round 3, M-3: SQL collision-blindness is a known, ACCEPTED
  // limitation (ver "Deliberadamente NO es" en el spec) — dos migraciones
  // distintas pueden hacer `CREATE OR REPLACE FUNCTION` sobre la MISMA
  // función y este guard no lo ve, porque cada una es un fichero `.sql`
  // diferente. Aceptar la limitación no es lo mismo que ocultarla: el
  // mensaje tiene que decirlo cada vez que aplique, no dejar que quien lea
  // "superficies disjuntas" lo dé por sentado.
  const touchesSql = targets.some((t) => [...t.writeSet].some((f) => f.endsWith('.sql')));
  if (touchesSql) {
    console.log('');
    console.log('NOTA: al menos un target toca SQL. Este guard no detecta que dos');
    console.log('migraciones DISTINTAS hagan CREATE OR REPLACE sobre la MISMA función —');
    console.log('es ceguera a colisiones en SQL, limitación conocida y aceptada (ver el');
    console.log('spec). Revisa a mano si ambos targets tocan la misma función.');
  }
}

function main() {
  const { targets: targetStrs, base, repo, maxDepth } = parseArgv(process.argv.slice(2));
  if (targetStrs.length < 2) {
    usageError('hacen falta al menos 2 targets para comparar solapamiento.');
  }

  const targets = targetStrs.map((s) => buildTarget(s, { repo, base, maxDepth }));

  // spec-91 fase 3: chequeo de ORDEN, antes que el de superficie. Si una
  // fase declara **Depende de:** una fase que no está [done], discutir si
  // sus ficheros chocan con otra es una pregunta que todavía no toca — así
  // que este chequeo corre primero y, si encuentra algo, ni siquiera llega
  // a calcular solapamiento (exit 4 gana sobre 1/3).
  const unmetDeps = [];
  for (const t of targets) {
    if (!t.depends || !t.depends.fieldPresent || t.depends.explicitNone || t.depends.indeterminate) {
      continue; // ausente, "ninguna", o "(indeterminado — ...)": nada que chequear aquí
    }
    for (const dep of t.depends.entries) {
      const res = resolveDependency(repo, dep);
      if (!res.specFound) {
        unmetDeps.push({ target: t.name, dep, reason: `spec-${dep.specId} no existe en docs/specs/` });
      } else if (!res.found) {
        unmetDeps.push({ target: t.name, dep, reason: `spec-${dep.specId} fase ${dep.faseNum} no se encontró en ${res.specFile}` });
      } else if (res.token !== 'done') {
        unmetDeps.push({ target: t.name, dep, reason: `sigue \`[${res.token}]\`` });
      }
    }
  }
  if (unmetDeps.length > 0) {
    console.error('check-phase-overlap: no despachable todavía — dependencia(s) declarada(s) sin satisfacer:');
    for (const u of unmetDeps) {
      console.error(`  ${u.target} depende de spec-${u.dep.specId} fase ${u.dep.faseNum}, que ${u.reason}.`);
    }
    process.exit(4);
  }

  // Blocker 3 (review round 1): a target with no **Archivos:** and no
  // committed branch has an EMPTY write set — there is nothing to compare it
  // against, and computeOverlap would silently report "disjoint" for lack of
  // anything to find. That is not "checked, and clean" — it is "not
  // checked", and printing the same verdict as a real clean run erases the
  // difference. Verified against real data: spec-80 fase 1b (no
  // **Archivos:**, no branch given) reported "despachable en paralelo —
  // superficies disjuntas" while the real branches collided on two files.
  //
  // Review round 3: a target that declares ONLY a directory (no concrete
  // file, no branch) also has writeSet.size === 0 — the same shape as
  // nothing declared at all — but a directory IS real information
  // (directoryConflicts can still compare it against another target's
  // concrete files). spec-88 fase 5 and spec-84 fase 3 both use exactly this
  // form ("test pgTAP en `packages/.../tests/`") and DO have **Archivos:**;
  // refusing them here would tell an agent to add a field that already
  // exists.
  const unjudgeable = targets.filter((t) => t.writeSet.size === 0 && t.directories.length === 0);
  if (unjudgeable.length > 0) {
    console.error('check-phase-overlap: no puedo juzgar — target(s) sin superficie alguna:');
    for (const t of unjudgeable) {
      // spec-91 fase 2 (regresión real, #695): dos causas MUY distintas
      // producen el mismo writeSet vacío. Sin distinguirlas, el mensaje le
      // dice a una fase que YA declaró **Archivos:** que la declare —
      // instrucción cumplida, mensaje falso. `archivosFieldPresent` es la
      // señal: la línea existe, sólo que su contenido (p.ej. "(indeterminado
      // — <razón>)") no resolvió a ningún fichero ni directorio.
      if (t.archivosFieldPresent) {
        console.error(
          `  ${t.name} — declara **Archivos:** pero su contenido no resuelve a ningún fichero del repo: "${t.archivosRaw}"`,
        );
      } else {
        console.error(`  ${t.name} — sin **Archivos:** en el spec y sin rama (o rama sin commits todavía).`);
      }
    }
    console.error('Declara **Archivos:** en el spec, o pasa la rama una vez tenga commits, antes de dispatchar en paralelo.');
    process.exit(3);
  }

  const overlap = computeOverlap(targets);
  printReport(targets, overlap);

  process.exit(overlap.hard.length > 0 ? 1 : 0);
}

main();
