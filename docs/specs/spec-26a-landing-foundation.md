# Spec-26a: Landing Foundation (Font, Icons, Copy, Accessibility)

> **Status:** backlog
> **Depends on:** spec-17 (landing page — implemented)
> **Layer:** 1 of 3 (see also: spec-26b, spec-26c)

## Goal

Immediate quality uplift for the landing page. Replace generic elements (Geist-only typography, emoji icons, missing accessibility) with professional alternatives. No layout restructuring, no new libraries — purely refinement of what exists.

---

## Changes

### 1. Display Font — Instrument Serif

Add Instrument Serif (Google Fonts) via `next/font/google` in `layout.tsx`. Expose as `--font-display` CSS variable.

| File | Change |
|------|--------|
| `layout.tsx` | Import `Instrument_Serif` from `next/font/google`, add to `<html>` className as `${instrumentSerif.variable}` |
| `tailwind.config.ts` | Add `display: ["var(--font-display)", "serif"]` to `fontFamily.extend` |
| `globals.css` | Add `.font-display { font-family: var(--font-display, serif); }` utility |

Apply `font-display` class to all `h1` and `h2` elements across landing components:
- `src/app/(landing)/components/hero.tsx` — h1
- `src/app/(landing)/components/value-props.tsx` — h2
- `src/app/(landing)/components/metrics-showcase.tsx` — h2
- `src/app/(landing)/components/features.tsx` — h2
- `src/app/(landing)/components/how-it-works.tsx` — h2
- `src/app/(landing)/components/integrations.tsx` — h2
- `src/app/(landing)/components/founder-section.tsx` — h2
- `src/app/(landing)/components/cta-section.tsx` — h2

Hero headline scales up from `text-4xl md:text-5xl lg:text-6xl` to `text-5xl md:text-6xl lg:text-7xl`.

**Note:** Instrument Serif only has Regular (400) weight — no bold. Remove `font-bold` from h1/h2 elements that get `font-display`. The serif's natural presence at large sizes provides sufficient hierarchy.

### 2. Icon System — Replace Emoji with Lucide

| Component | Emoji | Lucide Icon |
|-----------|-------|-------------|
| `value-props.tsx` | `$` | `DollarSign` |
| `value-props.tsx` | `✗` | `XCircle` |
| `value-props.tsx` | `★` | `Star` |
| `how-it-works.tsx` | `📄` | `FileText` |
| `how-it-works.tsx` | `📱` | `Smartphone` |
| `how-it-works.tsx` | `🔗` | `Link2` |
| `how-it-works.tsx` | `📊` | `BarChart3` |
| `metrics-showcase.tsx` | `💡` | `Lightbulb` |

Icon containers keep existing styling (`w-10 h-10 rounded-lg` with appropriate color backgrounds). Lucide icons render at `w-5 h-5` inside the container with matching text color (`text-red-400` for pain points, `text-amber-400` for features).

**Replacement patterns differ by component:**
- `value-props.tsx` — `pains` data array has `icon: '$'` string fields. Change to store Lucide component references (e.g., `icon: DollarSign`), render as `<pain.icon className="w-5 h-5" />`.
- `how-it-works.tsx` — the `feats` array (lines 22-47, not the `steps` array) has `icon: '📄'` string fields. Same pattern as above.
- `metrics-showcase.tsx` — the `💡` emoji is **not** in a data array. It's a hardcoded inline character in the "case study insight" callout box (line 83). Replace directly with `<Lightbulb className="w-5 h-5 text-amber-400" />` in the JSX.

### 3. Copy Fixes

| File | Change |
|------|--------|
| `footer.tsx:17` | `"Intelligence Applied. Results Delivered."` → `"Inteligencia aplicada. Resultados medibles."` |
| `page.tsx:34` | Remove inline `style={{ scrollBehavior: 'smooth' }}` from `<main>` |
| `globals.css` | Add `scroll-behavior: smooth;` to `html` rule in `@layer base` |
| `hero.tsx:64-65` | Remove `eslint-disable` comment, replace `<img>` with inline SVG for Tractis logo |

### 4. Constants Extraction

Create `src/app/(landing)/constants.ts`:

