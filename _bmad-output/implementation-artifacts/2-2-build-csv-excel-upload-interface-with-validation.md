# Story 2.2: Build CSV/Excel Upload Interface with Validation

**Epic:** 2 - Order Data Ingestion
**Story ID:** 2.2
**Status:** done
**Created:** 2026-02-17

---

## Story

**As an** operations manager,
**I want to** upload a CSV or Excel file with orders and see validation results before importing,
**So that** I can quickly import manifests received via email or downloaded from retailer portals.

---

## Acceptance Criteria

### Main Flow

```gherkin
Given I am logged in as an operations_manager or admin
When I navigate to /orders/import and select "Upload CSV/Excel"
Then A file upload dropzone displays with accepted formats: .csv, .xlsx, .xls (max 10MB file size)
And Dragging a file or clicking "Browse" opens file picker
And After file selection, the system parses the file and displays a preview table with first 10 rows
```

### Column Validation

```gherkin
Given A CSV/Excel file is selected
When The system parses the file
Then Required columns are validated:
  - order_number
  - customer_name
  - customer_phone
  - delivery_address
  - comuna
  - delivery_date (format: YYYY-MM-DD or DD/MM/YYYY)
And Optional columns are imported if present:
  - delivery_window_start
  - delivery_window_end
  - retailer_name
  - notes
And Missing required columns show error: "Missing required column: [column_name]"
```

### Data Validation & Error Display

```gherkin
Given The file is being validated
When Data validation occurs
Then Data validation errors display inline:
  - Invalid phone format (not 9 digits)
  - Invalid date format
  - Missing required field
  - Duplicate order_number in file
And Valid rows show green checkmark
And Invalid rows show red X with error message
```

### Preview & Import Decision

```gherkin
Given The file has been validated
When The preview displays
Then Bottom summary shows: "X valid rows, Y errors" with button "Import X Valid Orders"
And Import button is disabled if 0 valid rows
```

### Import Execution

```gherkin
Given The user clicks "Import X Valid Orders"
When The import process executes
Then Orders are created in database with:
  - imported_via = 'CSV'
  - raw_data = entire row as JSON
And Success toast displays: "Imported X orders successfully. Y errors skipped."
```

### Error Recovery

```gherkin
Given Import completes with errors
When The process finishes
Then Failed rows can be exported as CSV with error column for correction and re-upload
```

---

## Tasks / Subtasks

### Phase 1: Parser Implementation (AC: Column Validation, Data Validation)
- [x] Install dependencies: `papaparse@^5.4.1` and `xlsx@^0.18.5`
- [x] Create unified parser: `src/lib/parsers/orderFileParser.ts`
  - [x] Implement `parseCSV(file)` using PapaParse
  - [x] Implement `parseExcel(file)` using SheetJS mini
  - [x] Implement `parseOrdersFile(file)` dispatcher (detects file type)
  - [x] Add file size validation (10MB limit)
  - [x] Add file type validation (magic number check, not just extension)

### Phase 2: Validation Layer (AC: Data Validation & Error Display)
- [x] Create validation module: `src/lib/validation/orderImportValidation.ts`
  - [x] Implement `validateColumns(fields)` - check required columns present
  - [x] Implement `validateRow(row, rowIndex)` - validate individual row data
  - [x] Implement `validateAllRows(data)` - batch validate all rows
  - [x] Implement `findDuplicates(data)` - detect in-file duplicates
  - [x] Implement `checkDatabaseDuplicates(orderNumbers, operatorId)` - query Supabase

### Phase 3: Upload UI Component (AC: Main Flow, Preview & Import Decision)
- [x] Create Chilean location data: `src/lib/data/chileanLocations.ts`
  - [x] Define REGIONS object with comunas array
  - [x] Export ALL_COMUNAS array for validation
  - [x] Export isValidComuna(comuna: string) function
- [x] Create component: `src/components/orders/FileUploadForm.tsx`
  - [x] **REUSE:** Drag-and-drop pattern from `apps/frontend/src/app/app/storage/page.tsx` (lines 80-223)
  - [x] Copy handleDrop(), handleDragEnter/Leave/Over() handlers
  - [x] Use react-hook-form + Zod (existing pattern from UserForm.tsx)
  - [x] File validation on selection
  - [x] Loading spinner with Loader2 icon (lucide-react)
  - [x] Preview table (first 10 rows)

### Phase 4: Validation Display (AC: Data Validation & Error Display)
- [x] Create component: `src/components/orders/ValidationErrorDisplay.tsx`
  - [x] Table with row-level error highlighting
  - [x] Green checkmark for valid rows
  - [x] Red X for invalid rows with inline error messages
  - [x] Summary footer: "X valid rows, Y errors"

