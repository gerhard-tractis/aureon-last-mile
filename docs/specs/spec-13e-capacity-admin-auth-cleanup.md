# Spec-13e: Capacity, Admin, Auth & Cleanup

> **Status:** brainstorming
> **Parent:** spec-13 (design language)
> **Depends on:** spec-13a (foundation components)
> **Phase:** 5 of 5

## Goal

Restyle remaining pages (capacity planning, admin, auth) and perform final cleanup: remove all inline hex colors, legacy theme references, and inconsistent patterns.

---

## Part 1: Capacity Planning

**Route:** `/app/capacity-planning`

### Deliverables

#### 1. Calendar Restyle

**Existing:** `CapacityCalendar.tsx`, `CapacityCell.tsx`
**Action:** Restyle with spec-11 tokens

- Calendar grid: `bg-surface border border-border rounded-md`
- Day headers: `text-xs font-semibold text-text-muted uppercase`
- Capacity cells colored by utilization:
  - `< 80%`: `bg-status-success-bg border-status-success-border`
  - `80-95%`: `bg-status-warning-bg border-status-warning-border`
  - `> 95%`: `bg-status-error-bg border-status-error-border`
- Today: `ring-2 ring-accent`
- Values: `font-mono text-sm`

#### 2. Alert Panel → Sheet

**Existing:** `CapacityAlertPanel.tsx`
**Action:** Convert from custom modal to shadcn Sheet

- Slide-out from right
- Alert items use status tokens
- Dismiss action with confirmation

#### 3. Alert Bell

**Existing:** `CapacityAlertBell.tsx`
**Action:** Move from header to floating position

- Top-right of main content area: `fixed top-4 right-4 z-10`
- Only visible when active alerts exist
- Badge count: `bg-status-error text-white text-[10px] rounded-full`

#### 4. Supporting Components

- `CapacityBulkFill.tsx` → restyle form inputs with spec-11 tokens
- `CapacityUtilizationSummary.tsx` → use `MetricCard` components
- `CapacityAccuracyRanking.tsx` → use `DataTable`

---

## Part 2: Admin

### Users Page

**Route:** `/admin/users`

**Existing:** `UserManagementPage.tsx`, `UserTable.tsx`, `UserListHeader.tsx`, `UserForm.tsx`, `DeleteConfirmationModal.tsx`

#### 1. User Table → DataTable

- Columns: Name, Email, Role (Badge), Status (StatusBadge), Created (mono)
- Filter chips: role, status
- Search by name/email

#### 2. User Form → Sheet

**Existing:** `UserForm.tsx`
**Action:** Render inside shadcn Sheet (slide-out from right)

- Create new user: empty form in Sheet
- Edit user: pre-filled form in Sheet
- Form inputs use spec-11 token styling

#### 3. Delete Confirmation

**Existing:** `DeleteConfirmationModal.tsx`
**Action:** Keep as AlertDialog, restyle with tokens

- Destructive button: `bg-destructive text-destructive-foreground`

### Admin Audit Logs

**Route:** `/admin/audit-logs`

**Existing:** `admin/AuditLogTable.tsx`, `admin/AuditLogFilters.tsx`
**Action:** Same treatment as app-level audit logs (spec-13c). Use `DataTable`.

---

## Part 3: Auth Pages

**Routes:** `/auth/login`, `/auth/register`, `/auth/2fa`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`

### Standalone Layout (no sidebar)

- Centered card: `max-w-sm mx-auto mt-20`
- Card: `bg-surface border border-border rounded-lg p-8`
- Logo: centered above card, 48px height
- Page background: `bg-background`

### Form Styling

- Inputs: shadcn `Input` with `bg-surface border-border`
- Labels: `text-sm font-medium text-text`
- Primary button: `w-full bg-accent text-accent-foreground hover:opacity-90`
- Secondary/link: `text-accent hover:underline`
- Error messages: `text-sm text-status-error`
- SSO buttons (`SSOButtons.tsx`): `bg-surface border border-border` with provider icon

### Per-Page Notes

- **Login:** email + password + remember me + SSO buttons + forgot password link
- **Register:** name + email + password + confirm password
- **2FA:** code input (6 digits, Geist Mono, large), verify button
- **Forgot Password:** email input + submit
- **Reset Password:** new password + confirm + submit
- **Verify Email:** status message + resend link

---

## Part 4: Orders & Settings Pages

### Orders Import (`/app/orders/import`)

**Existing:** `FileUploadForm.tsx`, `ValidationErrorDisplay.tsx`
**Action:** Wrap in `PageShell`, restyle with spec-11 tokens

- File upload area: `bg-surface border-2 border-dashed border-border rounded-lg p-8`
- Drag active: `border-accent bg-accent/5`
- Validation errors: `text-status-error`

### Orders New (`/app/orders/new`)

**Existing:** `ManualOrderForm.tsx`
**Action:** Wrap in `PageShell`, restyle form inputs

- Form: shadcn Input/Select/Textarea with spec-11 tokens
- Submit: `bg-accent text-accent-foreground`

### User Settings (`/app/user-settings`)

**Action:** Wrap in `PageShell`, restyle with spec-11 tokens

- Form sections with `Separator` between them
- Toggle switches for preferences

---

## Part 5: Global Cleanup

> **Note:** The global cleanup (removing ALL inline hex, ensuring ALL pages have skeleton/empty states) can only be fully completed after phases 2-4 are done. The page-specific work in Parts 1-4 of this spec is independent of phases 2-4.

### 1. Remove all inline hex colors

Search and replace all `text-[#hex]`, `bg-[#hex]`, `border-[#hex]` with semantic token classes.

**Common replacements:**
| Inline | Token |
|--------|-------|
| `text-[#10b981]` | `text-status-success` |
| `text-[#f59e0b]` | `text-status-warning` |
| `text-[#ef4444]` | `text-status-error` |
| `bg-[#f8fafc]` | `bg-background` |
| `text-[#64748b]` | `text-text-secondary` |
| `text-[#94a3b8]` | `text-text-muted` |
| `border-[#e2e8f0]` | `border-border` |

### 2. Remove legacy references

- Remove any remaining `primary-50`…`primary-900` class usages
- Remove `NEXT_PUBLIC_THEME` from `.env.example` if present
- Remove old `theme-*` class references if any survive in JS

### 3. Consistent loading states

Every page/table/card that fetches data must have a skeleton or spinner:
- Tables: `DataTableSkeleton`
- Metric cards: skeleton matching `MetricCard` dimensions
- Pages: `PageShell` + skeletons

### 4. Consistent empty states

Every list/table page must handle zero data with `EmptyState`:
- Pickup list: "No hay cargas pendientes" + icon
- Reception list: "No hay recepciones" + icon
- Operations table: "No hay ordenes" + filter reset CTA
- Audit logs: "No hay eventos" + adjust filters CTA

## Acceptance Criteria

- [ ] Capacity calendar uses status token colors for utilization
- [ ] Alert panel is a Sheet, alert bell is floating
- [ ] Admin user table uses `DataTable`, form uses Sheet
- [ ] Auth pages centered card layout, gold accent buttons, Geist typography
- [ ] Zero inline hex colors remain in `src/` (verify with grep)
- [ ] Zero `primary-50`…`primary-900` references remain
- [ ] Every fetchable list/table has skeleton + empty state
- [ ] All Vitest tests pass
- [ ] Build succeeds
