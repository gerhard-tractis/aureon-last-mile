# Spec 17 — Aureon Landing Page

**Status:** backlog

## Overview

Marketing landing page for `aureon.tractis.ai` that showcases the platform, educates prospects on key logistics KPIs, and funnels them to book a demo or log in. Replaces the current root redirect to `/auth/login`.

## Goals

- **Showcase** Aureon as an intelligent last-mile operations platform
- **Educate** prospects on CPO, OTIF, and NPS — the KPIs that matter
- **Convert** visitors via Google Calendar demo booking
- **Retain** existing users with a quick "Ingresa" / "Ir al Panel" path

## Target Audience

Latin American logistics companies, Spanish-first. Initial focus on Chile market with LATAM expansion in mind.

## Tone

Modern SaaS — clean, confident, slightly casual. Educate through value, not jargon.

## Routing Changes

```
/                    → Landing page (public) — replaces redirect to /auth/login
/auth/login          → Login (unchanged)
/auth/register       → Register (unchanged)
/app/*               → Protected app (unchanged)
```

**Middleware:** No changes needed. Supabase middleware already allows unauthenticated access to non-`/app` routes. Only change is replacing the `redirect('/auth/login')` in `src/app/page.tsx` with the landing page component. Note: middleware still runs `supabase.auth.getUser()` on every request including `/` — acceptable latency for a marketing page since auth check is lightweight.

**Authenticated users visiting `/`:** See the landing page with "Ir al Panel" replacing "Ingresa" buttons. Auth state is detected server-side in `page.tsx` via `createClient()` + `supabase.auth.getUser()` (same pattern used across the app). The result is passed as a prop to the navbar component. All landing section components remain pure Server Components — no `'use client'` except the navbar (which needs scroll listener for transparent→solid transition).

**HTML lang attribute:** The root layout sets `lang="en"`. This should be changed to `lang="es"` since the entire app serves Spanish-speaking users. This is a one-line change in `src/app/layout.tsx`.

**SEO metadata:** `page.tsx` exports a `metadata` object with landing-page-specific Open Graph tags:
- `title`: "Aureon — Tu última milla, bajo control"
- `description`: "Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas, rutas más eficientes, datos en tiempo real."
- `openGraph.image`: Tractis brand image (placeholder for v1, replaceable later)

## File Organization

```
src/app/
├── page.tsx                          → Landing page (replaces redirect)
├── (landing)/
│   └── components/
│       ├── navbar.tsx                → 'use client' (scroll listener + mobile menu)
│       ├── hero.tsx                  → 'use client' (load animation)
│       ├── scroll-reveal.tsx         → 'use client' (intersection observer wrapper)
│       ├── value-props.tsx           → Server Component
│       ├── metrics-showcase.tsx      → Server Component
│       ├── features.tsx              → Server Component
│       ├── integrations.tsx          → Server Component
│       ├── how-it-works.tsx          → Server Component
│       ├── cta-section.tsx           → Server Component
│       └── footer.tsx                → Server Component
```

## Page Sections (in order)

### 1. Navbar

Fixed top navbar. Transparent on hero, transitions to solid `bg-background/80 backdrop-blur-lg` after scrolling past 64px (one scroll listener via `useEffect` in a `'use client'` component). Transition: `transition-colors duration-300`.

- **Left:** Aureon logo (Tractis T-mark + "Aureon")
- **Center/Right (desktop):** Anchor links with smooth scroll (`scroll-behavior: smooth` on html, each section has an `id` attribute: `#beneficios`, `#funcionalidades`, `#como-funciona`, `#metricas`). Scroll offset accounts for fixed navbar height (64px) via `scroll-margin-top`.
- **Far right:**
  - "Ingresa" → `/auth/login` (ghost button)
  - "Solicita una Demo" → Google Calendar link (primary gold button)
- **Authenticated variant:** "Ingresa" becomes "Ir al Panel" → `/app`. Auth state passed as `isAuthenticated` prop from `page.tsx`.
- **Mobile:** Hamburger menu using existing `Sheet` component from `src/components/ui/sheet.tsx`

### 2. Hero

Full viewport height. Background: `bg-stone-950` + topographic SVG pattern at `opacity-[0.03]` + radial gold gradient from center-top. Faint Tractis T-symbol watermark centered behind text at `opacity-[0.03]`.

- **Tagline:** "Tu última milla, bajo control" — gradient text (`from-white via-stone-200 to-stone-400`), `text-5xl md:text-7xl font-bold`
- **Subtitle:** "Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas, rutas más eficientes, datos en tiempo real." — `text-stone-400 text-lg max-w-2xl`
- **CTAs:**
  - "Solicita una Demo" → Google Calendar (gold bg, `hover:shadow-[0_0_20px_rgba(230,193,92,0.3)]`)
  - "Ingresa" → `/auth/login` (outline, `border-stone-700 hover:border-stone-500`)
- **Load animation:** Staggered fade-in (tagline → subtitle → CTAs, 150ms delays)
- No hero image for v1 — typographic hero with atmospheric background. Structured for product screenshot later.

### 3. Value Props (Beneficios)

Three cards in a row (stacked on mobile) on `bg-stone-900`. Each card: gold left border accent (`border-l-2 border-amber-500/40`), icon in stone-800 container, hover lifts card and brightens border. Scroll-triggered staggered reveal.

**Operaciones más rápidas** (Zap)
"Digitaliza tu flujo completo — desde la recepción hasta la entrega — y elimina los cuellos de botella manuales."

**Menos entregas fallidas** (ShieldCheck)
"Verificación en cada punto de contacto. Escaneo, firma, foto — trazabilidad completa que reduce errores."

**Decisiones con datos** (BarChart3)
"Métricas en tiempo real sobre tu operación. Sabe exactamente dónde optimizar y cuánto estás ahorrando."

### 4. Metrics Showcase (KPIs)

Darker inset section (`bg-stone-950`) creating a "dashboard preview" feel.

Section header: "Los KPIs que transforman tu operación"
Subheader: "Nuestra inteligencia agentic trabaja continuamente para mejorar cada uno."

Three elevated cards with large `font-mono text-3xl text-amber-400` abbreviations, subtle inner glow (`shadow-[inset_0_1px_0_rgba(230,193,92,0.1)]`):

**CPO — Costo por Envío**
"El indicador que define tu rentabilidad. Cada reintento, cada ruta ineficiente, cada minuto de espera lo sube. Nuestros agentes optimizan rutas, reducen reintentos y eliminan tiempos muertos."

**OTIF — On Time In Full**
"¿Llegó completo y a tiempo? Agentes de monitoreo contactan a tus clientes antes de la entrega y verifican disponibilidad para que el primer intento sea el definitivo."

**NPS — Net Promoter Score**
"¿Tu cliente te recomendaría? Entregas puntuales y comunicación proactiva construyen la experiencia que genera lealtad."

### 5. Features Grid (Funcionalidades)