### Phase 5: Import Execution (AC: Import Execution, Error Recovery)
- [x] Create API endpoint: `src/app/api/orders/bulk-import/route.ts`
  - [x] Validate JWT and extract operator_id
  - [x] Server-side re-validation (don't trust client)
  - [x] Batch insert valid orders into `orders` table
  - [x] Store raw_data as JSONB (entire row)
  - [x] Set imported_via = 'CSV'
  - [x] Log to audit_logs table
  - [x] Return import summary with errors
- [x] Add "Import X Valid Orders" button to UI
- [x] Implement error export: Download failed rows as CSV with error column

### Phase 6: Testing (AC: All)
- [x] Unit tests: `__tests__/lib/parsers/orderFileParser.test.ts`
  - [x] Test CSV parsing with valid file
  - [x] Test Excel parsing with valid file
  - [x] Test file size validation (reject >10MB)
  - [x] Test file type validation (reject non-CSV/Excel)
- [x] Unit tests: `__tests__/lib/validation/orderImportValidation.test.ts`
  - [x] Test column validation (missing required columns)
  - [x] Test row validation (invalid phone, date, empty fields)
  - [x] Test duplicate detection (in-file)
  - [x] Test database duplicate detection
- [x] Integration tests: `__tests__/api/orders/bulk-import.test.ts`
  - [x] Test successful bulk import
  - [x] Test validation errors (reject invalid data)
  - [x] Test RLS enforcement (operator_id isolation)
  - [x] Test audit logging
- [x] E2E tests: `__tests__/e2e/order-import.spec.ts` (Playwright)
  - [x] Upload valid CSV → see preview → import successfully
  - [x] Upload file with errors → see error display → export failed rows
  - [x] Upload duplicate orders → see database duplicate errors

---

## Dev Notes

### Business Context & Value

**Business Value:** Reduce order import time by 80% vs manual entry. Enable 95%+ first-try success rate with <3s validation feedback.

**Integration & Dependencies:**
- **Depends on Story 2.1:** Orders table schema with RLS, unique constraints, JSONB raw_data field
- **Feeds into Story 2.3:** Email manifest parsing will **reuse this validation logic**
- **Fallback to Story 2.4:** Manual entry form for one-off orders when bulk import fails

---

## Developer Context & Guardrails

### 🚨 CRITICAL: Read Before Implementation

**This story's validation logic becomes the CANONICAL validation for ALL data ingestion paths in Epic 2.**

Story 2.3 (Email Manifest Parsing) will explicitly reuse these validation functions. Story 2.4 (Manual Entry) will use similar field validation rules. **Do NOT cut corners or write "quick and dirty" validation** - this code will be reused across 3 stories.

### 🔄 Existing Components to Reuse

**1. Drag-and-Drop File Upload**
- Location: `apps/frontend/src/app/app/storage/page.tsx` (lines 80-223)
- Pattern: handleDrop(), handleDragEnter/Leave/Over(), isDragging state, hidden file input

**2. Form Handling**
- Library: react-hook-form@7.71.1 + Zod validation
- Reference: `apps/frontend/src/components/admin/UserForm.tsx`
- Pattern: `useForm({ resolver: zodResolver(schema) })`

**3. Toast Notifications**
- Library: Sonner@2.0.7 (already installed)
- Usage: `import { toast } from 'sonner';`
- Examples: `toast.success()`, `toast.error()`, `toast.warning()`

**4. UI Components (Shadcn UI)**
- Location: `apps/frontend/src/components/ui/`
- Available: Dialog, Card, Alert, Button, Input, AlertDialog
- Import: `import { Dialog, DialogContent } from '@/components/ui/dialog';`

**5. Icons (Lucide React)**
- Library: lucide-react@0.469.0
- Icons: Upload, FileIcon, AlertCircle, CheckCircle, Loader2, Download, Trash2
- Import: `import { Upload, Loader2 } from 'lucide-react';`

**6. Supabase Clients**
- Browser: `apps/frontend/src/lib/supabase/client.ts` → `createSPAClient()`
- Server: `apps/frontend/src/lib/supabase/server.ts` → `createSSRClient()`
- Filename sanitization: `filename.replace(/[^0-9a-zA-Z!\-_.*'()]/g, '_')`

**7. Database Types**
- Location: `apps/frontend/src/lib/types.ts`
- Usage: `type Order = Database['public']['Tables']['orders']['Row'];`

### 🎯 Zero Tolerance for These LLM Developer Mistakes

1. **❌ WRONG:** Building new drag-and-drop from scratch → **✅ RIGHT:** Reuse existing pattern from storage/page.tsx
2. **❌ WRONG:** Using different form library → **✅ RIGHT:** Use react-hook-form + Zod (established pattern)
3. **❌ WRONG:** Installing new toast library → **✅ RIGHT:** Use Sonner (already installed project-wide)
4. **❌ WRONG:** Trusting file extensions → **✅ RIGHT:** Validate magic numbers (see CSV spike doc)
5. **❌ WRONG:** Client-side validation only → **✅ RIGHT:** Validate client AND server
6. **❌ WRONG:** Storing CSV as text → **✅ RIGHT:** Parse to JSON, store in `raw_data` JSONB
7. **❌ WRONG:** Wrong file paths → **✅ RIGHT:** Use `/app/` prefix (e.g., `src/app/app/orders/import/page.tsx`)
8. **❌ WRONG:** Hardcoding operator_id → **✅ RIGHT:** Extract from JWT server-side only

---

## Technical Requirements

### File Upload Specifications

| Requirement | Value | Validation |
|------------|-------|-----------|
| **Accepted Formats** | .csv, .xlsx, .xls | File content validation (magic numbers) |
| **Maximum File Size** | 10MB | Client-side (UX) + Server-side (security) |
| **Upload Method** | Drag-and-drop + file picker | react-dropzone or similar |
| **Preview Rows** | First 10 rows | Display before import confirmation |
| **Character Encoding** | UTF-8 | Auto-detect and convert if needed |

### Field Validation Rules

| Field | Required | Type | Validation | Error Message |
|-------|----------|------|-----------|---------------|
| `order_number` | ✅ Yes | string (VARCHAR 50) | Non-empty, unique per operator | "Order number is required" / "Duplicate order number" |
| `customer_name` | ✅ Yes | string (VARCHAR 255) | Non-empty | "Customer name is required" |
| `customer_phone` | ✅ Yes | string (VARCHAR 20) | 9 digits (+56 prefix optional) | "Phone must be 9 digits" |
| `delivery_address` | ✅ Yes | string (TEXT) | Non-empty | "Delivery address is required" |
| `comuna` | ✅ Yes | string (VARCHAR 100) | Valid Chilean comuna | "Must be valid Chilean comuna" |
| `delivery_date` | ✅ Yes | date | YYYY-MM-DD OR DD/MM/YYYY | "Date must be YYYY-MM-DD or DD/MM/YYYY" |
| `delivery_window_start` | ❌ No | time | HH:MM format if provided | "Must be valid time" |
| `delivery_window_end` | ❌ No | time | HH:MM format if provided | "Must be valid time" |
| `retailer_name` | ❌ No | string (VARCHAR 50) | - | - |
| `notes` | ❌ No | string (TEXT) | - | - |

### Database Schema (from Story 2.1)

**Table:** `orders` (already exists, DO NOT modify)

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  order_number VARCHAR(50) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  delivery_address TEXT NOT NULL,
  comuna VARCHAR(100) NOT NULL,
  delivery_date DATE NOT NULL,
  delivery_window_start TIME,
  delivery_window_end TIME,
  retailer_name VARCHAR(50),
  raw_data JSONB NOT NULL,              -- Store entire CSV row here
  metadata JSONB DEFAULT '{}'::jsonb,
  imported_via imported_via_enum NOT NULL,  -- Use 'CSV' for this story
  imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT unique_order_number_per_operator UNIQUE (operator_id, order_number)
);

