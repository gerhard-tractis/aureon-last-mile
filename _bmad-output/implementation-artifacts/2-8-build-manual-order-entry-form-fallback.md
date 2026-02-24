# Story 2.8: Build Manual Order Entry Form (Fallback)

**Epic:** 2 - Order Data Ingestion & Automation Worker
**Story ID:** 2.8
**Status:** review
**Created:** 2026-02-23

---

## Story

**As an** operations manager,
**I want** to manually enter a single order via a web form,
**So that** I can add orders when email and CSV fail or for one-off special deliveries.

---

## Acceptance Criteria

### AC1: Route Access and Role Guard
```gherkin
Given I am logged in as operations_manager or admin
When I navigate to /orders/new
Then I see the manual order entry form
And the form is fully interactive

Given I am logged in as any other role (driver, viewer, etc.)
When I navigate to /orders/new
Then I am shown an "Access Denied" message or redirected
And the form is not rendered
```

### AC2: Form Fields
```gherkin
Given I am on the /orders/new page
Then the form contains the following fields:
  - Order Number (required, text input)
  - Customer Name (required, text input)
  - Customer Phone (required, text input, placeholder: +56912345678 or 912345678)
  - Delivery Address (required, textarea)
  - Comuna (required, autocomplete dropdown from Chilean comuna list)
  - Delivery Date (required, date picker, no past dates allowed)
  - Delivery Window Start (optional, time picker)
  - Delivery Window End (optional, time picker)
  - Retailer Name (optional, dropdown: Falabella, Shopee, Mercado Libre, Ripley, Paris, Other)
  - Notes (optional, textarea, maps to orders.status_detail or raw_data.notes)
And a "Save Order" primary button (disabled until all required fields are valid)
And an "Add Another Order" secondary button (appears after successful submit)
```

### AC3: Real-Time Validation on Blur
```gherkin
Given I am filling in the form
When I leave (blur) the Customer Phone field
Then validation runs immediately
And if the phone is not 9 digits (accepting +56912345678 or 912345678 formats) an inline error appears below the field in red: "Phone must be 9 digits"

When I leave the Order Number field
Then an AJAX check queries the orders table for (operator_id, order_number) uniqueness
And if a duplicate exists an inline error appears: "Order #[order_number] already exists for this operator"

When I leave the Comuna field
Then the value is validated against the Chilean comuna list
And if invalid an inline error appears: "Please select a valid Chilean comuna"
```

### AC4: Order Creation on Submit
```gherkin
Given all required fields are valid
When I click "Save Order"
Then a new row is inserted into public.orders with:
  - imported_via = 'MANUAL'
  - imported_at = NOW() (set client-side or server-side via API route)
  - raw_data = { ...formValues, created_by: <authenticated user's UUID> }
  - operator_id = operator from the authenticated user's JWT claims
  - All mapped form fields populated (order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end,
    retailer_name)
And the order is saved successfully
```

### AC5: Success Feedback
```gherkin
Given I clicked "Save Order" and the insert succeeded
Then a success toast appears: "Order #[order_number] created successfully"
And the toast contains a link to the order detail page (if an orders detail page exists)
And an "Add Another Order" button appears to reset the form for the next entry
```

### AC6: Form Reset for Next Entry
```gherkin
Given the order was created successfully
When I click "Add Another Order"
Then the form resets to its empty initial state
And I can immediately enter another order
```

### AC7: Inline Validation Errors on Submit
```gherkin
Given I click "Save Order" with one or more required fields empty or invalid
Then the form does NOT submit
And validation errors display inline in red below each invalid field
And focus is moved to the first invalid field
```

### AC8: Submit Button State
```gherkin
Given the form is in any state
Then the "Save Order" button is disabled unless all required fields pass validation
And the button shows a loading spinner while the insert is in progress
And the button is disabled again during submission to prevent double-submit
```

---

## Edge Cases

- **Duplicate order_number:** AJAX blur check catches it early. If it slips through to submit (race condition), the DB UNIQUE constraint `(operator_id, order_number)` will reject the insert and the error must be caught and displayed inline: "Order #[order_number] already exists for this operator."
- **Invalid phone format:** Inline error on blur: "Phone must be 9 digits." Zod validation also blocks submit.
- **Future delivery date >30 days away:** Show a non-blocking warning (yellow, not red) after date is selected: "Delivery date is more than 30 days away. Confirm?" The submit button must still be enabled — this is a warning, not an error.
- **Missing required field on submit:** Focus the first invalid field, show its inline error message in red.
- **Delivery Window End before Start:** If both are provided, validate that end > start. Show inline error: "Window end must be after window start."
- **Network error on submit:** Show error toast: "Failed to save order. Please try again." Do not reset the form — preserve entered data.
- **Network error on duplicate AJAX check:** Fail silently (do not block form interaction), retry on submit.
- **Empty Notes field:** Omit from raw_data or store as null — do not send empty string.