Section header: "Todo lo que necesitas para tu operación"

8 features in a 2-column, 4-row grid (desktop), stacked on mobile. Icon + title + one-liner.

| Feature | Icon | Description |
|---------|------|-------------|
| Despacho inteligente | Route | Rutas optimizadas por zona y capacidad, con GPS y monitoreo de distancia recorrida |
| Escaneo y verificación | ScanLine | QR y código de barras en cada punto — recepción, carga, entrega |
| Control de operaciones | Monitor | Panel en tiempo real con el estado de cada orden y conductor |
| Ingesta con IA | BrainCircuit | Carga manifiestos desde cualquier formato — CSV, PDF, fotos — sin integraciones complejas |
| KPIs estratégicos | Target | CPO, OTIF y NPS en un solo dashboard — los tres indicadores que definen tu operación |
| Agentes de monitoreo | Bot | Contacto proactivo con clientes antes de la entrega para reducir entregas fallidas y mejorar NPS |
| Inteligencia operacional | TrendingUp | FADR, eficiencia de combustible, dwell time, desglose de causas de fallo |
| Reportes y auditoría | FileBarChart | Exporta datos a CSV/PDF, trazabilidad completa para auditorías |

### 6. Integraciones

**Header:** "Tu centro de comando — compatible con tus herramientas"
**Subtitle:** "Mantén la app que ya usan tus conductores. Aureon se integra con tu operación actual y centraliza todo en un solo lugar."

Integration badges displayed in a row:
- **DispatchTrack** — download logo from dispatchtrack.com, commit as `public/logos/dispatchtrack.svg`
- **SimpliRoute** — download logo from simpliroute.com, commit as `public/logos/simpliroute.svg`
- **Driv.in** — download logo from driv.in, commit as `public/logos/drivin.svg`
- **"Y más..."** — generic Plug icon from lucide-react

Logos are static assets committed to the repo (no hotlinking). If a logo cannot be obtained, use styled text badges as fallback (company name in a bordered pill).

### 7. How It Works (Cómo Funciona)

Horizontal stepper on desktop (4 steps connected by a gold gradient line: `from-amber-500/60 via-amber-500/30 to-amber-500/60`). Step numbers in `font-mono` inside gold-bordered circles (`w-10 h-10 rounded-full border-2 border-amber-500/50 text-amber-400`). On mobile, becomes a vertical stepper with the gold line on the left.

**Step 1 — Carga manifiestos**
"Integración directa o deja que el agente IA los procese desde cualquier formato."

**Step 2 — Recibe y despacha en tu hub**
"Recepción, distribución y carga verificada con escaneo en cada punto."

**Step 3 — Monitorea la última milla**
"Seguimiento GPS, agentes proactivos y verificación de entrega en tiempo real."

**Step 4 — Mejora cada detalle**
"FADR, OTIF, NPS, costos — analítica que te dice exactamente dónde optimizar."

### 8. CTA Section

Full-width band on `bg-stone-950`. Top border: gold gradient line (`bg-gradient-to-r from-transparent via-amber-500/40 to-transparent h-px`). Subtle radial gold gradient matching the hero (bookend symmetry).

- **Headline:** "Lleva tu operación al siguiente nivel"
- **Subtitle:** "Agenda una demo y descubre cómo Aureon puede mejorar tus KPIs desde el primer mes."
- **CTA:** "Solicita una Demo" → Google Calendar (large gold button with hover glow)

### 9. Footer

Three columns (desktop), stacked on mobile.

**Column 1 — Brand:**
Tractis T-mark + "Aureon", one-liner: "Plataforma de última milla por Tractis"

**Column 2 — Links:**
- Ingresa → `/auth/login`
- Solicita una Demo → Google Calendar
- Legal → `/legal` (note: legal pages are currently in English — translation is out of scope for v1 but noted as a future improvement)