-- RLS Policy (already active)
CREATE POLICY "orders_tenant_isolation" ON orders
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());
```

**Important Notes:**
- `imported_via` ENUM values: 'API', 'EMAIL', 'MANUAL', 'CSV' → Use **'CSV'** for this story
- `raw_data` JSONB: Store entire CSV row as JSON (audit trail + re-processing capability)
- `metadata` JSONB: System-managed flags (e.g., `{truncated: true}` if raw_data >1MB)
- **RLS Active:** All queries automatically filtered by `operator_id` from JWT

---

## Architecture Compliance

### Code Structure (Feature-Based Organization)

```
src/
├── app/
│   ├── app/                              # ⚠️ Note: /app/ prefix (matches existing structure)
│   │   └── orders/
│   │       └── import/
│   │           └── page.tsx              # Main import page (route: /app/orders/import)
│   │
│   └── api/
│       └── orders/
│           └── bulk-import/
│               └── route.ts              # POST /api/orders/bulk-import
│
├── components/
│   └── orders/
│       ├── FileUploadForm.tsx            # Drag-and-drop + file picker
│       ├── ImportPreview.tsx             # Preview table (first 10 rows)
│       └── ValidationErrorDisplay.tsx    # Error highlighting
│
├── lib/
│   ├── data/
│   │   └── chileanLocations.ts           # ⚠️ NEW: REGIONS + ALL_COMUNAS data
│   │
│   ├── parsers/
│   │   └── orderFileParser.ts            # parseCSV, parseExcel, parseOrdersFile
│   │
│   └── validation/
│       └── orderImportValidation.ts      # validateColumns, validateRow, etc.
│
└── __tests__/
    ├── lib/
    │   ├── parsers/
    │   │   └── orderFileParser.test.ts
    │   └── validation/
    │       └── orderImportValidation.test.ts
    ├── api/
    │   └── orders/
    │       └── bulk-import.test.ts
    └── e2e/
        └── order-import.spec.ts          # Playwright E2E
```

**Key Principles:**
- **Feature-based organization** - group by feature (orders), not by type (components/parsers)
- **Single file per component** - don't split unless >200 lines
- **Collocate tests** - `__tests__/` mirrors `src/` structure

### API Design Pattern

**Endpoint:** `POST /api/orders/bulk-import`

**Request Format (multipart/form-data):**
```
POST /api/orders/bulk-import
Content-Type: multipart/form-data

Body:
- file: File (CSV or Excel)
- retailer_name?: string (optional)
```

**Response Format (Success - 201):**
```json
{
  "success": true,
  "imported": 140,
  "errors": 2,
  "validation_errors": [
    {
      "row": 5,
      "field": "customer_phone",
      "value": "1234",
      "message": "Phone must be 9 digits"
    }
  ]
}
```

**Response Format (Error - 400/422):**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "CSV validation failed",
  "timestamp": "2026-02-17T14:30:00Z"
}
```

**Existing API Error Pattern (apps/frontend/src/app/api/users/route.ts):**
```typescript
// Follow this exact pattern for consistency
const validation = schema.safeParse(body);
if (!validation.success) {
  const firstError = validation.error.issues[0];
  return NextResponse.json({
    code: 'VALIDATION_ERROR',
    message: firstError.message,
    field: firstError.path.join('.')
  }, { status: 400 });
}

// Generic errors
return NextResponse.json({
  code: 'ERROR_CODE',
  message: 'User-friendly message',
  timestamp: new Date().toISOString()
}, { status: 400 });
```

**HTTP Status Codes:**
- `201`: Successfully imported (even if some rows failed)
- `400`: Bad request (file too large, invalid format)
- `401`: Unauthorized (missing/invalid JWT)
- `403`: Forbidden (insufficient permissions)
- `422`: Unprocessable entity (validation errors)
- `429`: Rate limit exceeded (100 req/min per user)
- `500`: Server error

### Security Requirements (MANDATORY)

#### Authentication & Authorization

**Middleware Auto-Handles Session** (`apps/frontend/src/middleware.ts`)
- Session automatically refreshed on every request
- API routes receive valid session - just extract user:

```typescript
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  return NextResponse.json(
    { code: 'UNAUTHORIZED', message: 'Authentication required' },
    { status: 401 }
  );
}

const operatorId = session.user.user_metadata.operator_id;
```

#### File Upload Security

**Complete implementation:** See `apps/frontend/docs/csv-excel-parsing-spike.md` (lines 724-785)

