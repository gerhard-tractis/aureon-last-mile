# Nav Restructure: Operaciones & Analítica as Sidebar Sub-Items

## Problem

Operaciones (6 pipeline steps) and Analítica (3 analytics views) are crammed into a single horizontal sub-tab bar inside Dashboard. This is cluttered and confusing.

## Design

### Sidebar (AppLayout.tsx)

"Dashboard" becomes a collapsible group with a chevron. Two sub-items:

- **Operaciones** → `/app/dashboard/operaciones`
- **Analítica** → `/app/dashboard/analitica`

The group auto-expands when the current pathname starts with `/app/dashboard`. The active sub-item highlights based on pathname match.

### Routes

| Route | Default tab | Available tabs |
|-------|------------|----------------|
| `/app/dashboard` | Redirects → `/app/dashboard/operaciones?tab=loading` | — |
| `/app/dashboard/operaciones` | `loading` | `loading`, `pickup`, `reception`, `distribution`, `routing`, `lastmile` |
| `/app/dashboard/analitica` | `otif` | `otif`, `unit_economics`, `cx` |

Legacy redirect: `/app/dashboard?tab=delivery` → `/app/dashboard/operaciones?tab=lastmile`

### Components

- **PipelineNav** replaced by a single reusable `SubTabNav` component that accepts a `tabs` prop
- **`operaciones/page.tsx`** — renders SubTabNav (6 ops tabs) + tab content (LoadingTab, DeliveryTab)
- **`analitica/page.tsx`** — renders SubTabNav (3 analytics tabs) + tab content (OtifTab, UnitEconomicsTab, CxTab)
- **`dashboard/page.tsx`** — becomes a redirect to `/app/dashboard/operaciones`

### Defaults

- Operaciones defaults to `loading`
- Analítica defaults to `otif`

## Out of Scope

- Dark mode pass (separate follow-up)
- New tab content (only restructuring navigation)
