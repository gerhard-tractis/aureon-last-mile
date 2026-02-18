-- Migration: Create Orders and Packages Tables with Multi-Tenant RLS
-- Created: 2026-02-17
-- Story: 2.1 - Create Orders Table and Data Model
-- Epic: 2 - Order Data Ingestion
-- Purpose: Create orders + packages tables for multi-source imports (CSV, Email, Manual, API)
--          Orders contain manifest data, Packages contain scannable cartons with SKU details
-- Dependencies:
--   - 20260209000001_auth_function.sql (public.get_operator_id)
--   - 20260216170542_create_users_table_with_rbac.sql (operators table exists)

-- ============================================================================
-- PART 1: Create ENUM Type for Import Method (Task 1.1)
-- ============================================================================

-- Create imported_via ENUM with 4 import sources (idempotent)
DO $$ BEGIN
  CREATE TYPE imported_via_enum AS ENUM (
    'API',     -- Programmatic API import
    'EMAIL',   -- Email manifest parsing (n8n)
    'MANUAL',  -- Manual entry form
    'CSV'      -- CSV/Excel upload
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE imported_via_enum IS 'Order import source tracking for Epic 2 multi-channel ingestion';

-- ============================================================================
-- PART 2: Create Orders Table (Task 1.2)
-- ============================================================================

-- Handle migration conflict: Old orders table exists from previous .bak migration
-- Drop old schema and recreate with new Epic 2 requirements
DO $$
BEGIN
  -- Check if old orders table exists with old schema (has 'barcode' column instead of 'comuna')
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'orders'
    AND column_name = 'barcode'
  ) THEN
    -- Old schema detected - drop and recreate
    RAISE NOTICE 'Detected old orders table schema - dropping and recreating for Epic 2';
    DROP TABLE IF EXISTS public.orders CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  order_number VARCHAR(50) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  delivery_address TEXT NOT NULL,
  comuna VARCHAR(100) NOT NULL,
  delivery_date DATE NOT NULL,
  delivery_window_start TIME,
  delivery_window_end TIME,
  retailer_name VARCHAR(50),
  raw_data JSONB NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  imported_via imported_via_enum NOT NULL,
  imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_order_number_per_operator UNIQUE (operator_id, order_number)
);

COMMENT ON TABLE public.orders IS 'Orders table with multi-source import support (CSV, Email, Manual, API) and tenant isolation';
COMMENT ON COLUMN public.orders.operator_id IS 'Tenant identifier for multi-tenant isolation';
COMMENT ON COLUMN public.orders.order_number IS 'Retailer-assigned order ID (unique within operator)';
COMMENT ON COLUMN public.orders.customer_phone IS 'Chilean phone format validation in app layer (+56 9XXXXXXXX mobile, +56 2XXXXXXXX landline)';
COMMENT ON COLUMN public.orders.comuna IS 'Chilean administrative district for delivery routing';
COMMENT ON COLUMN public.orders.raw_data IS 'Original payload from any source - preserves audit trail for re-processing (TOAST compressed >2KB)';
COMMENT ON COLUMN public.orders.metadata IS 'System-managed flags (e.g., {truncated: true, original_size: 1048576} if raw_data >1MB)';
COMMENT ON COLUMN public.orders.imported_via IS 'Data ingestion method (API/EMAIL/MANUAL/CSV)';
COMMENT ON COLUMN public.orders.deleted_at IS 'Soft delete timestamp (7-year data retention for Chilean compliance)';

-- ============================================================================
-- PART 3: Create Performance Indexes (Task 1.3)
-- ============================================================================

-- Index on operator_id (CRITICAL for RLS policy performance)
CREATE INDEX idx_orders_operator_id ON public.orders(operator_id);

-- Composite index for order lookups (operator + order_number)
CREATE INDEX idx_orders_operator_order_number ON public.orders(operator_id, order_number);

-- Composite index for delivery date queries (operator + date range)
CREATE INDEX idx_orders_delivery_date ON public.orders(operator_id, delivery_date);

