-- spec-33: make connector_type nullable to allow clients without connectors
ALTER TABLE public.tenant_clients ALTER COLUMN connector_type DROP NOT NULL;
