/**
 * When closing a reception requires a discrepancy note.
 *
 * This used to live inside FinalizeReceptionButton; it was extracted once a
 * second consumer appeared (spec-62's mobile sheet). A rule with two
 * consumers cannot be written twice.
 *
 * WHY IT IS NOT received < expected. spec-52 accepts a package that arrives
 * with no verified pickup scan on this route: it increments received_count
 * AND unexpected_count, so the two errors offset and the raw count checks
 * out:
 *
 *   10 expected · 10 received · 1 unexpected
 *     -> checks out, and yet ONE expected package never arrived and ONE
 *        package from another truck did. Comparing totals lets it through
 *        silently.
 *
 * Separating the populations does not let it through:
 *   matched   := received - unexpected
 *   needsNote := matched !== expected || unexpected > 0
 *
 * DELIBERATE ASYMMETRY WITH THE SERVER. complete_route_reception keeps the
 * spec-47 guard (`received_count < expected_count`); the rule above was
 * explicitly deferred — see PART 3 of
 * 20260812000006_spec52_unexpected_count.sql — and is spec-56's job. The UI
 * asks for a note in more cases than the server, never in fewer: that
 * direction is the safe one. The reverse would leave the reception unable to
 * close.
 */
export interface ReceptionCounts {
  expectedCount: number;
  receivedCount: number;
  unexpectedCount: number;
}

export interface FinalizeDecision {
  /** Expected packages that actually arrived. */
  matched: number;
  /** Expected packages that never arrived. Never negative. */
  missing: number;
  needsNote: boolean;
}

export function finalizeRule({
  expectedCount,
  receivedCount,
  unexpectedCount,
}: ReceptionCounts): FinalizeDecision {
  const matched = receivedCount - unexpectedCount;
  return {
    matched,
    missing: Math.max(0, expectedCount - matched),
    needsNote: matched !== expectedCount || unexpectedCount > 0,
  };
}

/**
 * What the server requires TODAY, no more, no less. Exists so the inclusion
 * test can name it; do not use it to decide anything in the UI.
 */
export function serverRequiresNote({ expectedCount, receivedCount }: ReceptionCounts): boolean {
  return receivedCount < expectedCount;
}
