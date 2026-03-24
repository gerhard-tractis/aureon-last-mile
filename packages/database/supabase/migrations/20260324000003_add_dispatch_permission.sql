-- Add 'dispatch' permission to loading_crew, operations_manager, and admin users
-- who do not already have it.
UPDATE public.users
SET permissions = array_append(permissions, 'dispatch')
WHERE role IN ('loading_crew', 'operations_manager', 'admin')
  AND NOT ('dispatch' = ANY(permissions))
  AND deleted_at IS NULL;
