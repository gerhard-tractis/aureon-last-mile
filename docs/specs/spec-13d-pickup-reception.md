# Spec-13d: Pickup & Reception Redesign (Mobile-First)

> **Status:** brainstorming
> **Parent:** spec-13 (design language)
> **Depends on:** spec-13a (foundation components)
> **Phase:** 4 of 5

## Goal

Redesign pickup and reception flows with touch-optimized mobile patterns. Field workers use these on phones in warehouses — larger targets, simpler layouts, clear progress indicators.

---

## Part 1: Pickup Flow

### Routes

- `/app/pickup` — pickup list
- `/app/pickup/scan/[loadId]` — barcode scanning
- `/app/pickup/review/[loadId]` — review scanned packages
- `/app/pickup/handoff/[loadId]` — handoff to driver
- `/app/pickup/complete/[loadId]` — completion confirmation

### Mobile Pattern (Primary)

**Step progress breadcrumb:** `Pickup > Scan > Review > Handoff > Complete`
- Uses shadcn `Breadcrumb` component
- Current step: `text-accent font-semibold`
- Completed steps: `text-text-secondary` with checkmark
- Future steps: `text-text-muted`

**Gold header bar (all steps):**
- `bg-accent text-accent-foreground p-4`
- Load ID: `text-xs opacity-80`
- Progress: `font-mono text-xl font-bold` ("12 / 18")
- Progress bar: `bg-white/20 rounded h-1.5`, fill `bg-white`

#### 1. Pickup List (`/app/pickup`)

**Existing:** pickup page with load cards
**Action:** Restyle

- `PageShell` with "Pickup" title
- Load cards: `bg-surface border border-border rounded-lg p-4`
- Each card: load ID (mono), client name, package count, status badge
- Desktop: `DataTable` view
- Mobile: card stack

#### 2. Scan Page (`/app/pickup/scan/[loadId]`)

**Existing:** `ScannerInput.tsx`, `ScanHistoryList.tsx`, `ScanResultPopup.tsx`
**Action:** Touch-optimize

- Gold header bar with progress
- Scan button: `bg-accent rounded-lg p-3 text-center text-base font-medium` (large, centered)
- Package cards below:
  - Card: `bg-surface border rounded-lg p-3`
  - Touch target: 48px minimum height
  - Scanned: `border-status-success-border`, green circle checkmark (28px)
  - Pending: `border-border`, gray circle dash
  - Package ID: `font-mono text-sm font-semibold`
  - Client + weight: `text-xs text-text-secondary`
- Scan result popup: `ScanResultPopup.tsx` restyled with status tokens

#### 3. Review Page (`/app/pickup/review/[loadId]`)

**Existing:** `ManifestCard.tsx`, `ManifestDetailList.tsx`, `DiscrepancyItem.tsx`
**Action:** Restyle

- Gold header: "Review" step
- Summary card: total scanned vs expected, discrepancy count
- Discrepancy items: `bg-status-warning-bg border-status-warning-border rounded-lg p-3`
- Confirm button: full-width `bg-accent` at bottom

#### 4. Handoff Page (`/app/pickup/handoff/[loadId]`)

**Existing:** `SignaturePad.tsx`
**Action:** Restyle

- Gold header: "Handoff" step
- Driver info card
- Signature pad: full-width, `border-2 border-border rounded-lg`
- Submit button: full-width `bg-accent`

#### 5. Complete Page (`/app/pickup/complete/[loadId]`)

**Existing:** completion confirmation
**Action:** Restyle

- Success illustration / checkmark
- Summary: packages handed off, timestamp
- "Back to Pickup List" button

### Desktop Pattern

Same flow structure but:
- Scanner input is a text field (not full-screen button)
- Package list in narrower DataTable format
- Wider card layouts with side-by-side information

---

## Part 2: Reception Flow

### Routes

- `/app/reception` — reception list
- `/app/reception/scan/[receptionId]` — QR/barcode scanning
- `/app/reception/complete/[receptionId]` — completion

### Components

**Existing:** `ReceptionList.tsx`, `ReceptionCard.tsx`, `ReceptionDetailList.tsx`, `ReceptionScanner.tsx`, `ReceptionSummary.tsx`, `QRScanner.tsx`, `QRHandoff.tsx`

### Deliverables

#### 1. Reception List

- `PageShell` with "Recepcion" title
- Desktop: `DataTable` with columns: Reception ID (mono), Origin, Expected Pkgs (mono), Status (badge), Time (mono)
- Mobile: card stack matching pickup card pattern

#### 2. Reception Scan

- Same touch-optimized pattern as pickup scan
- QR scanner: full-viewport camera view on mobile, inline on desktop
- Scanned package cards with checkmarks

#### 3. Reception Complete

- Summary card with totals
- Discrepancy report if any
- Confirmation button

## Acceptance Criteria

- [ ] Breadcrumb step progress shows current position in flow
- [ ] Gold header bar with progress on all pickup/reception scan pages
- [ ] Scan button: large, centered, 48px+ touch target
- [ ] Package cards: 48px min height, chunky checkmarks, monospace IDs
- [ ] Discrepancy items use warning status tokens
- [ ] Signature pad renders full-width on mobile
- [ ] QR scanner is full-viewport on mobile
- [ ] Desktop: text input scanner, DataTable package list
- [ ] All Vitest tests pass
- [ ] Build succeeds