```ts
export const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';
export const CONTACT_EMAIL = 'gerhard@tractis.ai';
```

Update imports in: `hero.tsx`, `navbar.tsx`, `cta-section.tsx`, `footer.tsx`. Remove local `DEMO_URL` declarations from each.

**Note:** `integrations.tsx` exists in the component directory but is not currently rendered in `page.tsx`. As part of this spec, add `<Integrations />` to `page.tsx` between `<HowItWorks />` and `<FounderSection />` to match the intended page flow and enable the font/accessibility changes below.

### 5. Accessibility

**Focus-visible on all CTAs** — Add to every `<a>` and `<button>` in landing components:
```
focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 outline-none
```

**Section aria-labels:**

| Section | `aria-label` |
|---------|-------------|
| Hero | `"Inicio"` |
| ValueProps | `"El problema"` |
| MetricsShowcase | `"Inteligencia estrategica"` |
| Features | `"Agentes autonomos"` |
| Integrations | `"Integraciones"` |
| HowItWorks | `"Operacion completa"` |
| FounderSection | `"Quien esta detras"` |
| CtaSection | `"Agenda una llamada"` |
| Footer | `"Pie de pagina"` |

**Navbar hamburger:** Add `aria-label="Abrir menu de navegacion"` to the Sheet trigger button (currently has `aria-label="Menu"` — update to Spanish).

### 6. CTA Weight Differentiation

**Primary CTA (gold "Agenda una llamada"):**
- Padding: `px-8 py-3` → `px-10 py-4`
- Add: `active:scale-[0.98] transition-all`
- Applies in: `hero.tsx`, `cta-section.tsx`, `navbar.tsx` (desktop)

**Secondary CTA (outline):**
- Keep current padding
- Add: `active:scale-[0.98]`
- Applies in: `hero.tsx`, `cta-section.tsx`

---

## Files Touched

All paths relative to `apps/frontend/`:

- `src/app/layout.tsx` — font import
- `tailwind.config.ts` — font family extend
- `src/app/globals.css` — scroll-behavior, font utility
- `src/app/page.tsx` — remove inline `scrollBehavior` style from `<main>`
- `src/app/(landing)/components/hero.tsx` — font class, headline size, logo SVG, CTA styles, constants import, accessibility
- `src/app/(landing)/components/navbar.tsx` — CTA styles, constants import, aria-label
- `src/app/(landing)/components/value-props.tsx` — Lucide icons, font class, aria-label
- `src/app/(landing)/components/metrics-showcase.tsx` — Lucide icon (inline), font class, aria-label
- `src/app/(landing)/components/features.tsx` — font class, aria-label
- `src/app/(landing)/components/integrations.tsx` — font class, aria-label
- `src/app/(landing)/components/how-it-works.tsx` — Lucide icons (`feats` array), font class, aria-label
- `src/app/(landing)/components/founder-section.tsx` — font class, aria-label
- `src/app/(landing)/components/cta-section.tsx` — font class, CTA styles, constants import, aria-label
- `src/app/(landing)/components/footer.tsx` — Spanish tagline, constants import, aria-label
- **New:** `src/app/(landing)/constants.ts`

## Tests

Existing tests in `__tests__/` (hero.test.tsx, navbar.test.tsx, scroll-reveal.test.tsx, sections.test.tsx) must be updated if component interfaces change (e.g., icon data structure changing from string to component reference). Run full test suite after implementation.

## Dependencies

None new. Instrument Serif via `next/font/google` (already available in Next.js).

## Acceptance Criteria

1. All h1/h2 on landing render in Instrument Serif
2. Hero headline is `text-5xl md:text-6xl lg:text-7xl`
3. Zero emoji icons remain — all 8 replaced with Lucide SVGs
4. Footer tagline is in Spanish
5. `DEMO_URL` defined in exactly one file
6. `scroll-behavior: smooth` on `html` via CSS, not inline on `<main>`
7. All CTAs have `focus-visible` ring styles
8. All sections have `aria-label`
9. Primary CTA visually larger than secondary
10. Tractis logo is inline SVG (no eslint-disable)
11. Lighthouse accessibility score >= 95
12. All existing functionality preserved
