'use client';

import { useEffect, useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { createSPAClient } from '@/lib/supabase/client';
import { useCameraIntake } from '@/hooks/pickup/useCameraIntake';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Generator {
  id: string;
  name: string;
}

interface CameraIntakeProps {
  onClose: () => void;
}

export function CameraIntake({ onClose }: CameraIntakeProps) {
  const { t } = useTranslation();
  const { operatorId } = useOperatorId();
  const { status, result, error, submit, reset } = useCameraIntake();
  const [generators, setGenerators] = useState<Generator[]>([]);
  const [selectedGeneratorId, setSelectedGeneratorId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    ;(supabase.from as CallableFunction)('generators')
      .select('id, name')
      .eq('operator_id', operatorId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .then(({ data }: { data: Generator[] | null }) => {
        const gens = data ?? [];
        setGenerators(gens);
        if (gens.length > 0) setSelectedGeneratorId(gens[0].id);
      });
  }, [operatorId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedGeneratorId) {
      submit(file, selectedGeneratorId);
    }
  };

  // ── Success ────────────────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="text-text font-semibold">{t('pickup.success')}</p>
        <p className="text-text-secondary">
          {t('pickup.orders_created', { count: result?.ordersCreated ?? 0 })}
        </p>
        <button
          onClick={onClose}
          className="px-6 py-2 bg-accent text-white rounded-lg text-sm font-medium"
        >
          {t('pickup.close')}
        </button>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="text-text font-semibold">{t('pickup.error')}</p>
        <p className="text-text-secondary text-sm">{error}</p>
        <button
          onClick={reset}
          className="px-6 py-2 bg-accent text-white rounded-lg text-sm font-medium"
        >
          {t('pickup.retry')}
        </button>
      </div>
    );
  }

  // ── Processing ─────────────────────────────────────────────────────────────
  if (status === 'processing' || status === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-text-secondary text-sm">{t('pickup.processing')}</p>
      </div>
    );
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">{t('pickup.select_generator')}</p>
      <select
        value={selectedGeneratorId}
        onChange={(e) => setSelectedGeneratorId(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-sm"
      >
        {generators.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        disabled={!selectedGeneratorId}
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-3 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50"
      >
        {t('pickup.take_photo')}
      </button>

      <button
        onClick={onClose}
        className="w-full py-2 text-text-secondary text-sm"
      >
        {t('pickup.cancel')}
      </button>
    </div>
  );
}