**Key requirements:**
- ✅ Validate file content (magic numbers, not extensions)
- ✅ Enforce 10MB file size limit
- ✅ Sanitize input (remove control characters)
- ✅ Prevent formula injection (escape =, +, -, @)
- ✅ Sanitize filenames: `filename.replace(/[^0-9a-zA-Z!\-_.*'()]/g, '_')`

#### Rate Limiting

**Reference implementation:** `apps/frontend/src/app/api/users/route.ts` (lines 16-36)

```typescript
// In-memory Map for dev (use Redis for production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string, limit = 100): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(identifier);

  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + 60000 });
    return true;
  }

  if (userLimit.count >= limit) return false;
  userLimit.count++;
  return true;
}
```

- Per operator: **1000 requests/minute**
- Per user: **100 requests/minute**
- Return `429 Too Many Requests` when exceeded

#### Audit Logging (7-Year Compliance)
```typescript
// Log to audit_logs table for EVERY import
await supabase.from('audit_logs').insert({
  operator_id,
  user_id,
  action: 'CSV_IMPORT',
  resource_type: 'order',
  resource_id: null, // Bulk operation
  changes_json: {
    file_name: file.name,
    rows_imported: importedCount,
    rows_failed: failedCount
  },
  ip_address: request.headers.get('x-forwarded-for'),
  timestamp: new Date().toISOString()
});
```

---

## Library & Framework Requirements

### Exact Versions

**CSV/Excel Parsing (from spike):**
```bash
npm install papaparse@^5.4.1 xlsx@^0.18.5
npm install --save-dev @types/papaparse@^5.3.14
```

**Existing Libraries (already installed):**
- react-hook-form@7.71.1 (form handling)
- @hookform/resolvers (Zod integration)
- zod (validation schemas)
- sonner@2.0.7 (toast notifications)
- lucide-react@0.469.0 (icons)

**Why these libraries:**
- **PapaParse v5.4.1** - Best-in-class CSV parser (1.5M weekly downloads)
  - Streaming support for large files
  - Auto-detects delimiters (comma, semicolon, tab)
  - Header row detection
  - TypeScript types included
  - Works in browser and Node.js
  - Bundle size: 47KB

- **SheetJS (xlsx) v0.18.5** - Industry standard Excel parser (1.8M weekly downloads)
  - Supports .xlsx and .xls formats
  - Multiple sheet support (use first sheet only)
  - Works in browser and Node.js
  - Bundle size: 100KB (mini version)

**Combined bundle impact:** 147KB (acceptable for order management feature)

### Implementation Examples (from Spike)

**CSV Parsing:**
```typescript
import Papa from 'papaparse';

export function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,                          // First row as column names
      skipEmptyLines: true,                  // Ignore blank rows
      transformHeader: (h) => h.trim(),      // Remove whitespace from headers
      dynamicTyping: false,                  // Keep all as strings for validation
      complete: (results) => {
        resolve({
          data: results.data as Record<string, any>[],
          errors: results.errors.map(err => ({
            row: err.row || 0,
            message: err.message
          })),
          meta: {
            fields: results.meta.fields || [],
            rowCount: results.data.length
          }
        });
      },
      error: (error) => {
        reject(new Error(`CSV parse error: ${error.message}`));
      }
    });
  });
}
```

**Excel Parsing:**
```typescript
import * as XLSX from 'xlsx';

export async function parseExcel(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();

  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,      // Parse dates automatically
    cellText: false       // Don't convert to text
  });

  // Get first sheet
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];

  // Convert to JSON (array of objects)
  const data = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,            // First row as headers
    defval: '',           // Default value for empty cells
    blankrows: false      // Skip blank rows
  });

  // Extract headers and rows
  const headers = data[0] as string[];
  const rows = data.slice(1) as any[][];

  // Convert rows to objects
  const parsedData = rows.map(row => {
    const obj: Record<string, any> = {};
    headers.forEach((header, index) => {
      obj[header.trim()] = row[index] || '';
    });
    return obj;
  });

  return {
    data: parsedData,
    errors: [],
    meta: {
      fields: headers.map(h => h.trim()),
      rowCount: parsedData.length
    }
  };
}
```

**Unified Dispatcher:**
```typescript
export async function parseOrdersFile(file: File): Promise<ParseResult> {
  // Validate file size (10MB limit)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error('File too large. Maximum 10MB.');
  }

  // Detect file type
  const extension = file.name.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'csv':
      return parseCSV(file);
    case 'xlsx':
    case 'xls':
      return parseExcel(file);
    default:
      throw new Error('Invalid file format. Please upload .csv, .xlsx, or .xls');
  }
}
```

### Validation Functions (CANONICAL - Reused by Stories 2.3, 2.4)

**Complete validation examples in CSV parsing spike.** Core pattern:

