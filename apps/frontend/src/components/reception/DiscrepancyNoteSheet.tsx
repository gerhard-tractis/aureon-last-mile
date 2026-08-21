'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { finalizeRule, type ReceptionCounts } from '@/lib/reception/finalize-rule';

interface DiscrepancyNoteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: ReceptionCounts;
  isPending: boolean;
  onConfirm: (note: string) => void;
}

/**
 * spec-62 3q — the note an operator must write before closing a reception
 * that doesn't reconcile. Opened only when `finalizeRule(counts).needsNote`
 * is true (task 18's job, at the session level); this sheet itself just
 * renders the decision it's handed and collects the text.
 *
 * `missing` comes from finalizeRule, never `expectedCount - receivedCount` —
 * see that module for why the raw subtraction hides real loss when an
 * "ajeno" package is present.
 */
export function DiscrepancyNoteSheet({
  open,
  onOpenChange,
  counts,
  isPending,
  onConfirm,
}: DiscrepancyNoteSheetProps) {
  const [note, setNote] = useState('');

  const { missing, matched } = finalizeRule(counts);
  const { expectedCount, unexpectedCount } = counts;

  const trimmed = note.trim();
  // Empty text must not submit: the server rejects it, and more importantly
  // a note that says nothing is worse than none — it satisfies the check
  // while recording nothing about what happened to the missing boxes.
  const disabled = trimmed === '' || isPending;

  const handleConfirm = () => {
    if (disabled) return;
    onConfirm(trimmed);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-full flex-col">
        <SheetHeader>
          <SheetTitle>Recepción con discrepancias</SheetTitle>
          <SheetDescription>
            {expectedCount} esperados · {matched} calzados
            {missing > 0 && (
              <>
                {' '}
                · faltan {missing} paquete{missing === 1 ? '' : 's'}
              </>
            )}
            {unexpectedCount > 0 && (
              <>
                {' '}
                · {unexpectedCount} paquete{unexpectedCount === 1 ? '' : 's'} ajeno
                {unexpectedCount === 1 ? '' : 's'}
              </>
            )}
            . Describe qué pasó con los paquetes faltantes para cerrar la recepción.
          </SheetDescription>
        </SheetHeader>

        <Textarea
          aria-label="Notas de discrepancia"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={5}
          placeholder="Describe los paquetes faltantes y posibles causas..."
          className="mt-4 flex-1 resize-none text-base"
        />

        <Button
          onClick={handleConfirm}
          disabled={disabled}
          className="mt-4 h-[56px] text-base"
        >
          Cerrar recepción
        </Button>
      </SheetContent>
    </Sheet>
  );
}
