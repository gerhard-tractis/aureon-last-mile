'use client';

import { useState } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { finalizeRule } from '@/lib/reception/finalize-rule';

interface FinalizeReceptionButtonProps {
  receivedCount: number;
  expectedCount: number;
  /**
   * Received packages with no verified pickup scan on this route
   * (`route_receptions.unexpected_count`). Load-bearing — see `finalize-rule`.
   */
  unexpectedCount: number;
  isPending?: boolean;
  onFinalize: (discrepancyNotes: string | null) => void;
}

/**
 * Closes the consolidated reception, demanding discrepancy notes per the rule
 * in `@/lib/reception/finalize-rule` — see that module for why it exists.
 */
export function FinalizeReceptionButton({
  receivedCount,
  expectedCount,
  unexpectedCount,
  isPending = false,
  onFinalize,
}: FinalizeReceptionButtonProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const { missing: missingCount, needsNote: needsNotes } = finalizeRule({
    expectedCount,
    receivedCount,
    unexpectedCount,
  });

  const handleClick = () => {
    if (needsNotes) {
      setOpen(true);
    } else {
      onFinalize(null);
    }
  };

  const handleConfirm = () => {
    if (!notes.trim()) return;
    onFinalize(notes.trim());
    setOpen(false);
  };

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={isPending || receivedCount === 0}
        className="w-full"
        size="lg"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <CheckCircle className="h-4 w-4 mr-2" />
            Finalizar recepción
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recepción con discrepancias</DialogTitle>
            <DialogDescription>
              {missingCount > 0 && (
                <>
                  Falta{missingCount === 1 ? '' : 'n'} {missingCount} paquete
                  {missingCount === 1 ? '' : 's'} por recibir
                </>
              )}
              {missingCount > 0 && unexpectedCount > 0 && ' y '}
              {unexpectedCount > 0 && (
                <>
                  {missingCount > 0 ? 'lleg' : 'Lleg'}
                  {unexpectedCount === 1 ? 'ó' : 'aron'} {unexpectedCount} paquete
                  {unexpectedCount === 1 ? '' : 's'} inesperado
                  {unexpectedCount === 1 ? '' : 's'}
                </>
              )}
              {'. '}
              Describe la discrepancia para finalizar la recepción.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Describe los paquetes faltantes y posibles causas..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            aria-label="Notas de discrepancia"
            data-testid="discrepancy-notes-input"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!notes.trim()}
              data-testid="confirm-finalize"
            >
              Finalizar con discrepancia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
