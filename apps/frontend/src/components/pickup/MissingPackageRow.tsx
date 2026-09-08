'use client';

import { useState } from 'react';

interface MissingPackageRowProps {
  packageId: string;
  packageLabel: string;
  orderNumber: string;
  customerName?: string;
  existingNote: string;
  onSaveNote: (packageId: string, note: string) => Promise<void>;
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
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const hasNote = existingNote.trim().length > 0;
  const subtitle = customerName ? `${orderNumber} · ${customerName}` : orderNumber;

  // Medio 4 (spec-80 fase 2 review, PR #686): the draft used to be cleared
  // and the editor closed unconditionally, right after calling onSaveNote —
  // which is a bare `.insert()` with no offline queue and no onError
  // (useSaveDiscrepancyNote). Without network, the note the crew just typed
  // vanished from the screen AND never reached the server. Only clear/close
  // once the save actually resolves; keep the draft and surface the failure
  // otherwise so nothing typed is silently lost.
  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setIsSaving(true);
    setSaveError(false);
    try {
      await onSaveNote(packageId, trimmed);
      setIsEditing(false);
      setDraft('');
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
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
          {saveError && (
            <span className="text-xs text-status-error">
              No se pudo guardar la nota. Revisa la conexión e inténtalo de nuevo.
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="self-end text-xs font-semibold rounded-md px-3 min-h-11 bg-accent text-accent-foreground disabled:opacity-50"
          >
            {isSaving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}
    </div>
  );
}