```typescript
// src/lib/validation/orderImportValidation.ts
import { isValidComuna } from '@/lib/data/chileanLocations';

const REQUIRED_COLUMNS = [
  'order_number',
  'customer_name',
  'customer_phone',
  'delivery_address',
  'comuna',
  'delivery_date'
];

export function validateColumns(fields: string[]): string[] {
  return REQUIRED_COLUMNS.filter(col => !fields.includes(col));
}

export function validateRow(
  row: Record<string, any>,
  rowIndex: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Order number (required, non-empty)
  if (!row.order_number?.trim()) {
    errors.push({
      row: rowIndex,
      field: 'order_number',
      value: row.order_number,
      message: 'Order number is required'
    });
  }

  // Customer phone (9 digits)
  const phone = row.customer_phone?.toString().replace(/\D/g, '');
  if (!phone || phone.length !== 9) {
    errors.push({
      row: rowIndex,
      field: 'customer_phone',
      value: row.customer_phone,
      message: 'Phone must be 9 digits'
    });
  }

  // Delivery date (YYYY-MM-DD or DD/MM/YYYY)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/;
  if (!row.delivery_date || !dateRegex.test(row.delivery_date)) {
    errors.push({
      row: rowIndex,
      field: 'delivery_date',
      value: row.delivery_date,
      message: 'Date must be YYYY-MM-DD or DD/MM/YYYY'
    });
  }

  // Comuna (required, valid Chilean comuna)
  if (!row.comuna?.trim()) {
    errors.push({
      row: rowIndex,
      field: 'comuna',
      value: row.comuna,
      message: 'Comuna is required'
    });
  } else if (!isValidComuna(row.comuna)) {
    errors.push({
      row: rowIndex,
      field: 'comuna',
      value: row.comuna,
      message: 'Must be valid Chilean comuna'
    });
  }

  return errors;
}

// Chilean Location Data (NEW - create this file)
// src/lib/data/chileanLocations.ts
export const REGIONS = {
  'RM': {
    name: 'Región Metropolitana',
    comunas: ['Santiago', 'Providencia', 'Las Condes', 'Vitacura', 'Lo Barnechea', 'Ñuñoa', 'La Reina']
  },
  'V': {
    name: 'Valparaíso',
    comunas: ['Valparaíso', 'Viña del Mar', 'Concón', 'Quintero']
  }
  // ... add all regions and comunas
};

export const ALL_COMUNAS = Object.values(REGIONS).flatMap(r => r.comunas);

export function isValidComuna(comuna: string): boolean {
  return ALL_COMUNAS.includes(comuna.trim());
}

export function validateAllRows(data: Record<string, any>[]): ValidationError[] {
  const allErrors: ValidationError[] = [];

  data.forEach((row, index) => {
    const rowErrors = validateRow(row, index + 2); // +2: header row + 0-indexed
    allErrors.push(...rowErrors);
  });

  return allErrors;
}

export function findDuplicates(data: Record<string, any>[]): ValidationError[] {
  const seen = new Map<string, number>();
  const duplicates: ValidationError[] = [];

  data.forEach((row, index) => {
    const orderNumber = row.order_number?.trim();
    if (!orderNumber) return;

    if (seen.has(orderNumber)) {
      duplicates.push({
        row: index + 2,
        field: 'order_number',
        value: orderNumber,
        message: `Duplicate order number (first seen on row ${seen.get(orderNumber)})`
      });
    } else {
      seen.set(orderNumber, index + 2);
    }
  });

  return duplicates;
}

export async function checkDatabaseDuplicates(
  orderNumbers: string[],
  operatorId: string
): Promise<string[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('order_number')
    .eq('operator_id', operatorId)
    .in('order_number', orderNumbers);

  if (error) {
    console.error('Database check error:', error);
    return [];
  }

  return data.map(row => row.order_number);
}

// TanStack Query Hook Pattern (from apps/frontend/src/hooks/useUsers.ts)
export const useBulkImportOrders = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: importOrders,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success(`Imported ${data.imported} orders successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to import: ${error.message}`);
    }
  });
};

// CSV Export Pattern (from apps/frontend/src/hooks/useAuditLogs.ts)
export function exportFailedRowsAsCSV(data: any[], errors: ValidationError[]): void {
  const errorsByRow = new Map<number, string[]>();
  errors.forEach(e => {
    const messages = errorsByRow.get(e.row) || [];
    messages.push(`${e.field}: ${e.message}`);
    errorsByRow.set(e.row, messages);
  });

  const failedRows = data
    .map((row, index) => {
      const rowErrors = errorsByRow.get(index + 2);
      return rowErrors ? { ...row, errors: rowErrors.join('; ') } : null;
    })
    .filter(Boolean);

  const csvContent = 'data:text/csv;charset=utf-8,' +
    Papa.unparse(failedRows);

  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `failed_orders_${new Date().toISOString()}.csv`;
  link.click();
}
```

---

## File Structure Requirements

**Location:** `src/app/app/orders/import/page.tsx`

**Why:** App section for authenticated users (matches existing /app/storage pattern)

**Route:** `/app/orders/import`

**Access Control:**
- Requires authentication (JWT)
- Requires role: `operations_manager` OR `admin`
- Middleware enforces role-based access

**Component Hierarchy:**
```tsx
<ImportOrdersPage>
  <FileUploadForm onFileSelected={handleFileSelect} />
  {validationResult && (
    <>
      <ImportPreview data={validationResult.data} errors={validationResult.errors} />
      <ValidationErrorDisplay errors={validationResult.errors} />
      <ImportButton
        onImport={handleImport}
        disabled={validationResult.errors.length > 0}
      />
    </>
  )}
</ImportOrdersPage>
```

---

## Testing Requirements

**Test Pattern References:**
- Unit tests: `apps/frontend/src/lib/api/users.test.ts`
- Store tests: `apps/frontend/src/lib/stores/scanStore.test.ts`
- Hook tests: `apps/frontend/src/hooks/useSentryUser.test.ts`
- Integration tests: `apps/frontend/__tests__/orders-rls.test.ts` (use real fetch with undici)

### Unit Tests

**File:** `__tests__/lib/parsers/orderFileParser.test.ts`

```typescript
import { parseCSV, parseExcel, parseOrdersFile } from '@/lib/parsers/orderFileParser';

describe('parseCSV', () => {
  it('should parse valid CSV file', async () => {
    const csvContent = 'order_number,customer_name\nORD001,John Doe';
    const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

    const result = await parseCSV(file);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].order_number).toBe('ORD001');
    expect(result.errors).toHaveLength(0);
  });

  it('should reject file >10MB', async () => {
    const largeContent = 'x'.repeat(11 * 1024 * 1024);
    const file = new File([largeContent], 'large.csv', { type: 'text/csv' });

    await expect(parseOrdersFile(file)).rejects.toThrow('File too large');
  });
});
```