-- Index on deleted_at for active order queries (WHERE deleted_at IS NULL)
CREATE INDEX idx_orders_deleted_at ON public.orders(deleted_at);

-- ============================================================================
-- PART 4: Enable Row-Level Security (Task 1.4)
-- ============================================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 5: Create RLS Policies (Task 1.4)
-- ============================================================================

-- Policy 1: Tenant isolation for ALL operations
CREATE POLICY "orders_tenant_isolation" ON public.orders
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

-- Policy 2: Explicit SELECT policy for UPDATE compatibility (2026 best practice)
-- Without SELECT, PostgreSQL can't verify USING clause on UPDATE
CREATE POLICY "orders_tenant_select" ON public.orders
  FOR SELECT
  USING (operator_id = public.get_operator_id());

-- Grant permissions
GRANT SELECT ON public.orders TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.orders TO authenticated;  -- RLS controls access
REVOKE ALL ON public.orders FROM anon;

-- ============================================================================
-- PART 6: Enable Audit Logging (from Story 1.6)
-- ============================================================================

-- Attach audit logging trigger (uses audit_trigger_func from Story 1.6)
CREATE TRIGGER audit_orders_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

COMMENT ON TRIGGER audit_orders_changes ON public.orders IS 'Audit trigger: Logs all order changes to audit_logs table';

-- ============================================================================
-- PART 7: Create Packages Table (Scannable Cartons with SKU Details)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  -- Scanning identifier (flexible format: CTN12345, LPN98765, etc.)
  label VARCHAR(100) NOT NULL,

  -- Package sequencing (handle inefficient retailers who don't pre-label individual boxes)
  package_number VARCHAR(20),                -- "1 of 3" (if retailer provides)
  declared_box_count INTEGER DEFAULT 1,      -- Boxes in package (usually 1, sometimes 3+ requiring split)
  is_generated_label BOOLEAN DEFAULT FALSE,  -- TRUE if operator created sub-label (CTN001-1, CTN001-2)
  parent_label VARCHAR(100),                 -- Original CTN if this is a sub-label

  -- SKU contents (array of items per package from manifest)
  sku_items JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{sku, description, quantity}, ...]

  -- Physical attributes (retailer-declared, often WRONG for billing manipulation)
  declared_weight_kg DECIMAL(10,2),
  declared_dimensions JSONB,                 -- {length, width, height, unit}

  -- Verified attributes (operator-measured for accurate billing)
  verified_weight_kg DECIMAL(10,2),          -- NULL until measured
  verified_dimensions JSONB,                 -- NULL until measured

  -- Metadata & audit trail
  metadata JSONB DEFAULT '{}'::jsonb,        -- {weight_discrepancy_flag: true, etc.}
  raw_data JSONB NOT NULL,                   -- Original manifest package data

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT unique_label_per_operator UNIQUE (operator_id, label)
);

COMMENT ON TABLE public.packages IS 'Scannable packages/cartons with SKU details and physical attributes';
COMMENT ON COLUMN public.packages.label IS 'Barcode/label value (CTN12345, LPN98765) - what gets scanned at pickup';
COMMENT ON COLUMN public.packages.declared_box_count IS 'Number of boxes retailer declared (usually 1, >1 for inefficient retailers)';
COMMENT ON COLUMN public.packages.is_generated_label IS 'TRUE if operator created sub-labels (CTN001-1, CTN001-2) from single CTN001';
COMMENT ON COLUMN public.packages.sku_items IS 'Array of SKU items: [{sku, description, quantity}] from manifest';
COMMENT ON COLUMN public.packages.declared_weight_kg IS 'Retailer-declared weight (often underreported for billing)';
COMMENT ON COLUMN public.packages.verified_weight_kg IS 'Operator-measured weight (for accurate billing and dispute resolution)';
COMMENT ON COLUMN public.packages.deleted_at IS 'Soft delete timestamp (7-year data retention for Chilean compliance)';

