# Spec-26c: Landing Motion & Texture

> **Status:** backlog
> **Depends on:** spec-26b (landing layout variety)
> **Layer:** 3 of 3 (see also: spec-26a, spec-26b)

## Goal

Add depth, atmosphere, and choreographed motion to the landing page. This is the polish layer that makes it feel premium — the difference between "competent" and "memorable."

---

## Changes

### 1. Motion Library

Install `motion` (formerly Framer Motion):
```bash
npm install motion
```

**Bundle isolation:** Motion is only used in landing components (`src/app/(landing)/`). Enforcement:
- `hero.tsx` imports Motion directly (it's `'use client'` already and lives under `(landing)/`)
- `scroll-reveal.tsx` stays CSS-only (no Motion needed for simple fade+translate)
- No files under `src/app/app/` or `src/components/` may import from `motion`
- **Verification:** After implementation, run `next build` and check the route-level bundle output. Motion chunks must only appear in the `/` route group, not in `/app/*` routes. If `@next/bundle-analyzer` is available, use it for visual confirmation.

### 2. Hero Entrance Choreography

Replace the current uniform CSS `opacity-0 translate-y-5` → `opacity-100 translate-y-0` approach in `hero.tsx` with a Motion-powered staggered sequence:

| Element | Animation | Delay |
|---------|-----------|-------|
| Brand (Aureon + Tractis) | fadeIn + scale(1.05 → 1.0) | 0ms |
| Eyebrow | fadeIn + slideFromLeft (x: -20 → 0) | 100ms |
| Headline line 1 | fadeIn + slideUp (y: 20 → 0) | 200ms |
| Headline line 2 (gradient) | fadeIn + slideUp (y: 20 → 0) | 350ms |
| Subtext | fadeIn | 500ms |
| CTAs | fadeIn + slideUp (y: 15 → 0) | 650ms |
| Proof stats bar | fadeIn + slideUp, per-stat stagger (100ms each) | 800ms |
| Dashboard placeholder | fadeIn + slideUp (y: 30 → 0) | 1000ms |

All animations use `ease-out` with `duration: 0.7s`. The `mounted` state and CSS transition approach is removed — Motion handles the initial mount animation via `initial` + `animate` props.

### 3. Background Topo Parallax

In the hero, the topographic SVG pattern gets a subtle scroll-linked parallax:

- Lightweight scroll listener (same pattern as navbar's existing one)
- On scroll, apply `transform: translateY(${scrollY * 0.1}px)` to the topo pattern div
- CSS `will-change: transform` for GPU acceleration
- No Motion library needed — raw `useEffect` + `requestAnimationFrame`

### 4. Landing Noise Texture

Add a CSS-only noise overlay **scoped to the landing page only** (not `body::after`, which would affect `/app/*` routes).

**Approach:** Add a `::after` pseudo-element to the `<main>` wrapper in `page.tsx`. Since the landing `<main>` already has a unique class combo (`bg-stone-950 text-stone-100 overflow-x-hidden`), add a `.landing-noise` utility class:

In `globals.css`:
```css
.landing-noise {
  position: relative;
}
.landing-noise::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  opacity: 0.015;
  background-image: url("data:image/png;base64,..."); /* ~500 byte noise PNG */
  background-repeat: repeat;
  background-size: 128px 128px;
}
```

In `page.tsx`, add `landing-noise` to the `<main>` className.

The base64 noise PNG is a small 128x128 pixel grayscale noise pattern. `z-index: 40` keeps it above section content but safely below Radix portals (Sheet, Dialog) which use `z-index: 50`.

### 5. Section Gradient Transitions

Replace abrupt `bg-stone-950` / `bg-stone-900` color swaps between sections.

**Approach (Tailwind div):** Add a gradient fade `<div>` at the top of each section that transitions from the previous section's background. This is simpler and more explicit than CSS pseudo-elements with custom properties.

In each section component, add as the first child inside the `<section>`:
```html
<div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-stone-950 to-transparent pointer-events-none" />
```

The `from-` color matches the previous section's background:
- Sections on `bg-stone-900`: add `from-stone-950` gradient (fades from the stone-950 section above)
- Sections on `bg-stone-950`: add `from-stone-900` gradient (fades from the stone-900 section above)
- Hero section: no gradient (it's the first section)

Each section needs `position: relative` if not already set (most already have it from other elements).

### 6. Topographic Pattern Extension

Currently the topo SVG pattern only appears in the hero. Extend it to two more sections:

| Section | Opacity |
|---------|---------|
| Hero | `opacity-[0.03]` (unchanged) |
| MetricsShowcase | `opacity-[0.015]` |
| CTA section | `opacity-[0.01]` |

Add the same `TOPO_PATTERN` div structure (currently defined in `hero.tsx`) — extract the SVG data URI to the `constants.ts` file created in spec-26a and import where needed.

### 7. CTA Section Shimmer

The gold gradient line at the top of `cta-section.tsx` gets an animated shimmer:

```css
@keyframes gold-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

Applied to the existing `h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent` div:
- `background-size: 200% 100%`
- `animation: gold-shimmer 4s ease-in-out infinite`
- Subtle — the highlight sweeps left-to-right every 4 seconds

Push the radial gold tint from `rgba(230,193,92,0.06)` to `rgba(230,193,92,0.10)` for more presence.

### 8. Card Micro-Interactions

Add subtle hover effects to all card types:

**All cards (global):**
- Add `hover:-translate-y-0.5 transition-all duration-200` (subtle 2px lift)

**Agent cards (features.tsx):**
- The green `animate-pulse` dot on hover: override `animation-duration` from `2s` to `0.8s` via a group-hover. Wrap card in `group` class, dot gets `group-hover:animate-[pulse_0.8s_ease-in-out_infinite]`

**KPI cards (metrics-showcase.tsx):**
- Gold top bar: `h-0.5 group-hover:h-1 transition-all duration-200`
- Wrap card in `group` class

**Pain cards (value-props.tsx):**
- Already have `hover:border-red-500/25` — increase to `hover:border-red-500/35` for stronger signal

### 9. ScrollReveal Direction Variants

Add a `direction` prop to the `ScrollReveal` component:

```tsx
interface ScrollRevealProps {
  children: React.ReactNode;
  delay?: number;
  direction?: 'up' | 'left' | 'right';
  className?: string;
}
```

| Direction | Hidden state | Visible state |
|-----------|-------------|---------------|
| `up` (default) | `opacity-0 translate-y-8` | `opacity-100 translate-y-0` |
| `left` | `opacity-0 -translate-x-8` | `opacity-100 translate-x-0` |
| `right` | `opacity-0 translate-x-8` | `opacity-100 translate-x-0` |

Apply across sections for variety:
- ValueProps header: `direction="left"`
- MetricsShowcase header: `direction="right"`
- Features left column: `direction="left"`
- HowItWorks header: `direction="left"`
- FounderSection: `direction="up"` (centered, up feels natural)
- CtaSection: `direction="up"` (centered)

Cards within sections stay `direction="up"` — the directional variety is at the section header level.

### 10. Reduced Motion Accessibility

Respect `prefers-reduced-motion` for users who have motion sensitivity:

**Motion library (hero):** Use Motion's built-in `useReducedMotion()` hook. When reduced motion is preferred, skip all entrance animations — elements render in their final state immediately (no fade, no slide, no scale).

**CSS animations (shimmer, parallax, card hover lifts, pulse speed-up):** Add a global media query in `globals.css`:
```css
@media (prefers-reduced-motion: reduce) {
  .landing-noise::after { animation: none; }
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

**Important:** Scope this under `.landing-noise` to avoid affecting `/app/*` route transitions (sidebar, modals, etc.):
```css
@media (prefers-reduced-motion: reduce) {
  .landing-noise * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

**ScrollReveal:** When `prefers-reduced-motion` matches, elements render visible immediately (no translate/fade transition). Check `window.matchMedia('(prefers-reduced-motion: reduce)')` in the `useEffect`.

---

## Files Touched

All paths relative to `apps/frontend/`:

- `package.json` — add `motion` dependency
- `src/app/(landing)/components/hero.tsx` — Motion entrance choreography, topo parallax, reduced motion
- `src/app/(landing)/components/scroll-reveal.tsx` — direction prop, reduced motion check
- `src/app/globals.css` — landing noise class, section gradient divs, gold shimmer keyframe, reduced motion media query
- `src/app/page.tsx` — add `landing-noise` class to `<main>`
- `src/app/(landing)/constants.ts` — add `TOPO_PATTERN` SVG data URI (extract from hero.tsx, added to file from spec-26a)
- `src/app/(landing)/components/metrics-showcase.tsx` — topo pattern, card micro-interactions, ScrollReveal direction
- `src/app/(landing)/components/features.tsx` — card micro-interactions, ScrollReveal direction
- `src/app/(landing)/components/value-props.tsx` — card micro-interactions, ScrollReveal direction, section gradient div
- `src/app/(landing)/components/how-it-works.tsx` — ScrollReveal direction, section gradient div
- `src/app/(landing)/components/integrations.tsx` — section gradient div, ScrollReveal direction
- `src/app/(landing)/components/founder-section.tsx` — ScrollReveal direction, section gradient div
- `src/app/(landing)/components/cta-section.tsx` — shimmer animation, topo pattern, radial tint increase, section gradient div

## Dependencies

- `motion` (npm, ~15KB gzip) — hero entrance choreography

## Risks

- **Motion bundle size:** ~15KB gzip. Only imported in `(landing)/` components. Verify with `next build` that Motion chunks don't appear in `/app/*` routes.
- **Noise texture z-index:** Scoped to `.landing-noise::after` at `z-index: 40`, safely below Radix portals (`z-index: 50`).
- **Parallax performance:** The scroll-linked translateY on the topo pattern must use `requestAnimationFrame` to avoid jank. Avoid recalculating on every scroll event — throttle to rAF.

## Acceptance Criteria

1. Hero has a choreographed Motion-powered entrance (not uniform CSS transitions)
2. Each animation element in the hero has a distinct motion (scale, slideFromLeft, slideUp — not all the same)
3. Subtle noise texture visible across the full page at low opacity
4. Section transitions use gradient fades (no abrupt color changes)
5. Topo pattern appears in hero, MetricsShowcase, and CTA section at descending opacities
6. CTA section gold line has a shimmer animation
7. Cards lift on hover with smooth transitions
8. Agent card pulse dots speed up on hover
9. KPI card gold bars expand on hover
10. ScrollReveal supports left/right/up directions, applied with variety across sections
11. Motion library does not appear in `/app/*` route bundles
12. No scroll jank from parallax or noise overlay
13. `prefers-reduced-motion: reduce` disables all animations (hero renders immediately, no CSS transitions)
14. All existing functionality preserved
