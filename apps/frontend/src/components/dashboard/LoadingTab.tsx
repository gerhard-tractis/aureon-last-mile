'use client';

import { useState } from 'react';
import DateFilterBar, { type DatePreset } from './DateFilterBar';
import { useDatePreset } from '@/hooks/useDatePreset';
import LoadingKPIStrip from './LoadingKPIStrip';
import DailyOrdersChart from './DailyOrdersChart';
import CommittedOrdersChart from './CommittedOrdersChart';
import OrdersByClientTable from './OrdersByClientTable';
import OrdersByComunaTable from './OrdersByComunaTable';

interface LoadingTabProps {
  operatorId: string;
}

export default function LoadingTab({ operatorId }: LoadingTabProps) {
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { startDate, endDate, prevStartDate, prevEndDate } = useDatePreset(
    preset,
    customStart,
    customEnd
  );

  return (
    <div className="space-y-6" data-testid="loading-tab">
      <DateFilterBar
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={setPreset}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />

      <LoadingKPIStrip
        operatorId={operatorId}
        startDate={startDate}
        endDate={endDate}
        prevStartDate={prevStartDate}
        prevEndDate={prevEndDate}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DailyOrdersChart
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
        <CommittedOrdersChart
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrdersByClientTable
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
        <OrdersByComunaTable
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
        />
      </div>
    </div>
  );
}
