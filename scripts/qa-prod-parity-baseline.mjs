/**
 * qa-prod-parity-baseline.mjs — spec-93 fase 4: parsing docs/qa-prod-parity-baseline.yml.
 *
 * Split out of qa-prod-parity-compare.mjs (review budget: this repo keeps
 * files under 300 lines) — a distinct concern, easier to test in isolation,
 * same pattern check-phase-overlap-depends.mjs used to split off of
 * check-phase-overlap.mjs.
 *
 * A HAND-ROLLED PARSER, NOT GENERAL YAML
 * -----------------------------------------
 * Pulling in js-yaml would make this script — and its tests — depend on
 * node_modules being installed, which a fresh worktree of this monorepo
 * cannot always guarantee quickly (observed 45+ minutes for `npm install`
 * with the .bin symlinks still missing). The baseline file only ever needs
 * two top-level keys, each a list of flat string-valued maps:
 *
 *   top_level_key:
 *     - field: value
 *       other_field: "quoted value"
 *
 * Two-space indent for the list marker (`  - `), four-space indent for its
 * fields. Anything outside that shape is a parse error, not a silent guess —
 * a baseline file this parser reads wrong is exactly the kind of "verified
 * nothing, said nothing" bug spec-93 exists to close.
 */

function parseSimpleYaml(text) {
  const root = {};
  let currentTopKey = null;
  let currentItem = null;

  // Strips a matching pair of double OR single quotes. Values in this file
  // are written double-quoted by convention, but a hand-edited single-quoted
  // value (`qa: 'true'`) used to survive as the literal 4-character string
  // `'true'` and silently never match anything — a trap in a file people
  // edit by hand (review round 1, Menores).
  const stripQuotes = (v) => {
    const trimmed = v.trim();
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed;
  };

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const topMatch = line.match(/^([A-Za-z0-9_]+):\s*$/);
    if (topMatch) {
      currentTopKey = topMatch[1];
      root[currentTopKey] = [];
      currentItem = null;
      continue;
    }

    const listItemMatch = line.match(/^ {2}- ([A-Za-z0-9_]+):\s*(.*)$/);
    if (listItemMatch) {
      if (!currentTopKey) throw new Error(`list item found before any top-level key: ${JSON.stringify(line)}`);
      currentItem = { [listItemMatch[1]]: stripQuotes(listItemMatch[2]) };
      root[currentTopKey].push(currentItem);
      continue;
    }

    const fieldMatch = line.match(/^ {4}([A-Za-z0-9_]+):\s*(.*)$/);
    if (fieldMatch) {
      if (!currentItem) throw new Error(`field found outside any list item: ${JSON.stringify(line)}`);
      currentItem[fieldMatch[1]] = stripQuotes(fieldMatch[2]);
      continue;
    }

    throw new Error(`could not parse baseline line: ${JSON.stringify(line)}`);
  }

  return root;
}

/** Same key-joining convention as qa-prod-parity-compare.mjs — kept in sync deliberately. */
export const KEY_SEP = '::';

/**
 * Returns { excludedSurfaces: Map<string, {id, reason}>, accepted: Map<"surface::key", {...}> }.
 * Throws on any entry missing a required field — an unreadable or
 * under-specified baseline must not silently behave like an empty one.
 *
 * excludedSurfaces carries the reason (not just a Set of ids) because the
 * comparator has to REPORT every exclusion and how many facts it silenced,
 * every run — an exclusion nobody can see in the output is indistinguishable
 * from one that silently does nothing (review round 1, Bloqueante 2).
 */
export function parseBaseline(yamlText) {
  const raw = yamlText.trim() === '' ? {} : parseSimpleYaml(yamlText);

  const excludedSurfaces = new Map();
  for (const entry of raw.excluded_surfaces || []) {
    if (!entry || !entry.id) {
      throw new Error('excluded_surfaces entry is missing "id"');
    }
    if (!entry.reason || String(entry.reason).trim() === '') {
      throw new Error(`excluded_surfaces entry "${entry.id}" is missing a reason`);
    }
    excludedSurfaces.set(entry.id, { id: entry.id, reason: String(entry.reason) });
  }

  const accepted = new Map();
  for (const entry of raw.accepted_divergences || []) {
    for (const field of ['surface', 'key', 'qa', 'production', 'reason', 'uncovered_change_class']) {
      if (entry[field] === undefined || entry[field] === null || String(entry[field]).trim() === '') {
        throw new Error(
          `accepted_divergences entry for ${entry.surface || '?'}/${entry.key || '?'} is missing "${field}"`
        );
      }
    }
    accepted.set(String(entry.surface) + KEY_SEP + String(entry.key), {
      surface: String(entry.surface),
      key: String(entry.key),
      qa: String(entry.qa),
      production: String(entry.production),
      reason: String(entry.reason),
      uncoveredChangeClass: String(entry.uncovered_change_class),
    });
  }

  return { excludedSurfaces, accepted };
}
