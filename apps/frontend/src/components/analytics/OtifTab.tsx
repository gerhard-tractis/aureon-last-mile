'use client';

import { useState } from 'react';
import DateFilterBar, { type DatePreset } from '@/components/dashboard/DateFilterBar';
import { useDatePreset } from '@/hooks/useDatePreset';
import HeroSLA from '@/components/dashboard/HeroSLA';
import OtifByRetailerTable from '@/components/dashboard/OtifByRetailerTable';
import LateDeliveriesTable from '@/components/dashboard/LateDeliveriesTable';

interface OtifTabProps {
  operatorId: string;
}

export default function OtifTab({ operatorId }: OtifTabProps) {
  const [preset, setPreset] = useState<DatePreset>('last_7_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { startDate, endDate } = useDatePreset(preset, customStart, customEnd);

  return (
    <div className="space-y-6" data-testid="otif-tab">
      <DateFilterBar
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={setPreset}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />
      <HeroSLA operatorId={operatorId} startDate={startDate} endDate={endDate} />
      <OtifByRetailerTable operatorId={operatorId} startDate={startDate} endDate={endDate} />
      <LateDeliveriesTable operatorId={operatorId} startDate={startDate} endDate={endDate} />
    </div>
  );
}