---

## Tasks / Subtasks

### Task 1: Create Zod Schema for Manual Order Form (AC: #2, #3, #7, #8)
- [x] Create `apps/frontend/src/lib/validation/manualOrderSchema.ts`
- [x] Define `manualOrderSchema` with Zod:
  - `order_number`: `z.string().min(1, 'Order number is required')`
  - `customer_name`: `z.string().min(1, 'Customer name is required')`
  - `customer_phone`: `z.string().regex(/^(\+569|9)\d{8}$/, 'Phone must be 9 digits')` (accepts `+56912345678` or `912345678`)
  - `delivery_address`: `z.string().min(1, 'Delivery address is required')`
  - `comuna`: `z.string().refine(val => isValidComuna(val), { message: 'Please select a valid Chilean comuna' })` — import `isValidComuna` from `@/lib/data/chileanLocations`
  - `delivery_date`: `z.string().min(1, 'Delivery date is required').refine(val => new Date(val) >= new Date(todayISO), { message: 'Delivery date cannot be in the past' })` (date string `YYYY-MM-DD`) — **E4:** do not rely solely on the HTML `min` attribute; enforce past-date rejection in Zod as well. Define `todayISO` as `new Date().toISOString().slice(0, 10)` at module scope.
  - `delivery_window_start`: `z.string().optional().or(z.literal(''))` — **E1:** cleared time inputs submit `''` not `undefined`; use `.optional().or(z.literal(''))` or add a `.transform(val => val === '' ? undefined : val)` to convert empty strings to `undefined` before they reach the insert.
  - `delivery_window_end`: `z.string().optional().or(z.literal(''))` — same empty-string handling as above (**E1**).
  - `retailer_name`: `z.preprocess(val => val === '' ? undefined : val, z.enum(['Falabella', 'Shopee', 'Mercado Libre', 'Ripley', 'Paris', 'Other']).optional())` — **E2:** a placeholder `<option value=''>` submits `''`; `z.preprocess` converts that to `undefined` so the optional enum validates correctly.
  - `notes`: `z.string().optional()`
- [x] Add cross-field refinement: if `delivery_window_end` is set and `delivery_window_start` is set, end must be > start
- [x] Export `ManualOrderFormData` type from the schema
- [x] Export `RETAILER_OPTIONS` constant array for the dropdown

### Task 2: Create useOrders Hook (AC: #4)
- [x] Create `apps/frontend/src/hooks/useOrders.ts`
- [x] Implement `useCreateManualOrder()` mutation using TanStack Query `useMutation`:
  - Uses `createSPAClient()` from `@/lib/supabase/client`
  - Calls `supabase.from('orders').insert({ ...data, imported_via: 'MANUAL', imported_at: new Date().toISOString(), raw_data: { ...formValues, created_by: userId } })`
  - On success: invalidate any orders list queries
  - On error: surface the error for the form to display
- [x] Implement `checkOrderNumberDuplicate` — **E3:** this is a plain `async` function (NOT a hook) exported from `useOrders.ts`, not defined inline in the component. Export it directly: `export async function checkOrderNumberDuplicate(operatorId: string, orderNumber: string): Promise<boolean>`. The component imports and calls it. This keeps the component clean and makes the function independently testable.

### Task 3: Create ManualOrderForm Component (AC: #2, #3, #5, #6, #7, #8)
- [x] Create `apps/frontend/src/components/orders/ManualOrderForm.tsx`
- [x] Use `useForm<ManualOrderFormData>` from React Hook Form with `zodResolver(manualOrderSchema)`
- [x] Implement all form fields per AC2:
  - Text inputs for order_number, customer_name, customer_phone, delivery_address (textarea)
  - **Comuna autocomplete:** Use a `<datalist>` or a controlled `<input>` + `<datalist>` element backed by `ALL_COMUNAS` from `@/lib/data/chileanLocations`. Do NOT use a third-party autocomplete library unless one already exists in the project.
  - `<input type="date">` for delivery_date with `min={today}` attribute
  - `<input type="time">` for delivery_window_start and delivery_window_end (optional)
  - `<select>` for retailer_name using `RETAILER_OPTIONS`
  - `<textarea>` for notes
