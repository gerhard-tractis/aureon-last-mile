import { useEffect, useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

export function useOperatorId() {
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const claims = session?.user?.app_metadata?.claims;
      setOperatorId(claims?.operator_id ?? null);
      setRole(claims?.role ?? null);
      setPermissions(claims?.permissions ?? []);
    });
  }, []);

  return { operatorId, role, permissions };
}
