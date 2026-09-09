'use client';

import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ManifestNotDownloadedNoticeProps {
  externalLoadId: string;
  onBack: () => void;
}

/**
 * spec-82 fase 2 (mock 5c/5d) — la contraparte honesta de "DESCARGAR": esta
 * carga nunca se bajó al dispositivo y no hay señal para traerla ahora.
 * `5d` se niega a entrar en vez de dejar escanear contra órdenes/bultos que
 * no van a llegar — escanear igual produciría "no encontrado" para todo,
 * indistinguible de un error real de manifiesto.
 */
export function ManifestNotDownloadedNotice({
  externalLoadId,
  onBack,
}: ManifestNotDownloadedNoticeProps) {
  return (
    <div className="p-6 max-w-md mx-auto space-y-4 text-center">
      <WifiOff className="h-10 w-10 text-text-muted mx-auto" />
      <p className="text-text font-semibold">{externalLoadId} no está descargada</p>
      <p className="text-sm text-text-secondary">
        Esta carga no se descargó al dispositivo. Necesitas conexión para
        traerla antes de poder escanear sin red.
      </p>
      <Button onClick={onBack}>Volver</Button>
    </div>
  );
}