- [x] Wire blur handlers:
  - `onBlur` for `order_number`: call `useCheckOrderNumberDuplicate()`, set a local `orderNumberError` state if duplicate
  - `onBlur` for `customer_phone`: RHF + Zod handles inline validation
  - `onBlur` for `comuna`: RHF + Zod handles inline validation via `isValidComuna`
- [x] Implement >30-day delivery date warning: `useEffect` on `delivery_date` field value — if date is more than 30 days from today, set a local `dateWarning` state. Render as yellow warning text, not a red error.
- [x] Implement inline errors: render `{errors.field_name && <p className="mt-1 text-sm text-red-600" role="alert">{errors.field_name.message}</p>}` below each field (matches UserForm.tsx pattern)
- [x] Submit button: `disabled={!isValid || isPending || !!orderNumberError}` — **C6:** `isValid` from RHF reflects only Zod schema state; it does NOT include external async state like `orderNumberError`. The `!!orderNumberError` guard is mandatory to prevent submission when a duplicate order number has been detected.
- [x] On successful submit: show `toast.success(...)` via Sonner, show "Add Another Order" button, call `form.reset()`
- [x] On submit error: show `toast.error('Failed to save order. Please try again.')`, preserve form values
- [x] Apply existing Tailwind CSS classes matching UserForm.tsx: `px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c]`

### Task 4: Create /orders/new Page (AC: #1, #2)
- [x] Create `apps/frontend/src/app/app/orders/new/page.tsx`
- [x] This is a Next.js App Router page component (client component if role check needs session)
- [x] Implement role guard matching the pattern from `apps/frontend/src/app/app/orders/import/page.tsx`:
  ```tsx
  const ALLOWED_ROLES = ['admin', 'operations_manager'];
  // useEffect → supabase.auth.getSession() → check role from session?.user?.app_metadata?.claims?.role
  ```
- [x] Render `<ManualOrderForm />` if role is allowed
- [x] Render an access denied UI if role is denied (match existing denied UI pattern in the import page)
- [x] Show a loading state while role is being checked

### Task 3b: Verify Toaster Mount (AC: #5)
- [x] **C2 — Toaster mount check:** Verify `<Toaster />` from `sonner` is mounted in `apps/frontend/src/app/app/layout.tsx` or `AppLayout.tsx`. If not present, add `import { Toaster } from 'sonner'` and render `<Toaster />` inside the layout's JSX — without this, all `toast.success()` and `toast.error()` calls will be completely invisible to the user, regardless of whether Sonner is imported correctly in the form component.

### Task 5: Write Tests (AC: all)
- [x] Create `apps/frontend/src/components/orders/ManualOrderForm.test.tsx`
- [x] Test: form renders all required fields
- [x] Test: submit button is disabled when required fields are empty
- [x] Test: phone validation — invalid formats trigger error, valid formats clear error
- [x] Test: duplicate order number check — mock Supabase call, verify error message shown
- [x] Test: delivery date >30 days triggers warning (not error)
- [x] Test: form resets after successful submit ("Add Another Order" button click)
- [x] Test: success toast appears after successful submit (mock `useCreateManualOrder` mutation)
- [x] Test: form preserves values on submit error
- [x] Follow test pattern from `apps/frontend/src/components/admin/UserForm.test.tsx`

---

## Dev Notes

### Architecture Context

**This is a frontend-only story.** No database migrations. No worker changes. No new npm packages unless absolutely necessary.

**Stack in use (confirmed from codebase):**
- **Forms:** React Hook Form 7.x + `@hookform/resolvers` + Zod
- **Data fetching/mutations:** TanStack Query (`@tanstack/react-query`) 5.x
- **State management:** Zustand 5.x (only if needed for global state — likely not required for this story)
- **Toasts:** Sonner 2.x (`toast.success()`, `toast.error()`) — already imported in import/page.tsx
- **Supabase client:** `createSPAClient()` from `@/lib/supabase/client` for client components
- **Styling:** Tailwind CSS — match existing class names from UserForm.tsx exactly

**Routing pattern (Next.js App Router):**
```
apps/frontend/src/app/app/
├── orders/
│   ├── import/page.tsx   ← existing (CSV/file import)
│   └── new/page.tsx      ← NEW: manual entry form (this story)
```

The `app/app/` double-nesting is the existing pattern — the outer `app/` is the Next.js app directory, the inner `app/` is the authenticated app layout route group.

