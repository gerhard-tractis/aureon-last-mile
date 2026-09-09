'use client';

import { SignaturePad } from '@/components/pickup/SignaturePad';

interface OperatorSignatureSectionProps {
  operatorName: string;
  onOperatorSignatureChange: (signature: string | null) => void;
}

/**
 * spec-80 fase 3, ronda 2 de review del PR #706 (Seguimiento) — extraído de
 * `complete/[loadId]/page.tsx` junto con `ClientSignatureSection`.
 *
 * "TU FIRMA" del mock `5f` — la del operario, obligatoria para cerrar.
 */
export function OperatorSignatureSection({
  operatorName,
  onOperatorSignatureChange,
}: OperatorSignatureSectionProps) {
  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold tracking-wide text-text-secondary uppercase">
        TU FIRMA
      </span>
      <p className="text-sm text-text-secondary">
        Operador: <strong className="text-text">{operatorName}</strong>
      </p>
      <SignaturePad
        label="Firma del operador (obligatoria)"
        onChange={onOperatorSignatureChange}
      />
    </div>
  );
}
