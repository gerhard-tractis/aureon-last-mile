-- spec-33: add soft delete support to tenant_clients
ALTER TABLE public.tenant_clients ADD COLUMN deleted_at TIMESTAMPTZ;
