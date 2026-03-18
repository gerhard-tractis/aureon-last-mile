-- =============================================================
-- Epic 5: Migrate order_status_enum to 8-stage pipeline model
-- Old values: pending, processing, dispatched, delivered, failed
-- New values: ingresado, verificado, en_bodega, asignado,
--             en_carga, listo, en_ruta, entregado, cancelado
-- =============================================================

-- Step 1: Create new enum types
CREATE TYPE package_status_enum AS ENUM (
  'ingresado', 'verificado', 'en_bodega', 'asignado',
  'en_carga', 'listo', 'en_ruta', 'entregado',
  'cancelado', 'devuelto', 'dañado', 'extraviado'
);

CREATE TYPE new_order_status_enum AS ENUM (
  'ingresado', 'verificado', 'en_bodega', 'asignado',
  'en_carga', 'listo', 'en_ruta', 'entregado',
  'cancelado'
);

-- Step 2: Add new status column with mapped values
ALTER TABLE orders ADD COLUMN new_status new_order_status_enum;

UPDATE orders SET new_status = CASE status::text
  WHEN 'pending'    THEN 'ingresado'::new_order_status_enum
  WHEN 'processing' THEN 'asignado'::new_order_status_enum
  WHEN 'dispatched' THEN 'en_ruta'::new_order_status_enum
  WHEN 'delivered'  THEN 'entregado'::new_order_status_enum
  WHEN 'failed'     THEN 'cancelado'::new_order_status_enum
  ELSE                   'ingresado'::new_order_status_enum
END;

ALTER TABLE orders ALTER COLUMN new_status SET NOT NULL;
ALTER TABLE orders ALTER COLUMN new_status SET DEFAULT 'ingresado';

-- Step 3: Drop old column and rename new
ALTER TABLE orders DROP COLUMN status;
ALTER TABLE orders RENAME COLUMN new_status TO status;

-- Step 4: Drop old enum, rename new to final name
DROP TYPE order_status_enum;
ALTER TYPE new_order_status_enum RENAME TO order_status_enum;
