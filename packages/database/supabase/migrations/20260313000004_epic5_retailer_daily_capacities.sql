-- =============================================================
-- Epic 5: Create retailer_daily_capacities table
-- Tracks negotiated daily delivery capacity per retailer per date
-- =============================================================

CREATE TABLE retailer_daily_capacities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES tenant_clients(id) ON DELETE CASCADE,
  capacity_date DATE NOT NULL,
  daily_capacity INT NOT NULL CHECK (daily_capacity >= 0),
  source VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'rule', 'ai_agent')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Partial unique index: allows re-inserting after soft delete
CREATE UNIQUE INDEX idx_rdc_unique_active
  ON retailer_daily_capacities(operator_id, client_id, capacity_date)
  WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX idx_rdc_operator_date
  ON retailer_daily_capacities(operator_id, capacity_date);
CREATE INDEX idx_rdc_operator_client_date
  ON retailer_daily_capacities(operator_id, client_id, capacity_date);

-- Updated_at trigger
CREATE TRIGGER set_rdc_updated_at
  BEFORE UPDATE ON retailer_daily_capacities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row Level Security
ALTER TABLE retailer_daily_capacities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rdc_tenant_isolation" ON retailer_daily_capacities
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE POLICY "rdc_tenant_select" ON retailer_daily_capacities
  FOR SELECT
  USING (operator_id = public.get_operator_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON retailer_daily_capacities TO authenticated;
REVOKE ALL ON retailer_daily_capacities FROM anon;

-- Audit trigger
CREATE TRIGGER audit_rdc_changes
  AFTER INSERT OR UPDATE OR DELETE ON retailer_daily_capacities
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
