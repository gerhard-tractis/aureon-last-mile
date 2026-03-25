'use client';

import { useState, useEffect } from 'react';
import { Package } from 'lucide-react';

interface DiscrepancyItemProps {
  packageId: string;
  packageLabel: string;
  orderNumber: string;
  existingNote: string;
  onSaveNote: (packageId: string, note: string) => void;
}

export function DiscrepancyItem({
  packageId,
  packageLabel,
  orderNumber,
  existingNote,
  onSaveNote,
}: DiscrepancyItemProps) {
  const [note, setNote] = useState(existingNote);

  useEffect(() => {
    setNote(existingNote);
  }, [existingNote]);

  const handleBlur = () => {
    if (note.trim() && note.trim() !== existingNote) {
      onSaveNote(packageId, note.trim());
    }
  };

  return (
    <div className="bg-status-warning-bg border border-status-warning-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-status-warning" />
        <span className="font-mono text-sm font-medium text-text">{packageLabel}</span>
        <span className="text-xs text-text-secondary">Pedido: {orderNumber}</span>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={handleBlur}
        placeholder="Motivo del faltante (obligatorio)..."
        className="w-full p-2 text-sm bg-surface border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 text-text"
        rows={2}
        aria-label={`Nota para paquete ${packageLabel}`}
      />
    </div>
  );
}
