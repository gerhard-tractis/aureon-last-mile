# Story 3.7: Implement Export Functionality (CSV/PDF Reports)

Status: done

## Story

As a business owner,
I want to export dashboard data as CSV or PDF reports,
so that I can share performance data with stakeholders and use in presentations.

## Acceptance Criteria

### AC1: Export Button & Modal
**Given** I am viewing the complete dashboard with all metrics loaded
**When** I click the "Exportar Reporte" button below the SecondaryMetricsGrid
**Then** A modal opens (use shadcn Dialog wrapper from `@/components/ui/dialog`) with export options:
- Format: CSV or PDF radio buttons (CSV default)
- Date Range: "Últimos 7 días", "Últimos 30 días", "Últimos 90 días" dropdown (default 30)
- Sections checkboxes (all checked by default): "Resumen SLA", "Métricas Primarias", "Tabla de Clientes", "Análisis de Fallos", "Métricas Secundarias"
- File name: editable text field, default `aureon-dashboard-YYYY-MM-DD`
- "Exportar" primary button, "Cancelar" secondary button

### AC2: CSV Export
**When** I select CSV format and click "Exportar"
**Then** A CSV file downloads containing clearly labeled sections separated by blank rows:
- Section 1 — SLA Summary: metric, value, change columns
- Section 2 — Primary Metrics: FADR %, Claims CLP, Avg Delivery Time
- Section 3 — Customer Table: all columns with current sort preserved
- Section 4 — Failed Deliveries: top failure reasons with count and percentage
- Section 5 — Secondary Metrics: Capacity %, Orders/Hour
**And** CSV uses BOM prefix (`\ufeff`) for Excel compatibility (match existing pattern in `CustomerPerformanceTable.tsx`)
**And** Fields with commas/quotes are properly escaped (reuse `escapeCSVField` from `CustomerPerformanceTable.tsx`)

