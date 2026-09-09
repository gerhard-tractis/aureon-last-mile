/**
 * check-phase-overlap-depends.mjs (spec-91 fase 3/4)
 *
 * Text parsing for order-dependency, not surface-overlap. Kept separate from
 * check-phase-overlap-parse.mjs (which owns **Archivos:**) the same way
 * check-phase-overlap-closure.mjs is separate from it — a distinct concern,
 * easier to test in isolation. Also where check-phase-overlap.mjs's
 * dependency-checking logic moved to (review ronda 2, menor): that file was
 * pushing past 300 líneas — the repo's own budget.
 *
 * Cuatro concerns:
 *   1. extractDependsField   — read **Depende de:** for one phase, in its
 *      three explicit states (ausente / ninguna / indeterminado) plus a
 *      list of declared `spec-N fase M` entries. Pura.
 *   2. findPhaseTokenByNumber — given ANOTHER spec's markdown, find the
 *      status token of the phase numbered M. Pura.
 *   3. scanUndeclaredReferences — heuristic net: phase-number mentions in
 *      prose that are NOT in **Depende de:** (advisory only, never blocks). Pura.
 *   4. resolveDependency / checkDependencies — ÚNICA excepción a "pura": lee
 *      `docs/specs/` del repo real para resolver una referencia declarada
 *      contra el token de la OTRA fase. Toca `fs`, a propósito — moverlo
 *      aquí (en vez de duplicar la lectura de ficheros en el CLI) es lo que
 *      mantiene a `check-phase-overlap.mjs` bajo el límite de líneas.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HEADING_RE = /^#{2,4}\s+.*$/;

/**
 * Same phase-bounds algorithm as extractArchivosFiles in
 * check-phase-overlap-parse.mjs, duplicated deliberately — this module has
 * no git/fs dependency and shouldn't gain one just to share ~15 lines.
 * CRLF is normalized first for the same reason documented there: `$` never
 * matches before a stray `\r`, and this repo's Windows checkouts have one.
 */
function findPhaseBody(mdContent, faseMatch) {
  const lines = mdContent.replace(/\r\n/g, '\n').split('\n');
  let phaseStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]) && lines[i].includes(faseMatch)) {
      phaseStart = i;
      break;
    }
  }
  if (phaseStart === -1) return { found: false, lines: [], bodyLines: [] };

  let phaseEnd = lines.length;
  for (let i = phaseStart + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      phaseEnd = i;
      break;
    }
  }
  return { found: true, lines, bodyLines: lines.slice(phaseStart + 1, phaseEnd), headingLine: lines[phaseStart] };
}

/**
 * `spec-(\d+[a-z]?)` ... `fase|phase|paso|step` ... `(\d+[a-z]?)`, tolerant
 * of punctuation/backticks in between (comma, colon, backtick, "y" — the
 * real corpus uses all of these) — validated against the 89-spec corpus,
 * not assumed. Case-insensitive on the "fase" word only; the spec number
 * itself is always lowercase in this repo's convention.
 */
const REF_RE = /spec-(\d+[a-z]?)[^a-zA-Z0-9]{0,15}?(?:fase|phase|paso|step)[-_]?\s*(\d+[a-z]?)/gi;

function findAllRefs(text) {
  const out = [];
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text))) {
    out.push({ specId: m[1].toLowerCase(), faseNum: m[2].toLowerCase() });
  }
  return out;
}

/** true when the block is exactly the literal "ninguna" (± punctuation/whitespace). */
function isExplicitNone(text) {
  return /^ninguna\.?$/i.test(text.trim());
}

