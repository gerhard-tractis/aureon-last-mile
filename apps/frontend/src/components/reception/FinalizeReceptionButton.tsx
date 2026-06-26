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
  isPending?: boolean;
  onFinalize: (discrepancyNotes: string | null) => void;
}

/**
 * Closes the consolidated reception. When `received === expected` the
 * button finalises directly. Otherwise it opens a notes modal — the
 * receptionist MUST type a discrepancy explanation before finalising,
 * matching the server-side guard in `complete_route_reception`.
 */
export function FinalizeReceptionButton({
  receivedCount,
  expectedCount,
  isPending = false,
  onFinalize,
}: FinalizeReceptionButtonProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const hasMissing = receivedCount < expectedCount;
  const missingCount = Math.max(0, expectedCount - receivedCount);

  const handleClick = () => {
    if (hasMissing) {
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
            <DialogTitle>Recepción incompleta</DialogTitle>
            <DialogDescription>
              Faltan {missingCount} paquete{missingCount === 1 ? '' : 's'} por recibir.
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
