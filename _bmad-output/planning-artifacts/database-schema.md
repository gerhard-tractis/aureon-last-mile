# Database Schema - Aureon Last Mile

**Last Updated:** 2026-02-17
**Current Version:** Story 2.1 (Orders + Packages)
**Migration:** `20260217000003_create_orders_table.sql`

---

## Table of Contents

1. [Overview](#overview)
2. [Schema Design Principles](#schema-design-principles)
3. [Orders Table](#orders-table)
4. [Packages Table](#packages-table)
5. [Table Relationships](#table-relationships)
6. [Row-Level Security (RLS) Policies](#row-level-security-rls-policies)
7. [Indexes & Performance](#indexes--performance)
8. [Soft Delete Pattern](#soft-delete-pattern)
9. [Example Queries](#example-queries)
10. [Migration History](#migration-history)

---

## Overview

The Aureon Last Mile database supports a **multi-tenant logistics platform** for last-mile delivery operations in Chile. The schema is designed around two core entities:

- **Orders:** Customer delivery requests imported from retailers (Falabella, Shopee, etc.)
- **Packages:** Individual scannable cartons/boxes that compose orders (the physical units tracked through the warehouse)

**Key Architectural Pattern:**
```
1 Order → N Packages (1:N relationship)
```

**Example:**
- Order `SH-2847` (customer delivery to Santiago) contains:
  - Package `CTN001` (electronics - 5kg)
  - Package `CTN002` (clothing - 2kg)
  - Package `CTN003` (books - 3kg)

When warehouse crew scans barcodes during pickup, they scan **packages** (CTN001, CTN002, CTN003), not the order number. This granular tracking enables:
- Weight verification (compare declared vs actual for billing disputes)
- SKU-level inventory management
- Precise pickup/delivery reconciliation
- Audit trail per physical carton

---

## Schema Design Principles

### 1. Multi-Tenant Isolation (Row-Level Security)
Every table includes `operator_id UUID` with RLS policies enforcing:
```sql
operator_id = public.get_operator_id()
```
Users can **only** access data for their operator (tenant). Cross-tenant queries return empty results.

### 2. Soft Delete (7-Year Data Retention)
Chilean compliance requires 7-year data retention. All tables use:
```sql
deleted_at TIMESTAMP WITH TIME ZONE NULL
```
- Active records: `WHERE deleted_at IS NULL`
- Soft delete: `UPDATE table SET deleted_at = NOW()`
- Restoration: `UPDATE table SET deleted_at = NULL`
- Hard delete: Only after 7-year retention expires

### 3. Audit Logging
All tables have triggers:
```sql
CREATE TRIGGER audit_{table}_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.{table}
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```
Every change logged to `audit_logs` table with before/after state.

### 4. JSONB for Flexibility
- `raw_data` (JSONB): Original retailer payload (CSV row, email attachment, API response)
- `metadata` (JSONB): System flags (truncation markers, validation warnings)
- **No GIN indexes:** Data stored for archive/re-processing, not queried

### 5. Idempotent Migrations
All migrations use:
```sql
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

---

## Orders Table

### Purpose
Stores customer delivery requests imported from multiple sources (CSV upload, email manifest, manual entry, API integration).

### Schema

```sql
CREATE TABLE public.orders (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-Tenant Isolation
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  -- Order Identification
  order_number VARCHAR(50) NOT NULL,  -- Retailer-assigned ID (e.g., FAL-2026-001234)

  -- Customer Information
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,  -- Chilean format: +56 9XXXXXXXX (mobile) or +56 2XXXXXXXX (landline)

  -- Delivery Details
  delivery_address TEXT NOT NULL,
  comuna VARCHAR(100) NOT NULL,  -- Chilean administrative district (e.g., Providencia, Santiago)
  delivery_date DATE NOT NULL,
  delivery_window_start TIME,  -- Optional delivery window (e.g., 09:00-13:00)
  delivery_window_end TIME,

  -- Source Metadata
  retailer_name VARCHAR(50),  -- e.g., 'Falabella', 'Shopee', 'Mercado Libre'
  imported_via imported_via_enum NOT NULL,  -- 'API', 'EMAIL', 'MANUAL', 'CSV'
  imported_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Data Preservation
  raw_data JSONB NOT NULL,  -- Original retailer payload (preserves audit trail for re-processing)
  metadata JSONB DEFAULT '{}'::jsonb,  -- System-managed flags (e.g., {truncated: true, original_size: 1048576})

  -- Record Management
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,  -- Soft delete (7-year retention)

  -- Constraints
  CONSTRAINT unique_order_number_per_operator UNIQUE (operator_id, order_number)
);
```

### Field Descriptions

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY | Unique order identifier (system-generated) |
| `operator_id` | UUID | NOT NULL, FK | Tenant identifier for multi-tenant isolation |
| `order_number` | VARCHAR(50) | NOT NULL, UNIQUE per operator | Retailer-assigned order ID (unique within operator) |
| `customer_name` | VARCHAR(255) | NOT NULL | Full name of delivery recipient |
| `customer_phone` | VARCHAR(20) | NOT NULL | Contact phone (Chilean format validated at app layer) |
| `delivery_address` | TEXT | NOT NULL | Full delivery location (street, building, apartment) |
| `comuna` | VARCHAR(100) | NOT NULL | Chilean administrative district for routing |
| `delivery_date` | DATE | NOT NULL | Expected delivery date |
| `delivery_window_start` | TIME | NULLABLE | Optional delivery window start time |
| `delivery_window_end` | TIME | NULLABLE | Optional delivery window end time |
| `retailer_name` | VARCHAR(50) | NULLABLE | Source retailer (Falabella, Shopee, etc.) |
| `raw_data` | JSONB | NOT NULL | Original payload from any source (email/CSV/API) |
| `metadata` | JSONB | DEFAULT '{}' | System metadata (truncation flags, processing notes) |
| `imported_via` | ENUM | NOT NULL | Data ingestion method: 'API', 'EMAIL', 'MANUAL', 'CSV' |
| `imported_at` | TIMESTAMP | NOT NULL | When order was imported into system |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | Record creation timestamp |
| `deleted_at` | TIMESTAMP | NULLABLE | Soft delete timestamp (7-year compliance) |

### ENUM Type: imported_via_enum

```sql
CREATE TYPE imported_via_enum AS ENUM (
  'API',     -- Programmatic API import
  'EMAIL',   -- Email manifest parsing (n8n workflow)
  'MANUAL',  -- Manual entry form
  'CSV'      -- CSV/Excel upload
);
```

### Business Rules

1. **Unique Order Numbers:** Each operator can have one order with a given `order_number`. Different operators can have the same `order_number` (e.g., two operators both import "FAL-001").

2. **Phone Format Validation:** Application layer validates Chilean phone formats:
   - Mobile: `+56 9XXXXXXXX` (9 digits starting with 9)
   - Landline: `+56 2XXXXXXXX` (9 digits starting with 2)
   - Database accepts VARCHAR(20) for flexibility

3. **Raw Data Truncation:** If `raw_data` exceeds 1MB:
   - Application truncates to 1MB
   - Sets `metadata.truncated = true`
   - Stores `metadata.original_size = {bytes}`

4. **Comuna (District):** Used for delivery routing and capacity planning. Must match Chilean administrative divisions.

### Example Record

```sql
INSERT INTO public.orders (
  operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, delivery_window_start,
  delivery_window_end, retailer_name, raw_data, metadata,
  imported_via, imported_at
) VALUES (
  'op-uuid-123',
  'FAL-2026-001234',
  'Juan Pérez González',
  '+56987654321',
  'Av. Providencia 1234, Depto 501',
  'Providencia',
  '2026-02-20',
  '09:00:00',
  '13:00:00',
  'Falabella',
  '{"csv_row": 5, "original_order_id": "FAL-2026-001234", "items": 3, "total": 45990}',
  '{}',
  'CSV',
  NOW()
);
```

---

## Packages Table

### Purpose
Stores individual **scannable cartons/boxes** that compose orders. Packages are the physical units tracked through the warehouse with barcode labels (e.g., CTN12345).

### Schema

```sql
CREATE TABLE public.packages (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-Tenant Isolation & Relationship
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  -- Scanning Identifier
  label VARCHAR(100) NOT NULL,  -- Barcode/label value (CTN12345, LPN98765, varies by retailer)

  -- Package Sequencing (for inefficient retailers)
  package_number VARCHAR(20),  -- FREE-FORM TEXT: "1 of 3", "2/3", etc. (app-layer validation)
  declared_box_count INTEGER DEFAULT 1,  -- Number of boxes retailer declared (usually 1, >1 for split)
  is_generated_label BOOLEAN DEFAULT FALSE,  -- TRUE if operator created sub-labels (CTN001-1, CTN001-2)
  parent_label VARCHAR(100),  -- Original CTN label if this is a generated sub-label

  -- SKU Contents
  sku_items JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array: [{sku, description, quantity}, ...]

  -- Physical Attributes (Declared by Retailer)
  declared_weight_kg DECIMAL(10,2),  -- Often underreported for billing manipulation
  declared_dimensions JSONB,  -- {length, width, height, unit: 'cm'}

  -- Physical Attributes (Verified by Operator)
  verified_weight_kg DECIMAL(10,2),  -- NULL until measured at hub
  verified_dimensions JSONB,  -- NULL until measured at hub

  -- Metadata & Audit Trail
  metadata JSONB DEFAULT '{}'::jsonb,  -- {weight_discrepancy_flag: true, discrepancy_pct: 60}
  raw_data JSONB NOT NULL,  -- Original manifest package data

  -- Record Management
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,  -- Soft delete (7-year retention)

  -- Constraints
  CONSTRAINT unique_label_per_operator UNIQUE (operator_id, label)
);
```

### Field Descriptions

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY | Unique package identifier |
| `operator_id` | UUID | NOT NULL, FK | Tenant identifier for multi-tenant isolation |
| `order_id` | UUID | NOT NULL, FK | Parent order (CASCADE delete when order deleted) |
| `label` | VARCHAR(100) | NOT NULL, UNIQUE per operator | Barcode/label value (what gets scanned at pickup) |
| `package_number` | VARCHAR(20) | NULLABLE | Package sequence ("1 of 3") - FREE-FORM TEXT, app validates |
| `declared_box_count` | INTEGER | DEFAULT 1 | Boxes in package (usually 1, >1 for inefficient retailers) |
| `is_generated_label` | BOOLEAN | DEFAULT FALSE | TRUE if operator created sub-labels from single CTN |
| `parent_label` | VARCHAR(100) | NULLABLE | Original manifest label if this is a sub-label |
| `sku_items` | JSONB | NOT NULL DEFAULT '[]' | Array of SKU items: `[{sku, description, quantity}]` |
| `declared_weight_kg` | DECIMAL(10,2) | NULLABLE | Retailer-declared weight (often underreported) |
| `declared_dimensions` | JSONB | NULLABLE | Retailer-declared dimensions (cm) |
| `verified_weight_kg` | DECIMAL(10,2) | NULLABLE | Operator-measured weight (for billing disputes) |
| `verified_dimensions` | JSONB | NULLABLE | Operator-measured dimensions |
| `metadata` | JSONB | DEFAULT '{}' | System flags (weight discrepancy alerts) |
| `raw_data` | JSONB | NOT NULL | Original manifest package data |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | Record creation timestamp |
| `deleted_at` | TIMESTAMP | NULLABLE | Soft delete timestamp |

### Business Rules

1. **Sub-Label Generation Algorithm:**
   - **Problem:** Some retailers send "CTN001 contains 3 boxes" without individual labels
   - **Solution:** Operator generates sub-labels during import: `CTN001-1`, `CTN001-2`, `CTN001-3`
   - **Implementation:**
     - Set `is_generated_label = true`
     - Set `parent_label = 'CTN001'`
     - Set `declared_box_count = 3`
     - Create 3 package records with labels: `CTN001-1`, `CTN001-2`, `CTN001-3`
   - **Format:** `{parent_label}-{sequence}` (application code enforces this)

2. **SKU Items Array Format:**
   ```json
   [
     {
       "sku": "SHIRT-M-BLUE",
       "description": "Camisa Azul Talla M",
       "quantity": 2
     },
     {
       "sku": "PANTS-L-BLACK",
       "description": "Pantalón Negro Talla L",
       "quantity": 1
     }
   ]
   ```

3. **Weight Discrepancy Tracking:**
   - Retailers often underreport weight to reduce billing
   - `declared_weight_kg` preserved from manifest
   - `verified_weight_kg` measured at operator hub
   - If discrepancy >10%, system sets `metadata.weight_discrepancy_flag = true`
   - Used for billing disputes and contract renegotiation

4. **Package Labels (CTN Numbers):**
   - Format varies by retailer: `CTN12345`, `LPN98765`, `PKG-FAL-001`
   - Database accepts VARCHAR(100) for flexibility
   - Unique constraint per operator (can't scan same CTN twice)

### Example Records

**Standard Package:**
```sql
INSERT INTO public.packages (
  operator_id, order_id, label,
  sku_items, declared_weight_kg, verified_weight_kg,
  raw_data
) VALUES (
  'op-uuid-123',
  'order-uuid-456',
  'CTN12345',
  '[{"sku": "SHIRT-M-BLUE", "description": "Camisa Azul Talla M", "quantity": 2}]',
  5.0,
  8.0,  -- 60% weight discrepancy!
  '{"manifest_line": 12, "retailer_declared_weight": 5.0}'
);
```

**Sub-Label (Generated from CTN001):**
```sql
-- Package 1 of 3 from original CTN001
INSERT INTO public.packages (
  operator_id, order_id, label,
  declared_box_count, is_generated_label, parent_label,
  sku_items, raw_data
) VALUES (
  'op-uuid-123',
  'order-uuid-456',
  'CTN001-1',  -- Generated label
  3,  -- Original package declared 3 boxes
  true,  -- Operator created this label
  'CTN001',  -- Original manifest label
  '[{"sku": "LARGE-ITEM-PART-1", "description": "Large Item Part 1", "quantity": 1}]',
  '{"original_label": "CTN001", "part": 1, "manifest_line": 15}'
);
```

---

## Table Relationships

### Entity-Relationship Diagram

```
┌─────────────────────────┐
│      OPERATORS          │
│  (Multi-Tenant Root)    │
├─────────────────────────┤
│ id (PK)                 │
│ name                    │
│ slug                    │
└───────────┬─────────────┘
            │ 1
            │
            │ N (CASCADE DELETE)
            │
┌───────────▼─────────────┐         ┌──────────────────────────┐
│        ORDERS           │ 1───N   │       PACKAGES           │
├─────────────────────────┤         ├──────────────────────────┤
│ id (PK)                 │         │ id (PK)                  │
│ operator_id (FK)        │◄────────┤ operator_id (FK)         │
│ order_number (UNIQUE)   │         │ order_id (FK) ───────────┤
│ customer_name           │         │ label (UNIQUE per op)    │
│ customer_phone          │         │ sku_items (JSONB)        │
│ delivery_address        │         │ declared_weight_kg       │
│ comuna                  │         │ verified_weight_kg       │
│ delivery_date           │         │ is_generated_label       │
│ retailer_name           │         │ parent_label             │
│ raw_data (JSONB)        │         │ raw_data (JSONB)         │
│ imported_via (ENUM)     │         │ created_at               │
│ deleted_at              │         │ deleted_at               │
└─────────────────────────┘         └──────────────────────────┘
            │
            │ 1
            │
            │ N
            ▼
   (Future: MANIFESTS, LOCATIONS, SCANS, etc.)
```

### Foreign Key Constraints

**orders.operator_id → operators.id**
```sql
REFERENCES public.operators(id) ON DELETE CASCADE
```
- **Behavior:** Deleting an operator deletes all its orders
- **RLS Impact:** Enforces multi-tenant isolation

**packages.operator_id → operators.id**
```sql
REFERENCES public.operators(id) ON DELETE CASCADE
```
- **Behavior:** Deleting an operator deletes all its packages
- **Chain Effect:** operator → orders → packages (all cascade)

**packages.order_id → orders.id**
```sql
REFERENCES public.orders(id) ON DELETE CASCADE
```
- **Behavior:** Deleting an order deletes all its packages
- **Use Case:** If order import fails validation, cleanup is automatic

### Relationship Cardinality

- **1 Operator → N Orders** (one tenant has many orders)
- **1 Operator → N Packages** (redundant FK for performance/RLS)
- **1 Order → N Packages** (one delivery contains multiple cartons)

**Example:**
```
Operator: "LogiTrans Santiago"
  ├─ Order: "FAL-2026-001234" (customer: Juan Pérez)
  │    ├─ Package: "CTN001" (5kg, electronics)
  │    ├─ Package: "CTN002" (2kg, clothing)
  │    └─ Package: "CTN003" (3kg, books)
  └─ Order: "SH-2026-987" (customer: María García)
       ├─ Package: "LPN5001" (1kg, phone case)
       └─ Package: "LPN5002" (0.5kg, charger)
```

---

## Row-Level Security (RLS) Policies

### Overview
Every table enforces **tenant isolation** using PostgreSQL Row-Level Security. Users can only access data for their operator.

### RLS Function: get_operator_id()

```sql
-- Created in Story 1.2 (Multi-Tenant RLS)
CREATE OR REPLACE FUNCTION public.get_operator_id()
RETURNS UUID AS $$
BEGIN
  -- Extract operator_id from JWT custom claim
  RETURN (current_setting('request.jwt.claims', true)::json->>'operator_id')::uuid;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

**How it works:**
1. User logs in via Supabase Auth
2. Auth hook (Story 1.3) adds `operator_id` to JWT custom claims
3. Every request includes JWT in Authorization header
4. `get_operator_id()` extracts `operator_id` from JWT
5. RLS policies filter rows: `WHERE operator_id = get_operator_id()`

### Orders Table RLS Policies

```sql
-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Policy 1: Tenant isolation for ALL operations (INSERT, UPDATE, DELETE)
CREATE POLICY "orders_tenant_isolation" ON public.orders
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

-- Policy 2: Explicit SELECT policy (2026 best practice for UPDATE compatibility)
CREATE POLICY "orders_tenant_select" ON public.orders
  FOR SELECT
  USING (operator_id = public.get_operator_id());

-- Permissions
GRANT SELECT ON public.orders TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.orders TO authenticated;
REVOKE ALL ON public.orders FROM anon;
```

**Why two policies?**
- PostgreSQL UPDATE needs SELECT permission to verify USING clause
- Without explicit SELECT policy, UPDATE fails with permission error
- This is a 2026 best practice for RLS-enabled tables

### Packages Table RLS Policies

```sql
-- Enable RLS
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

-- Policy 1: Tenant isolation for ALL operations
CREATE POLICY "packages_tenant_isolation" ON public.packages
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

-- Policy 2: Explicit SELECT policy
CREATE POLICY "packages_tenant_select" ON public.packages
  FOR SELECT
  USING (operator_id = public.get_operator_id());

-- Permissions
GRANT SELECT ON public.packages TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.packages TO authenticated;
REVOKE ALL ON public.packages FROM anon;
```

### RLS Testing Examples

**Valid Query (Same Operator):**
```sql
-- User's JWT has operator_id = 'op-uuid-123'
SELECT * FROM orders WHERE operator_id = 'op-uuid-123';
-- ✅ Returns rows (matches user's operator_id)
```

**Blocked Query (Cross-Tenant):**
```sql
-- User's JWT has operator_id = 'op-uuid-123'
SELECT * FROM orders WHERE operator_id = 'op-uuid-999';
-- ❌ Returns empty (RLS blocks cross-tenant access)
```

**Blocked INSERT (Cross-Tenant):**
```sql
-- User's JWT has operator_id = 'op-uuid-123'
INSERT INTO orders (operator_id, order_number, ...)
VALUES ('op-uuid-999', 'ORDER-001', ...);
-- ❌ Fails with RLS policy violation
```

---

## Indexes & Performance

### Orders Table Indexes

```sql
-- Index 1: RLS Policy Optimization (CRITICAL for performance)
CREATE INDEX idx_orders_operator_id ON public.orders(operator_id);
```
**Purpose:** Every query filtered by `operator_id` via RLS policy. Without this index, queries do full table scan.

```sql
-- Index 2: Order Lookup
CREATE INDEX idx_orders_operator_order_number ON public.orders(operator_id, order_number);
```
**Purpose:** Fast lookup by order number within operator (search, detail views).

```sql
-- Index 3: Delivery Date Queries
CREATE INDEX idx_orders_delivery_date ON public.orders(operator_id, delivery_date);
```
**Purpose:** Date-range queries for daily delivery lists, capacity planning.

```sql
-- Index 4: Soft Delete Filtering
CREATE INDEX idx_orders_deleted_at ON public.orders(deleted_at);
```
**Purpose:** Fast filtering of active orders: `WHERE deleted_at IS NULL`.

**Total Orders Indexes:** 4 (plus automatic PK and unique constraint indexes)

### Packages Table Indexes

```sql
-- Index 1: RLS Policy Optimization (CRITICAL)
CREATE INDEX idx_packages_operator_id ON public.packages(operator_id);
```

```sql
-- Index 2: Find All Packages for an Order
CREATE INDEX idx_packages_order_id ON public.packages(order_id);
```
**Purpose:** Join packages to orders, reconciliation queries.

```sql
-- Index 3: Package Label Lookup
CREATE INDEX idx_packages_label ON public.packages(operator_id, label);
```
**Purpose:** Barcode scanning: find package by label (CTN12345).

```sql
-- Index 4: Soft Delete Filtering
CREATE INDEX idx_packages_deleted_at ON public.packages(deleted_at);
```

```sql
-- Index 5: Sub-Label Lookups (Partial Index)
CREATE INDEX idx_packages_parent_label ON public.packages(parent_label)
WHERE parent_label IS NOT NULL;
```
**Purpose:** Find all sub-labels generated from parent CTN (CTN001 → CTN001-1, CTN001-2, CTN001-3).

**Total Packages Indexes:** 5 (plus automatic PK and unique constraint indexes)

### Index Naming Convention

**Strict Pattern:** `idx_{tablename}_{columns}`

Examples:
- ✅ `idx_orders_operator_id`
- ✅ `idx_packages_order_id`
- ❌ `orders_operator_index` (missing prefix)
- ❌ `idx_orders_operator` (incomplete column name)

### Performance Notes

**JSONB Fields (raw_data, metadata, sku_items):**
- ✅ NO GIN indexes created
- ✅ PostgreSQL TOAST compression activates for JSONB >2KB
- ✅ Stored in separate TOAST table (extra I/O)
- ✅ Acceptable tradeoff: Fields are write-once, read-rarely

**Why no GIN indexes?**
- JSONB fields used for archive storage, not querying
- GIN indexes increase write overhead significantly
- Application never queries inside `raw_data` (only retrieves for re-processing)

**RLS Performance:**
- **Always index columns in RLS policies** (top performance killer if missing)
- Our policies use `operator_id` → Index on `operator_id` is MANDATORY

---

## Soft Delete Pattern

### Overview
Chilean compliance requires 7-year data retention. All tables use soft delete instead of hard delete.

### Implementation

**Column:**
```sql
deleted_at TIMESTAMP WITH TIME ZONE NULL
```

**Active Records:**
```sql
SELECT * FROM orders WHERE deleted_at IS NULL;
```

**Soft Delete:**
```sql
UPDATE orders SET deleted_at = NOW() WHERE id = '...';
```

**Restoration:**
```sql
UPDATE orders SET deleted_at = NULL WHERE id = '...';
```

**Hard Delete (After 7 Years):**
```sql
DELETE FROM orders WHERE deleted_at < NOW() - INTERVAL '7 years';
```

### Business Rules

1. **Default Application Behavior:** All queries include `WHERE deleted_at IS NULL`
2. **UI Behavior:** Deleted records hidden from users by default
3. **Admin Tools:** Special "view deleted" permission for auditors
4. **Audit Logs:** Soft delete events logged to `audit_logs` table
5. **Foreign Keys:** CASCADE delete still works (soft-deletes children)

### Example Workflow

```sql
-- Create order with packages
INSERT INTO orders (...) VALUES (...) RETURNING id;  -- order-123
INSERT INTO packages (order_id, ...) VALUES ('order-123', ...);  -- pkg-456
INSERT INTO packages (order_id, ...) VALUES ('order-123', ...);  -- pkg-789

-- Soft delete order (cascades to packages via trigger/application logic)
UPDATE orders SET deleted_at = NOW() WHERE id = 'order-123';
UPDATE packages SET deleted_at = NOW() WHERE order_id = 'order-123';

-- Active orders query (excludes deleted)
SELECT * FROM orders WHERE deleted_at IS NULL;
-- Returns: 0 rows (order-123 is soft-deleted)

-- Restore order
UPDATE orders SET deleted_at = NULL WHERE id = 'order-123';
UPDATE packages SET deleted_at = NULL WHERE order_id = 'order-123';
```

---

## Example Queries

### Orders Queries

**1. Find all active orders for today's delivery:**
```sql
SELECT
  id, order_number, customer_name, delivery_address, comuna
FROM orders
WHERE operator_id = public.get_operator_id()
  AND deleted_at IS NULL
  AND delivery_date = CURRENT_DATE
ORDER BY comuna, delivery_address;
```

**2. Search order by number:**
```sql
SELECT * FROM orders
WHERE operator_id = public.get_operator_id()
  AND deleted_at IS NULL
  AND order_number = 'FAL-2026-001234';
```

**3. Orders imported today (by source):**
```sql
SELECT
  imported_via,
  COUNT(*) as order_count
FROM orders
WHERE operator_id = public.get_operator_id()
  AND deleted_at IS NULL
  AND imported_at::date = CURRENT_DATE
GROUP BY imported_via;
```

**4. Orders with delivery window (capacity planning):**
```sql
SELECT
  delivery_date,
  COUNT(*) as order_count,
  COUNT(CASE WHEN delivery_window_start IS NOT NULL THEN 1 END) as windowed_orders
FROM orders
WHERE operator_id = public.get_operator_id()
  AND deleted_at IS NULL
  AND delivery_date BETWEEN '2026-02-20' AND '2026-02-27'
GROUP BY delivery_date
ORDER BY delivery_date;
```

### Packages Queries

**1. Find all packages for an order:**
```sql
SELECT
  p.label, p.sku_items, p.declared_weight_kg, p.verified_weight_kg
FROM packages p
WHERE p.operator_id = public.get_operator_id()
  AND p.deleted_at IS NULL
  AND p.order_id = 'order-uuid-123'
ORDER BY p.created_at;
```

**2. Scan package by barcode (pickup verification):**
```sql
SELECT
  p.id, p.label, p.order_id, o.order_number, o.customer_name
FROM packages p
JOIN orders o ON p.order_id = o.id
WHERE p.operator_id = public.get_operator_id()
  AND p.deleted_at IS NULL
  AND p.label = 'CTN12345';
```

**3. Find all sub-labels generated from parent:**
```sql
SELECT
  label, sku_items, declared_box_count
FROM packages
WHERE operator_id = public.get_operator_id()
  AND deleted_at IS NULL
  AND parent_label = 'CTN001'
ORDER BY label;
-- Returns: CTN001-1, CTN001-2, CTN001-3
```

**4. Weight discrepancy report (billing disputes):**
```sql
SELECT
  o.order_number,
  p.label,
  p.declared_weight_kg,
  p.verified_weight_kg,
  ROUND((p.verified_weight_kg - p.declared_weight_kg) / p.declared_weight_kg * 100, 2) as discrepancy_pct
FROM packages p
JOIN orders o ON p.order_id = o.id
WHERE p.operator_id = public.get_operator_id()
  AND p.deleted_at IS NULL
  AND p.verified_weight_kg IS NOT NULL
  AND p.verified_weight_kg > p.declared_weight_kg * 1.1  -- >10% heavier
ORDER BY discrepancy_pct DESC;
```

### Reconciliation Queries

**5. Pickup reconciliation (signed for vs scanned):**
```sql
-- Orders signed for in manifest
WITH manifest_orders AS (
  SELECT COUNT(DISTINCT id) as signed_count
  FROM orders
  WHERE operator_id = public.get_operator_id()
    AND deleted_at IS NULL
    AND imported_at::date = CURRENT_DATE
),
-- Packages scanned at warehouse
scanned_packages AS (
  SELECT COUNT(*) as scanned_count
  FROM packages
  WHERE operator_id = public.get_operator_id()
    AND deleted_at IS NULL
    AND created_at::date = CURRENT_DATE
)
SELECT
  signed_count as orders_in_manifest,
  scanned_count as packages_scanned,
  scanned_count - signed_count as variance
FROM manifest_orders, scanned_packages;
```

**6. Orders with package count:**
```sql
SELECT
  o.order_number,
  o.customer_name,
  COUNT(p.id) as package_count,
  SUM(p.verified_weight_kg) as total_weight_kg
FROM orders o
LEFT JOIN packages p ON o.id = p.order_id AND p.deleted_at IS NULL
WHERE o.operator_id = public.get_operator_id()
  AND o.deleted_at IS NULL
  AND o.delivery_date = CURRENT_DATE
GROUP BY o.id, o.order_number, o.customer_name
ORDER BY package_count DESC;
```

---

## Migration History

### Story 2.1: Orders + Packages Tables (2026-02-17)

**Migration File:** `20260217000003_create_orders_table.sql`

**Created:**
- ENUM type: `imported_via_enum` (API, EMAIL, MANUAL, CSV)
- Table: `orders` (17 columns)
- Table: `packages` (16 columns)
- Indexes: 9 total (4 orders + 5 packages)
- RLS policies: 4 total (2 per table)
- Audit triggers: 2 (orders + packages)

**Validation:**
- RLS enabled check (orders + packages)
- ENUM type exists check
- All 9 indexes exist check
- Success notices

**Dependencies:**
- Story 1.2: `public.get_operator_id()` function
- Story 1.6: `audit_trigger_func()` function
- Epic 1: `operators` table

**Test Coverage:**
- File: `apps/frontend/__tests__/orders-rls.test.ts`
- Tests: 13 passing (RLS isolation, CASCADE deletes, unique constraints, JSONB, ENUM validation)
- Skipped: 6 (meta-tests for pg_indexes/pg_policies queries, audit trigger tests)

### Future Migrations (Planned)

**Epic 2 (Continued):**
- Story 2.2: CSV/Excel parsing validation enhancements
- Story 2.3: Email parsing (n8n integration)
- Story 2.4: Manual order entry form

**Epic 4 (Pickup Verification):**
- Story 4.1: `manifests` table + `pickup_scans` table
- Story 4.2: Barcode scanning workflows
- Story 4.5: Offline scan queue (IndexedDB → Supabase sync)

**Epic 5 (Order Pipeline):**
- Story 5.1: Order status tracking (`order_statuses` table, 8 pipeline stages)
- Story 5.6: Capacity forecast tables

---

## Appendix: Migration Best Practices

### 1. Always Use Idempotent SQL
```sql
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 2. Validate After Changes
```sql
DO $$
BEGIN
  IF NOT EXISTS (...check...) THEN
    RAISE EXCEPTION 'Critical validation failed!';
  END IF;
  RAISE NOTICE '✓ Migration validation passed';
END $$;
```

### 3. Include Rollback Notes
```sql
-- Rollback: DROP TABLE IF EXISTS public.orders CASCADE;
-- Rollback: DROP TABLE IF EXISTS public.packages CASCADE;
-- Rollback: DROP TYPE IF EXISTS imported_via_enum CASCADE;
```

### 4. Test Locally First
```bash
supabase db reset  # Reset local DB
supabase db push   # Apply migration
supabase db diff   # Verify changes
```

### 5. Document Migration in CHANGELOG
```markdown
## [2026-02-17] - Story 2.1
### Added
- Orders table (17 columns) for multi-source order ingestion
- Packages table (16 columns) for scannable carton tracking
- 9 indexes for RLS and query performance
- Sub-label generation support (declared_box_count pattern)
```

---

**End of Database Schema Documentation**
**Last Updated:** 2026-02-17
**Maintained By:** Aureon DevOps Team
**Contact:** See CLAUDE.md for contribution guidelines
