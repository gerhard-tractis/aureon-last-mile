# [EPIC-ID.STORY-ID] Story Title

> **Status:** backlog | in-progress | review | done
> **Epic:** [Epic name]
> **Branch:** feat/[story-id]-[short-name]

---

## Goal

One sentence: what does this story deliver and why does it matter?

---

## Stack Notes

Relevant architecture constraints for this story:
- Which layers are touched (DB / Edge Function / hook / component)?
- Any new tables or migrations needed?
- Any new dependencies to add?

---

## Acceptance Criteria

- [ ] AC1: [specific, testable outcome]
- [ ] AC2: [specific, testable outcome]
- [ ] AC3: [specific, testable outcome]

---

## Test Plan

> Write this section BEFORE implementation. Tests must be written first (TDD).

| Test | Type | Description |
|------|------|-------------|
| `test name` | unit/integration/e2e | What behavior it verifies |

---

## Constraints Checklist

> Verify before marking story done.

- [ ] All new files < 300 lines
- [ ] No circular dependencies introduced
- [ ] TDD followed — tests written before implementation
- [ ] `operator_id` filter present on all new DB queries
- [ ] Soft deletes used (no hard DELETEs on user data)
- [ ] `docs/sprint-status.yaml` updated to `done`

---

## Implementation Notes

Key decisions made during implementation. Update as you go.

- [Decision 1]
- [Decision 2]
