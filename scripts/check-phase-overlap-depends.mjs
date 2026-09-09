/**
 * check-phase-overlap-depends.mjs (spec-91 fase 3/4)
 *
 * Pure text parsing for order-dependency, not surface-overlap. Kept
 * separate from check-phase-overlap-parse.mjs (which owns **Archivos:**)
 * the same way check-phase-overlap-closure.mjs is separate from it — a
 * distinct concern, easier to test in isolation.
 *
 * Three concerns:
 *   1. extractDependsField   — read **Depende de:** for one phase, in its
 *      three explicit states (ausente / ninguna / indeterminado) plus a
 *      list of declared `spec-N fase M` entries.
 *   2. findPhaseTokenByNumber — given ANOTHER spec's markdown, find the
 *      status token of the phase numbered M.
 *   3. scanUndeclaredReferences — heuristic net: phase-number mentions in
 *      prose that are NOT in **Depende de:** (advisory only, never blocks).
 */

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

/**
 * Given ANOTHER spec's full markdown and a phase number (with optional
 * letter suffix, e.g. "1b"), finds the heading whose text contains
 * `Fase <N>` / `Phase <N>` as a whole token — not a substring match, so
 * looking for "1" does not match "Fase 1b" and vice versa — and returns its
 * status token.
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
    if (tm) return { found: true, token: tm[1] };
    return { found: true, token: null }; // heading matched, no token on it
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
