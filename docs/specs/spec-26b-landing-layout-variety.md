# Spec-26b: Landing Layout Variety & Visual Assets

> **Status:** backlog
> **Depends on:** spec-26a (landing foundation)
> **Layer:** 2 of 3 (see also: spec-26a, spec-26c)

## Goal

Break the visual monotony of the landing page. Currently every section follows the same pattern: eyebrow, h2, paragraph, card grid. This spec gives each section a distinct layout, adds a stylized dashboard placeholder to the hero, and introduces chat bubbles for agent example messages.

---

## Changes

### 1. MetricsShowcase — Asymmetric Layout

Switch from 3 equal-width columns to a featured + secondary layout:

```
Desktop (md+):
┌─────────────────────────┬──────────────┐
│         CPO             │     OTIF     │
│  (horizontal layout:    ├──────────────┤
│   metric left,          │     NPS      │
│   drivers right)        │              │
└─────────────────────────┴──────────────┘
```

- Grid becomes `md:grid-cols-3` with CPO card at `md:col-span-2`
- CPO card interior: `flex md:flex-row` — left side has abbr + name + description, right side has drivers tags. Gold top bar spans full width.
- OTIF and NPS cards remain vertical, stacked in the remaining `md:col-span-1` column
- Mobile: all three cards stack vertically (unchanged)

### 2. Features/Agentes — Split Layout with Chat Bubbles

Switch from 2x2 card grid to a split layout:

```
Desktop (md+):
┌──────────────────┬──────────────────────────┐
│  Section header  │  Agent card 1            │
│  + description   │  Agent card 2            │
│  (sticky)        │  Agent card 3            │
│                  │  Agent card 4            │
└──────────────────┴──────────────────────────┘
```

- Left column: `md:w-2/5 md:sticky md:top-24` — contains eyebrow, h2, and description paragraph
- Right column: `md:w-3/5` — 4 agent cards stacked vertically with `gap-6`

**Chat bubble component** — New `(landing)/components/chat-bubble.tsx`:

```
┌──────────────────────────────────────┐
│ 🤖  Aureon                    14:32  │
│                                      │
│ "Hola Maria, tu pedido #4521..."     │
└──────────────────────────────────────┘
```

- Container: `bg-emerald-950/30 border border-emerald-500/15 rounded-xl rounded-tl-sm p-4`
- Top row: small bot icon (Lucide `Bot`, `w-4 h-4 text-emerald-400`), "Aureon" label in `text-xs text-emerald-400`, timestamp right-aligned in `text-xs text-stone-600`
- Message body: `text-sm text-stone-300 leading-relaxed mt-2`
- Agent cards with a non-null `example` field render the `ChatBubble` below the description
- Agent cards without `example` render as before (no bubble)

### 3. HowItWorks — Connected Timeline for `steps` + Feature Grid Unchanged

The component has two distinct sections: `steps` (4-item process flow: Pickup → Recepcion → Distribucion → Despacho) and `feats` (4-item feature grid with icons). Only the `steps` section changes layout. The `feats` grid below stays as a 4-column grid (unchanged — already distinct from the timeline above).

Replace the desktop `steps` row of identical boxes with `→` separators with a connected horizontal timeline:

```
Desktop (md+):
          ①──────────②──────────③──────────④
          │          │          │          │
       ┌──┴──┐   ┌──┴──┐   ┌──┴──┐   ┌──┴──┐
       │Card │   │Card │   │Card │   │Card │
       │     │   │(off)│   │     │   │(off)│
       └─────┘   └─────┘   └─────┘   └─────┘
```

- Horizontal line: `absolute` positioned `h-0.5 bg-amber-500/30` connecting the 4 numbered circles
- Numbered circles: `w-10 h-10 rounded-full bg-amber-500 text-stone-950` sitting on the line, `z-10`
- Content cards hang below each circle via `absolute` or flow positioning
- Even-numbered cards get a `mt-4` extra offset to create alternating rhythm
- Container uses `flex justify-between` with `relative` for the connecting line

Mobile: vertical stepper stays as-is (already good). The integration bar at the bottom of this section is also unchanged.

### 4. FounderSection — Editorial Quote

Add a decorative opening quotation mark behind the blockquote:

- `"` character in Instrument Serif (`font-display`) at `text-[120px] md:text-[180px]`
- Color: `text-amber-500/10`
- Position: `absolute -top-8 left-1/2 -translate-x-1/2` (centered above the quote)
- Container needs `relative` added
- Purely decorative — adds editorial flair without changing content

### 5. Hero — Dashboard Placeholder

New component `(landing)/components/dashboard-placeholder.tsx`:

An SVG-based stylized wireframe that communicates "intelligence + operations in one place":

**Left half — KPI metrics:**
- 3 small rectangles representing metric cards, labeled "CPO", "OTIF", "NPS" in `text-xs`
- Below: simplified sparkline/bar chart outlines using SVG `<path>` and `<rect>` elements
- Colors: `stroke-amber-500/40` for chart lines, `fill-stone-800` for card backgrounds

**Right half — Delivery timeline:**
- Vertical timeline with 4-5 small circles (delivery stops)
- Connecting lines between stops
- Small status indicators (filled/empty circles for completed/pending)
- A simplified route line using SVG `<path>`

**Frame:**
- Browser chrome: rounded-xl container with 3 small dots (red/yellow/green at `opacity-0.3`) in a top bar
- Background: `bg-stone-900/80 border border-stone-800`
- Gold glow: `shadow-[0_0_60px_rgba(230,193,92,0.08)]`

**Positioning in hero:**
- Placed below the proof stats bar
- `max-w-3xl mx-auto mt-12`
- Bottom portion bleeds into the next section: hero section removes `min-h-screen` bottom constraint, dashboard sits at `relative z-10`, and `value-props.tsx` adds `pt-20` top padding to accommodate the overlap

**TODO comment** at the top of the component: `// TODO: Replace with real product screenshot when available`

**Implementation note:** The SVG wireframe is a stylized illustration, not pixel-precise. The implementer should design it to feel "abstract dashboard" — recognizable shapes (rectangles for cards, lines for charts, circles for timeline nodes) but not a literal UI replica. Approximate dimensions: 800x400 viewBox. Use the existing palette tokens (`stroke-amber-500/40`, `fill-stone-800`, `stroke-stone-700`).

### 6. Hero — Proof Stats Floating Bar

Replace the flat `border-t border-stone-800` wrapper with:
- `bg-stone-900/50 backdrop-blur-sm rounded-2xl px-8 py-6`
- Remove `pt-8 border-t border-stone-800` from the current grid wrapper
- Add `mt-14` for spacing from CTAs

---

## Files Touched

All paths relative to `apps/frontend/`:

- `src/app/(landing)/components/hero.tsx` — proof stats floating bar, dashboard placeholder integration
- `src/app/(landing)/components/value-props.tsx` — add `pt-20` to accommodate hero dashboard bleed-through
- `src/app/(landing)/components/metrics-showcase.tsx` — asymmetric grid layout for CPO featured card
- `src/app/(landing)/components/features.tsx` — split layout (sticky left, cards right), chat bubble integration
- `src/app/(landing)/components/how-it-works.tsx` — connected timeline desktop layout for `steps` section
- `src/app/(landing)/components/founder-section.tsx` — decorative quotation mark
- **New:** `src/app/(landing)/components/chat-bubble.tsx`
- **New:** `src/app/(landing)/components/dashboard-placeholder.tsx`

**Not modified:** `integrations.tsx` — already has a distinct layout (horizontal badge row with "Y mas..." plug icon). No changes needed for layout variety.

## Dependencies

None new. All CSS + inline SVG.

## Acceptance Criteria

1. MetricsShowcase CPO card spans 2 columns with horizontal metric/drivers layout on desktop
2. Features section has sticky left header + stacked cards on the right on desktop
3. Agent cards with example messages render a green-tinted chat bubble
4. HowItWorks desktop shows a connected horizontal timeline with alternating card offsets
5. FounderSection has a large decorative quotation mark behind the blockquote
6. Hero displays a stylized dashboard wireframe below the proof stats
7. Dashboard placeholder has a TODO comment for future screenshot replacement
8. Proof stats render in a floating rounded bar (not flat border-top)
9. All sections stack properly on mobile (no broken layouts)
10. No two consecutive sections share the same grid pattern