### Database Schema — orders Table (Fully Confirmed)

The `orders` table already has every column needed. No migration required.

**Key columns for this story:**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated |
| `operator_id` | UUID FK | From user's JWT claims via `get_operator_id()` |
| `order_number` | VARCHAR(50) NOT NULL | Form input; UNIQUE per operator |
| `customer_name` | VARCHAR(255) NOT NULL | Form input |
| `customer_phone` | VARCHAR(20) NOT NULL | Form input; 9-digit Chilean validation |
| `delivery_address` | TEXT NOT NULL | Form textarea |
| `comuna` | VARCHAR(100) NOT NULL | Form autocomplete; validated against `ALL_COMUNAS` |
| `delivery_date` | DATE NOT NULL | Form date picker |
| `delivery_window_start` | TIME | Optional time picker |
| `delivery_window_end` | TIME | Optional time picker |
| `retailer_name` | VARCHAR(50) | Optional dropdown |
| `raw_data` | JSONB NOT NULL | `{ ...formValues, created_by: userId }` |
| `imported_via` | imported_via_enum NOT NULL | MUST be `'MANUAL'` |
| `imported_at` | TIMESTAMPTZ NOT NULL | Set to `new Date().toISOString()` on insert |
| `status` | order_status_enum NOT NULL | Default `'pending'` (set by DB) |

**UNIQUE constraint:** `UNIQUE (operator_id, order_number)` — this is the conflict key for duplicate detection.

**`imported_via` ENUM values** (from migration `20260217000003_create_orders_table.sql`):
```sql
CREATE TYPE imported_via_enum AS ENUM ('API', 'EMAIL', 'MANUAL', 'CSV');
```
`'MANUAL'` is confirmed present — use it exactly.

**`raw_data` structure for manual orders:**
```json
{
  "order_number": "ORD-001",
  "customer_name": "Juan Pérez",
  "customer_phone": "912345678",
  "delivery_address": "Av. Providencia 1234",
  "comuna": "Providencia",
  "delivery_date": "2026-03-01",
  "delivery_window_start": "09:00",
  "delivery_window_end": "13:00",
  "retailer_name": "Falabella",
  "notes": "Fragile, ring doorbell",
  "created_by": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Note:** `notes` maps to `raw_data.notes` only — there is no dedicated `notes` column on the orders table. If a `status_detail` note is needed, that is a separate field and should not be used for free-form user notes.

### Chilean Comuna Data — Already Exists

`apps/frontend/src/lib/data/chileanLocations.ts` exports:
- `REGIONS` — all 16 regions with their comunas
- `ALL_COMUNAS` — flat array of all ~346 comunas
- `isValidComuna(string): boolean` — case-insensitive lookup via normalized Set

**Use these directly.** Do not create a new data file. Import path: `@/lib/data/chileanLocations`.

For the autocomplete field, use a native `<input>` + `<datalist>` approach:
```tsx
<input list="comunas-list" {...register('comuna')} />
<datalist id="comunas-list">
  {ALL_COMUNAS.map(c => <option key={c} value={c} />)}
</datalist>
```
This avoids adding a third-party autocomplete library. It provides browser-native filtering as the user types.

### Phone Validation — Chilean Format

The codebase already defines Chilean phone validation in Story 2.5 (n8n Code node logic). The Zod schema for this story should accept:
- `+56912345678` — international format (12 chars, starts with +569, then 8 digits)
- `912345678` — local format (9 digits, starts with 9)

Zod regex: `/^(\+569|9)\d{8}$/`

This matches exactly 9 significant digits (the mobile number after the `+569` or `9` prefix).

### Duplicate Order Number Check — AJAX Pattern

Follow the pattern from `UserForm.tsx` which uses a `useEffect` with `setTimeout` debounce to check email uniqueness. For order number:

```tsx
const orderNumberValue = watch('order_number');

useEffect(() => {
  if (!orderNumberValue || orderNumberValue.length < 2) {
    setOrderNumberError(null);
    return;
  }
  const timeoutId = setTimeout(async () => {
    const supabase = createSPAClient();
    const { data } = await supabase
      .from('orders')
      .select('id')
      .eq('operator_id', operatorId)
      .eq('order_number', orderNumberValue)
      .maybeSingle();
    if (data) {
      setOrderNumberError(`Order #${orderNumberValue} already exists for this operator`);
    } else {
      setOrderNumberError(null);
    }
  }, 500);
  return () => clearTimeout(timeoutId);
}, [orderNumberValue]);
```

**C3 — Duplicate check operator_id:** Always include `.eq('operator_id', operatorId)` in the duplicate check query. Do not rely solely on RLS for scoping — be explicit. Read `operatorId` from the session (same as the submit handler) and pass it to `checkOrderNumberDuplicate`. The full query should be: `.from('orders').select('id').eq('operator_id', operatorId).eq('order_number', value).maybeSingle()`.

### Role-Based Access — Reuse Existing Pattern

The import page (`apps/frontend/src/app/app/orders/import/page.tsx`) already implements the RBAC pattern used in this codebase:

```tsx
const ALLOWED_ROLES = ['admin', 'operations_manager'];

