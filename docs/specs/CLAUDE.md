# Plans

## Naming Convention

```
spec-XX-description-of-the-spec.md
```

Scan for highest existing number, add one. Zero-padded (01, 02, ...). Never skip or reuse.

**A number is only reserved by a file in this directory.** Do not pre-assign numbers to future work in any other document — a planning table, a roadmap, an issue. Those reservations are invisible to the scan above, so two people working in parallel will pick the same number. This has already happened twice: `docs/architecture/phased-rollout-strategy.md` claimed 47/48/49, which were taken on disk; it was corrected to 53/54/55, and spec-53 was taken on disk two days later. Describe planned work by name and assign the number when you create the file.

**One file per spec only.** The spec and implementation plan live in the same file. Never create a separate `...Plan.md` or any companion file for a spec.

## Spec States

Every spec file must have a `**Status:**` line at the top. Keep it updated.

| State | When |
|---|---|
| `backlog` | Spec written, not yet started |
| `in progress` | Implementation has begun |
| `completed` | User confirms no additional PRs needed |
| `superseded` | The feature was removed or replaced — the spec is history, not live behaviour |

Rules:
- Set to `in progress` when the first implementation commit is made
- Set to `completed` only when the user explicitly confirms the feature is done
- Never self-declare completed — wait for user confirmation
- Set to `superseded` when later work removes or replaces what the spec describes,
  and say so in a note at the top: what replaced it, which PR, and what a revival
  would actually require. A `completed` spec reads as a description of the running
  system, and a `backlog` one reads as ready to pick up — both mislead once the
  feature is gone. The landing specs (17, 26a-c) are the worked example.

## Required Skills — In Order

**IMPORTANT: Assess before invoking.** Read and evaluate what already exists before invoking any skill. If a spec is already written and approved, skip brainstorming and writing-plans. If a spec already contains detailed stories, data model, component architecture, and file paths, it IS the plan — don't invoke writing-plans to rewrite it. Only invoke a skill when it will produce something that doesn't already exist.

### Spec Creation
1. `superpowers:using-superpowers` — start of every conversation
2. `superpowers:brainstorming` — before writing any spec; explores intent and requirements. **Skip if spec already exists and is approved.**
3. `superpowers:writing-plans` — produces the spec file with TDD steps. **Skip if spec already contains sufficient implementation detail (data model, stories, component architecture, file paths).**

### Implementation
4. `superpowers:using-git-worktrees` — before starting implementation; isolates work from current workspace
5. `superpowers:subagent-driven-development` — when the plan has independent tasks that can run in parallel in the current session
6. `superpowers:executing-plans` — when executing a plan in a separate session with review checkpoints
7. `superpowers:test-driven-development` — when implementing any feature or bugfix; write tests first
8. `superpowers:dispatching-parallel-agents` — when 2+ independent tasks can be worked without shared state

### Debugging
9. `superpowers:systematic-debugging` — on any bug, test failure, or unexpected behavior; before proposing fixes

### Completion
10. `superpowers:verification-before-completion` — before claiming work is done, fixed, or passing; run verification commands and confirm output
11. `superpowers:requesting-code-review` — after implementation is complete and tests pass; before merging
12. `superpowers:receiving-code-review` — when code review feedback arrives; before implementing suggestions
13. `superpowers:finishing-a-development-branch` — when all tests pass and work is ready to integrate
