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
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-red-500" />
        <span className="font-mono text-sm font-medium">{packageLabel}</span>
        <span className="text-xs text-muted-foreground">Order: {orderNumber}</span>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={handleBlur}
        placeholder="Reason for missing package (required)..."
        className="w-full p-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
        rows={2}
        aria-label={`Note for package ${packageLabel}`}
      />
    </div>
  );
}
