-- spec-33: allow admin/operations_manager to write pickup_points within their operator
CREATE POLICY pickup_points_admin_write ON public.pickup_points
  FOR ALL
  TO authenticated
  USING (
    operator_id = public.get_operator_id()
    AND (
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role')
      IN ('admin', 'operations_manager')
    )
  )
  WITH CHECK (
    operator_id = public.get_operator_id()
    AND (
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role')
      IN ('admin', 'operations_manager')
    )
  );
