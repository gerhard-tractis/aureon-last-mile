'use client';

import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useCameraIntake } from '@/hooks/pickup/useCameraIntake';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useTenantClients } from '@/hooks/useTenantClients';
import { useGeneratorsByClient } from '@/hooks/pickup/useGeneratorsByClient';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface CameraIntakeProps {
  onClose: () => void;
}

export function CameraIntake({ onClose }: CameraIntakeProps) {
  const { t } = useTranslation();
  const { operatorId } = useOperatorId();
  const { status, result, error, submit, reset } = useCameraIntake();
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedGeneratorId, setSelectedGeneratorId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: clients, isLoading: loadingClients } = useTenantClients(operatorId);
  const { data: generators, isLoading: loadingGenerators } = useGeneratorsByClient(
    operatorId,
    selectedClientId || null
  );

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedGeneratorId('');
  };

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

  // ── Loading clients ────────────────────────────────────────────────────────
  if (loadingClients) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-text-secondary text-sm">{t('pickup.loading_clients')}</p>
      </div>
    );
  }

  // ── No clients ─────────────────────────────────────────────────────────────
  if (!clients || clients.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="text-text font-semibold">{t('pickup.no_clients')}</p>
        <p className="text-text-secondary text-sm text-center">
          {t('pickup.no_clients_hint')}
        </p>
        <button
          onClick={onClose}
          className="w-full py-2 text-text-secondary text-sm"
        >
          {t('pickup.close')}
        </button>
      </div>
    );
  }

  // ── Idle — cascading dropdowns ─────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Dropdown 1: Client */}
      <div>
        <label className="text-sm font-medium text-text mb-1 block">
          {t('pickup.label_client')}
        </label>
        <select
          value={selectedClientId}
          onChange={(e) => handleClientChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-sm"
          data-testid="client-select"
        >
          <option value="">{t('pickup.select_client')}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Dropdown 2: Pickup Point (generator) */}
      <div>
        <label className="text-sm font-medium text-text mb-1 block">
          {t('pickup.label_pickup_point')}
        </label>
        {selectedClientId && loadingGenerators ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span className="text-text-secondary text-sm">Cargando...</span>
          </div>
        ) : selectedClientId && generators && generators.length === 0 ? (
          <p className="text-text-secondary text-sm px-1" data-testid="no-pickup-points">
            {t('pickup.no_pickup_points')}
          </p>
        ) : (
          <select
            value={selectedGeneratorId}
            onChange={(e) => setSelectedGeneratorId(e.target.value)}
            disabled={!selectedClientId}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-sm disabled:opacity-50"
            data-testid="generator-select"
          >
            <option value="">{t('pickup.select_pickup_point')}</option>
            {(generators ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </div>

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
