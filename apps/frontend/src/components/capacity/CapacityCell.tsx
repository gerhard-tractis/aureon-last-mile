'use client';

import { useState, useRef, useEffect } from 'react';
import { useUpdateCapacity } from '@/hooks/useCapacityMutations';

interface CapacityCellProps {
  date: string;
  capacity: number | null;
  actualOrders: number | null;
  utilizationPct: number | null;
  rowId: string | null;
}

function getUtilizationClass(pct: number | null): string {
  if (pct === null) return '';
  if (pct > 120) return 'bg-red-100 border-red-300 dark:bg-red-950 dark:border-red-700';
  if (pct > 100) return 'bg-orange-100 border-orange-300 dark:bg-orange-950 dark:border-orange-700';
  if (pct >= 80) return 'bg-yellow-100 border-yellow-300 dark:bg-yellow-950 dark:border-yellow-700';
  return 'bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-700';
}

function isFutureDate(date: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return date > today;
}

export default function CapacityCell({
  date,
  capacity,
  actualOrders,
  utilizationPct,
  rowId,
}: CapacityCellProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutate, isPending } = useUpdateCapacity();

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleStartEdit = () => {
    if (rowId === null) return;
    setEditValue(String(capacity ?? 0));
    setEditing(true);
  };

  const handleSave = () => {
    const val = parseInt(editValue, 10);
    if (!isNaN(val) && rowId) {
      mutate(
        { id: rowId, daily_capacity: val },
        { onSettled: () => setEditing(false) }
      );
    } else {
      setEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  // No capacity — past date
  if (capacity === null && !isFutureDate(date)) {
    return (
      <div className="min-h-[80px] p-1 border rounded text-center flex items-center justify-center text-muted-foreground text-xs bg-muted">
        <span>N/A</span>
      </div>
    );
  }

  // No capacity — future date
  if (capacity === null && isFutureDate(date)) {
    return (
      <div className="min-h-[80px] p-1 border-2 border-dashed rounded text-center flex items-center justify-center text-muted-foreground text-xs">
        <span>—</span>
      </div>
    );
  }

  const utilizationColor = getUtilizationClass(utilizationPct);

  return (
    <div className={`min-h-[80px] p-1 border rounded text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer ${utilizationColor}`}>
      {/* Capacity row — editable */}
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          className="w-16 text-center text-sm font-semibold border rounded px-1 bg-background text-foreground"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          disabled={isPending}
          aria-label="Capacidad diaria"
        />
      ) : (
        <span
          className="text-sm font-semibold text-foreground cursor-pointer hover:underline"
          onClick={handleStartEdit}
          title="Clic para editar"
        >
          {capacity}
        </span>
      )}

      {/* Actual orders */}
      <span className="text-xs text-muted-foreground">
        {actualOrders !== null ? actualOrders : '—'}
      </span>

      {/* Utilization % */}
      {utilizationPct !== null && (
        <span className="text-xs font-medium">
          {Math.round(utilizationPct)}%
        </span>
      )}
    </div>
  );
}