**Column 3 — Contacto:**
- gerhard@tractis.ai
- [LinkedIn — Gerhard Neumann](https://linkedin.com/in/gneumannv)
- [LinkedIn — Tractis](https://www.linkedin.com/company/tractis-ai/)

**Bottom bar:** "© 2026 Tractis. Todos los derechos reservados."

## Visual Design System

### Aesthetic Direction: "Warm Command Center"

The landing page should feel like looking into an intelligent control room through warm amber glass. Dark, warm backgrounds with gold as the dominant accent creating pools of light that guide the eye. Typography-driven with moments of visual drama. Continuation of the design DNA established in the auth layout (geometric patterns, gold accent lines, warm stone palette).

### Color & Theme

- **Theme:** Landing page uses hardcoded dark backgrounds independent of the user's theme preference. This ensures the marketing page always looks consistent regardless of `localStorage` theme setting. The app at `/app/*` continues to respect user theme preference.
- **Primary background:** `bg-stone-950` (`#0c0a09`) — deepest warm black
- **Section alternation:** Alternate between `bg-stone-950` and `bg-stone-900` (`#1c1917`) to create depth between sections
- **Card surfaces:** `bg-stone-900` on `stone-950` sections, `bg-stone-800/50` on `stone-900` sections
- **Accent:** Tractis gold (`#e6c15c`) — used aggressively: gradient text, accent borders, glow effects, connecting lines
- **Text:** `text-stone-100` (headings), `text-stone-400` (body), `text-stone-500` (muted)
- **Borders:** `border-stone-800` default, `border-amber-500/20` for accent borders

### Typography

- **Fonts:** Geist Sans (UI text), Geist Mono (metrics, KPI abbreviations, step numbers)
- **Hero tagline:** `text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight` — with CSS gradient text (`bg-gradient-to-r from-white via-stone-200 to-stone-400 bg-clip-text text-transparent`) for a luminous effect
- **Section headers:** `text-3xl md:text-4xl font-bold text-stone-100`
- **Section subheaders:** `text-lg text-stone-400`
- **Card titles:** `text-lg font-semibold text-stone-200`
- **Card descriptions:** `text-sm text-stone-400 leading-relaxed`
- **KPI abbreviations (Metrics section):** `font-mono text-3xl font-bold text-amber-400` — large, bold, monospace to create a dashboard-preview feel

### Background Texture

Topographic/contour line SVG pattern at 2-3% opacity applied to the hero and extending faintly through the page. Evokes maps, routes, and geography — on-brand for logistics. This replaces the cross-pattern used in the auth layout.

```
Hero section: topographic pattern at opacity-[0.03]
Other sections: same pattern at opacity-[0.015] or none
```

The hero additionally gets a radial gold gradient: `radial-gradient(ellipse at 50% 0%, rgba(230,193,92,0.08) 0%, transparent 60%)` — creates a warm glow emanating from center-top, like a control room light source.

### Motion & Animation

All animations use CSS via `tailwindcss-animate` (already installed) + intersection observer for scroll-triggered reveals. No heavy JS libraries.

**Page load (hero only):**
- Tagline: fade-in + translate-y from 20px, `duration-700 ease-out`
- Subtitle: same, `delay-150`
- CTAs: same, `delay-300`
- Background gradient: scale from 0.8 to 1.0, `duration-1000`

**Scroll reveals (all other sections):**
- Each section: fade-in + translate-y from 30px as it enters viewport (intersection observer, `threshold: 0.1`)
- Cards within sections: staggered reveal with `100ms` delay between siblings
- Animation: `duration-500 ease-out`, triggers once (no re-animation on scroll back)

**Hover states:**
- Cards: `hover:border-amber-500/30 hover:-translate-y-0.5 transition-all duration-200`
- Feature icons: container border shifts to gold, icon brightens
- Buttons: primary gold gets `hover:shadow-[0_0_20px_rgba(230,193,92,0.3)]` (subtle gold glow)
- Navbar links: `hover:text-stone-200` from `text-stone-400`

**Implementation:** A single `'use client'` component (`scroll-reveal.tsx`) wraps section content with an intersection observer. All other components remain Server Components.

### Component Styling Details

**Navbar:**
- Transparent → `bg-stone-950/80 backdrop-blur-lg border-b border-stone-800/50` on scroll
- Gold accent line: 1px gold gradient border-bottom when scrolled (mirroring auth layout's accent line pattern)

**Hero:**
- Full viewport with topographic background + radial gold gradient
- Tractis T-symbol rendered large and faint behind the tagline as a watermark (`opacity-[0.03]`, `w-96 h-96`, centered)

**Value Props cards:**
- Gold left border accent (`border-l-2 border-amber-500/40`)
- Icon sits in a `w-10 h-10 rounded-lg bg-stone-800 border border-stone-700/50` container (matching auth layout pattern)
- Hover: border brightens to `border-amber-500/60`, card lifts slightly

**Metrics Showcase:**
- Section background: darker inset (`bg-stone-950` if surrounding is `stone-900`)
- Each card: large KPI abbreviation in `font-mono text-amber-400`, full name below in `text-stone-200`, description in `text-stone-400`
- Cards get a subtle inner glow: `shadow-[inset_0_1px_0_rgba(230,193,92,0.1)]`
- Feels like a dashboard preview — the visitor gets a taste of the data experience

**Features Grid:**
- Icon containers: same pattern as value props (stone-800 with stone-700 border)
- On hover: icon container border shifts to gold, the feature title brightens

**Integrations row:**
- Logos/badges on a `bg-stone-900/50` surface with `border border-stone-800 rounded-xl px-6 py-3`
- Grayscale logos with `hover:grayscale-0` transition (when real logos are added)
- For v1 text badges: `font-semibold text-stone-300` in bordered pills

**How It Works stepper:**
- Connecting line: gold gradient (`from-amber-500/60 via-amber-500/30 to-amber-500/60`)
- Step numbers: `font-mono text-lg font-bold` inside gold-bordered circles (`w-10 h-10 rounded-full border-2 border-amber-500/50 text-amber-400`)
- On mobile: vertical layout, gold line on the left

**CTA Section:**
- Top border: gold gradient line (`bg-gradient-to-r from-transparent via-amber-500/40 to-transparent h-px`)
- Button: large gold with glow on hover
- Subtle radial gradient background matching the hero (creating bookend symmetry)

**Footer:**
- `bg-stone-950` with `border-t border-stone-800`
- Muted text (`text-stone-500`), links brighten on hover to `text-stone-300`
- Social icons: `text-stone-500 hover:text-amber-400`

### Components & Libraries

- **Components:** shadcn/ui, Tailwind CSS
- **Icons:** lucide-react
- **Animation:** `tailwindcss-animate` (already installed) + one custom intersection observer component
- **Images:** None for v1 — icon + typography + gradient driven. Structured for screenshots/mockups later.
- **Responsive:** Mobile-first, all sections stack on small screens

## CTAs

| Label | Target | Style |
|-------|--------|-------|
| Solicita una Demo | https://calendar.app.google/k9siT3q8FuxjGf9v5 (new tab) | Primary, gold |
| Ingresa | `/auth/login` | Secondary, ghost/outline |
| Ir al Panel (authenticated) | `/app` | Secondary, ghost/outline |

## Out of Scope

- Internationalization (English/Portuguese) — future
- Product screenshots/mockups — future, structure supports drop-in
- Blog or resources section
- Pricing page
- Contact form (Calendly/form-based lead capture)
- Analytics tracking beyond existing Vercel Analytics + GA
- Legal page translation to Spanish — future
- Custom OG image generation — use placeholder for v1

---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the root `/` redirect with a marketing landing page that showcases Aureon, educates on KPIs, and converts via demo booking.

**Architecture:** Single-page landing built from 9 Server/Client components in a `(landing)/components/` route group. Auth state detected server-side in `page.tsx` via `createSSRClient()`, passed as prop to navbar. One shared `ScrollReveal` client component handles all scroll animations via IntersectionObserver.

**Tech Stack:** Next.js 15 (App Router), Supabase Auth (server-side), shadcn/ui (Button, Sheet), Tailwind CSS, tailwindcss-animate, lucide-react, Vitest + Testing Library.

**Test runner:** `cd apps/frontend && npx vitest run --reporter=verbose`

**Parallelism:** Tasks 3–9 are independent and can run in parallel. Tasks 1–2 must complete first. Task 10 runs last.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/app/layout.tsx:32` | Change `lang="en"` → `lang="es"` |
| Rewrite | `src/app/page.tsx` | Landing page shell: auth check, metadata, compose sections |
| Create | `src/app/(landing)/components/scroll-reveal.tsx` | `'use client'` IntersectionObserver wrapper |
| Create | `src/app/(landing)/components/navbar.tsx` | `'use client'` fixed navbar with scroll, auth, mobile |
| Create | `src/app/(landing)/components/hero.tsx` | `'use client'` hero with load animation |
| Create | `src/app/(landing)/components/value-props.tsx` | Server Component — 3 benefit cards |
| Create | `src/app/(landing)/components/metrics-showcase.tsx` | Server Component — 3 KPI cards |
| Create | `src/app/(landing)/components/features.tsx` | Server Component — 8-feature grid |
| Create | `src/app/(landing)/components/integrations.tsx` | Server Component — integration badges |
| Create | `src/app/(landing)/components/how-it-works.tsx` | Server Component — 4-step stepper |
| Create | `src/app/(landing)/components/cta-section.tsx` | Server Component — final CTA band |
| Create | `src/app/(landing)/components/footer.tsx` | Server Component — 3-col footer |
| Create | `src/app/(landing)/components/__tests__/navbar.test.tsx` | Navbar tests |
| Create | `src/app/(landing)/components/__tests__/hero.test.tsx` | Hero tests |
| Create | `src/app/(landing)/components/__tests__/sections.test.tsx` | All section component tests |
| Create | `src/app/(landing)/components/__tests__/scroll-reveal.test.tsx` | ScrollReveal tests |
| Create | `public/logos/` | Integration partner logos directory |

---

## Task 1: Foundation — Routing, ScrollReveal, Lang

**Files:**
- Modify: `apps/frontend/src/app/layout.tsx:32`
- Modify: `apps/frontend/src/app/page.tsx`
- Create: `apps/frontend/src/app/(landing)/components/scroll-reveal.tsx`
- Create: `apps/frontend/src/app/(landing)/components/__tests__/scroll-reveal.test.tsx`

- [ ] **Step 1: Write ScrollReveal test**

```tsx
// src/app/(landing)/components/__tests__/scroll-reveal.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();
let observerCallback: IntersectionObserverCallback;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', vi.fn((cb) => {
    observerCallback = cb;
    return { observe: mockObserve, unobserve: mockUnobserve, disconnect: mockDisconnect };
  }));
});

