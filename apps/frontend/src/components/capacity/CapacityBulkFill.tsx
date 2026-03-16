'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useBulkFillCapacity } from '@/hooks/useCapacityMutations';
import type { BulkFillCapacityRow } from '@/hooks/useCapacityMutations';

interface CapacityBulkFillProps {
  operatorId: string;
  clientId: string;
  month: string; // 'YYYY-MM'
}

function generateMonthRows(
  month: string,
  weekdayCapacity: number,
  saturdayCapacity: number
): BulkFillCapacityRow[] {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const rows: BulkFillCapacityRow[] = [];

  for (let day = 1; day <= lastDay; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const d = new Date(`${date}T00:00:00`);
    const dow = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat

    let capacity: number;
    if (dow === 0) {
      capacity = 0; // Sunday closed
    } else if (dow === 6) {
      capacity = saturdayCapacity;
    } else {
      capacity = weekdayCapacity;
    }

    rows.push({ capacity_date: date, daily_capacity: capacity, source: 'rule' });
  }

  return rows;
}

export default function CapacityBulkFill({
  operatorId,
  clientId,
  month,
}: CapacityBulkFillProps) {
  const [weekdayVal, setWeekdayVal] = useState('');
  const [satVal, setSatVal] = useState('');
  const { mutate, isPending } = useBulkFillCapacity();

  const weekdayNum = parseInt(weekdayVal, 10);
  const satNum = parseInt(satVal, 10);
  const isValid = !isNaN(weekdayNum) && weekdayNum >= 0 && !isNaN(satNum) && satNum >= 0;

  const handleConfirm = () => {
    if (!isValid) return;
    const rows = generateMonthRows(month, weekdayNum, satNum);
    mutate({ operatorId, clientId, rows });
  };

  return (
    <div className="flex flex-wrap items-end gap-4 p-4 bg-card border rounded-lg">
      <div className="flex flex-col gap-1">
        <label htmlFor="weekday-capacity" className="text-sm font-medium text-foreground">
          Lun-Vie
        </label>
        <Input
          id="weekday-capacity"
          type="number"
          min={0}
          placeholder="ej. 300"
          className="w-28"
          value={weekdayVal}
          onChange={(e) => setWeekdayVal(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="sat-capacity" className="text-sm font-medium text-foreground">
          Sáb
        </label>
        <Input
          id="sat-capacity"
          type="number"
          min={0}
          placeholder="ej. 150"
          className="w-28"
          value={satVal}
          onChange={(e) => setSatVal(e.target.value)}
        />
      </div>

      <span className="text-xs text-muted-foreground self-end pb-2">Dom: 0 (cerrado)</span>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={!isValid || isPending} className="self-end">
            Aplicar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar llenado masivo</AlertDialogTitle>
            <AlertDialogDescription>
              Esto sobreescribirá la capacidad de todos los días del mes para este retailer.
              Lun–Vie: <strong>{weekdayVal}</strong>, Sáb: <strong>{satVal}</strong>, Dom: 0.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
