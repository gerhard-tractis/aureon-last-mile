'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCapacityCalendar } from '@/hooks/useCapacityCalendar';
import { createSPAClient } from '@/lib/supabase/client';
import CapacityCell from './CapacityCell';
import CapacityBulkFill from './CapacityBulkFill';
import type { CapacityRow } from '@/hooks/useCapacityCalendar';

interface CapacityCalendarProps {
  operatorId: string;
  initialMonth?: string; // 'YYYY-MM'
}

interface RetailerOption {
  id: string;
  name: string;
}

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildCalendarGrid(month: string, rows: CapacityRow[]): (CapacityRow | null)[][] {
  const [year, mon] = month.split('-').map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay = new Date(year, mon, 0);

  // Map of date string → row
  const byDate = new Map<string, CapacityRow>();
  for (const r of rows) {
    byDate.set(r.capacity_date, r);
  }

  // Monday=0 offset
  const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const totalDays = lastDay.getDate();

  const cells: (CapacityRow | null | 'empty')[] = [];
  // Pad beginning
  for (let i = 0; i < startDow; i++) cells.push('empty');
  // Days
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
    cells.push(byDate.get(dateStr) ?? null);
  }
  // Pad end to complete last week
  while (cells.length % 7 !== 0) cells.push('empty');

  // Split into weeks
  const weeks: (CapacityRow | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(
      cells.slice(i, i + 7).map((c) => (c === 'empty' ? null : c))
    );
  }
  return weeks;
}

export default function CapacityCalendar({
  operatorId,
  initialMonth,
}: CapacityCalendarProps) {
  const [month, setMonth] = useState<string>(initialMonth ?? getCurrentMonth());
  const [retailers, setRetailers] = useState<RetailerOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const { data, isLoading, dataUpdatedAt } = useCapacityCalendar(
    operatorId,
    selectedClientId,
    month
  );

  // Load retailers on mount
  useEffect(() => {
    async function loadRetailers() {
      const supabase = createSPAClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: clients } = await (supabase.from('tenant_clients') as any)
        .select('id, name')
        .eq('operator_id', operatorId)
        .is('deleted_at', null)
        .order('name');
      if (clients) {
        setRetailers(clients as RetailerOption[]);
        if (clients.length > 0 && !selectedClientId) {
          setSelectedClientId(clients[0].id);
        }
      }
    }
    loadRetailers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId]);

  const [year, mon] = month.split('-').map(Number);
  const monthLabel = `${MONTH_NAMES_ES[mon - 1]} ${year}`;
  const weeks = buildCalendarGrid(month, data ?? []);

  // For each day, find its date string
  function getDateForCell(weekIdx: number, dowIdx: number): string {
    const [y, m] = month.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const startDow = (firstDay.getDay() + 6) % 7;
    const dayNum = weekIdx * 7 + dowIdx - startDow + 1;
    const lastDay = new Date(y, m, 0).getDate();
    if (dayNum < 1 || dayNum > lastDay) return '';
    return `${month}-${String(dayNum).padStart(2, '0')}`;
  }

  const updatedAtLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Retailer selector */}
        <select
          className="border rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={selectedClientId ?? ''}
          onChange={(e) => setSelectedClientId(e.target.value || null)}
          aria-label="Seleccionar retailer"
        >
          {retailers.length === 0 && (
            <option value="">Sin retailers</option>
          )}
          {retailers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground min-w-[120px] text-center">
            {monthLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DOW_LABELS.map((d) => (
              <div
                key={d}
                className="text-center text-xs font-semibold text-muted-foreground py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Weeks */}
          {isLoading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <div
                  key={i}
                  className="min-h-[80px] rounded border bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : (
            weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
                {week.map((cell, di) => {
                  const date = getDateForCell(wi, di);
                  if (!date) {
                    return <div key={di} className="min-h-[80px]" />;
                  }
                  return (
                    <div key={di}>
                      <div className="text-xs text-muted-foreground text-center mb-0.5">
                        {parseInt(date.split('-')[2], 10)}
                      </div>
                      <CapacityCell
                        date={date}
                        capacity={cell?.daily_capacity ?? null}
                        actualOrders={cell ? (cell.actual_orders ?? null) : null}
                        utilizationPct={cell?.utilization_pct ?? null}
                        rowId={null}
                      />
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Updated timestamp */}
      {updatedAtLabel && (
        <p className="text-xs text-muted-foreground text-right">
          Actualizado: {updatedAtLabel}
        </p>
      )}

      {/* Bulk fill */}
      {selectedClientId && (
        <CapacityBulkFill
          operatorId={operatorId}
          clientId={selectedClientId}
          month={month}
        />
      )}
    </div>
  );
}
