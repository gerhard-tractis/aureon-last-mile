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
      {/* spec-82 fase 2, revisión B1 — el texto anterior decía "…antes de
          poder escanear sin red", que prometía justo lo contrario de lo
          real: descargar deja VER el manifiesto sin red, nunca registrar un
          escaneo — eso sigue yendo directo a Supabase (useScanMutation, sin
          cola offline en esta pantalla; conectarla es spec-81). */}
      <p className="text-sm text-text-secondary">
        Esta carga no se descargó al dispositivo. Necesitas conexión para
        traer sus datos.
      </p>
      <p className="text-xs text-text-muted">
        Descargarla te deja ver el manifiesto sin red, pero registrar un
        escaneo siempre requiere estar en línea.
      </p>
      <Button onClick={onBack}>Volver</Button>
    </div>
  );
}
