import { useGlobal } from '@/lib/context/GlobalContext';

export function useOperatorId() {
  const { operatorId, role, permissions } = useGlobal();
  return { operatorId, role, permissions };
}
