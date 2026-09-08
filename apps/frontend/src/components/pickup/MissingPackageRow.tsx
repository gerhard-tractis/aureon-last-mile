'use client';

import { useState } from 'react';

interface MissingPackageRowProps {
  packageId: string;
  packageLabel: string;
  orderNumber: string;
  customerName?: string;
  existingNote: string;
  onSaveNote: (packageId: string, note: string) => void;
}

/**
 * spec-80 fase 2, mock `5e`, `SIN VERIFICAR` row. Two states, not one
 * always-open textarea:
 *   - no note yet: a `Nota` button (status-warning) that reveals an inline
 *     field on tap.
 *   - note saved: a `CON NOTA` badge (status-success) and the note itself,
 *     read-only, quoted — matches the mock's "El local no lo encontró en
 *     bodega, queda para mañana." row exactly.
 *
 * The note is OPTIONAL (user decision, 2026-09-08: "Es opcional, y la
 * dejaría editable en el futuro" — see reviewCloseGate.ts and spec-80's
 * fase 2 notes). The mock itself shows "Cerrar con 3 faltantes" fully
 * opaque with two of the three SIN VERIFICAR rows still showing the `Nota`
 * button, unsaved. Editing an already-saved note is not built here — see
 * spec-80's fase 2 notes for why (no write path exists yet on
 * `discrepancies.note`, only at capture time).
 */
export function MissingPackageRow({
  packageId,
  packageLabel,
  orderNumber,
  customerName,
  existingNote,
  onSaveNote,
}: MissingPackageRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const hasNote = existingNote.trim().length > 0;
  const subtitle = customerName ? `${orderNumber} · ${customerName}` : orderNumber;

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSaveNote(packageId, trimmed);
    setIsEditing(false);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="font-mono text-sm font-semibold text-text">{packageLabel}</span>
          <span className="text-xs text-text-secondary">{subtitle}</span>
        </div>

        {hasNote ? (
          <span className="flex-none text-xs font-semibold rounded-md px-2 py-1.5 bg-status-success-bg text-status-success border border-status-success-border">
            CON NOTA
          </span>
        ) : !isEditing ? (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="flex-none text-xs font-semibold rounded-md px-3 min-h-11 bg-status-warning-bg text-status-warning border border-status-warning-border"
          >
            Nota
          </button>
        ) : null}
      </div>

      {hasNote && (
        <span className="text-sm text-text-secondary rounded-md px-2.5 py-2 bg-background border border-border">
          &quot;{existingNote}&quot;
        </span>
      )}

      {!hasNote && isEditing && (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Motivo del faltante (opcional)..."
            className="w-full p-2 text-sm bg-surface border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 text-text"
            rows={2}
            aria-label={`Nota para paquete ${packageLabel}`}
          />
          <button
            type="button"
            onClick={handleSave}
            className="self-end text-xs font-semibold rounded-md px-3 min-h-9 bg-accent text-accent-foreground"
          >
            Guardar
          </button>
        </div>
      )}
    </div>
  );
}