**File:** `__tests__/lib/validation/orderImportValidation.test.ts`

```typescript
import { validateRow, findDuplicates } from '@/lib/validation/orderImportValidation';

describe('validateRow', () => {
  it('should reject row with missing order_number', () => {
    const row = { customer_name: 'John Doe' };
    const errors = validateRow(row, 2);

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('order_number');
  });

  it('should reject invalid phone format', () => {
    const row = {
      order_number: 'ORD001',
      customer_phone: '1234' // Invalid: not 9 digits
    };
    const errors = validateRow(row, 2);

    expect(errors.find(e => e.field === 'customer_phone')).toBeDefined();
  });
});

describe('findDuplicates', () => {
  it('should detect duplicate order numbers', () => {
    const data = [
      { order_number: 'ORD001' },
      { order_number: 'ORD001' }
    ];
    const duplicates = findDuplicates(data);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].message).toContain('Duplicate');
  });
});
```

### Integration Tests

**File:** `__tests__/api/orders/bulk-import.test.ts`

```typescript
import { POST } from '@/app/api/orders/bulk-import/route';

describe('POST /api/orders/bulk-import', () => {
  it('should import valid CSV successfully', async () => {
    const formData = new FormData();
    formData.append('file', new File(['order_number,customer_name\nORD001,John'], 'test.csv'));

    const request = new NextRequest('http://localhost/api/orders/bulk-import', {
      method: 'POST',
      body: formData
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.imported).toBeGreaterThan(0);
  });

  it('should enforce RLS (operator_id isolation)', async () => {
    // Create orders for operator A
    // Login as operator B
    // Attempt to import (should not see operator A's orders)

    // ... test implementation
  });
});
```

### E2E Tests (Playwright)

**File:** `__tests__/e2e/order-import.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('should upload CSV and import orders', async ({ page }) => {
  await page.goto('/app/orders/import');

  // Upload file
  const uploadInput = page.locator('input[type="file"]');
  await uploadInput.setInputFiles('./test-data/valid-orders.csv');

  // Wait for preview
  await expect(page.locator('text=Preview')).toBeVisible();

  // Click import
  await page.click('button:has-text("Import")');

  // Check success toast
  await expect(page.locator('text=Imported successfully')).toBeVisible();
});

test('should display validation errors', async ({ page }) => {
  await page.goto('/app/orders/import');

  // Upload file with errors
  const uploadInput = page.locator('input[type="file"]');
  await uploadInput.setInputFiles('./test-data/invalid-orders.csv');

  // Check error display
  await expect(page.locator('text=Phone must be 9 digits')).toBeVisible();

  // Import button should be disabled
  const importButton = page.locator('button:has-text("Import")');
  await expect(importButton).toBeDisabled();
});
```

### Test Data Files

**File:** `__tests__/test-data/valid-orders.csv`
```csv
order_number,customer_name,customer_phone,delivery_address,comuna,delivery_date
ORD001,John Doe,912345678,Av. Libertador 123,Santiago,2026-02-20
ORD002,Jane Smith,987654321,Calle Moneda 456,Providencia,2026-02-21
```

**File:** `__tests__/test-data/invalid-orders.csv`
```csv
order_number,customer_name,customer_phone,delivery_address,comuna,delivery_date
ORD001,John Doe,1234,Av. Libertador 123,Santiago,2026-02-20
,Jane Smith,987654321,Calle Moneda 456,Providencia,invalid-date
```

---

## Previous Story Intelligence (Story 2.1 Learnings)

### Database Schema Already Complete ✅

Story 2.1 created the `orders` table with:
- ✅ Multi-tenant RLS policies (`operator_id` isolation)
- ✅ Unique constraint on `(operator_id, order_number)` → prevents duplicates
- ✅ ENUM type `imported_via_enum` with values: 'API', 'EMAIL', 'MANUAL', **'CSV'**
- ✅ JSONB fields: `raw_data` (store entire CSV row), `metadata` (system flags)
- ✅ 4 indexes for performance (including composite index on operator_id + order_number)
- ✅ Audit trigger (automatic logging to audit_logs table)
- ✅ Soft delete pattern (`deleted_at` column for 7-year compliance)

**Migration file:** `apps/frontend/supabase/migrations/20260217000003_create_orders_table.sql`

**DO NOT modify the orders table schema** - it's production-ready and tested (10 passing tests, 9 code review issues fixed).

### Testing Pattern from Story 2.1

**Use real fetch (undici) for database integration tests:**
```typescript
import { fetch as nodeFetch } from 'undici';
vi.stubGlobal('fetch', nodeFetch);
```

**Why:** Story 2.1 discovered that mocking fetch breaks Supabase client (commit 71a9ef9).

**Test file locations:**
- Database integration tests: `apps/frontend/__tests__/orders-rls.test.ts` (reference for RLS testing patterns)
- Test setup: `apps/frontend/vitest.config.ts` (already configured with dotenv for .env.local)

### Code Review Learnings from Story 2.1

**9 issues fixed (commit ca40e8c):**
1. Complete index validation (validate all 9 indexes individually)
2. Document audit trigger (reference Story 1.6 implementation)
3. Document package_number field (free-form text, app-layer validation)
4. Add CASCADE delete tests (operator→orders→packages chain)
5. Document sub-label generation algorithm (for multi-box packages)
6. Correct RLS policy documentation (`public.get_operator_id()`, not `auth.operator_id()`)
7. Add environment variable validation (warn if SUPABASE_SERVICE_ROLE_KEY missing)
8. Add invalid ENUM rejection test (verify invalid values rejected)
9. Document RLS testing limitation (service role bypasses RLS, acceptable for Story 2.1)

