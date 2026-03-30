'use client';

import { useState, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useCameraIntake } from '@/hooks/pickup/useCameraIntake';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useTenantClients } from '@/hooks/useTenantClients';
import { usePickupPointsByClient } from '@/hooks/pickup/usePickupPointsByClient';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface CameraIntakeProps {
  onClose: () => void;
}

export function CameraIntake({ onClose }: CameraIntakeProps) {
  const { t } = useTranslation();
  const { operatorId } = useOperatorId();
  const { status, result, error, uploadProgress, submit, reset } = useCameraIntake();
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedPickupPointId, setSelectedPickupPointId] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: clients, isLoading: loadingClients } = useTenantClients(operatorId);
  const { data: pickupPoints, isLoading: loadingPickupPoints } = usePickupPointsByClient(
    operatorId,
    selectedClientId || null
  );

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedPickupPointId('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotos((prev) => [...prev, file]);
    }
    // Reset input so same file can be re-selected if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = useCallback((idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

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

  // ── Uploading ──────────────────────────────────────────────────────────────
  if (status === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-text-secondary text-sm">
          {uploadProgress
            ? `Subiendo foto ${uploadProgress.current} de ${uploadProgress.total}...`
            : t('pickup.processing')}
        </p>
      </div>
    );
  }

  // ── Processing ─────────────────────────────────────────────────────────────
  if (status === 'processing') {
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

  // ── Idle — cascading dropdowns + multi-photo ───────────────────────────────
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

      {/* Dropdown 2: Pickup Point */}
      <div>
        <label className="text-sm font-medium text-text mb-1 block">
          {t('pickup.label_pickup_point')}
        </label>
        {selectedClientId && loadingPickupPoints ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span className="text-text-secondary text-sm">Cargando...</span>
          </div>
        ) : selectedClientId && pickupPoints && pickupPoints.length === 0 ? (
          <p className="text-text-secondary text-sm px-1" data-testid="no-pickup-points">
            {t('pickup.no_pickup_points')}
          </p>
        ) : (
          <select
            value={selectedPickupPointId}
            onChange={(e) => setSelectedPickupPointId(e.target.value)}
            disabled={!selectedClientId}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-sm disabled:opacity-50"
            data-testid="pickup-point-select"
          >
            <option value="">{t('pickup.select_pickup_point')}</option>
            {(pickupPoints ?? []).map((pp) => (
              <option key={pp.id} value={pp.id}>
                {pp.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Photo capture / multi-photo strip */}
      {photos.length === 0 ? (
        <button
          disabled={!selectedPickupPointId}
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-3 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {t('pickup.take_photo')}
        </button>
      ) : (
        <>
          {/* Thumbnail strip */}
          <div className="flex gap-2 overflow-x-auto py-2">
            {photos.map((_, idx) => (
              <div
                key={idx}
                className="relative flex-shrink-0 w-16 h-16 rounded-lg bg-surface-secondary flex items-center justify-center"
                data-testid={`photo-thumb-${idx}`}
              >
                <span className="text-xs text-text-secondary">{idx + 1}</span>
                <button
                  onClick={() => removePhoto(idx)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                  data-testid={`remove-photo-${idx}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              disabled={photos.length >= 10}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 py-3 border border-accent text-accent rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Tomar otra pagina
            </button>
            <button
              onClick={() => submit(photos, selectedPickupPointId)}
              className="flex-1 py-3 bg-accent text-white rounded-lg text-sm font-medium"
              data-testid="submit-btn"
            >
              Enviar ({photos.length})
            </button>
          </div>
        </>
      )}

      <button
        onClick={onClose}
        className="w-full py-2 text-text-secondary text-sm"
      >
        {t('pickup.cancel')}
      </button>
    </div>
  );
}
