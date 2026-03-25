# Spec-19: Pickup Flow Visual Polish

> **Status:** backlog
> **Depends on:** spec-13d (pickup structural redesign — in progress)

## Goal

Polish the entire 5-screen pickup flow to match the quality bar set by the distribution page (spec-18). Fix 15 issues found in design review: missing KPIs, mixed English/Spanish, inconsistent component usage, dark mode bugs, missing confirmation dialogs, and no success feedback.

---

## Issues

| # | Issue | Screen | Impact | Effort |
|---|-------|--------|--------|--------|
| 1 | No KPIs on pickup list | list | High | Low |
| 2 | Mixed English/Spanish | all | High | Medium |
| 3 | Raw buttons instead of shadcn Button | list, handoff, scan | Medium | Low |
| 4 | Hand-rolled modal instead of Dialog | list | Medium | Low |
| 5 | No EmptyState component | list | Medium | Low |
| 6 | No max-w / responsive padding | list, sub-pages | Medium | Low |
| 7 | Hand-rolled summary cards instead of MetricCard | review, complete | Medium | Medium |
| 8 | SignaturePad dark mode broken (`#000` stroke) | complete | Medium | Low |
| 9 | No confirmation dialog on custody transfer | complete | High | Low |
| 10 | No success feedback after completion | complete | Medium | Low |
| 11 | Hand-rolled tabs instead of shadcn Tabs | list | Low-Med | Low |
| 12 | No PageShell wrapper | list | Low | Low |
| 13 | No error boundaries / loading states | review, complete | Medium | Medium |
| 14 | "Proceed to Sign" skips handoff step | review | High (bug) | Low |
| 15 | Completed manifest onClick is no-op | list | Low | Trivial |

---

## Implementation Plan

### Chunk 1: Shared Component Updates

| File | Change |
|------|--------|
| `PickupStepBreadcrumb.tsx` | Labels → Spanish: Recogida / Escaneo / Revisión / Entrega / Firma |
| `ManifestCard.tsx` | "Unknown Retailer" → "Retailer desconocido"; add `interactive?: boolean` prop |
| `DiscrepancyItem.tsx` | "Order:" → "Pedido:"; placeholder → Spanish |
| `SignaturePad.tsx` | `ctx.strokeStyle` reads `--color-text` CSS var; "Clear" → "Borrar" |

### Chunk 2: Pickup List Page

- Add 3 MetricCards (pending count, total packages, completed today)
- Replace hand-rolled tabs with shadcn Tabs
- Replace hand-rolled modal with shadcn Dialog
- Replace raw button with shadcn Button
- Replace `<p>` empty states with EmptyState component
- Wrap in PageShell
- Pass `interactive={false}` to completed ManifestCards
- Always fetch completedManifests for KPI data

### Chunk 3: Scan Page

- Translate all text to Spanish
- Replace raw back button with `<Button variant="ghost" size="icon">`
- Add `sm:p-6` responsive padding

### Chunk 4: Review Page

- Translate all text to Spanish
- Replace inline summary cards with MetricCard
- **Fix bug:** "Proceed to Sign" route → handoff (not complete)
- Add loading skeleton
- Add `sm:p-6`

### Chunk 5: Complete Page

- Translate all text to Spanish
- Replace inline summary cards with MetricCard
- Add AlertDialog confirmation on "Complete" button
- Add toast.success after completion
- Replace raw checkbox with shadcn Checkbox
- Add loading skeleton
- Add `sm:p-6`

### Chunk 6: Handoff Page

- Translate header to Spanish
- Replace raw buttons with shadcn Button
- Change max-w-lg → max-w-2xl
- Add `sm:p-6`

---

## Acceptance Criteria

- [ ] All text in pickup flow is in Spanish (zero English UI strings)
- [ ] Pickup list shows 3 MetricCards with at-a-glance KPIs
- [ ] All buttons use shadcn Button component
- [ ] Camera intake modal uses shadcn Dialog
- [ ] Tabs use shadcn Tabs component
- [ ] Empty states use EmptyState component
- [ ] All pages have responsive padding (p-4 sm:p-6) and max-w constraint
- [ ] Review and complete summary cards use MetricCard
- [ ] SignaturePad stroke is visible in dark mode
- [ ] "Complete" action has AlertDialog confirmation
- [ ] Toast shows success message after completion
- [ ] Checkbox uses shadcn Checkbox
- [ ] Review "Continue" button routes to handoff (not complete)
- [ ] Completed manifests are non-interactive
- [ ] All Vitest tests pass
- [ ] TypeScript compiles (`tsc --noEmit`)
- [ ] Lint passes (`next lint`)
