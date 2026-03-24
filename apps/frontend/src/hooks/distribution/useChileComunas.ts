import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ChileComunaRecord {
  id: string;
  nombre: string;
  region: string;
  region_num: number;
}

export function useChileComunas() {
  return useQuery({
    queryKey: ['chile-comunas'],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('chile_comunas')
        .select('id, nombre, region, region_num')
        .order('nombre');
      if (error) throw error;
      return data as ChileComunaRecord[];
    },
    staleTime: Infinity,
  });
}
