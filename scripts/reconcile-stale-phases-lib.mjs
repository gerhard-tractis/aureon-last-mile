/**
 * reconcile-stale-phases-lib.mjs (spec-91 fase 5)
 *
 * Pure logic for the server-side reconciliation guard: no fs, no git, no
 * gh — kept separate from reconcile-stale-phases.mjs (the CLI) the same
 * way the rest of this repo's guards separate parsing from wiring
 * (check-phase-overlap-parse.mjs vs check-phase-overlap.mjs).
 *
 * Why this exists at all: no LOCAL hook can catch a stale [in_progress]
 * token left behind by `gh pr merge --auto --squash` (CLAUDE.md's mandated
 * flow) — the merge happens on GitHub's servers, minutes later, with no
 * Bash command for a hook to intercept. The six stale tokens that motivated
 * spec-91 all came from exactly that path. This is the same reason
 * `check-spec-fields.sh` lives in CI and not in a hook: a check that
 * depends on someone remembering to run it locally isn't a guardrail.
 */

const HEADING_RE = /^#{2,4}\s+.*$/;
const TOKEN_END_RE = /\[in_progress\]`?\s*$/;

/**
 * Scans a set of spec files for headings carrying the `[in_progress]`
 * token, and returns each with its spec id (from the FILENAME, not the
 * content — `spec-<id>-...md`) and the heading text (label + title, token
 * stripped).
 */
export function findInProgressPhases(specFiles) {
  const out = [];
  for (const { filename, content } of specFiles) {
    const idMatch = /^spec-(\d+[a-z]?)-/.exec(filename);
    if (!idMatch) continue;
    const specId = idMatch[1];
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      if (!HEADING_RE.test(line)) continue;
      if (!TOKEN_END_RE.test(line)) continue;
      const faseText = line
        .replace(/^#+\s*/, '')
        .replace(/\s*`?\[in_progress\]`?\s*$/, '')
        .trim();
      out.push({ specId, faseText, file: filename });
    }
  }
  return out;
}

/**
 * Given a list of open PR branch names, returns the set of spec ids any of
 * them names — same tolerant pattern `keep-going.sh` already uses
 * (`grep -oE 'spec-[0-9]+[a-z]?'`).
 */
export function extractSpecIdsFromBranches(branchNames) {
  const ids = new Set();
  for (const branch of branchNames) {
    const m = /spec-([0-9]+[a-z]?)/i.exec(branch || '');
    if (m) ids.add(m[1].toLowerCase());
  }
  return ids;
}

/**
 * A phase is stale when its spec id has NO open PR naming it — checked at
 * the SPEC level, not per-fase: a branch usually encodes both, but staying
 * at spec-granularity keeps the false-negative rate low (a real open PR for
 * a DIFFERENT phase of the same spec still suppresses the warning for this
 * one). Documented limitation, not a bug: this trades a few missed stale
 * phases for never crying wolf about a spec that's genuinely still active.
 */
export function computeStalePhases(inProgressPhases, openPrSpecIds) {
  return inProgressPhases.filter((p) => !openPrSpecIds.has(p.specId.toLowerCase()));
}

const ROW_RE = /^\|\s*spec-([0-9]+[a-z]?)\s*\|\s*(.*?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*$/;

/** Parses the tracking issue's own body back into entries — round-trips with `renderIssueBody`. */
export function parseIssueBody(body) {
  const out = [];
  for (const line of String(body || '').split('\n')) {
    const m = ROW_RE.exec(line);
    if (m) out.push({ specId: m[1], faseText: m[2], firstSeen: m[3] });
  }
  return out;
}

/**
 * Renders the tracking issue's body as a markdown table, one row per stale
 * entry. `entries` are already merged (see `mergeStaleEntries`) — this
 * function is pure rendering, no date logic.
 */
export function renderIssueBody(entries) {
  const lines = [
    'Fases con token `[in_progress]` sin ningún PR abierto que las respalde.',
    '',
    'Puede significar que el trabajo se mergeó (probablemente vía `gh pr merge --auto`,',
    'que no deja ningún comando local que un hook pueda interceptar — ver spec-91) y',
    'nadie cerró el token todavía. **También puede ser un falso positivo inofensivo:**',
    'trabajo en una rama LOCAL sin pushear todavía no tiene PR abierto que lo',
    'respalde — y una rama YA pusheada pero sin PR abierto todavía (por ejemplo,',
    'entre el push y el `gh pr create`) tampoco lo tiene. Los dos aparecen aquí',
    'igual, y los dos son transitorios: desaparecen en cuanto se pushea o se abre',
    'el PR. La columna "detectado" ayuda a distinguir esto de lo real: unos',
    'minutos, probablemente alguno de estos dos casos; unos días, probablemente',
    'un token que nadie cerró.',
    '',
    '| Spec | Fase | Detectado por primera vez |',
    '|---|---|---|',
  ];
  for (const e of entries) {
    lines.push(`| spec-${e.specId} | ${e.faseText} | ${e.firstSeen} |`);
  }
  lines.push('');
  lines.push(
    'Actualizado automáticamente por `.github/workflows/reconcile-stale-phases.yml` ' +
      '(push a `main` y una corrida diaria). Se cierra solo cuando la lista queda vacía — no bloquea CI.',
  );
  return lines.join('\n');
}

/**
 * F5-3 (review ronda 3): la clave de identidad de una entrada es
 * spec + NÚMERO de fase, no el texto completo del heading. `faseText` trae
 * el título después del número ("Fase 2 — RPCs") y este repo corrige esos
 * títulos a menudo — si la clave incluyera el texto completo, corregir un
 * título reseteaba `firstSeen` a "hoy", justo la columna que el cuerpo del
 * issue le pide al lector usar para distinguir un falso positivo (rama sin
 * pushear, minutos) de uno real (días). Se extrae sólo el número (con
 * sufijo de letra: "1b"); si el heading no trae uno reconocible (no debería
 * pasar — `findInProgressPhases` sólo emite headings de fase reales), se
 * cae al texto completo en vez de fusionar entradas de fases distintas por
 * error.
 */
function faseKey(faseText) {
  const m = /^(?:Fase|Phase)\s+(\d+[a-z]?)\b/i.exec(faseText || '');
  return m ? m[1].toLowerCase() : faseText;
}

/**
 * Merges the phases that are stale RIGHT NOW against what the issue already
 * tracked: a phase still stale keeps its ORIGINAL `firstSeen` (never reset
 * to today just because the workflow ran again — nor because someone fixed
 * a typo in the phase's title, see `faseKey` above); a phase newly stale
 * gets `today`; a phase no longer stale is dropped — this is what makes the
 * issue self-healing without anyone editing it by hand.
 */
export function mergeStaleEntries(staleNow, previousEntries, today) {
  const prevByKey = new Map(previousEntries.map((e) => [`${e.specId}\0${faseKey(e.faseText)}`, e]));
  return staleNow.map((p) => {
    const key = `${p.specId}\0${faseKey(p.faseText)}`;
    const prev = prevByKey.get(key);
    return { specId: p.specId, faseText: p.faseText, firstSeen: prev ? prev.firstSeen : today };
  });
}