**Key takeaway:** Thorough validation and documentation prevent silent failures.

### Migration Deployment Pattern (Proven in Epic 1)

```bash
# Local development
supabase migration new create_feature
supabase start && supabase db push && supabase db diff

# Production deployment (via GitHub Actions)
git add supabase/migrations/ && git commit && git push
# CI/CD auto-deploys to Supabase production
```

**Critical lessons:**
- Always run `supabase db diff` to verify schema changes
- Test RLS policies locally before pushing to production
- Verify naming conventions (idx_* prefix, snake_case)
- If migration conflicts occur: `supabase db pull` to sync local state

---

## Git Intelligence Summary

**Recent commits relevant to Story 2.2:**

1. **a469421** - docs: Document orders + packages data model (Story 2.1 scope expansion)
   - Added 956 lines of database schema documentation
   - Documented packages table (multi-box support for retailers)
   - Updated epics.md with Story 2.1 scope changes

2. **ca40e8c** - fix(story-2.1): Address all 9 code review issues
   - Enhanced migration validation (all 9 indexes individually validated)
   - Added CASCADE delete tests (operator→orders→packages)
   - Fixed RLS policy documentation (`public.get_operator_id()`)
   - Added invalid ENUM rejection test

3. **71a9ef9** - fix(tests): Restore real fetch for database integration tests
   - Fixed 3 test files to use real fetch (undici) instead of mocking
   - **Critical lesson:** Mocking fetch breaks Supabase client

4. **c58f387** - feat(epic-2): Create orders + packages tables with multi-tenant RLS (Story 2.1)
   - Main implementation: 369-line migration file
   - 1027-line test file (10 passing tests, 4 skipped)
   - RLS policies, indexes, audit triggers all tested

5. **eaa2eda** - docs: Complete CSV/Excel parsing technical spike (Epic 2 prep)
   - **842-line spike document:** `apps/frontend/docs/csv-excel-parsing-spike.md`
   - Library recommendations: PapaParse v5.4.1 + SheetJS v0.18.5
   - Complete validation patterns, error handling, security considerations
   - Performance benchmarks: <2s for 1000 rows (requirement met)
   - Ready for Story 2.2 implementation

**Pattern established:** Test-driven development with thorough validation and code review process.

---

## Latest Tech Information (from CSV Parsing Spike)

### Library Versions (as of Feb 17, 2026)

**PapaParse v5.4.1** (CSV Parser)
- NPM: https://www.npmjs.com/package/papaparse
- Weekly downloads: 1.5M
- Bundle size: 47KB (minified)
- License: MIT
- TypeScript types: ✅ Included
- Browser support: ✅ Chrome, Firefox, Safari, Edge (last 2 versions)

**SheetJS (xlsx) v0.18.5** (Excel Parser)
- NPM: https://www.npmjs.com/package/xlsx
- Weekly downloads: 1.8M
- Bundle size: 100KB (mini version), 600KB (full version)
- License: Apache 2.0
- TypeScript types: ✅ Available (@types/xlsx not needed for v0.18+)
- Browser support: ✅ All modern browsers

**Combined Impact:** 147KB total (acceptable for order management feature)

### Security Best Practices (OWASP 2026)

**File Upload Security:**
- ✅ Validate file content (magic numbers), not just extensions
- ✅ Enforce file size limits (10MB hard limit)
- ✅ Sanitize input (remove control characters, escape formulas)
- ✅ Prevent CSV injection (formulas starting with =, +, -, @)
- ✅ Use Content Security Policy (CSP) to prevent XSS

**References:**
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- CSV Injection: https://owasp.org/www-community/attacks/CSV_Injection

### Performance Optimization

**Benchmarks (MacBook Pro M1, Chrome 120):**

| Rows | CSV (PapaParse) | Excel (SheetJS) |
|------|----------------|-----------------|
| 100 | 15ms | 45ms |
| 1,000 | 85ms | 320ms |
| 10,000 | 650ms | 2,100ms |

**Streaming for Large Files (>5MB):**
- Use PapaParse streaming API for CSV files >5MB
- Process 1000 rows at a time to prevent browser freeze
- Update progress bar incrementally

**Memory Management:**
- Files >10MB rejected at upload (before parsing)
- Truncate `raw_data` JSONB if >1MB (set `metadata: {truncated: true}`)
- PostgreSQL TOAST automatically compresses JSONB >2KB

---

## Project Context Reference

**Deployment Runbook:** `apps/frontend/docs/deployment-runbook.md`
**CSV Parsing Spike:** `apps/frontend/docs/csv-excel-parsing-spike.md`
**Database Schema Docs:** `_bmad-output/planning-artifacts/database-schema.md`
**Epic 2 Planning:** `_bmad-output/planning-artifacts/epics.md` (Epic 2 section)

**Related Stories:**
- **Story 2.1:** Create orders table and data model (✅ DONE - foundation for this story)
- **Story 2.3:** Implement email manifest parsing (⏳ NEXT - will reuse validation logic)
- **Story 2.4:** Build manual order entry form (⏳ FALLBACK - single order entry)

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- All 64 unit/integration tests pass (15 parser, 39 validation, 10 API)
- Full regression suite: 123/131 suites pass; 8 failures are pre-existing (audit DB connection tests, health route) — unrelated to Story 2.2
- E2E spec written (requires Playwright setup to run, matching project pattern from Story 1.5)

### Completion Notes List