/** true when the block opens with a parenthetical "(indeterminado ...)". */
function isIndeterminate(text) {
  return /^\(\s*indeterminado\b/i.test(text.trim());
}

/**
 * Reads `**Depende de:**` for the phase matching `faseMatch` (same
 * continuation-line convention as `**Archivos:**`: the field line plus any
 * immediately following non-blank lines, stopping at the first blank line
 * or the next heading).
 */
export function extractDependsField(mdContent, faseMatch) {
  const { found, bodyLines } = findPhaseBody(mdContent, faseMatch);
  if (!found) {
    return { headingFound: false, fieldPresent: false, explicitNone: false, indeterminate: false, entries: [], raw: '' };
  }

  let start = -1;
  for (let i = 0; i < bodyLines.length; i++) {
    if (/^\*\*Depende de:\*\*/.test(bodyLines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return { headingFound: true, fieldPresent: false, explicitNone: false, indeterminate: false, entries: [], raw: '' };
  }

  let end = start + 1;
  while (end < bodyLines.length && bodyLines[end].trim() !== '') end++;
  const block = bodyLines.slice(start, end).join('\n');
  const raw = block.replace(/^\*\*Depende de:\*\*\s*/, '').trim();

  if (isExplicitNone(raw)) {
    return { headingFound: true, fieldPresent: true, explicitNone: true, indeterminate: false, entries: [], raw };
  }
  if (isIndeterminate(raw)) {
    return { headingFound: true, fieldPresent: true, explicitNone: false, indeterminate: true, entries: [], raw };
  }

  const entries = findAllRefs(raw);
  return { headingFound: true, fieldPresent: true, explicitNone: false, indeterminate: false, entries, raw };
}

const VALID_TOKENS = new Set(['pending', 'in_progress', 'blocked', 'awaiting_user_test', 'done', 'parked']);

/**
 * Given ANOTHER spec's full markdown and a phase number (with optional
 * letter suffix, e.g. "1b"), finds the heading whose text contains
 * `Fase <N>` / `Phase <N>` as a whole token — not a substring match, so
 * looking for "1" does not match "Fase 1b" and vice versa — and returns its
 * status token.
 *
 * Bloqueante 1 (review ronda 2): a spec's prose routinely mentions "fase N"
 * of ITSELF inside a heading that is not a phase heading at all — e.g.
 * spec-85-discrepancias.md line 222: "### La costura entre esta fase y
 * spec-80 fase 2", which has no token, sitting BEFORE the real
 * "### Fase 2 — RPCs `[done]`" at line 338. Stopping at the FIRST heading
 * that merely mentions the number returned `[null]` for spec-85 fase 2 —
 * the most-cited dependency in the corpus (spec-86 fases 1/2a/2b/3, spec-80
 * fases 1/1b, spec-88 fase 1) — which would have hard-blocked the first
 * backfill outright.
 *
 * Fix: keep scanning past a heading that matches the number but carries no
 * RECOGNIZED status token (this repo's actual phase headings always do);
 * only a heading with a valid token counts as a real phase heading. If NO
 * heading with a valid token is ever found, this is genuinely
 * indeterminate — `found: false`, never a token of `null` presented as if
 * it meant something.
 */
export function findPhaseTokenByNumber(mdContent, faseNum) {
  const lines = mdContent.replace(/\r\n/g, '\n').split('\n');
  const escaped = faseNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingHasFase = new RegExp(`\\b(?:fase|phase)\\s+${escaped}\\b`, 'i');
  const BT = '`';
  const tokenRe = new RegExp(`\\[([a-z_]+)\\]${BT}?\\s*$`, 'i');

  for (const line of lines) {
    if (!HEADING_RE.test(line)) continue;
    if (!headingHasFase.test(line)) continue;
    const tm = tokenRe.exec(line);
    if (tm && VALID_TOKENS.has(tm[1].toLowerCase())) {
      return { found: true, token: tm[1].toLowerCase() };
    }
    // Heading mentions the number but isn't a real phase heading (no
    // recognized token) — keep looking, a later heading may be the real one.
  }
  return { found: false, token: null };
}

/**
 * Advisory net: mentions of `spec-N fase M` in the phase body that are NOT
 * already in `**Depende de:**`, excluding the phase's own self-reference
 * (its own spec id + its own fase number — common in evidence lines like
 * `> Implementado por: ... rama feat/spec-84-fase-1-x`). Never blocks; the
 * caller decides what to do with the list (spec-91: print a warning).
 */
export function scanUndeclaredReferences(mdContent, faseMatch, ownSpecId) {
  const { found, bodyLines } = findPhaseBody(mdContent, faseMatch);
  if (!found) return [];

  const ownFaseNum = (/(\d+[a-z]?)/.exec(faseMatch) || [])[1];
  const declared = extractDependsField(mdContent, faseMatch).entries;
  const declaredKeys = new Set(declared.map((d) => `${d.specId}#${d.faseNum}`));

  const body = bodyLines.join('\n');
  const seen = new Set();
  const out = [];
  for (const ref of findAllRefs(body)) {
    const key = `${ref.specId}#${ref.faseNum}`;
    if (seen.has(key)) continue;
    if (ref.specId === String(ownSpecId).toLowerCase() && ref.faseNum === (ownFaseNum || '').toLowerCase()) {
      continue; // autorreferencia
    }
    if (declaredKeys.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * Resuelve una entrada de **Depende de:** contra el repo real: busca
 * `docs/specs/spec-<N>-*.md` y lee el token de su fase `M`. Lee SIEMPRE del
 * disco de trabajo (no de una rama/ref) — el estado de "¿está [done]?" de
 * OTRA fase es una propiedad del repo, no de la rama del target evaluado.
 */
export function resolveDependency(repo, dep) {
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

/**
 * Chequeo de orden para un conjunto de targets (spec-91 fase 3). Devuelve
 * dos listas separadas — nunca una mezclada — porque tienen tratamiento
 * distinto en el CLI: `unmetDeps` bloquea (`exit 4`); `ambiguousDeps` sólo
 * se reporta (bloqueante 1 de la ronda 2: un heading que MENCIONA "fase N"
 * sin ser un heading de fase real no puede distinguirse de un número de
 * fase que genuinamente no existe — adivinar cuál de los dos es sería peor
 * que reportarlo).
 */
export function checkDependencies(targets, repo) {
  const unmetDeps = [];
  const ambiguousDeps = [];
  for (const t of targets) {
    if (!t.depends || !t.depends.fieldPresent || t.depends.explicitNone || t.depends.indeterminate) {
      continue; // ausente, "ninguna", o "(indeterminado — ...)": nada que chequear aquí
    }
    for (const dep of t.depends.entries) {
      const res = resolveDependency(repo, dep);
      if (!res.specFound) {
        unmetDeps.push({ target: t.name, dep, reason: `spec-${dep.specId} no existe en docs/specs/` });
      } else if (!res.found) {
        ambiguousDeps.push({ target: t.name, dep, specFile: res.specFile });
      } else if (res.token !== 'done') {
        // Menor (review ronda 2): resolveDependency lee el WORKING TREE del
        // `--repo` dado — si ese checkout va detrás de `origin/main` (caso
        // conocido de este repo, ver project_primary_checkout_goes_stale),
        // este mensaje puede parecer un exit 4 "falso". Nombrar el fichero
        // exacto que se leyó es lo mínimo para que quien lo vea sepa dónde
        // mirar antes de asumir que el guard está mal.
        unmetDeps.push({ target: t.name, dep, reason: `sigue \`[${res.token}]\` en ${res.specFile} (leído del working tree de --repo)` });
      }
    }
  }
  return { unmetDeps, ambiguousDeps };
}
