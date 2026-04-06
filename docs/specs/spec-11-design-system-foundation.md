# Spec-11: Design System Foundation

**Status:** backlog
_Date: 2026-03-18_

---

## Goal

Replace the current ad-hoc theme system (7 hardcoded CSS presets, inconsistent tokens, `NEXT_PUBLIC_THEME` env var) with a proper 3-mode design system: **Light**, **Dark**, and **Custom** (operator white-label). All future specs build on this foundation.

## Context

The current frontend has:
- 7 disconnected theme classes in `globals.css` (`theme-blue`, `theme-sass`, `theme-tractis`, etc.)
- `BrandingProvider` that generates color ramps from operator hex colors but is not aligned with the token structure
- `useTheme` only toggling light/dark with no knowledge of custom mode
- No typography system — font choices are inconsistent

This spec replaces all of that with one coherent system.

## Design Decisions

### Aesthetic
Command Center: high contrast, status-saturated, precise. Dense information hierarchy. Every element earns its space.

### Typography
- **UI font:** Geist Sans (weights 400–800) via `next/font/local`
- **Data/mono font:** Geist Mono (weights 400–600) — all tabular numbers, counts, IDs, timestamps, codes
- Loaded once in root layout, exposed as CSS variables `--font-sans` and `--font-mono`

### Three Modes

#### Mode 1 — Standard Light (default)
| Token | Value |
|---|---|
| `--color-background` | `#f8fafc` |
| `--color-surface` | `#ffffff` |
| `--color-surface-raised` | `#f1f5f9` |
| `--color-border` | `#e2e8f0` |
| `--color-border-subtle` | `#f1f5f9` |
| `--color-accent` | `#ca9a04` |
| `--color-accent-light` | `#e6c15c` |
| `--color-accent-muted` | `#fef9c3` |
| `--color-accent-foreground` | `#ffffff` |
| `--color-text` | `#0f172a` |
| `--color-text-secondary` | `#64748b` |
| `--color-text-muted` | `#94a3b8` |

#### Mode 2 — Standard Dark (warm)
| Token | Value |
|---|---|
| `--color-background` | `#13110d` |
| `--color-surface` | `#1e1a14` |
| `--color-surface-raised` | `#2a2218` |
| `--color-border` | `#2a2218` |
| `--color-border-subtle` | `#1f1a13` |
| `--color-accent` | `#e6c15c` |
| `--color-accent-light` | `#f5d98a` |
| `--color-accent-muted` | `#2d2106` |
| `--color-accent-foreground` | `#0d0b09` |
| `--color-text` | `#f5ecd7` |
| `--color-text-secondary` | `#c8b99a` |
| `--color-text-muted` | `#5c5040` |

#### Mode 3 — Custom (operator white-label)
Loaded dynamically by `BrandingProvider` from the agent-generated palette stored in `operators.settings.branding`. Always uses a light neutral base — the operator's brand colors replace accent tokens only. The user's light/dark preference does not apply in custom mode; custom mode has its own fixed appearance driven entirely by the operator's palette.

**Agent-generated palette contract (4 fields):**
```json
{
  "brand_primary":    "#hex",  // required — main brand color
  "brand_background": "#hex",  // required — their page base (usually white/off-white)
  "brand_text":       "#hex",  // required — primary text (near-black or dark brand shade)
  "brand_secondary":  "#hex"   // optional — complementary accent
}
```

**Derivation rules** (all computed by `generateBrandTokens(palette)`):
- `--color-accent` → `brand_primary`
- `--color-accent-muted` → `brand_primary` at 10% opacity
- `--color-accent-foreground` → auto-calculated (white if contrast ≥ 4.5:1, else dark text)
- `--color-background` → `brand_background`
- `--color-surface` → `brand_background` lightened/mixed slightly
- `--color-border` → `brand_background` darkened 12%
- `--color-text` → `brand_text`
- `--color-text-secondary` → `brand_text` at 60% opacity
- `--color-text-muted` → `brand_text` at 35% opacity
- Full `primary-50`→`primary-900` ramp via `generateColorRamp(brand_primary)`

### Fixed Tokens (all modes, never overridden)
In light and custom modes the light values apply. In dark mode the dark values apply. Custom mode never uses the dark fixed token set regardless of brand palette.

| Token | Light / Custom value | Dark value |
|---|---|---|
| `--color-status-success` | `#22c55e` | `#4ade80` |
| `--color-status-success-bg` | `#dcfce7` | `rgba(20,83,45,0.27)` |
| `--color-status-success-border` | `#bbf7d0` | `#14532d` |
| `--color-status-warning` | `#f59e0b` | `#fbbf24` |
| `--color-status-warning-bg` | `#fef9c3` | `rgba(120,53,15,0.27)` |
| `--color-status-warning-border` | `#fde68a` | `#78350f` |
| `--color-status-error` | `#ef4444` | `#f87171` |
| `--color-status-error-bg` | `#fee2e2` | `rgba(127,29,29,0.27)` |
| `--color-status-error-border` | `#fecaca` | `#7f1d1d` |
| `--color-status-info` | `#3b82f6` | `#60a5fa` |

Status tokens are fixed by intent — green always means active/success, amber always means warning, red always means failure. Operator branding must never override them.