-- ============================================================================
-- PART 8: Create Packages Indexes
-- ============================================================================

-- Index on operator_id (CRITICAL for RLS policy performance)
CREATE INDEX idx_packages_operator_id ON public.packages(operator_id);

-- Index on order_id (find all packages for an order)
CREATE INDEX idx_packages_order_id ON public.packages(order_id);

-- Composite index for package lookups by label
CREATE INDEX idx_packages_label ON public.packages(operator_id, label);

-- Index on deleted_at for active package queries
CREATE INDEX idx_packages_deleted_at ON public.packages(deleted_at);

-- Index on parent_label for finding generated sub-labels
CREATE INDEX idx_packages_parent_label ON public.packages(parent_label) WHERE parent_label IS NOT NULL;

-- ============================================================================
-- PART 9: Enable RLS on Packages Table
-- ============================================================================

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 10: Create RLS Policies for Packages
-- ============================================================================

-- Policy 1: Tenant isolation for ALL operations
CREATE POLICY "packages_tenant_isolation" ON public.packages
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

-- Policy 2: Explicit SELECT policy for UPDATE compatibility (2026 best practice)
CREATE POLICY "packages_tenant_select" ON public.packages
  FOR SELECT
  USING (operator_id = public.get_operator_id());

-- Grant permissions
GRANT SELECT ON public.packages TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.packages TO authenticated;
REVOKE ALL ON public.packages FROM anon;

-- ============================================================================
-- PART 11: Enable Audit Logging on Packages
-- ============================================================================

-- Attach audit logging trigger (uses audit_trigger_func from Story 1.6)
CREATE TRIGGER audit_packages_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

COMMENT ON TRIGGER audit_packages_changes ON public.packages IS 'Audit trigger: Logs all package changes to audit_logs table';

-- ============================================================================
-- PART 12: Migration Validation
-- ============================================================================

DO $$
BEGIN
  -- Verify RLS enabled on orders
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    AND c.relname = 'orders'
    AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on public.orders table!';
  END IF;

  -- Verify RLS enabled on packages
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    AND c.relname = 'packages'
    AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on public.packages table!';
  END IF;

  -- Verify ENUM type created
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'imported_via_enum'
  ) THEN
    RAISE EXCEPTION 'ENUM type imported_via_enum not found!';
  END IF;

  -- Verify orders indexes exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'orders'
    AND indexname = 'idx_orders_operator_id'
  ) THEN
    RAISE EXCEPTION 'Critical index idx_orders_operator_id not found!';
  END IF;

  -- Verify packages indexes exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'packages'
    AND indexname = 'idx_packages_operator_id'
  ) THEN
    RAISE EXCEPTION 'Critical index idx_packages_operator_id not found!';
  END IF;

  RAISE NOTICE '✓ Story 2.1 migration complete - orders + packages tables with multi-tenant isolation created';
  RAISE NOTICE '  ';
  RAISE NOTICE '  Orders Table:';
  RAISE NOTICE '    - 17 columns with multi-source import support (CSV, Email, Manual, API)';
  RAISE NOTICE '    - 4 performance indexes (including RLS optimization)';
  RAISE NOTICE '    - RLS policies for tenant isolation';
  RAISE NOTICE '    - Audit logging enabled';
  RAISE NOTICE '  ';
  RAISE NOTICE '  Packages Table:';
  RAISE NOTICE '    - 16 columns with SKU tracking and physical attributes';
  RAISE NOTICE '    - 5 performance indexes (including parent_label for sub-label lookups)';
  RAISE NOTICE '    - Support for inefficient retailers (declared_box_count, is_generated_label)';
  RAISE NOTICE '    - Verified weight/dimensions for billing accuracy';
  RAISE NOTICE '    - RLS policies for tenant isolation';
  RAISE NOTICE '    - Audit logging enabled';
  RAISE NOTICE '  ';
  RAISE NOTICE '  Ready for Stories 2.2 (CSV), 2.3 (Email), 2.4 (Manual)';
END $$;
