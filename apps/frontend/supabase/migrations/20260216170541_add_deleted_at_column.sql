-- Add deleted_at column for Story 1.2 compliance requirement
ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Add index for soft delete queries
CREATE INDEX IF NOT EXISTS idx_operators_deleted_at ON public.operators(deleted_at);