useEffect(() => {
  const supabase = createSPAClient();
  supabase.auth.getSession().then(({ data: { session } }) => {
    const role = session?.user?.app_metadata?.claims?.role;
    setRoleCheck(ALLOWED_ROLES.includes(role) ? 'allowed' : 'denied');
  });
}, []);
```

Copy this pattern exactly into `new/page.tsx`. Render the `<ManualOrderForm />` only when `roleCheck === 'allowed'`.

### Form Submit — Supabase Insert

The insert must use `createSPAClient()` (not the server client). The authenticated user's `operator_id` is enforced by RLS — the row will be rejected by the DB if the JWT's `operator_id` doesn't match what's inserted. Safer pattern: read `operator_id` from the session and pass it explicitly:

```tsx
const { data: { session } } = await supabase.auth.getSession();
const userId = session?.user?.id;
const operatorId = session?.user?.app_metadata?.claims?.operator_id;

await supabase.from('orders').insert({
  operator_id: operatorId,
  order_number: data.order_number,
  customer_name: data.customer_name,
  customer_phone: data.customer_phone,
  delivery_address: data.delivery_address,
  comuna: data.comuna,
  delivery_date: data.delivery_date,
  delivery_window_start: data.delivery_window_start ?? null,
  delivery_window_end: data.delivery_window_end ?? null,
  retailer_name: data.retailer_name ?? null,
  imported_via: 'MANUAL',
  imported_at: new Date().toISOString(),
  raw_data: {
    ...data,
    created_by: userId,
  },
});
```

**CRITICAL:** `imported_at` is NOT NULL with no default — it MUST be included in every manual insert. Omitting it will cause a constraint violation.

### Toast Notifications — Sonner

Import from `sonner` (already in package.json):
```tsx
import { toast } from 'sonner';

// Success:
toast.success(`Order #${orderNumber} created successfully`);

// Error:
toast.error('Failed to save order. Please try again.');
```

The `<Toaster />` component from Sonner must already be mounted in the app layout. Verify in `apps/frontend/src/app/app/layout.tsx` — if not present, add it there.

### Previous Story Patterns — Key Files to Read

Before implementation, read these files to internalize existing patterns:

| File | What to learn |
|---|---|
| `apps/frontend/src/components/admin/UserForm.tsx` | RHF + Zod form structure, inline errors, debounced async check, disabled submit button |
| `apps/frontend/src/lib/validation/userSchema.ts` | Zod schema structure, type exports |
| `apps/frontend/src/app/app/orders/import/page.tsx` | Role guard pattern, Sonner toast usage, Supabase client insert pattern |
| `apps/frontend/src/hooks/useUsers.ts` | TanStack Query `useMutation` + `useQuery` patterns |
| `apps/frontend/src/lib/data/chileanLocations.ts` | `ALL_COMUNAS`, `isValidComuna` — use directly |

### Project Structure — New Files

```
apps/frontend/src/
├── app/app/orders/
│   └── new/
│       └── page.tsx                          ← NEW: /orders/new route
├── components/orders/
│   └── ManualOrderForm.tsx                   ← NEW: form component
│   └── ManualOrderForm.test.tsx              ← NEW: form tests
├── hooks/
│   └── useOrders.ts                          ← NEW: useCreateManualOrder mutation
└── lib/validation/
    └── manualOrderSchema.ts                  ← NEW: Zod schema