### Corner Radius
- `--radius-sm`: `4px` — badges, inputs, stat cards
- `--radius-md`: `6px` — buttons, cards, panels
- `--radius-lg`: `8px` — modals, sheets, dropdowns

### Spacing Scale
Standard Tailwind 4-based scale — no custom spacing. Components use `p-2`, `p-3`, `p-4` etc. consistently.

---

## Deliverables

### 1. `globals.css` — Rewrite
- Remove all 7 legacy theme classes (`theme-blue`, `theme-sass`, etc.)
- Define `:root` with light mode tokens
- Define `.dark` class with dark mode tokens
- Define `.custom` class as a reset point (populated dynamically by `BrandingProvider`)
- Define fixed status tokens in `:root` (never overridden)
- Import Geist via `next/font` in layout (not CSS `@import`)

### 2. `tailwind.config.ts` — Update
Map all Tailwind color keys to the new CSS variables:
```ts
colors: {
  background:   'var(--color-background)',
  border:       'var(--color-border)',
  surface: {
    DEFAULT:    'var(--color-surface)',
    raised:     'var(--color-surface-raised)',
  },
  accent: {
    DEFAULT:    'var(--color-accent)',
    light:      'var(--color-accent-light)',
    muted:      'var(--color-accent-muted)',
    foreground: 'var(--color-accent-foreground)',
  },
  text: {
    DEFAULT:    'var(--color-text)',
    secondary:  'var(--color-text-secondary)',
    muted:      'var(--color-text-muted)',
  },
  status: {
    success:    'var(--color-status-success)',
    warning:    'var(--color-status-warning)',
    error:      'var(--color-status-error)',
    info:       'var(--color-status-info)',
  }
}
fontFamily: {
  sans: ['var(--font-sans)', ...defaultTheme.fontFamily.sans],
  mono: ['var(--font-mono)', ...defaultTheme.fontFamily.mono],
}
```

### 3. `src/lib/design/color-utils.ts` — New
- `generateColorRamp(hex: string): Record<string, string>` — generates 50–900 ramp
- `generateBrandTokens(palette: BrandPalette): CSSTokenMap` — derives all custom mode tokens from the 4-color contract
- `getContrastForeground(bg: string): '#ffffff' | '#0f172a'` — WCAG 4.5:1 auto white/dark
- `hexToHsl(hex: string): [number, number, number]`
- Unit tested with Vitest

### 4. `src/providers/BrandingProvider.tsx` — Rewrite
- Accept the new 4-field `BrandPalette` contract (from `operators.settings.branding`)
- Call `generateBrandTokens()` to derive full token map
- Apply tokens as CSS variables to `document.documentElement` (`<html>`) — consistent with `useTheme`
- Set `html.custom` class (via `useTheme`) when custom branding active; `BrandingProvider` only injects the variable values, not the class
- Fall back to standard light/dark when no branding configured
- Keep: company name, logo URL, favicon URL

### 5. `src/hooks/useTheme.ts` — Rewrite
Three modes: `'light' | 'dark' | 'custom'`
- `custom` only available when `BrandingProvider` has loaded a palette
- Persists to `localStorage` key `aureon-theme` (values: `light | dark | custom`)
- SSR-safe inline script (prevents flash)
- Applies class to `<html>` element: `light`, `dark`, or `custom` (all CSS selectors in `globals.css` target `html.light`, `html.dark`, `html.custom` — not `body`)

### 6. `src/components/ThemeToggle.tsx` — Update
- Show 2 options (light/dark) when no operator branding
- Show 3 options (light/dark/custom) when branding available
- Custom option shows operator logo thumbnail or brand color swatch

### 7. Root `layout.tsx` — Update
- Load Geist Sans + Geist Mono via `next/font/local`
- Expose as CSS variables `--font-sans`, `--font-mono`
- Remove `NEXT_PUBLIC_THEME` class injection — no longer needed

### 8. Deprecate
- Remove `NEXT_PUBLIC_THEME` env var usage from layout and all components
- Remove all 7 legacy theme classes from `globals.css`
- Remove `theme-tractis.test.ts` (replaces with new token tests)

---

## Token Naming Convention

All tokens follow `--color-{role}-{variant}` pattern:
- Role: `background`, `surface`, `border`, `accent`, `text`, `status-success`, etc.
- Variant: `DEFAULT` (omitted), `light`, `muted`, `foreground`, `secondary`, `subtle`

Tailwind classes map 1:1: `bg-background`, `bg-surface`, `text-text`, `text-text-secondary`, `border-border`, `bg-accent`, `text-accent-foreground`, etc.

---

## Exit Criteria

- All three modes visually correct: light (slate-50 + gold), dark (warm brown + gold), custom (brand palette)
- `useTheme` cycles correctly between available modes
- Custom mode only shows in toggle when operator branding exists
- `generateBrandTokens()` tested with 5+ real brand colors — contrast ratios pass WCAG AA
- Status colors (green/amber/red) identical across all three modes
- No `NEXT_PUBLIC_THEME` references remain in codebase
- No legacy theme classes remain in `globals.css`
- Geist fonts loading correctly in both dev and production build
- Existing pages render without visual regressions (no broken layouts)
- All utility functions in `color-utils.ts` have passing unit tests
- Every file under 300 lines