import { ScrollReveal } from '../scroll-reveal';

describe('ScrollReveal', () => {
  it('renders children', () => {
    render(<ScrollReveal><p>Hello</p></ScrollReveal>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('starts with opacity-0 and translate-y', () => {
    const { container } = render(<ScrollReveal><p>Hello</p></ScrollReveal>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('opacity-0');
    expect(wrapper.className).toContain('translate-y-8');
  });

  it('becomes visible when intersecting', () => {
    const { container } = render(<ScrollReveal><p>Hello</p></ScrollReveal>);
    const wrapper = container.firstChild as HTMLElement;

    // Simulate intersection
    observerCallback(
      [{ isIntersecting: true, target: wrapper }] as IntersectionObserverEntry[],
      {} as IntersectionObserver
    );

    expect(wrapper.className).toContain('opacity-100');
    expect(wrapper.className).toContain('translate-y-0');
  });

  it('applies stagger delay', () => {
    const { container } = render(<ScrollReveal delay={200}><p>Hi</p></ScrollReveal>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.transitionDelay).toBe('200ms');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (module not found)

```bash
cd apps/frontend && npx vitest run src/app/\(landing\)/components/__tests__/scroll-reveal.test.tsx --reporter=verbose
```

- [ ] **Step 3: Implement ScrollReveal**

```tsx
// src/app/(landing)/components/scroll-reveal.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

interface ScrollRevealProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export function ScrollReveal({ children, delay = 0, className = '' }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Change lang to "es" in layout.tsx**

In `apps/frontend/src/app/layout.tsx:32`, change `lang="en"` to `lang="es"`.

- [ ] **Step 6: Replace page.tsx redirect with landing shell**

```tsx
// src/app/page.tsx
import type { Metadata } from 'next';
import { createSSRClient } from '@/lib/supabase/server';

import { Navbar } from './(landing)/components/navbar';
import { Hero } from './(landing)/components/hero';
import { ValueProps } from './(landing)/components/value-props';
import { MetricsShowcase } from './(landing)/components/metrics-showcase';
import { Features } from './(landing)/components/features';
import { Integrations } from './(landing)/components/integrations';
import { HowItWorks } from './(landing)/components/how-it-works';
import { CtaSection } from './(landing)/components/cta-section';
import { Footer } from './(landing)/components/footer';

export const metadata: Metadata = {
  title: 'Aureon — Tu última milla, bajo control',
  description:
    'Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas, rutas más eficientes, datos en tiempo real.',
  openGraph: {
    title: 'Aureon — Tu última milla, bajo control',
    description:
      'Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas, rutas más eficientes, datos en tiempo real.',
    siteName: 'Aureon',
  },
};

export default async function LandingPage() {
  const supabase = await createSSRClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = !!user;

  return (
    <main className="bg-stone-950 text-stone-100 overflow-x-hidden" style={{ scrollBehavior: 'smooth' }}>
      <Navbar isAuthenticated={isAuthenticated} />
      <Hero isAuthenticated={isAuthenticated} />
      <ValueProps />
      <MetricsShowcase />
      <Features />
      <Integrations />
      <HowItWorks />
      <CtaSection />
      <Footer />
    </main>
  );
}
```

- [ ] **Step 7: Commit foundation**

```bash
git add apps/frontend/src/app/layout.tsx apps/frontend/src/app/page.tsx \
  apps/frontend/src/app/\(landing\)/components/scroll-reveal.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/scroll-reveal.test.tsx
git commit -m "feat(spec-17): foundation — ScrollReveal, page shell, lang=es"
```

---

## Task 2: Navbar

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/navbar.tsx`
- Create: `apps/frontend/src/app/(landing)/components/__tests__/navbar.test.tsx`

- [ ] **Step 1: Write Navbar test**

```tsx
// src/app/(landing)/components/__tests__/navbar.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet-content">{children}</div>,
}));

import { Navbar } from '../navbar';

describe('Navbar', () => {
  it('renders the Aureon brand', () => {
    render(<Navbar isAuthenticated={false} />);
    expect(screen.getByText('Aureon')).toBeInTheDocument();
  });

  it('shows "Ingresa" when not authenticated', () => {
    render(<Navbar isAuthenticated={false} />);
    expect(screen.getByRole('link', { name: /ingresa/i })).toHaveAttribute('href', '/auth/login');
  });

  it('shows "Ir al Panel" when authenticated', () => {
    render(<Navbar isAuthenticated={true} />);
    expect(screen.getByRole('link', { name: /ir al panel/i })).toHaveAttribute('href', '/app');
  });

  it('renders demo CTA linking to Google Calendar', () => {
    render(<Navbar isAuthenticated={false} />);
    const demoLink = screen.getByRole('link', { name: /solicita una demo/i });
    expect(demoLink).toHaveAttribute('href', 'https://calendar.app.google/k9siT3q8FuxjGf9v5');
    expect(demoLink).toHaveAttribute('target', '_blank');
  });

  it('renders anchor navigation links', () => {
    render(<Navbar isAuthenticated={false} />);
    expect(screen.getByText('Beneficios')).toBeInTheDocument();
    expect(screen.getByText('Métricas')).toBeInTheDocument();
    expect(screen.getByText('Funcionalidades')).toBeInTheDocument();
    expect(screen.getByText('Cómo Funciona')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement Navbar**

```tsx
// src/app/(landing)/components/navbar.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/sheet';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

const navLinks = [
  { label: 'Beneficios', href: '#beneficios' },
  { label: 'Métricas', href: '#metricas' },
  { label: 'Funcionalidades', href: '#funcionalidades' },
  { label: 'Cómo Funciona', href: '#como-funciona' },
];

export function Navbar({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 64);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-stone-950/80 backdrop-blur-lg border-b border-stone-800/50'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-6">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3">
          <svg width="24" height="22" viewBox="0 0 110 104" fill="#e6c15c" className="flex-shrink-0">
            <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
            <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
            <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
          </svg>
          <span className="text-sm font-semibold tracking-tight text-stone-100">Aureon</span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-stone-400 hover:text-stone-200 transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href={isAuthenticated ? '/app' : '/auth/login'}
            className="text-sm text-stone-400 hover:text-stone-200 transition-colors px-3 py-1.5"
          >
            {isAuthenticated ? 'Ir al Panel' : 'Ingresa'}
          </Link>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium bg-amber-500 text-stone-950 px-4 py-2 rounded-md hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(230,193,92,0.3)] transition-all"
          >
            Solicita una Demo
          </a>
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className="text-stone-400 hover:text-stone-200 p-2" aria-label="Menu">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="bg-stone-950 border-stone-800 w-72">
              <div className="flex flex-col gap-6 mt-8">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="text-stone-300 hover:text-stone-100 text-lg"
                  >
                    {link.label}
                  </a>
                ))}
                <hr className="border-stone-800" />
                <Link
                  href={isAuthenticated ? '/app' : '/auth/login'}
                  className="text-stone-300 hover:text-stone-100 text-lg"
                  onClick={() => setOpen(false)}
                >
                  {isAuthenticated ? 'Ir al Panel' : 'Ingresa'}
                </Link>
                <a
                  href={DEMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-center font-medium bg-amber-500 text-stone-950 px-4 py-2.5 rounded-md"
                >
                  Solicita una Demo
                </a>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/navbar.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/navbar.test.tsx
git commit -m "feat(spec-17): navbar with scroll effect, auth-aware CTAs, mobile menu"
```

---

## Task 3: Hero Section

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/hero.tsx`
- Create: `apps/frontend/src/app/(landing)/components/__tests__/hero.test.tsx`

- [ ] **Step 1: Write Hero test**

```tsx
// src/app/(landing)/components/__tests__/hero.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { Hero } from '../hero';

describe('Hero', () => {
  it('renders the tagline', () => {
    render(<Hero isAuthenticated={false} />);
    expect(screen.getByText('Tu última milla, bajo control')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<Hero isAuthenticated={false} />);
    expect(screen.getByText(/Plataforma inteligente/)).toBeInTheDocument();
  });

  it('renders demo CTA with Google Calendar link', () => {
    render(<Hero isAuthenticated={false} />);
    const link = screen.getByRole('link', { name: /solicita una demo/i });
    expect(link).toHaveAttribute('href', 'https://calendar.app.google/k9siT3q8FuxjGf9v5');
  });

  it('shows "Ingresa" for unauthenticated users', () => {
    render(<Hero isAuthenticated={false} />);
    expect(screen.getByRole('link', { name: /ingresa/i })).toHaveAttribute('href', '/auth/login');
  });

  it('shows "Ir al Panel" for authenticated users', () => {
    render(<Hero isAuthenticated={true} />);
    expect(screen.getByRole('link', { name: /ir al panel/i })).toHaveAttribute('href', '/app');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement Hero**

```tsx
// src/app/(landing)/components/hero.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

// Topographic SVG pattern (inline data URI)
const TOPO_PATTERN = `url("data:image/svg+xml,%3Csvg width='600' height='600' viewBox='0 0 600 600' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1'%3E%3Cellipse cx='300' cy='300' rx='280' ry='180'/%3E%3Cellipse cx='300' cy='300' rx='220' ry='140'/%3E%3Cellipse cx='300' cy='300' rx='160' ry='100'/%3E%3Cellipse cx='300' cy='300' rx='100' ry='60'/%3E%3Cellipse cx='300' cy='300' rx='50' ry='30'/%3E%3Cellipse cx='150' cy='150' rx='120' ry='80'/%3E%3Cellipse cx='150' cy='150' rx='70' ry='45'/%3E%3Cellipse cx='450' cy='450' rx='130' ry='85'/%3E%3Cellipse cx='450' cy='450' rx='75' ry='50'/%3E%3C/g%3E%3C/svg%3E")`;

export function Hero({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const show = (delay: number) =>
    mounted
      ? `opacity-100 translate-y-0 transition-all duration-700 ease-out`
      : 'opacity-0 translate-y-5';

  return (
    <section className="relative min-h-screen flex items-center justify-center bg-stone-950 overflow-hidden">
      {/* Topographic pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: TOPO_PATTERN, backgroundSize: '600px 600px' }}
      />

      {/* Radial gold gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(230,193,92,0.08) 0%, transparent 60%)',
        }}
      />

      {/* Faint T-symbol watermark */}
      <svg
        width="384"
        height="384"
        viewBox="0 0 110 104"
        fill="#e6c15c"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03]"
      >
        <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
        <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
        <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
      </svg>

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
        <h1
          className={`text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight bg-gradient-to-r from-white via-stone-200 to-stone-400 bg-clip-text text-transparent ${show(0)}`}
          style={{ transitionDelay: '0ms' }}
        >
          Tu última milla, bajo control
        </h1>

        <p
          className={`mt-6 text-lg md:text-xl text-stone-400 max-w-2xl mx-auto leading-relaxed ${show(150)}`}
          style={{ transitionDelay: '150ms' }}
        >
          Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas,
          rutas más eficientes, datos en tiempo real.
        </p>

        <div
          className={`mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 ${show(300)}`}
          style={{ transitionDelay: '300ms' }}
        >
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 bg-amber-500 text-stone-950 font-medium rounded-md hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(230,193,92,0.3)] transition-all text-sm"
          >
            Solicita una Demo
          </a>
          <Link
            href={isAuthenticated ? '/app' : '/auth/login'}
            className="px-8 py-3 border border-stone-700 text-stone-300 rounded-md hover:border-stone-500 hover:text-stone-100 transition-all text-sm"
          >
            {isAuthenticated ? 'Ir al Panel' : 'Ingresa'}
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/hero.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/hero.test.tsx
git commit -m "feat(spec-17): hero with gradient text, topo background, staggered animation"
```

---

## Task 4: Value Props

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/value-props.tsx`
- Test in: `apps/frontend/src/app/(landing)/components/__tests__/sections.test.tsx`

- [ ] **Step 1: Write ValueProps test** (start the shared sections test file)

```tsx
// src/app/(landing)/components/__tests__/sections.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock ScrollReveal to passthrough
vi.mock('../scroll-reveal', () => ({
  ScrollReveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ValueProps } from '../value-props';

describe('ValueProps', () => {
  it('renders section heading', () => {
    render(<ValueProps />);
    expect(screen.getByText('Beneficios')).toBeInTheDocument();
  });

  it('renders 3 value proposition cards', () => {
    render(<ValueProps />);
    expect(screen.getByText('Operaciones más rápidas')).toBeInTheDocument();
    expect(screen.getByText('Menos entregas fallidas')).toBeInTheDocument();
    expect(screen.getByText('Decisiones con datos')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement ValueProps**

```tsx
// src/app/(landing)/components/value-props.tsx
import { Zap, ShieldCheck, BarChart3, type LucideIcon } from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';

const props: { title: string; description: string; Icon: LucideIcon }[] = [
  {
    title: 'Operaciones más rápidas',
    description:
      'Digitaliza tu flujo completo — desde la recepción hasta la entrega — y elimina los cuellos de botella manuales.',
    Icon: Zap,
  },
  {
    title: 'Menos entregas fallidas',
    description:
      'Verificación en cada punto de contacto. Escaneo, firma, foto — trazabilidad completa que reduce errores.',
    Icon: ShieldCheck,
  },
  {
    title: 'Decisiones con datos',
    description:
      'Métricas en tiempo real sobre tu operación. Sabe exactamente dónde optimizar y cuánto estás ahorrando.',
    Icon: BarChart3,
  },
];

export function ValueProps() {
  return (
    <section id="beneficios" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <p className="text-sm font-medium tracking-widest uppercase text-amber-400 mb-4">Beneficios</p>
        </ScrollReveal>
        <div className="grid md:grid-cols-3 gap-8 mt-8">
          {props.map((p, i) => (
            <ScrollReveal key={p.title} delay={i * 100}>
              <div className="border-l-2 border-amber-500/40 hover:border-amber-500/60 bg-stone-800/50 rounded-r-lg p-6 hover:-translate-y-0.5 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-stone-800 border border-stone-700/50 flex items-center justify-center mb-4">
                  <p.Icon className="w-5 h-5 text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-stone-200">{p.title}</h3>
                <p className="mt-2 text-sm text-stone-400 leading-relaxed">{p.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/value-props.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/sections.test.tsx
git commit -m "feat(spec-17): value props section with gold border cards"
```

---

## Task 5: Metrics Showcase

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/metrics-showcase.tsx`
- Append to: `apps/frontend/src/app/(landing)/components/__tests__/sections.test.tsx`

- [ ] **Step 1: Add MetricsShowcase test to sections.test.tsx**

```tsx
// Append to sections.test.tsx
import { MetricsShowcase } from '../metrics-showcase';

describe('MetricsShowcase', () => {
  it('renders section heading', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('Los KPIs que transforman tu operación')).toBeInTheDocument();
  });

  it('renders 3 KPI cards with abbreviations', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('CPO')).toBeInTheDocument();
    expect(screen.getByText('OTIF')).toBeInTheDocument();
    expect(screen.getByText('NPS')).toBeInTheDocument();
  });

  it('renders KPI full names', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('Costo por Envío')).toBeInTheDocument();
    expect(screen.getByText('On Time In Full')).toBeInTheDocument();
    expect(screen.getByText('Net Promoter Score')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement MetricsShowcase**

```tsx
// src/app/(landing)/components/metrics-showcase.tsx
import { ScrollReveal } from './scroll-reveal';

const kpis = [
  {
    abbr: 'CPO',
    name: 'Costo por Envío',
    description:
      'El indicador que define tu rentabilidad. Cada reintento, cada ruta ineficiente, cada minuto de espera lo sube. Nuestros agentes optimizan rutas, reducen reintentos y eliminan tiempos muertos.',
  },
  {
    abbr: 'OTIF',
    name: 'On Time In Full',
    description:
      '¿Llegó completo y a tiempo? Agentes de monitoreo contactan a tus clientes antes de la entrega y verifican disponibilidad para que el primer intento sea el definitivo.',
  },
  {
    abbr: 'NPS',
    name: 'Net Promoter Score',
    description:
      '¿Tu cliente te recomendaría? Entregas puntuales y comunicación proactiva construyen la experiencia que genera lealtad.',
  },
];

export function MetricsShowcase() {
  return (
    <section id="metricas" className="bg-stone-950 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Los KPIs que transforman tu operación
          </h2>
          <p className="mt-4 text-lg text-stone-400">
            Nuestra inteligencia agentic trabaja continuamente para mejorar cada uno.
          </p>
        </ScrollReveal>

        <div className="grid md:grid-cols-3 gap-8 mt-12">
          {kpis.map((kpi, i) => (
            <ScrollReveal key={kpi.abbr} delay={i * 100}>
              <div className="bg-stone-900 border border-stone-800 rounded-xl p-8 hover:border-amber-500/30 hover:-translate-y-0.5 transition-all duration-200 shadow-[inset_0_1px_0_rgba(230,193,92,0.1)]">
                <span className="font-mono text-3xl font-bold text-amber-400">{kpi.abbr}</span>
                <h3 className="mt-2 text-lg font-semibold text-stone-200">{kpi.name}</h3>
                <p className="mt-3 text-sm text-stone-400 leading-relaxed">{kpi.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/metrics-showcase.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/sections.test.tsx
git commit -m "feat(spec-17): metrics showcase with dashboard-preview KPI cards"
```

---

## Task 6: Features Grid

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/features.tsx`
- Append to: `apps/frontend/src/app/(landing)/components/__tests__/sections.test.tsx`

- [ ] **Step 1: Add Features test**

```tsx
// Append to sections.test.tsx
import { Features } from '../features';

describe('Features', () => {
  it('renders section heading', () => {
    render(<Features />);
    expect(screen.getByText('Todo lo que necesitas para tu operación')).toBeInTheDocument();
  });

  it('renders all 8 features', () => {
    render(<Features />);
    expect(screen.getByText('Despacho inteligente')).toBeInTheDocument();
    expect(screen.getByText('Escaneo y verificación')).toBeInTheDocument();
    expect(screen.getByText('Control de operaciones')).toBeInTheDocument();
    expect(screen.getByText('Ingesta con IA')).toBeInTheDocument();
    expect(screen.getByText('KPIs estratégicos')).toBeInTheDocument();
    expect(screen.getByText('Agentes de monitoreo')).toBeInTheDocument();
    expect(screen.getByText('Inteligencia operacional')).toBeInTheDocument();
    expect(screen.getByText('Reportes y auditoría')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement Features**

```tsx
// src/app/(landing)/components/features.tsx
import {
  Route, ScanLine, Monitor, BrainCircuit,
  Target, Bot, TrendingUp, FileBarChart,
  type LucideIcon,
} from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';

const features: { title: string; description: string; Icon: LucideIcon }[] = [
  { title: 'Despacho inteligente', description: 'Rutas optimizadas por zona y capacidad, con GPS y monitoreo de distancia recorrida', Icon: Route },
  { title: 'Escaneo y verificación', description: 'QR y código de barras en cada punto — recepción, carga, entrega', Icon: ScanLine },
  { title: 'Control de operaciones', description: 'Panel en tiempo real con el estado de cada orden y conductor', Icon: Monitor },
  { title: 'Ingesta con IA', description: 'Carga manifiestos desde cualquier formato — CSV, PDF, fotos — sin integraciones complejas', Icon: BrainCircuit },
  { title: 'KPIs estratégicos', description: 'CPO, OTIF y NPS en un solo dashboard — los tres indicadores que definen tu operación', Icon: Target },
  { title: 'Agentes de monitoreo', description: 'Contacto proactivo con clientes antes de la entrega para reducir entregas fallidas y mejorar NPS', Icon: Bot },
  { title: 'Inteligencia operacional', description: 'FADR, eficiencia de combustible, dwell time, desglose de causas de fallo', Icon: TrendingUp },
  { title: 'Reportes y auditoría', description: 'Exporta datos a CSV/PDF, trazabilidad completa para auditorías', Icon: FileBarChart },
];

export function Features() {
  return (
    <section id="funcionalidades" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Todo lo que necesitas para tu operación
          </h2>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 gap-6 mt-12">
          {features.map((f, i) => (
            <ScrollReveal key={f.title} delay={i * 75}>
              <div className="flex gap-4 p-5 rounded-lg hover:bg-stone-800/40 transition-colors duration-200 group">
                <div className="w-10 h-10 rounded-lg bg-stone-800 border border-stone-700/50 group-hover:border-amber-500/40 flex items-center justify-center flex-shrink-0 transition-colors">
                  <f.Icon className="w-5 h-5 text-stone-400 group-hover:text-amber-400 transition-colors" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-stone-200">{f.title}</h3>
                  <p className="mt-1 text-sm text-stone-400 leading-relaxed">{f.description}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/features.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/sections.test.tsx
git commit -m "feat(spec-17): features grid with 8 capabilities"
```

---

## Task 7: Integrations

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/integrations.tsx`
- Create: `apps/frontend/public/logos/` (directory — logos downloaded during implementation)
- Append to: `apps/frontend/src/app/(landing)/components/__tests__/sections.test.tsx`

- [ ] **Step 1: Attempt to download logos from partner sites**

Fetch logos from dispatchtrack.com, simpliroute.com, and driv.in. Save as SVG/PNG to `apps/frontend/public/logos/`. If unavailable, use text badges as fallback.

- [ ] **Step 2: Add Integrations test**

```tsx
// Append to sections.test.tsx
import { Integrations } from '../integrations';

describe('Integrations', () => {
  it('renders section heading', () => {
    render(<Integrations />);
    expect(screen.getByText(/Tu centro de comando/)).toBeInTheDocument();
  });

  it('renders integration partner names', () => {
    render(<Integrations />);
    expect(screen.getByText('DispatchTrack')).toBeInTheDocument();
    expect(screen.getByText('SimpliRoute')).toBeInTheDocument();
    expect(screen.getByText('Driv.in')).toBeInTheDocument();
    expect(screen.getByText('Y más...')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

- [ ] **Step 4: Implement Integrations**

```tsx
// src/app/(landing)/components/integrations.tsx
import { Plug } from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';

const partners = [
  { name: 'DispatchTrack', logo: '/logos/dispatchtrack.svg' },
  { name: 'SimpliRoute', logo: '/logos/simpliroute.svg' },
  { name: 'Driv.in', logo: '/logos/drivin.svg' },
];

export function Integrations() {
  return (
    <section className="bg-stone-950 py-24">
      <div className="max-w-7xl mx-auto px-6 text-center">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Tu centro de comando — compatible con tus herramientas
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-2xl mx-auto">
            Mantén la app que ya usan tus conductores. Aureon se integra con tu operación actual
            y centraliza todo en un solo lugar.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={200}>
          <div className="flex flex-wrap items-center justify-center gap-6 mt-12">
            {partners.map((p) => (
              <div
                key={p.name}
                className="bg-stone-900/50 border border-stone-800 rounded-xl px-8 py-4 text-stone-300 font-semibold hover:border-stone-700 transition-colors"
              >
                {/* Logo image if available, text badge as fallback */}
                {p.name}
              </div>
            ))}
            <div className="bg-stone-900/50 border border-stone-800 rounded-xl px-8 py-4 flex items-center gap-2 text-stone-500">
              <Plug className="w-4 h-4" />
              <span className="font-medium">Y más...</span>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
```

Note: The component uses text badges initially. When logo SVGs are obtained and placed in `public/logos/`, update to use `<Image>` with grayscale filter.

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/integrations.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/sections.test.tsx \
  apps/frontend/public/logos/
git commit -m "feat(spec-17): integrations section with partner badges"
```

---

## Task 8: How It Works

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/how-it-works.tsx`
- Append to: `apps/frontend/src/app/(landing)/components/__tests__/sections.test.tsx`

- [ ] **Step 1: Add HowItWorks test**

```tsx
// Append to sections.test.tsx
import { HowItWorks } from '../how-it-works';

describe('HowItWorks', () => {
  it('renders all 4 steps', () => {
    render(<HowItWorks />);
    expect(screen.getByText('Carga manifiestos')).toBeInTheDocument();
    expect(screen.getByText('Recibe y despacha en tu hub')).toBeInTheDocument();
    expect(screen.getByText('Monitorea la última milla')).toBeInTheDocument();
    expect(screen.getByText('Mejora cada detalle')).toBeInTheDocument();
  });

  it('renders step numbers', () => {
    render(<HowItWorks />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement HowItWorks**

```tsx
// src/app/(landing)/components/how-it-works.tsx
import { ScrollReveal } from './scroll-reveal';

const steps = [
  {
    title: 'Carga manifiestos',
    description: 'Integración directa o deja que el agente IA los procese desde cualquier formato.',
  },
  {
    title: 'Recibe y despacha en tu hub',
    description: 'Recepción, distribución y carga verificada con escaneo en cada punto.',
  },
  {
    title: 'Monitorea la última milla',
    description: 'Seguimiento GPS, agentes proactivos y verificación de entrega en tiempo real.',
  },
  {
    title: 'Mejora cada detalle',
    description: 'FADR, OTIF, NPS, costos — analítica que te dice exactamente dónde optimizar.',
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">Cómo Funciona</h2>
        </ScrollReveal>

        {/* Desktop: horizontal stepper */}
        <div className="hidden md:grid grid-cols-4 gap-8 mt-12 relative">
          {/* Gold connecting line */}
          <div className="absolute top-5 left-[calc(12.5%+20px)] right-[calc(12.5%+20px)] h-0.5 bg-gradient-to-r from-amber-500/60 via-amber-500/30 to-amber-500/60" />

          {steps.map((step, i) => (
            <ScrollReveal key={step.title} delay={i * 150}>
              <div className="relative text-center">
                <div className="w-10 h-10 rounded-full border-2 border-amber-500/50 flex items-center justify-center mx-auto bg-stone-900 relative z-10">
                  <span className="font-mono text-lg font-bold text-amber-400">{i + 1}</span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-stone-200">{step.title}</h3>
                <p className="mt-2 text-sm text-stone-400 leading-relaxed">{step.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>

        {/* Mobile: vertical stepper */}
        <div className="md:hidden mt-12 relative pl-12">
          {/* Gold vertical line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-amber-500/60 via-amber-500/30 to-amber-500/60" />

          <div className="space-y-10">
            {steps.map((step, i) => (
              <ScrollReveal key={step.title} delay={i * 100}>
                <div className="relative">
                  <div className="absolute -left-12 w-10 h-10 rounded-full border-2 border-amber-500/50 flex items-center justify-center bg-stone-900">
                    <span className="font-mono text-lg font-bold text-amber-400">{i + 1}</span>
                  </div>
                  <h3 className="text-base font-semibold text-stone-200">{step.title}</h3>
                  <p className="mt-1 text-sm text-stone-400 leading-relaxed">{step.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/how-it-works.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/sections.test.tsx
git commit -m "feat(spec-17): how-it-works stepper with gold gradient line"
```

---

## Task 9: CTA Section + Footer

**Files:**
- Create: `apps/frontend/src/app/(landing)/components/cta-section.tsx`
- Create: `apps/frontend/src/app/(landing)/components/footer.tsx`
- Append to: `apps/frontend/src/app/(landing)/components/__tests__/sections.test.tsx`

- [ ] **Step 1: Add CTA + Footer tests**

```tsx
// Append to sections.test.tsx
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { CtaSection } from '../cta-section';
import { Footer } from '../footer';

describe('CtaSection', () => {
  it('renders headline', () => {
    render(<CtaSection />);
    expect(screen.getByText('Lleva tu operación al siguiente nivel')).toBeInTheDocument();
  });

  it('renders demo CTA', () => {
    render(<CtaSection />);
    const link = screen.getByRole('link', { name: /solicita una demo/i });
    expect(link).toHaveAttribute('href', 'https://calendar.app.google/k9siT3q8FuxjGf9v5');
  });
});

describe('Footer', () => {
  it('renders brand', () => {
    render(<Footer />);
    expect(screen.getByText(/Plataforma de última milla por Tractis/)).toBeInTheDocument();
  });

  it('renders contact email', () => {
    render(<Footer />);
    expect(screen.getByText('gerhard@tractis.ai')).toBeInTheDocument();
  });

  it('renders copyright', () => {
    render(<Footer />);
    expect(screen.getByText(/© 2026 Tractis/)).toBeInTheDocument();
  });

  it('renders LinkedIn links', () => {
    render(<Footer />);
    const links = screen.getAllByRole('link');
    const linkedInLinks = links.filter(
      (l) => l.getAttribute('href')?.includes('linkedin.com')
    );
    expect(linkedInLinks).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement CtaSection**

```tsx
// src/app/(landing)/components/cta-section.tsx
import { ScrollReveal } from './scroll-reveal';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

export function CtaSection() {
  return (
    <section className="relative bg-stone-950 py-24 overflow-hidden">
      {/* Top gold gradient line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />

      {/* Subtle radial gradient (bookend symmetry with hero) */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 100%, rgba(230,193,92,0.05) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 text-center px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Lleva tu operación al siguiente nivel
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-xl mx-auto">
            Agenda una demo y descubre cómo Aureon puede mejorar tus KPIs desde el primer mes.
          </p>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-8 px-10 py-3.5 bg-amber-500 text-stone-950 font-medium rounded-md hover:bg-amber-400 hover:shadow-[0_0_24px_rgba(230,193,92,0.35)] transition-all text-base"
          >
            Solicita una Demo
          </a>
        </ScrollReveal>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement Footer**

```tsx
// src/app/(landing)/components/footer.tsx
import Link from 'next/link';
import { Linkedin, Mail } from 'lucide-react';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

export function Footer() {
  return (
    <footer className="bg-stone-950 border-t border-stone-800 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid sm:grid-cols-3 gap-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <svg width="20" height="18" viewBox="0 0 110 104" fill="#e6c15c" className="flex-shrink-0">
                <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
                <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
                <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
              </svg>
              <span className="text-sm font-semibold text-stone-200">Aureon</span>
            </div>
            <p className="text-sm text-stone-500">Plataforma de última milla por Tractis</p>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-4">Enlaces</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/auth/login" className="text-stone-500 hover:text-stone-300 transition-colors">
                  Ingresa
                </Link>
              </li>
              <li>
                <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:text-stone-300 transition-colors">
                  Solicita una Demo
                </a>
              </li>
              <li>
                <Link href="/legal" className="text-stone-500 hover:text-stone-300 transition-colors">
                  Legal
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-4">Contacto</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="mailto:gerhard@tractis.ai" className="text-stone-500 hover:text-stone-300 transition-colors flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  gerhard@tractis.ai
                </a>
              </li>
              <li>
                <a href="https://linkedin.com/in/gneumannv" target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:text-amber-400 transition-colors flex items-center gap-2">
                  <Linkedin className="w-4 h-4" />
                  Gerhard Neumann
                </a>
              </li>
              <li>
                <a href="https://www.linkedin.com/company/tractis-ai/" target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:text-amber-400 transition-colors flex items-center gap-2">
                  <Linkedin className="w-4 h-4" />
                  Tractis
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-stone-800/50 text-center">
          <p className="text-xs text-stone-600">© 2026 Tractis. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/\(landing\)/components/cta-section.tsx \
  apps/frontend/src/app/\(landing\)/components/footer.tsx \
  apps/frontend/src/app/\(landing\)/components/__tests__/sections.test.tsx
git commit -m "feat(spec-17): CTA section with gold gradient + footer"
```

---

## Task 10: Integration Test & Polish

**Files:**
- All landing components wired into `page.tsx` (done in Task 1)
- Run full test suite

- [ ] **Step 1: Run all landing page tests**

```bash
cd apps/frontend && npx vitest run src/app/\(landing\)/ --reporter=verbose
```

Expected: All tests pass across scroll-reveal, navbar, hero, and sections test files.

- [ ] **Step 2: Run full project test suite to check for regressions**

```bash
cd apps/frontend && npx vitest run --reporter=verbose
```

Expected: No regressions in existing tests.

- [ ] **Step 3: Run build to verify no compilation errors**

```bash
cd apps/frontend && npx next build
```

Expected: Build succeeds. The page.tsx Server Component correctly composes all sections.

- [ ] **Step 4: Start dev server and visually verify**

```bash
cd apps/frontend && npx next dev
```

Open http://localhost:3000/ — should show the landing page, NOT redirect to login. Verify:
- Navbar appears, transparent on hero
- Scroll down — navbar becomes solid with blur
- All 9 sections render in order
- Gold accent throughout
- Mobile responsive (resize browser)
- "Ingresa" links to /auth/login
- "Solicita una Demo" opens Google Calendar in new tab

- [ ] **Step 5: Final commit with all files**

```bash
git add -A
git commit -m "feat(spec-17): Aureon landing page — complete implementation"
```

- [ ] **Step 6: Push and create PR**

```bash
git push origin HEAD
gh pr create --title "feat(spec-17): Aureon marketing landing page" --body "..."
gh pr merge --auto --squash
```
