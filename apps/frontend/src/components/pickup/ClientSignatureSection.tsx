'use client';

import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SignaturePad } from '@/components/pickup/SignaturePad';

interface ClientSignatureSectionProps {
  showClientSig: boolean;
  onToggleShowClientSig: (checked: boolean) => void;
  clientName: string;
  onClientNameChange: (name: string) => void;
  onClientSignatureChange: (signature: string | null) => void;
}

/**
 * spec-80 fase 3, ronda 2 de review del PR #706 (Seguimiento) — extraído de
 * `complete/[loadId]/page.tsx`, que estaba en 411 líneas antes de esto, para
 * dejar sitio a fase 4 sobre el mismo fichero.
 *
 * "FIRMA DEL LOCAL" del mock `5f` — el mock la coloca ANTES de la firma del
 * operario. Se conserva el checkbox opcional (spec-80 fase 1: "la del local
 * es opcional, el mock permite cerrar sin ella"), que el mock (una captura
 * ya llena) no contempla.
 */
export function ClientSignatureSection({
  showClientSig,
  onToggleShowClientSig,
  clientName,
  onClientNameChange,
  onClientSignatureChange,
}: ClientSignatureSectionProps) {
  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold tracking-wide text-text-secondary uppercase">
        FIRMA DEL LOCAL
      </span>
      {/* spec-95 fase 6, mock `5f` — "opcional" a la derecha de la fila.
          Fuera del <label>: si entrara dentro, el nombre accesible de la
          casilla pasaría a ser "Agregar firma del cliente opcional" y
          rompería `getByLabelText('Agregar firma del cliente')` (match
          exacto) en `page.test.tsx`. m3, ronda 2 de review — eso solo
          protegía el test; alguien navegando con lector de pantalla NUNCA
          oía "opcional" (no está en el nombre accesible NI enlazado por
          `aria-describedby`). `aria-describedby` en la casilla da las dos
          cosas: lo anuncia sin tocar el nombre accesible. */}
      <div className="flex items-center gap-2">
        <label htmlFor="client-sig" className="flex items-center gap-2">
          <Checkbox
            id="client-sig"
            checked={showClientSig}
            onCheckedChange={(checked) => onToggleShowClientSig(checked === true)}
            aria-describedby="client-sig-optional"
          />
          <span className="text-sm text-text">Agregar firma del cliente</span>
        </label>
        <span id="client-sig-optional" className="ml-auto text-xs text-text-muted">
          opcional
        </span>
      </div>
      {showClientSig && (
        <div className="space-y-2 ml-6">
          <Input
            value={clientName}
            onChange={(e) => onClientNameChange(e.target.value)}
            placeholder="Nombre del cliente"
            className="text-sm"
            aria-label="Nombre del cliente"
          />
          <SignaturePad
            label="Firma del cliente (opcional)"
            onChange={onClientSignatureChange}
          />
        </div>
      )}
    </div>
  );
}
