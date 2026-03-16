-- =============================================================
-- Epic 5: Add status columns, updated_at, and indexes
-- =============================================================

-- packages: add status tracking
ALTER TABLE packages ADD COLUMN status package_status_enum NOT NULL DEFAULT 'ingresado';
ALTER TABLE packages ADD COLUMN status_updated_at TIMESTAMPTZ DEFAULT NOW();

-- orders: add leading_status + status_updated_at (status column already migrated)
ALTER TABLE orders ADD COLUMN leading_status order_status_enum NOT NULL DEFAULT 'ingresado';
ALTER TABLE orders ADD COLUMN status_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Fix missing updated_at on orders and packages
ALTER TABLE orders ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE packages ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TRIGGER set_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_packages_updated_at
  BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- New indexes
CREATE INDEX idx_orders_operator_status ON orders(operator_id, status);
CREATE INDEX idx_orders_operator_leading ON orders(operator_id, leading_status);
CREATE INDEX idx_packages_operator_status ON packages(operator_id, status);
CREATE INDEX idx_packages_order_status ON packages(order_id, status);
