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
 *
 * `needsNote` is true whenever `missing > 0` OR `unexpectedCount > 0` — they
 * are independent triggers, not always both present. `10 esperados · 11
 * recibidos · 1 ajeno` opens this sheet with `missing === 0`: nothing is
 * lost, but an ajeno still needs to be accounted for. The closing sentence
 * below must name whichever condition actually caused the sheet to open,
 * not assume it was always a loss.
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
  // `missing` clamps at 0, so a route that matched more boxes than expected
  // (extra scans, a mislabeled ajeno counted as matched, etc.) leaves no
  // trace in `missing` — surface it separately rather than silently drop it.
  const surplus = Math.max(0, matched - expectedCount);

  const trimmed = note.trim();
  // Empty text must not submit: the server rejects it, and more importantly
  // a note that says nothing is worse than none — it satisfies the check
  // while recording nothing about what happened to the missing boxes.
  const disabled = trimmed === '' || isPending;

  const handleConfirm = () => {
    // Dead in practice — the disabled button already blocks this click —
    // but this is the last line of defence on a control whose entire job
    // is refusing to submit an empty note, so it stays.
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
                · falta{missing === 1 ? '' : 'n'} {missing} paquete{missing === 1 ? '' : 's'}
              </>
            )}
            {unexpectedCount > 0 && (
              <>
                {' '}
                · {unexpectedCount} paquete{unexpectedCount === 1 ? '' : 's'} ajeno
                {unexpectedCount === 1 ? '' : 's'}
              </>
            )}
            {surplus > 0 && (
              <>
                {' '}
                · sobra{surplus === 1 ? '' : 'n'} {surplus} paquete{surplus === 1 ? '' : 's'}
              </>
            )}
            {'. '}
            {missing > 0 ? (
              'Describe qué pasó con los paquetes faltantes para cerrar la recepción.'
            ) : (
              <>
                Describe el paquete{unexpectedCount === 1 ? '' : 's'} ajeno
                {unexpectedCount === 1 ? '' : 's'} para cerrar la recepción.
              </>
            )}
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
