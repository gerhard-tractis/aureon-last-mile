import { Button } from '@/components/ui/button';

interface ScanScreenFooterProps {
  onContinue: () => void;
  /**
   * fase 5 (ronda 2 del mock, 5d) — "Ingresar código a mano" en el mock NO
   * abre un segundo campo: `ScannerInput` ya es la superficie de entrada
   * manual (el operario puede teclear en vez de dejar disparar el lector),
   * así que un campo nuevo duplicaría la única fuente de verdad del código.
   * Este control le devuelve el foco al que ya existe — el llamador decide
   * cómo (`scannerRef.current?.focus()` en `scan/[loadId]/page.tsx`).
   */
  onManualEntryRequested: () => void;
  /**
   * Review de fase 5, M3 — `onManualEntryRequested` normalmente le
   * devuelve el foco a `ScannerInput` (vía `scannerRef.current?.focus()`),
   * pero `focus()` sobre un `<input disabled>` no hace nada. El llamador
   * pasa aquí la MISMA condición que deshabilita ese input
   * (`scanMutation.isPending || sync.status === 'offline'`) para que el
   * control no quede como un no-op silencioso — justo en el estado que
   * titula el artboard `5d` ("escaneo de recogida sin conexión").
   */
  manualEntryDisabled?: boolean;
}

/**
 * Extraído de `scan/[loadId]/page.tsx` (regla de 300 líneas — spec-95
 * fase 5) para no crecer un fichero que ya la excedía antes de esta fase.
 * spec-54 mock 1h — 60px de acción primaria, padding 16/20/26px por el
 * handoff. "Cerrar carga" (el otro secundario del mock viejo) sigue sin
 * implementarse aquí: no tiene mutación de respaldo a nivel de manifiesto
 * en esta pantalla — ver el comentario que dejó esa decisión en el
 * historial de `page.tsx` antes de esta extracción.
 */
export function ScanScreenFooter({
  onContinue,
  onManualEntryRequested,
  manualEntryDisabled = false,
}: ScanScreenFooterProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border pt-4 px-4 pb-[26px] sm:px-6">
      <div className="max-w-2xl mx-auto space-y-2.5">
        <Button onClick={onContinue} className="w-full h-[60px] text-base" size="lg">
          Continuar a revisión
        </Button>
        {/* `Button` variant="outline", no un `<button>` crudo — hereda
            `hover:`/`active:`/`focus-visible:` y `disabled:opacity-50
            disabled:pointer-events-none` del sistema de diseño en vez de
            quedarse sin ningún feedback visual (M3, L5). */}
        <Button
          type="button"
          variant="outline"
          onClick={onManualEntryRequested}
          disabled={manualEntryDisabled}
          className="w-full rounded-xl border-border py-[15px] h-auto text-sm font-semibold text-text-secondary"
        >
          Ingresar código a mano
        </Button>
      </div>
    </div>
  );
}
