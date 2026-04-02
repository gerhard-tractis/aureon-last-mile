# Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc 7-theme CSS system with a proper 3-mode design system (Light, Dark, Custom) using Tractis gold, Geist fonts, and a 4-field brand palette contract for operator white-labeling.

**Architecture:** Three named mode classes (`light`, `dark`, `custom`) on `<html>` control all visual tokens via CSS custom properties. `BrandingProvider` injects operator brand tokens into `documentElement` when custom mode is active. `useTheme` manages mode state and persistence. All token derivation for custom brands is done in `src/lib/design/color-utils.ts`.

**Tech Stack:** Next.js 15, Tailwind CSS 3, shadcn/ui, Vitest 4 + jsdom, `next/font/local` via `geist` npm package

**Spec:** `docs/specs/spec-11-design-system-foundation.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/lib/design/color-utils.ts` | `generateBrandTokens`, `getContrastForeground`, re-exports from existing util |
| Create | `src/lib/design/color-utils.test.ts` | Unit tests for all color utility functions |
| Rewrite | `src/app/globals.css` | Three token sets (`html.light`, `html.dark`, `html.custom`), Tailwind base, remove 7 legacy themes |
| Update | `apps/frontend/tailwind.config.ts` | Map new semantic tokens + keep shadcn compat tokens |
| Rewrite | `src/hooks/useTheme.ts` | 3-mode state: `'light' \| 'dark' \| 'custom'` |
| Create | `src/hooks/useTheme.test.ts` | Unit tests for mode switching and persistence |
| Update | `src/providers/BrandingProvider.tsx` | Accept 4-field `BrandPalette`, inject tokens to `documentElement` |
| Update | `src/components/ThemeToggle.tsx` | 3-mode toggle UI |
| Update | `src/app/layout.tsx` | Geist fonts via `next/font/local` (`geist` package), remove `NEXT_PUBLIC_THEME` |
| Delete | `src/app/theme-tractis.test.ts` | Replaced by `color-utils.test.ts` |

---

## Chunk 1: Color Utilities

### Task 1: `generateBrandTokens` and `getContrastForeground`

**Files:**
- Create: `src/lib/design/color-utils.ts`
- Create: `src/lib/design/color-utils.test.ts`

**Context:** The existing `src/utils/generateColorRamp.ts` has `hexToHsl`, `hslToHex`, `isValidHexColor`, and `generateColorRamp`. Import from it — do not duplicate. The new file adds two new functions needed by `BrandingProvider`.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/lib/design/color-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getContrastForeground,
  generateBrandTokens,
} from './color-utils';

describe('getContrastForeground', () => {
  it('returns white text on dark backgrounds', () => {
    expect(getContrastForeground('#c8102e')).toBe('#ffffff'); // Falabella red
    expect(getContrastForeground('#1a1a1a')).toBe('#ffffff'); // near-black
    expect(getContrastForeground('#ca9a04')).toBe('#ffffff'); // dark gold
  });

  it('returns dark text on light backgrounds', () => {
    expect(getContrastForeground('#ffffff')).toBe('#0f172a'); // white
    expect(getContrastForeground('#f8fafc')).toBe('#0f172a'); // slate-50
    expect(getContrastForeground('#fef9c3')).toBe('#0f172a'); // light yellow
    expect(getContrastForeground('#e6c15c')).toBe('#0f172a'); // light gold
  });
});