- **Phase 1 (Parser):** `orderFileParser.ts` implements CSV (PapaParse) and Excel (SheetJS) parsing with magic number validation, formula injection sanitization, header normalization to lowercase snake_case, and 10MB file size limit.
- **Phase 2 (Validation):** `orderImportValidation.ts` is the CANONICAL validation module for Epic 2. Validates columns, rows (phone 9-digit with +56 support, dates YYYY-MM-DD/DD/MM/YYYY, Chilean comunas), detects in-file duplicates, and checks database duplicates via injectable Supabase client. Exports `normalizeDeliveryDate` and `normalizePhoneNumber` for server-side use.
- **Phase 3 (Chilean data + Upload UI):** Complete 16-region Chilean location data with 346 comunas. Case-insensitive Set-based lookup. `FileUploadForm.tsx` reuses drag-and-drop pattern with file validation, loading state, and clear functionality.
- **Phase 4 (Validation Display):** `ValidationErrorDisplay.tsx` shows preview table with green checkmark/red X per row, inline error badges, row count summary, and `exportFailedRowsAsCSV()` utility.
- **Phase 5 (API + Import):** `POST /api/orders/bulk-import` with auth (JWT), role check (admin/operations_manager), rate limiting (100 req/min), server-side re-validation, batch insert with `imported_via='CSV'`, `raw_data` JSONB storage, and audit logging. Import page orchestrates full flow with toast notifications.
- **Phase 6 (Tests):** 64 tests across 3 test files + E2E spec. Test data files for valid and invalid orders provided.

### File List

- `apps/frontend/package.json` — Added papaparse, xlsx, @types/papaparse dependencies
- `apps/frontend/src/lib/parsers/orderFileParser.ts` — NEW: CSV/Excel parser with magic number validation
- `apps/frontend/src/lib/validation/orderImportValidation.ts` — NEW: CANONICAL validation module for Epic 2
- `apps/frontend/src/lib/data/chileanLocations.ts` — NEW: 16 regions, 346 comunas, isValidComuna()
- `apps/frontend/src/components/orders/FileUploadForm.tsx` — NEW: Drag-and-drop file upload component
- `apps/frontend/src/components/orders/ValidationErrorDisplay.tsx` — NEW: Validation table + error export
- `apps/frontend/src/app/api/orders/bulk-import/route.ts` — NEW: POST endpoint for bulk CSV import
- `apps/frontend/src/app/app/orders/import/page.tsx` — NEW: Import orders page (route: /app/orders/import)
- `apps/frontend/__tests__/lib/parsers/orderFileParser.test.ts` — NEW: 15 parser tests
- `apps/frontend/__tests__/lib/validation/orderImportValidation.test.ts` — NEW: 39 validation tests
- `apps/frontend/__tests__/api/orders/bulk-import.test.ts` — NEW: 10 API integration tests
- `apps/frontend/__tests__/e2e/order-import.spec.ts` — NEW: 3 Playwright E2E test specs
- `apps/frontend/__tests__/test-data/valid-orders.csv` — NEW: Test data
- `apps/frontend/__tests__/test-data/invalid-orders.csv` — NEW: Test data
- `apps/frontend/src/lib/types.ts` — MODIFIED: Updated orders table types to match Story 2.1 migration schema
- `apps/frontend/.gitignore` — MODIFIED: Added vitest-results.json and NUL to gitignore

---

## Senior Developer Review (AI)

**Review Date:** 2026-02-18
**Reviewer Model:** Claude Opus 4.6
**Review Outcome:** Changes Requested → All Fixed

### Issues Found: 3 High, 4 Medium, 2 Low

### Action Items

- [x] **[HIGH] H1:** `types.ts` orders schema mismatch — old columns (barcode, status, priority) instead of Story 2.1 schema (comuna, delivery_date, raw_data, imported_via, etc.). Fixed: Updated types to match migration.
- [x] **[HIGH] H2:** No role-based access control on import page — any authenticated user could see the upload UI. Fixed: Added client-side role guard (admin/operations_manager only).
- [x] **[HIGH] H3:** Server-side CSV reconstruction loses original file data — sanitized/mangled values stored as raw_data. Fixed: Send original File object to server instead of reconstructing CSV.
- [x] **[MED] M1:** `onFileParsed` prop declared but unused (dead interface surface). Fixed: Removed from FileUploadForm interface.
- [x] **[MED] M2:** Git artifacts `NUL` and `vitest-results.json` untracked. Fixed: Added to .gitignore.
- [x] **[MED] M3:** CSV export derives headers from first row only — rows with optional fields could produce incomplete CSV. Fixed: Union all row keys.
- [x] **[MED] M4:** Rate limit map grows unbounded. Fixed: Added expired entry sweep when map exceeds 100 entries.
- [ ] **[LOW] L1:** E2E tests can't run — Playwright not installed (matches project pattern from Story 1.5).
- [ ] **[LOW] L2:** `apps/frontend/NUL` artifact in working directory (Windows reserved device name).

---

## Story Completion Status

**Status:** done
**Analysis Completed:** 2026-02-17
**Comprehensive Context Created:** ✅

**Next Steps for Developer:**
1. ✅ Read this entire story file (contains ALL context needed)
2. ✅ Read `apps/frontend/docs/csv-excel-parsing-spike.md` (implementation examples)
3. ✅ Install dependencies: `npm install papaparse@^5.4.1 xlsx@^0.18.5 @types/papaparse@^5.3.14`
4. ✅ Follow Tasks/Subtasks section in order (Phase 1 → Phase 6)
5. ✅ Run tests after each phase to catch issues early
6. ✅ When complete, run code review workflow to mark story as "done"

**Ultimate context engine analysis completed** - comprehensive developer guide created with zero tolerance for common LLM mistakes. This story's validation logic will be reused by Stories 2.3 and 2.4, so implement it correctly the first time.

🚀 **Ready for flawless implementation!**