### AC3: PDF Export
**When** I select PDF format and click "Exportar"
**Then** A formatted PDF downloads with:
- Header: "Aureon Performance Dashboard" + date range + generation timestamp
- Tractis color scheme (gold #e6c15c, slate #5e6b7b)
- All selected sections with data tables (NOT chart images — keep it simple)
- Page numbers and footer: "Generado por Aureon Last Mile"
- Professional table formatting with alternating row colors
**And** PDF is generated client-side using `jsPDF` (architecture decision: client-side PDF)

### AC4: Export Progress
**When** export is generating
**Then** Button shows spinner + "Generando..." text (disabled state)
**And** On success: `sonner` toast "Reporte descargado: [filename]"
**And** Download starts automatically via Blob URL

### AC5: Audit Logging
**When** export completes successfully
**Then** Insert into `audit_logs` table: `action: 'EXPORT_DASHBOARD'`, `resource_type: 'report'`, `details: { format, filename, sections, dateRange }`
**And** Audit log failure does NOT block the export (non-blocking, match existing pattern)

### AC6: Edge Cases
- No data for selected sections → Include section header with "Sin datos para este período"
- PDF generation fails → Fallback to CSV with toast warning "Error generando PDF. Descargando CSV."
- >1000 customer rows → Include all rows (no pagination in export)
- User cancels during generation → Abort cleanly, no partial download

### AC7: Accessibility
- Modal uses shadcn `Dialog` wrapper from `@/components/ui/dialog` (already used by `MetricDrillDownDialog`, `SLADrillDownDialog`, and other dashboard components — provides `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose`)
- All form controls have labels
- Escape key closes modal
- Focus trapped inside modal

## Tasks / Subtasks

- [x] Task 1: Install jsPDF (AC: #3)
  - [x] `npm install jspdf` in `apps/frontend` (types are bundled — do NOT install `@types/jspdf`)
- [x] Task 2: Create ExportModal component (AC: #1, #7)
  - [x] Build `ExportDashboardModal.tsx` with format/dateRange/sections/filename controls
  - [x] Wire up open/close state
- [x] Task 3: Create CSV export utility (AC: #2)
  - [x] Build `exportDashboardCSV` function in `lib/utils/exportDashboard.ts`
  - [x] Reuse `escapeCSVField` pattern from CustomerPerformanceTable
  - [x] Multi-section CSV with labeled sections separated by blank rows
- [x] Task 4: Create PDF export utility (AC: #3)
  - [x] Build `exportDashboardPDF` function in `lib/utils/exportDashboard.ts`
  - [x] Tractis branding (colors, header, footer, page numbers)
  - [x] Table formatting with jsPDF (no autoTable plugin — keep dependencies minimal)
- [x] Task 5: Integrate into dashboard page (AC: #1, #4, #5)
  - [x] Add "Exportar Reporte" button below SecondaryMetricsGrid in `page.tsx`
  - [x] Wire modal with data fetching hooks
  - [x] Add audit logging on successful export
- [x] Task 6: Write tests (AC: all)
  - [x] Test ExportDashboardModal renders and controls work
  - [x] Test CSV generation produces correct multi-section output
  - [x] Test PDF export function is called with correct params
  - [x] Test audit log fires on export
  - [x] Test fallback from PDF to CSV on error

## Dev Notes

### Architecture Decisions
- **PDF generation: client-side jsPDF** — Architecture doc mandates client-side jsPDF for offline capability. Do NOT use server-side generation.
- **Prefer jsPDF core API for tables** — Start with manual table drawing. If it becomes too complex (column alignment, text wrapping, page breaks mid-row), `jspdf-autotable` (~15KB) is an acceptable fallback. Do NOT pre-install it — only add if manual approach fails.
- **Charts as data tables in PDF** — Do NOT attempt to render recharts as images in PDF. Show the data in tabular format instead. This is simpler and more reliable.

### Existing Patterns to Reuse

**CSV pattern from `CustomerPerformanceTable.tsx:36-61`:**
```typescript
// Reuse this exact pattern:
function escapeCSVField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || /^[=+\-@\t\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// BOM + Blob + anchor click download:
const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url);
```

**Audit log pattern from `CustomerPerformanceTable.tsx:143-151`:**
```typescript
try {
  await (createSPAClient().from('audit_logs').insert as CallableFunction)({
    action: 'EXPORT_DASHBOARD',
    resource_type: 'report',
    details: { format, filename, sections, dateRange },
  });
} catch {
  // Non-blocking — export still succeeds
}
```

**Toast pattern (sonner):**
```typescript
import { toast } from 'sonner';
toast.success('Reporte descargado: ' + filename);
toast.error('Error generando PDF. Descargando CSV.');
```

### Data Collection Strategy

**The export modal has its OWN date range selector (7/30/90 days).** This is independent from the date ranges used by each dashboard component:
- `HeroSLA`, `PrimaryMetricsGrid`, `SecondaryMetricsGrid` → hardcoded 7 days via `getDashboardDates()` from `hooks/useDashboardDates.ts`
- `FailedDeliveriesAnalysis` → own state, default 30 days
- `CustomerPerformanceTable` → own state, default 7 days

**Therefore the export MUST re-fetch data for the user's chosen date range.** You cannot reuse data from existing components because their date ranges differ.

**Recommended approach:** Create a `useExportData` hook in `useDashboardMetrics.ts` that accepts `startDate`/`endDate` from the modal's date range selection and calls the underlying data-fetching logic with those dates. The hook should be `enabled` only when the modal is open and the user clicks "Exportar" (use a trigger flag to avoid fetching on modal open).

```typescript
export type DashboardExportData = {
  sla: { value: number | null; prevValue: number | null; totalOrders: number; deliveredOrders: number };
  fadr: { value: number | null; prevValue: number | null; firstAttempt: number; total: number };
  claims: { count: number; amount: number; prevCount: number; prevAmount: number } | null;
  avgDeliveryTime: number | null;
  prevAvgDeliveryTime: number | null;
  customers: CustomerPerformanceRow[];
  failureReasons: FailureReasonRow[];
  secondary: SecondaryMetrics | null;
  prevSecondary: SecondaryMetrics | null;
};

// Hook accepts modal's date range, NOT getDashboardDates()
export function useExportData(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  enabled: boolean  // only fetch when user triggers export
) {
  // Compute previous period: same length, immediately before startDate
  // Use subDays from date-fns (already imported)
  // Call existing hooks: useSlaMetric, useFadrMetric, useShortageClaimsMetric,
  //   useAvgDeliveryTimeMetric, useCustomerPerformance, useFailureReasons,
  //   useSecondaryMetrics + their previous-period counterparts
  // Return consolidated DashboardExportData
}
```

**Previous period calculation:** Mirror the pattern in `getDashboardDates()` from `hooks/useDashboardDates.ts`:
```typescript
// getDashboardDates() returns:
// startDate = today - 6 days, endDate = today
// prevStartDate = today - 13 days, prevEndDate = today - 7 days
// For export: calculate prevStart/prevEnd based on modal's chosen range
const dayCount = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
const prevEndDate = format(subDays(parseISO(startDate), 1), 'yyyy-MM-dd');
const prevStartDate = format(subDays(parseISO(startDate), dayCount), 'yyyy-MM-dd');
```

### File Structure

**Files to CREATE:**
- `apps/frontend/src/components/dashboard/ExportDashboardModal.tsx` — Modal with form controls + export trigger
- `apps/frontend/src/components/dashboard/ExportDashboardModal.test.tsx` — Tests
- `apps/frontend/src/lib/utils/exportDashboard.ts` — CSV + PDF generation utilities

**Files to MODIFY:**
- `apps/frontend/src/hooks/useDashboardMetrics.ts` — Add `useExportData` hook + `DashboardExportData` type
- `apps/frontend/src/app/app/dashboard/page.tsx` — Add export button + modal, pass data
- `apps/frontend/package.json` — Add `jspdf` dependency

**Files to NOT touch:**
- CustomerPerformanceTable.tsx (has its own CSV export — leave it independent)
- Any other existing dashboard components
- MetricsCard.tsx, MetricsCardSkeleton.tsx
- FailedDeliveriesAnalysis.tsx and child charts
- SecondaryMetricsGrid.tsx

### Spanish UI Text (exact strings)

- Button: "Exportar Reporte"
- Modal title: "Exportar Dashboard"
- Format label: "Formato"
- Format options: "CSV", "PDF"
- Date range label: "Rango de Fechas"
- Date range options: "Últimos 7 días", "Últimos 30 días", "Últimos 90 días"
- Sections label: "Secciones a incluir"
- Section checkboxes: "Resumen SLA", "Métricas Primarias", "Tabla de Clientes", "Análisis de Fallos", "Métricas Secundarias"
- Filename label: "Nombre del archivo"
- Export button: "Exportar"
- Cancel button: "Cancelar"
- Generating state: "Generando..."
- Success toast: "Reporte descargado: [filename]"
- Error toast: "Error generando PDF. Descargando CSV."
- Empty section: "Sin datos para este período"
- PDF header: "Aureon Performance Dashboard"
- PDF footer: "Generado por Aureon Last Mile"

### Styling Requirements
- Modal: `max-w-lg`, white bg, rounded-xl, shadow-lg
- Export button in dashboard: Below SecondaryMetricsGrid, `bg-slate-700 hover:bg-slate-800 text-white px-6 py-3 rounded-lg font-medium`
- Checkboxes: standard HTML checkboxes with Tailwind styling
- Radio buttons: standard HTML radios with Tailwind styling
- Keep it simple — NO need for shadcn/ui form components. Plain HTML + Tailwind is fine for this modal.

### Common Mistakes to Avoid
- Do NOT use `window.print()` for PDF — use jsPDF programmatic generation
- Do NOT try to screenshot/canvas-capture recharts — render data as tables in PDF
- Do NOT install `jspdf-autotable` initially — use jsPDF core API for table drawing. If manual tables prove too complex/buggy, `jspdf-autotable` is an acceptable fallback (~15KB).
- Do NOT create a new Supabase client at module level — always `createSPAClient()` inside functions
- Do NOT assume the modal can reuse data from existing components — each component has its own date range (7/30/90 days). The export modal MUST fetch its own data for the user's chosen date range via `useExportData`.
- Do NOT add the export button inside any existing component — add it in `page.tsx` directly
- Do NOT modify the existing CSV export in CustomerPerformanceTable — it stays independent
- Do NOT import from `@radix-ui/react-dialog` directly — use the shadcn wrapper at `@/components/ui/dialog`
- Do NOT install `@types/jspdf` — jsPDF ships bundled TypeScript types

### Previous Story Intelligence (3.5 + 3.6)

**From Story 3.5 (done):**
- Charting library is **recharts** v2.15.0, NOT Chart.js (despite epic title)
- Hooks all live in `useDashboardMetrics.ts` — extend, don't create new files
- `createSPAClient()` always called inside `queryFn`, never at module level
- Tests use `@testing-library/react` + `vitest`, mock Supabase client
- `MetricDrillDownDialog` exists for drill-down patterns
- `sonner` for toast notifications
- 17 tests, all passing

**From Story 3.6 (ready-for-dev):**
- Secondary metrics use hardcoded capacity (1000/day) and hours (10h/day)
- Two cards only (capacity + orders/hour), cost/delivery and satisfaction deferred
- Reuses `MetricsCard` and `MetricsCardSkeleton` from 3.3

**Git patterns from recent commits:**
- Feature branches: `feat/story-3.x-description`
- Commit style: `feat(dashboard): description (Story 3.X)`
- CI runs: type-check + lint + build + test
- All stories verify CI before marking done

### Key Existing Files Reference
- `hooks/useDashboardDates.ts` — exports `getDashboardDates()` → `{ startDate, endDate, prevStartDate, prevEndDate }` (hardcoded 7-day window). Use `subDays`/`differenceInDays` from `date-fns` to compute export's own previous period.
- `components/ui/dialog.tsx` — shadcn wrapper exporting `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogPortal, DialogOverlay, DialogTrigger`
- `lib/utils/ipAddress.ts` — only existing file in `lib/utils/` dir

### Project Structure Reference
```
apps/frontend/src/
├── app/app/dashboard/page.tsx          ← ADD export button + modal here
├── components/
│   ├── ui/dialog.tsx                    ← USE THIS for modal (shadcn wrapper)
│   └── dashboard/
│       ├── ExportDashboardModal.tsx      ← NEW
│       ├── ExportDashboardModal.test.tsx ← NEW
│       ├── CustomerPerformanceTable.tsx  ← DO NOT MODIFY (has own CSV export)
│       ├── FailedDeliveriesAnalysis.tsx  ← DO NOT MODIFY
│       ├── SecondaryMetricsGrid.tsx      ← DO NOT MODIFY
│       └── ... other existing components
├── hooks/
│   ├── useDashboardMetrics.ts           ← ADD useExportData hook + DashboardExportData type
│   └── useDashboardDates.ts             ← REFERENCE ONLY (getDashboardDates pattern)
├── lib/
│   └── utils/
│       └── exportDashboard.ts           ← NEW (CSV + PDF utilities)
└── types/
```

### jsPDF Quick Reference

```typescript
import { jsPDF } from 'jspdf';

const doc = new jsPDF();
doc.setFontSize(20);
doc.setTextColor('#5e6b7b');  // Tractis slate
doc.text('Aureon Performance Dashboard', 20, 20);

// Table drawing (manual — no autoTable):
let y = 40;
const lineHeight = 8;
doc.setFontSize(10);
headers.forEach((h, i) => doc.text(h, 20 + i * 40, y));
y += lineHeight;
rows.forEach(row => {
  row.forEach((cell, i) => doc.text(String(cell), 20 + i * 40, y));
  y += lineHeight;
  if (y > 270) { doc.addPage(); y = 20; } // page break
});

doc.setFontSize(8);
doc.text('Generado por Aureon Last Mile', 20, 285);
doc.save(filename + '.pdf');
```

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Test fix: `getByText('CSV')` → `getByDisplayValue('csv')` (CSS uppercase vs DOM text)
- Test fix: `vi.clearAllMocks()` → added `vi.restoreAllMocks()` to prevent spy leaks across describe blocks

### Completion Notes List
- Task 1: Installed jsPDF 3.x in apps/frontend (bundled types, no @types needed)
- Task 2: ExportDashboardModal with shadcn Dialog, format radios (CSV default), date range dropdown (7/30/90 days, default 30), 5 section checkboxes (all checked by default), editable filename field
- Task 3: `generateCSV` + `downloadCSV` in exportDashboard.ts — multi-section CSV with BOM prefix, `escapeCSVField` reused from CustomerPerformanceTable pattern, blank-row section separators, "Sin datos para este período" for empty sections
- Task 4: `generatePDF` in exportDashboard.ts — jsPDF core API (no autoTable plugin), Tractis gold/slate branding, header + date range + timestamp, per-section tables with alternating row colors, page numbers, "Generado por Aureon Last Mile" footer
- Task 5: "Exportar Reporte" button added below SecondaryMetricsGrid in page.tsx, ExportDashboardModal wired with useExportData hook (fetches own data for modal's date range), audit log insert on success (non-blocking), spinner "Generando..." state, toast notifications, PDF→CSV fallback on error, abort on cancel
- Task 6: 18 tests — modal rendering, form controls, section toggles, CSV export trigger, PDF export trigger, PDF→CSV fallback, audit log fire, cancel behavior, CSV content generation (all sections, escaping, section toggles, empty data), PDF generation (no-throw with data, no-throw with empty data)
- Full suite: 540 tests passing (35 files), 0 regressions
- Created `useExportData` hook in useDashboardMetrics.ts that aggregates all dashboard hooks with the modal's own date range + computed previous period

### Senior Developer Review (AI)

**Review Date:** 2026-03-03
**Review Outcome:** Changes Requested → Fixed
**Action Items:** 6 found (3H, 3M), all resolved

#### Action Items
- [x] [H1] useExportData fires 13 queries on modal open — gated operatorId with enabled flag
- [x] [H2] computeDates not memoized — wrapped in useMemo
- [x] [H3] PDF fallback preserves .pdf extension — strip .pdf before CSV download
- [x] [M1] Abort mechanism is cosmetic dead code — removed abortRef
- [x] [M2] CSV section headers not escaped — routed through csvRow()
- [x] [M3] Inner hooks not gated by enabled — fixed via gatedOperatorId (same fix as H1)

### Change Log
- 2026-03-03: Implemented export functionality (CSV/PDF) — Story 3.7
- 2026-03-03: Code review fixes — 6 issues resolved (3H, 3M)

### File List
- apps/frontend/package.json (MODIFIED — added jspdf dependency)
- apps/frontend/package-lock.json (MODIFIED — lockfile update)
- apps/frontend/src/lib/utils/exportDashboard.ts (NEW — CSV + PDF generation utilities)
- apps/frontend/src/components/dashboard/ExportDashboardModal.tsx (NEW — export modal component)
- apps/frontend/src/components/dashboard/ExportDashboardModal.test.tsx (NEW — 18 tests)
- apps/frontend/src/hooks/useDashboardMetrics.ts (MODIFIED — added useExportData hook + DashboardExportData type)
- apps/frontend/src/app/app/dashboard/page.tsx (MODIFIED — added export button + modal integration)
