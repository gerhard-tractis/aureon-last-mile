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

interface FinalizeReceptionButtonProps {
  receivedCount: number;
  expectedCount: number;
  /**
   * Received packages with no verified pickup scan on this route
   * (`route_receptions.unexpected_count`). Load-bearing — see `needsNotes`.
   */
  unexpectedCount: number;
  isPending?: boolean;
  onFinalize: (discrepancyNotes: string | null) => void;
}

/**
 * Closes the consolidated reception, demanding discrepancy notes on exactly
 * the condition the server enforces in `complete_route_reception`.
 *
 * THE RULE, AND WHY IT IS NOT `received < expected`. spec-52 accepts a package
 * that arrives with no verified pickup scan on this route: refusing it would
 * force the receptionist to lie to the system. Such a package increments
 * `received_count` AND `unexpected_count`, so the two error modes offset:
 *
 *   10 expected · 10 received · 1 unexpected
 *     -> received === expected, yet ONE expected package never arrived and ONE
 *        package belonging to another truck did.
 *
 * That is the most likely real-world shape — a package mis-loaded at one client
 * while another is left behind — and precisely what the discrepancy report
 * exists to catch. Comparing raw counts waves it through silently. Separating
 * the populations does not:
 *
 *   matched := received - unexpected      (expected AND arrived)
 *   notes required when matched !== expected OR unexpected > 0
 *
 * This modal trigger and the server guard are ONE rule expressed twice. Keep
 * them identical: a server that demands notes the UI never prompts for makes
 * the reception unfinishable — no modal opens, `onFinalize(null)` is sent, the
 * RPC raises, and the receptionist has no way to supply what is being asked
 * for. The server-side tightening is contract-phase work and lands only once
 * this component is live.
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

  const matchedCount = receivedCount - unexpectedCount;
  const needsNotes = matchedCount !== expectedCount || unexpectedCount > 0;
  const missingCount = Math.max(0, expectedCount - matchedCount);

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