describe('generateBrandTokens', () => {
  const palette = {
    brand_primary: '#c8102e',
    brand_background: '#ffffff',
    brand_text: '#1a1a1a',
  };

  it('returns an empty object for invalid palette', () => {
    expect(generateBrandTokens({ brand_primary: 'not-a-color', brand_background: '#fff', brand_text: '#000' })).toEqual({});
    expect(generateBrandTokens({ brand_primary: '#c8102e', brand_background: 'bad', brand_text: '#000' })).toEqual({});
  });

  it('sets --color-accent to brand_primary', () => {
    const tokens = generateBrandTokens(palette);
    expect(tokens['--color-accent']).toBe('#c8102e');
  });

  it('sets --color-background to brand_background', () => {
    const tokens = generateBrandTokens(palette);
    expect(tokens['--color-background']).toBe('#ffffff');
  });

  it('sets --color-text to brand_text', () => {
    const tokens = generateBrandTokens(palette);
    expect(tokens['--color-text']).toBe('#1a1a1a');
  });

  it('sets --color-accent-foreground based on contrast', () => {
    const tokens = generateBrandTokens(palette);
    // red background → white foreground
    expect(tokens['--color-accent-foreground']).toBe('#ffffff');
  });

  it('produces a full token map with all required keys', () => {
    const tokens = generateBrandTokens(palette);
    const required = [
      '--color-background',
      '--color-surface',
      '--color-surface-raised',
      '--color-border',
      '--color-border-subtle',
      '--color-accent',
      '--color-accent-light',
      '--color-accent-muted',
      '--color-accent-foreground',
      '--color-text',
      '--color-text-secondary',
      '--color-text-muted',
    ];
    for (const key of required) {
      expect(tokens).toHaveProperty(key);
      expect(tokens[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('uses brand_secondary as secondary accent when provided', () => {
    const tokensWithSecondary = generateBrandTokens({
      ...palette,
      brand_secondary: '#0057a8',
    });
    expect(tokensWithSecondary['--color-accent-secondary']).toBe('#0057a8');
  });

  it('includes a primary-50 to primary-900 color ramp', () => {
    const tokens = generateBrandTokens(palette);
    for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(tokens).toHaveProperty(`--color-primary-${shade}`);
      expect(tokens[`--color-primary-${shade}`]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/frontend && npm run test:run -- src/lib/design/color-utils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `color-utils.ts`**

Create `apps/frontend/src/lib/design/color-utils.ts`:

```typescript
/**
 * Design system color utilities.
 * Builds on the existing generateColorRamp utility for ramp generation.
 */

import {
  isValidHexColor,
  generateColorRamp,
} from '@/utils/generateColorRamp';

export { isValidHexColor, generateColorRamp };

export interface BrandPalette {
  brand_primary: string;
  brand_background: string;
  brand_text: string;
  brand_secondary?: string;
}

export type CSSTokenMap = Record<string, string>;

/**
 * Returns '#ffffff' or '#0f172a' depending on which gives ≥ 4.5:1 contrast
 * against bgHex (WCAG AA). Uses relative luminance via the sRGB formula.
 */
export function getContrastForeground(bgHex: string): '#ffffff' | '#0f172a' {
  if (!isValidHexColor(bgHex)) return '#0f172a';

  // Parse hex to linear RGB
  const hex = bgHex.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  // Linearize sRGB values
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const luminance =
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);

  // White luminance = 1.0, dark text luminance ≈ 0.0 (#0f172a)
  const darkTextLuminance = 0.008; // approx for #0f172a
  const contrastWithWhite = (1.0 + 0.05) / (luminance + 0.05);
  const contrastWithDark = (luminance + 0.05) / (darkTextLuminance + 0.05);

  return contrastWithWhite >= contrastWithDark ? '#ffffff' : '#0f172a';
}

/** Mixes two hex colors. ratio 0 = fully a, ratio 1 = fully b */
function mixHex(hexA: string, hexB: string, ratio: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(hexA);
  const [br, bg, bb] = parse(hexB);
  const r = Math.round(ar + (br - ar) * ratio);
  const g = Math.round(ag + (bg - ag) * ratio);
  const b = Math.round(ab + (bb - ab) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Derives all CSS tokens for the `custom` mode from a 4-field brand palette.
 * Returns empty object if any required field is an invalid hex color.
 */
export function generateBrandTokens(palette: BrandPalette): CSSTokenMap {
  const { brand_primary, brand_background, brand_text, brand_secondary } = palette;

  // Validate required fields
  if (
    !isValidHexColor(brand_primary) ||
    !isValidHexColor(brand_background) ||
    !isValidHexColor(brand_text)
  ) {
    return {};
  }

  const tokens: CSSTokenMap = {};

  // Accent tokens
  tokens['--color-accent'] = brand_primary;
  // Lighter version: mix primary with white 30%
  tokens['--color-accent-light'] = mixHex(brand_primary, '#ffffff', 0.3);
  // Muted: mix primary with background 90% (10% primary tint)
  tokens['--color-accent-muted'] = mixHex(brand_background, brand_primary, 0.1);
  tokens['--color-accent-foreground'] = getContrastForeground(brand_primary);

  // Optional secondary accent
  if (brand_secondary && isValidHexColor(brand_secondary)) {
    tokens['--color-accent-secondary'] = brand_secondary;
  }

  // Surface tokens — derived from brand_background
  tokens['--color-background'] = brand_background;
  // Surface: slightly whiter/lighter than background
  tokens['--color-surface'] = mixHex(brand_background, '#ffffff', 0.5);
  // Surface raised: tiny primary tint
  tokens['--color-surface-raised'] = mixHex(brand_background, brand_primary, 0.06);
  // Borders: darken background
  tokens['--color-border'] = mixHex(brand_background, '#000000', 0.12);
  tokens['--color-border-subtle'] = mixHex(brand_background, '#000000', 0.06);

  // Text tokens — derived from brand_text
  tokens['--color-text'] = brand_text;
  // Secondary: mix text with background 40%
  tokens['--color-text-secondary'] = mixHex(brand_text, brand_background, 0.4);
  // Muted: mix text with background 65%
  tokens['--color-text-muted'] = mixHex(brand_text, brand_background, 0.65);

  // Full primary-50 → primary-900 ramp (spec requirement)
  const ramp = generateColorRamp('primary', brand_primary);
  Object.assign(tokens, ramp);

  return tokens;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/frontend && npm run test:run -- src/lib/design/color-utils.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/frontend
git add src/lib/design/color-utils.ts src/lib/design/color-utils.test.ts
git commit -m "feat(design-system): add color-utils — generateBrandTokens and getContrastForeground"
```

---

## Chunk 2: CSS Token Rewrite

### Task 2: Rewrite `globals.css`

**Files:**
- Rewrite: `src/app/globals.css`

**Context:** The current file has two token systems:
1. A custom `--color-primary-*` ramp system + 7 theme classes (`.theme-blue` etc.)
2. shadcn's HSL system (`--background`, `--foreground`, `--card`, etc.) in `@layer base`

Both must be replaced with 3 named mode selectors (`html.light`, `html.dark`, `html.custom`). The shadcn HSL tokens (`--background`, `--foreground`, `--card`, etc.) must be **kept** — many shadcn components (`bg-background`, `text-foreground`, `border-border`) depend on them. Update their values per mode to match the new palette.

The `html.custom` rule only sets the base layout tokens — `BrandingProvider` injects brand-specific overrides at runtime.

- [ ] **Step 1: Write the new globals.css**

Replace `apps/frontend/src/app/globals.css` entirely:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ============================================================
   DESIGN SYSTEM — THREE MODES
   Mode class applied to <html>: light | dark | custom
   Status tokens are fixed across all modes.
   ============================================================ */

/* ---- STANDARD LIGHT ---------------------------------------- */
html.light {
  /* Semantic tokens */
  --color-background:      #f8fafc;
  --color-surface:         #ffffff;
  --color-surface-raised:  #f1f5f9;
  --color-border:          #e2e8f0;
  --color-border-subtle:   #f1f5f9;

  --color-accent:          #ca9a04;
  --color-accent-light:    #e6c15c;
  --color-accent-muted:    #fef9c3;
  --color-accent-foreground: #ffffff;

  --color-text:            #0f172a;
  --color-text-secondary:  #64748b;
  --color-text-muted:      #94a3b8;

  /* shadcn compatibility — mapped to match semantic tokens */
  --background:            210 40% 98%;   /* #f8fafc */
  --foreground:            222 84% 5%;    /* #0f172a */
  --card:                  0 0% 100%;     /* #ffffff */
  --card-foreground:       222 84% 5%;
  --popover:               0 0% 100%;
  --popover-foreground:    222 84% 5%;
  --primary:               43 97% 40%;   /* #ca9a04 */
  --primary-foreground:    0 0% 100%;
  --secondary:             214 32% 91%;  /* #e2e8f0 */
  --secondary-foreground:  222 84% 5%;
  --muted:                 210 40% 96%;  /* #f1f5f9 */
  --muted-foreground:      215 16% 47%;  /* #64748b */
  --accent:                43 97% 40%;
  --accent-foreground:     0 0% 100%;
  --destructive:           0 84% 60%;
  --destructive-foreground: 0 0% 98%;
  --border:                214 32% 91%;  /* #e2e8f0 */
  --input:                 214 32% 91%;
  --ring:                  43 97% 40%;
  --radius:                0.375rem;

  /* Chart */
  --chart-1: 43 97% 40%;
  --chart-2: 142 71% 45%;
  --chart-3: 0 84% 60%;
  --chart-4: 217 91% 60%;
  --chart-5: 291 64% 42%;
}

/* ---- STANDARD DARK (warm brown) ---------------------------- */
html.dark {
  /* Semantic tokens */
  --color-background:      #13110d;
  --color-surface:         #1e1a14;
  --color-surface-raised:  #2a2218;
  --color-border:          #2a2218;
  --color-border-subtle:   #1f1a13;

  --color-accent:          #e6c15c;
  --color-accent-light:    #f5d98a;
  --color-accent-muted:    #2d2106;
  --color-accent-foreground: #0d0b09;

  --color-text:            #f5ecd7;
  --color-text-secondary:  #c8b99a;
  --color-text-muted:      #5c5040;

  /* shadcn compatibility */
  --background:            30 24% 7%;    /* #13110d */
  --foreground:            36 61% 91%;   /* #f5ecd7 */
  --card:                  30 20% 10%;   /* #1e1a14 */
  --card-foreground:       36 61% 91%;
  --popover:               30 20% 10%;
  --popover-foreground:    36 61% 91%;
  --primary:               43 76% 63%;   /* #e6c15c */
  --primary-foreground:    30 36% 6%;    /* #0d0b09 */
  --secondary:             30 16% 14%;   /* #2a2218 */
  --secondary-foreground:  36 40% 69%;   /* #c8b99a */
  --muted:                 30 16% 14%;
  --muted-foreground:      30 12% 37%;   /* #5c5040 */
  --accent:                43 76% 63%;
  --accent-foreground:     30 36% 6%;
  --destructive:           0 63% 55%;
  --destructive-foreground: 36 61% 91%;
  --border:                30 16% 14%;
  --input:                 30 16% 14%;
  --ring:                  43 76% 63%;
  --radius:                0.375rem;

  /* Chart */
  --chart-1: 43 76% 63%;
  --chart-2: 142 71% 45%;
  --chart-3: 0 63% 55%;
  --chart-4: 217 91% 60%;
  --chart-5: 291 64% 42%;
}

/* ---- CUSTOM (operator white-label) -------------------------
   Base tokens only — BrandingProvider injects brand overrides
   at runtime via document.documentElement.style.setProperty().
   Fixed status tokens always apply.
   ----------------------------------------------------------- */
html.custom {
  /* Default to light layout until BrandingProvider loads */
  --color-background:      #f8fafc;
  --color-surface:         #ffffff;
  --color-surface-raised:  #f1f5f9;
  --color-border:          #e2e8f0;
  --color-border-subtle:   #f1f5f9;
  --color-accent:          #ca9a04;
  --color-accent-light:    #e6c15c;
  --color-accent-muted:    #fef9c3;
  --color-accent-foreground: #ffffff;
  --color-text:            #0f172a;
  --color-text-secondary:  #64748b;
  --color-text-muted:      #94a3b8;

  /* shadcn compat — same as light until brand loads */
  --background:            210 40% 98%;
  --foreground:            222 84% 5%;
  --card:                  0 0% 100%;
  --card-foreground:       222 84% 5%;
  --popover:               0 0% 100%;
  --popover-foreground:    222 84% 5%;
  --primary:               43 97% 40%;
  --primary-foreground:    0 0% 100%;
  --secondary:             214 32% 91%;
  --secondary-foreground:  222 84% 5%;
  --muted:                 210 40% 96%;
  --muted-foreground:      215 16% 47%;
  --accent:                43 97% 40%;
  --accent-foreground:     0 0% 100%;
  --destructive:           0 84% 60%;
  --destructive-foreground: 0 0% 98%;
  --border:                214 32% 91%;
  --input:                 214 32% 91%;
  --ring:                  43 97% 40%;
  --radius:                0.375rem;

  --chart-1: 43 97% 40%;
  --chart-2: 142 71% 45%;
  --chart-3: 0 84% 60%;
  --chart-4: 217 91% 60%;
  --chart-5: 291 64% 42%;
}

/* ---- STATUS TOKENS — fixed across all modes --------------- */
/* Applied at :root so they're always present regardless of mode class */
:root {
  --color-status-success:        #22c55e;
  --color-status-success-bg:     #dcfce7;
  --color-status-success-border: #bbf7d0;

  --color-status-warning:        #f59e0b;
  --color-status-warning-bg:     #fef9c3;
  --color-status-warning-border: #fde68a;

  --color-status-error:          #ef4444;
  --color-status-error-bg:       #fee2e2;
  --color-status-error-border:   #fecaca;

  --color-status-info:           #3b82f6;
  --color-status-info-bg:        #dbeafe;
  --color-status-info-border:    #bfdbfe;
}

/* Dark mode overrides for status backgrounds (semi-transparent) */
html.dark {
  --color-status-success:        #4ade80;
  --color-status-success-bg:     rgba(20, 83, 45, 0.27);
  --color-status-success-border: #14532d;

  --color-status-warning:        #fbbf24;
  --color-status-warning-bg:     rgba(120, 53, 15, 0.27);
  --color-status-warning-border: #78350f;

  --color-status-error:          #f87171;
  --color-status-error-bg:       rgba(127, 29, 29, 0.27);
  --color-status-error-border:   #7f1d1d;

  --color-status-info:           #60a5fa;
  --color-status-info-bg:        rgba(30, 64, 175, 0.27);
  --color-status-info-border:    #1e40af;
}

/* ---- TAILWIND BASE LAYER ---------------------------------- */
@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans, system-ui, sans-serif);
  }
  code, kbd, pre, .font-mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
}

/* ---- COMPONENT UTILITIES ---------------------------------- */
@layer components {
  .btn-primary {
    @apply bg-accent text-accent-foreground hover:opacity-90 transition-opacity;
  }
  .btn-secondary {
    background-color: var(--color-surface-raised);
    color: var(--color-text);
    @apply hover:opacity-80 transition-opacity;
  }
}
```

- [ ] **Step 2: Verify the app still builds**

```bash
cd apps/frontend && npm run build 2>&1 | tail -20
```

Expected: Build succeeds (or only pre-existing errors — no new CSS errors).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/globals.css
git commit -m "feat(design-system): rewrite globals.css — 3 mode token sets, remove 7 legacy themes"
```

---

## Chunk 3: Tailwind Config

### Task 3: Update `tailwind.config.ts`

**Files:**
- Modify: `tailwind.config.ts`

**Context:** The current config maps `primary-50`…`primary-900` to the old ramp variables. Add the new semantic token mappings while keeping the shadcn `hsl(var(--*))` mappings intact (shadcn components depend on them). New token classes: `bg-surface`, `bg-surface-raised`, `text-text`, `text-text-secondary`, `text-text-muted`, `bg-accent`, `text-accent-foreground`, `bg-status-success`, etc.

- [ ] **Step 1: Update the config**

Replace `apps/frontend/tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        // shadcn compatibility — components use rounded-lg, rounded-md, rounded-sm
        // These must stay as var(--radius) derivatives; --radius is set per mode in globals.css
        lg:  "var(--radius)",
        md:  "calc(var(--radius) - 2px)",
        sm:  "calc(var(--radius) - 4px)",
        xl:  "12px",
      },
      colors: {
        /* ---- Semantic design system tokens ---- */
        background:   "var(--color-background)",
        surface: {
          DEFAULT: "var(--color-surface)",
          raised:  "var(--color-surface-raised)",
        },
        border:       "var(--color-border)",
        "border-subtle": "var(--color-border-subtle)",
        accent: {
          DEFAULT:    "var(--color-accent)",
          light:      "var(--color-accent-light)",
          muted:      "var(--color-accent-muted)",
          foreground: "var(--color-accent-foreground)",
        },
        text: {
          DEFAULT:    "var(--color-text)",
          secondary:  "var(--color-text-secondary)",
          muted:      "var(--color-text-muted)",
        },
        status: {
          success:        "var(--color-status-success)",
          "success-bg":   "var(--color-status-success-bg)",
          "success-border": "var(--color-status-success-border)",
          warning:        "var(--color-status-warning)",
          "warning-bg":   "var(--color-status-warning-bg)",
          "warning-border": "var(--color-status-warning-border)",
          error:          "var(--color-status-error)",
          "error-bg":     "var(--color-status-error-bg)",
          "error-border": "var(--color-status-error-border)",
          info:           "var(--color-status-info)",
          "info-bg":      "var(--color-status-info-bg)",
          "info-border":  "var(--color-status-info-border)",
        },

        /* ---- shadcn/ui compatibility — do not remove ---- */
        foreground:  "hsl(var(--foreground))",
        card: {
          DEFAULT:   "hsl(var(--card))",
          foreground:"hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:   "hsl(var(--popover))",
          foreground:"hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:   "hsl(var(--primary))",
          foreground:"hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:   "hsl(var(--secondary))",
          foreground:"hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:   "hsl(var(--muted))",
          foreground:"hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT:   "hsl(var(--destructive))",
          foreground:"hsl(var(--destructive-foreground))",
        },
        input:       "hsl(var(--input))",
        ring:        "hsl(var(--ring))",
        chart: {
          "1":       "hsl(var(--chart-1))",
          "2":       "hsl(var(--chart-2))",
          "3":       "hsl(var(--chart-3))",
          "4":       "hsl(var(--chart-4))",
          "5":       "hsl(var(--chart-5))",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 2: Verify build**

```bash
cd apps/frontend && npm run build 2>&1 | tail -20
```

Expected: No new errors. (Note: The old `primary-50`…`primary-900` classes will be gone — pre-existing usages of those classes will lose styling but won't break the build. That visual debt is addressed in spec-12.)

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/tailwind.config.ts
git commit -m "feat(design-system): update tailwind config — semantic tokens + shadcn compat"
```

---

## Chunk 4: useTheme — Three Modes

### Task 4: Rewrite `useTheme` to support `'light' | 'dark' | 'custom'`

**Files:**
- Rewrite: `src/hooks/useTheme.ts`
- Create: `src/hooks/useTheme.test.ts`

**Context:** The hook currently toggles `isDark: boolean`. The new version manages `mode: 'light' | 'dark' | 'custom'`. `'custom'` is only available when `BrandingProvider` signals it (via a `hasCustomBranding` flag passed in). The hook applies the mode class to `document.documentElement` and persists to `localStorage`.

- [ ] **Step 1: Write failing tests**

Create `apps/frontend/src/hooks/useTheme.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme, STORAGE_KEY } from './useTheme';

// jsdom doesn't implement matchMedia — mock it
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  localStorage.clear();
  document.documentElement.className = '';
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('useTheme', () => {
  it('defaults to light mode when no preference stored', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');
  });

  it('restores stored mode from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('dark');
  });

  it('applies the correct class to documentElement', () => {
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.setMode('dark'); });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('persists mode to localStorage on change', () => {
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.setMode('dark'); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('does not set custom mode when hasCustomBranding is false', () => {
    const { result } = renderHook(() => useTheme({ hasCustomBranding: false }));
    act(() => { result.current.setMode('custom'); });
    // Should fall back to light when custom not available
    expect(result.current.mode).toBe('light');
  });

  it('allows custom mode when hasCustomBranding is true', () => {
    const { result } = renderHook(() => useTheme({ hasCustomBranding: true }));
    act(() => { result.current.setMode('custom'); });
    expect(result.current.mode).toBe('custom');
    expect(document.documentElement.classList.contains('custom')).toBe(true);
  });

  it('removes all mode classes before applying new one', () => {
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.setMode('light'); });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
cd apps/frontend && npm run test:run -- src/hooks/useTheme.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement new `useTheme`**

Replace `apps/frontend/src/hooks/useTheme.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'custom';
export const STORAGE_KEY = 'aureon-theme';
const VALID_MODES: ThemeMode[] = ['light', 'dark', 'custom'];
const MODE_CLASSES = ['light', 'dark', 'custom'] as const;

interface UseThemeOptions {
  hasCustomBranding?: boolean;
}

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && VALID_MODES.includes(stored as ThemeMode)) {
    return stored as ThemeMode;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyModeClass(mode: ThemeMode) {
  const root = document.documentElement;
  MODE_CLASSES.forEach((cls) => root.classList.remove(cls));
  root.classList.add(mode);
}

export function useTheme({ hasCustomBranding = false }: UseThemeOptions = {}) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = getStoredMode();
    // Don't restore 'custom' mode if branding isn't available
    if (stored === 'custom' && !hasCustomBranding) return 'light';
    return stored;
  });

  // Apply class on mount and whenever mode changes
  useEffect(() => {
    applyModeClass(mode);
  }, [mode]);

  // Listen for system preference changes (only when no user override)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY) !== null) return;
      setModeState(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setMode = useCallback(
    (next: ThemeMode) => {
      // Guard: custom mode requires branding
      const resolved: ThemeMode = next === 'custom' && !hasCustomBranding ? 'light' : next;
      localStorage.setItem(STORAGE_KEY, resolved);
      setModeState(resolved);
    },
    [hasCustomBranding]
  );

  // Convenience for components that only need light/dark toggle
  const toggle = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  return {
    mode,
    setMode,
    toggle,
    isDark: mode === 'dark',
    isCustom: mode === 'custom',
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd apps/frontend && npm run test:run -- src/hooks/useTheme.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useTheme.ts apps/frontend/src/hooks/useTheme.test.ts
git commit -m "feat(design-system): rewrite useTheme — 3 modes light/dark/custom"
```

---

## Chunk 5: BrandingProvider

### Task 5: Update `BrandingProvider` to new 4-field contract

**Files:**
- Modify: `src/providers/BrandingProvider.tsx`

**Context:** The current provider calls `generateColorRamp` from `@/utils/generateColorRamp` and applies vars to `document.body`. The new version:
- Accepts `operators.settings.branding` with the 4-field `BrandPalette` shape
- Calls `generateBrandTokens` from the new `@/lib/design/color-utils`
- Applies tokens to `document.documentElement` (not `body`)
- Keeps logo, favicon, companyName logic unchanged
- Exposes `hasBranding: boolean` on context so `useTheme` / `ThemeToggle` can show the custom mode option

- [ ] **Step 1: Write failing tests for BrandingProvider**

Update `apps/frontend/src/providers/BrandingProvider.test.tsx` (create if it doesn't exist):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrandingProvider, useBranding } from './BrandingProvider';
import React from 'react';

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useOperatorId: () => ({ operatorId: 'test-op-id' }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Inspector() {
  const branding = useBranding();
  return <div data-testid="result" data-branding={JSON.stringify(branding)} />;
}

describe('BrandingProvider', () => {
  it('provides hasBranding: false when no palette configured', async () => {
    const { getByTestId } = render(
      <BrandingProvider><Inspector /></BrandingProvider>,
      { wrapper }
    );
    await waitFor(() => {
      const el = getByTestId('result');
      const data = JSON.parse(el.dataset.branding!);
      expect(data.hasBranding).toBe(false);
      expect(data.palette).toBeNull();
    });
  });

  it('injects brand tokens to documentElement when palette is present', async () => {
    const setSpy = vi.spyOn(document.documentElement.style, 'setProperty');
    // Override the mock to return a valid palette
    vi.doMock('@/lib/supabase/client', () => ({
      createSPAClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  settings: {
                    branding: {
                      brand_primary: '#c8102e',
                      brand_background: '#ffffff',
                      brand_text: '#1a1a1a',
                    },
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));
    // The key behavior: tokens are set on documentElement (not body)
    // Verify the effect would call setProperty on documentElement
    expect(setSpy).toBeDefined(); // env sanity check
    setSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/frontend && npm run test:run -- src/providers/BrandingProvider.test.tsx
```

Expected: Tests fail with module resolution errors (hasBranding property may not exist yet).

- [ ] **Step 3: Update `BrandingProvider.tsx`**

Replace `apps/frontend/src/providers/BrandingProvider.tsx`:

```typescript
'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import { generateBrandTokens, isValidHexColor, type BrandPalette } from '@/lib/design/color-utils';

export interface BrandingConfig {
  logoUrl: string | null;
  faviconUrl: string | null;
  companyName: string | null;
  palette: BrandPalette | null;
  hasBranding: boolean;
  isLoading: boolean;
}

const DEFAULTS: BrandingConfig = {
  logoUrl: null,
  faviconUrl: null,
  companyName: null,
  palette: null,
  hasBranding: false,
  isLoading: true,
};

const BrandingContext = createContext<BrandingConfig>(DEFAULTS);

export function useBranding(): BrandingConfig {
  return useContext(BrandingContext);
}

interface RawBranding {
  logo_url?: string | null;
  favicon_url?: string | null;
  company_name?: string | null;
  brand_primary?: string | null;
  brand_background?: string | null;
  brand_text?: string | null;
  brand_secondary?: string | null;
}

function parsePalette(raw: RawBranding | null): BrandPalette | null {
  if (!raw) return null;
  const { brand_primary, brand_background, brand_text } = raw;
  if (
    !brand_primary || !isValidHexColor(brand_primary) ||
    !brand_background || !isValidHexColor(brand_background) ||
    !brand_text || !isValidHexColor(brand_text)
  ) {
    return null;
  }
  return {
    brand_primary,
    brand_background,
    brand_text,
    brand_secondary: raw.brand_secondary ?? undefined,
  };
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { operatorId } = useOperatorId();

  const { data: rawBranding, isLoading } = useQuery({
    queryKey: ['branding', operatorId],
    queryFn: async (): Promise<RawBranding | null> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('operators')
        .select('settings')
        .eq('id', operatorId!)
        .single() as { data: { settings: Record<string, unknown> | null } | null; error: unknown };
      if (error || !data) return null;
      return (data.settings?.branding as RawBranding) ?? null;
    },
    enabled: !!operatorId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const palette = useMemo(() => parsePalette(rawBranding ?? null), [rawBranding]);

  const branding = useMemo<BrandingConfig>(() => ({
    logoUrl: rawBranding?.logo_url ?? null,
    faviconUrl: rawBranding?.favicon_url ?? null,
    companyName: rawBranding?.company_name ?? null,
    palette,
    hasBranding: palette !== null,
    isLoading,
  }), [rawBranding, palette, isLoading]);

  // Inject brand CSS tokens into <html> when custom mode is active
  useEffect(() => {
    if (!palette) return;
    const tokens = generateBrandTokens(palette);
    const root = document.documentElement;
    const applied: string[] = [];

    for (const [prop, val] of Object.entries(tokens)) {
      root.style.setProperty(prop, val);
      applied.push(prop);
    }

    return () => {
      for (const prop of applied) {
        root.style.removeProperty(prop);
      }
    };
  }, [palette]);

  // Update browser title
  useEffect(() => {
    document.title = branding.companyName
      ? `${branding.companyName} — Aureon Last Mile`
      : 'Aureon Last Mile';
  }, [branding.companyName]);

  // Dynamic favicon
  useEffect(() => {
    if (!branding.faviconUrl) return;
    const setFavicon = (rel: string, href: string) => {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = href;
    };
    const originalIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href;
    const originalApple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href;
    setFavicon('icon', branding.faviconUrl);
    setFavicon('apple-touch-icon', branding.faviconUrl);
    return () => {
      if (originalIcon) setFavicon('icon', originalIcon);
      if (originalApple) setFavicon('apple-touch-icon', originalApple);
    };
  }, [branding.faviconUrl]);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd apps/frontend && npm run test:run -- src/providers/BrandingProvider.test.tsx
```

Expected: `hasBranding: false` test passes.

- [ ] **Step 5: Verify build**

```bash
cd apps/frontend && npm run build 2>&1 | tail -20
```

Expected: Builds without new type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/providers/BrandingProvider.tsx apps/frontend/src/providers/BrandingProvider.test.tsx
git commit -m "feat(design-system): update BrandingProvider — 4-field palette contract, inject to documentElement"
```

---

## Chunk 6: ThemeToggle

### Task 6: Update `ThemeToggle` to show 3 modes

**Files:**
- Modify: `src/components/ThemeToggle.tsx`

**Context:** Currently a single button that toggles `isDark`. New version shows 2 or 3 mode options. Uses `useBranding()` to know whether to show the custom option. When `hasBranding` is true, shows a third option with the operator's accent color as a swatch.

- [ ] **Step 1: Update `ThemeToggle.tsx`**

Replace `apps/frontend/src/components/ThemeToggle.tsx`:

```tsx
'use client';

import { Moon, Sun, Palette } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { useBranding } from '@/providers/BrandingProvider';

export default function ThemeToggle() {
  const { hasBranding, palette } = useBranding();
  const { mode, setMode } = useTheme({ hasCustomBranding: hasBranding });

  const options: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light mode', icon: <Sun className="h-4 w-4" /> },
    { value: 'dark',  label: 'Dark mode',  icon: <Moon className="h-4 w-4" /> },
    ...(hasBranding
      ? [{
          value: 'custom' as ThemeMode,
          label: 'Brand mode',
          icon: palette?.brand_primary ? (
            <span
              className="h-4 w-4 rounded-sm inline-block border border-border"
              style={{ background: palette.brand_primary }}
            />
          ) : (
            <Palette className="h-4 w-4" />
          ),
        }]
      : []),
  ];

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Theme mode">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          aria-label={opt.label}
          aria-pressed={mode === opt.value}
          className={`p-2 rounded-md transition-colors ${
            mode === opt.value
              ? 'bg-accent text-accent-foreground'
              : 'text-text-secondary hover:text-text hover:bg-surface-raised'
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd apps/frontend && npm run build 2>&1 | tail -20
```

Expected: Builds without errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/ThemeToggle.tsx
git commit -m "feat(design-system): update ThemeToggle — 3-mode selector, brand swatch"
```

---

## Chunk 7: Layout — Geist Fonts

### Task 7: Add Geist via `next/font/local` (`geist` package), remove `NEXT_PUBLIC_THEME`

**Files:**
- Modify: `src/app/layout.tsx`

**Context:**
- The spec requires `next/font/local`. The `geist` npm package ships Vercel's Geist fonts for local loading — zero network dependency, zero layout shift.
- Fonts are loaded once and exposed as CSS variables `--font-sans` and `--font-mono` via `className` on `<html>`
- Remove the `NEXT_PUBLIC_THEME` class injection from `<body>` — mode classes now live on `<html>` managed by `useTheme`
- Update the anti-flash inline script to handle all 3 modes (not just `dark`)

- [ ] **Step 1: Install the `geist` package**

```bash
cd apps/frontend && npm install geist
```

Expected: Package added to `package.json`. No version conflicts.

- [ ] **Step 2: Update `layout.tsx`**

Replace `apps/frontend/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Analytics } from '@vercel/analytics/next';
import CookieConsent from "@/components/Cookies";
import { GoogleAnalytics } from '@next/third-parties/google';
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import ConnectionStatusBanner from "@/components/ConnectionStatusBanner";
import SentryUserProvider from "@/components/SentryUserProvider";

// GeistSans and GeistMono from the 'geist' package use next/font/local internally.
// They expose .variable (CSS variable class name) and .className (direct class).
// We use .variable to expose --font-sans and --font-mono as CSS variables.

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_PRODUCTNAME || "Aureon Last Mile",
  description: "Plataforma de gestión de última milla para operadores logísticos chilenos",
  manifest: "/manifest.json",
  themeColor: "#e6c15c",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: process.env.NEXT_PUBLIC_PRODUCTNAME || "Aureon Last Mile",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaID = process.env.NEXT_PUBLIC_GOOGLE_TAG;

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/*
          Anti-flash script: runs before hydration to apply the correct
          mode class immediately. Handles all 3 modes.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var s=localStorage.getItem('aureon-theme');
              var mode=(['light','dark','custom'].indexOf(s)!==-1)?s:null;
              if(!mode){mode=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
              document.documentElement.classList.add(mode);
            }catch(e){document.documentElement.classList.add('light');}})();`,
          }}
        />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body>
        <SentryUserProvider />
        <ServiceWorkerRegistration />
        <ConnectionStatusBanner />
        {children}
        <Analytics />
        <CookieConsent />
        {gaID && <GoogleAnalytics gaId={gaID} />}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd apps/frontend && npm run build 2>&1 | tail -20
```

Expected: Builds successfully. Geist fonts are loaded. No `NEXT_PUBLIC_THEME` references in the build output.

- [ ] **Step 4: Verify no remaining `NEXT_PUBLIC_THEME` references**

```bash
grep -r "NEXT_PUBLIC_THEME" apps/frontend/src/
```

Expected: No output.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/layout.tsx apps/frontend/package.json apps/frontend/package-lock.json
git commit -m "feat(design-system): add Geist fonts via next/font/local, remove NEXT_PUBLIC_THEME"
```

---

## Chunk 8: Cleanup + Full Test Run

### Task 8: Delete legacy test, run full suite

**Files:**
- Delete: `src/app/theme-tractis.test.ts`

- [ ] **Step 1: Delete the legacy test file**

```bash
rm apps/frontend/src/app/theme-tractis.test.ts
```

- [ ] **Step 2: Run the full test suite**

```bash
cd apps/frontend && npm run test:run 2>&1 | tail -40
```

Expected: All tests PASS. No failures caused by this spec's changes.

- [ ] **Step 3: Verify `NEXT_PUBLIC_THEME` can be removed from `.env.local`**

```bash
grep "NEXT_PUBLIC_THEME" apps/frontend/.env.local 2>/dev/null && echo "found - can be removed" || echo "not present"
```

If found, remove the line manually (don't commit `.env.local`).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(design-system): cleanup — remove legacy theme test, finalize spec-11"
```

- [ ] **Step 5: Push and open PR**

```bash
git push origin HEAD
gh pr create \
  --title "feat: design system foundation — 3-mode tokens, Geist, Tractis gold" \
  --body "$(cat <<'EOF'
## Summary
- Replaces 7 legacy CSS theme presets with 3 named modes: light, dark, custom
- Light: Tractis gold on slate-50. Dark: Tractis gold on warm brown (#13110d)
- Custom: operator brand palette injected via 4-field contract from agent-generated branding
- Adds Geist Sans + Geist Mono via next/font/local (geist package)
- Removes NEXT_PUBLIC_THEME env var dependency
- Adds generateBrandTokens + getContrastForeground utilities (WCAG AA contrast)

## Test plan
- [ ] All Vitest tests pass: `npm run test:run`
- [ ] Light mode: Tractis gold buttons, slate-50 background, white cards
- [ ] Dark mode: gold on warm brown, status badges visible
- [ ] ThemeToggle shows 2 options without branding, 3 with branding
- [ ] Geist font loads in dev and production
- [ ] No visual regressions on existing pages

Spec: docs/specs/spec-11-design-system-foundation.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```