```

No other files need to be created or modified.

### What NOT To Do

- **Do NOT create database migrations.** The orders table already has all needed columns including `imported_via` ENUM with `'MANUAL'` value.
- **Do NOT modify the orders table.** All schema work is complete from Stories 2.1 and 2.4.
- **Do NOT add new npm packages** unless absolutely necessary. React Hook Form, Zod, `@hookform/resolvers`, TanStack Query, Sonner, and Zustand are all already installed.
- **C1 — Zod as direct dependency:** Verify `zod` is listed as a direct dependency in `apps/frontend/package.json`. If it appears only as a transitive dependency of `@hookform/resolvers` (not explicitly listed), add it: `npm install zod`. Note: `@hookform/resolvers` v5.x requires Zod v4 — confirm version compatibility before installing.
- **Do NOT build this as a separate app.** It is a page within the existing Next.js frontend at `apps/frontend/`.
- **Do NOT create a separate Chilean comuna data file.** `apps/frontend/src/lib/data/chileanLocations.ts` already exists — import from it.
- **Do NOT add a third-party autocomplete or combobox library** for the comuna field. Use native `<input>` + `<datalist>`. If a combobox component already exists in `apps/frontend/src/components/ui/`, use that — but do not add a new library.
- **Do NOT use `status` or `status_detail` for the Notes field.** Notes go into `raw_data.notes` as JSONB. The `status` column is managed by downstream delivery tracking, not by form input.
- **Do NOT omit `imported_at`** from the insert — it is NOT NULL with no default and will cause a DB constraint violation.
- **Do NOT include `status` in the form.** The default `'pending'` from the DB is correct for new manual orders.
- **Do NOT push directly to `main`.** Use a feature branch: `feat/story-2.8-manual-order-form`, open a PR, wait for CI before declaring done.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.8] — acceptance criteria and user story
- [Source: apps/frontend/supabase/migrations/20260217000003_create_orders_table.sql] — orders schema, `imported_via_enum`, `UNIQUE (operator_id, order_number)` constraint
- [Source: apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql] — `order_status_enum`, orders extensions
- [Source: apps/frontend/src/lib/data/chileanLocations.ts] — `ALL_COMUNAS`, `isValidComuna`
- [Source: apps/frontend/src/components/admin/UserForm.tsx] — RHF + Zod form pattern, debounced async validation
- [Source: apps/frontend/src/lib/validation/userSchema.ts] — Zod schema pattern
- [Source: apps/frontend/src/app/app/orders/import/page.tsx] — role guard pattern, Sonner toast, Supabase insert
- [Source: apps/frontend/src/hooks/useUsers.ts] — TanStack Query mutation pattern
- [Source: _bmad-output/implementation-artifacts/2-4-create-automation-worker-database-schema.md] — DB schema context
- [Source: _bmad-output/implementation-artifacts/2-5-implement-easy-csv-email-connector.md] — template reference

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Fixed Zod `z.preprocess` → `z.transform().pipe()` for retailer_name to avoid `unknown` type inference
- Fixed RHF + Zod type mismatch: defined separate `ManualOrderFormInput` type for form fields (pre-transform), cast resolver
- Fixed Supabase `from('orders').insert()` typing: `never` type due to PostgREST version metadata in Database type — used explicit `OrderInsert` type + `any` cast on `.from()` call
- Added `zod@^4.3.6` as direct dependency (was only transitive via `@hookform/resolvers`)
- Added `<Toaster />` from sonner to `app/app/layout.tsx` — was completely missing, all toasts would have been invisible

### Completion Notes List

- All 5 tasks + Task 3b completed
- 10 tests written and passing (form rendering, validation, duplicate check, date warning, submit success/error, reset)
- 373 total tests pass (0 regressions)
- TypeScript compiles with 0 errors
- All ACs satisfied: AC1 (role guard), AC2 (form fields), AC3 (blur validation), AC4 (order creation), AC5 (success toast), AC6 (form reset), AC7 (inline errors), AC8 (button state)
- Edge cases handled: duplicate order number (AJAX + DB constraint), phone format, >30-day warning, window end < start, network error, empty notes

### File List

- `apps/frontend/src/lib/validation/manualOrderSchema.ts` — NEW: Zod schema, ManualOrderFormData type, RETAILER_OPTIONS
- `apps/frontend/src/hooks/useOrders.ts` — NEW: useCreateManualOrder mutation, checkOrderNumberDuplicate function
- `apps/frontend/src/components/orders/ManualOrderForm.tsx` — NEW: manual order entry form component
- `apps/frontend/src/components/orders/ManualOrderForm.test.tsx` — NEW: 10 tests for ManualOrderForm
- `apps/frontend/src/app/app/orders/new/page.tsx` — NEW: /orders/new route with role guard
- `apps/frontend/src/app/app/layout.tsx` — MODIFIED: added `<Toaster />` from sonner
- `apps/frontend/package.json` — MODIFIED: added `zod` as direct dependency
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story status updated
