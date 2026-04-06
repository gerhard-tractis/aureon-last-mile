---
name: spec_location_and_naming_convention
description: Design specs go in docs/plans/ with naming pattern spec-NN-short-name.md — ask user for next number
type: feedback
---

Design specs and plans must be saved to `docs/plans/`, not `docs/superpowers/specs/`.

Naming convention: `spec-NN-<short-name>.md` (e.g. `spec-07-pickup-scanning-improvements.md`).

**Why:** The project has an established convention — `docs/plans/` for specs/plans, `docs/stories/` for stories. Spec numbers are sequential but may be claimed by parallel sessions. The superpowers brainstorming skill defaults to `docs/superpowers/specs/` but the project convention takes precedence.

**How to apply:** Always ask the user for the next spec number before creating the file. Use `docs/plans/spec-NN-<short-name>.md`. Override the superpowers default.
