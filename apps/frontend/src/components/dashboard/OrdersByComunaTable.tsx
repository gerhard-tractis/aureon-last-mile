'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useOrdersByComuna } from '@/hooks/useLoadingMetrics';

interface OrdersByComunaTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

const fmt = (n: number) => n.toLocaleString('es-CL');

export default function OrdersByComunaTable({ operatorId, startDate, endDate }: OrdersByComunaTableProps) {
  const [selectedRegion, setSelectedRegion] = useState<string | undefined>(undefined);

  const { data: regions } = useQuery({
    queryKey: ['loading', operatorId, 'distinct-regions', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('orders')
        .select('recipient_region')
        .gte('created_at', `${startDate}T00:00:00-03:00`)
        .lt('created_at', `${endDate}T23:59:59.999-03:00`)
        .is('deleted_at', null)
        .not('recipient_region', 'is', null);
      if (error) throw error;
      return [...new Set((data as { recipient_region: string }[])?.map(d => d.recipient_region).filter(Boolean))].sort();
    },
    enabled: !!operatorId,
    staleTime: 30000,
  });

  const { data, isLoading } = useOrdersByComuna(operatorId, startDate, endDate, selectedRegion);

  return (
    <div className="bg-card rounded-xl p-6 shadow-sm border border-border">
      <h2 className="text-lg font-semibold text-foreground mb-4">Órdenes por Comuna</h2>

      <select
        value={selectedRegion ?? ''}
        onChange={e => setSelectedRegion(e.target.value || undefined)}
        className="text-sm border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#e6c15c] mb-4"
      >
        <option value="">Todas las regiones</option>
        {regions?.map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-4 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Sin datos para el período seleccionado
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="pb-2">Comuna</th>
              <th className="pb-2 text-right">Órdenes</th>
              <th className="pb-2 text-right">% del Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr
                key={row.comuna}
                className={`border-b border-border ${idx % 2 === 1 ? 'bg-muted' : ''}`}
              >
                <td className="py-2">{row.comuna}</td>
                <td className="py-2 text-right tabular-nums">{fmt(row.count)}</td>
                <td className="py-2 text-right tabular-nums">{row.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
