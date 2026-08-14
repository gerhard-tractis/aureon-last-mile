'use client';

import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Minus, Plus, Loader2 } from 'lucide-react';

const MIN_BOXES = 1;
const MAX_BOXES = 20;

const QUICK_REASONS = [
  'Producto de varias cajas',
  'Retailer declaró de menos',
  'Otro',
] as const;

interface ExpandCartonSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The parent carton's own label, e.g. "CTN001". */
  parentLabel: string;
  /**
   * How many boxes already exist in this carton's family (the parent plus
   * any previously minted siblings this screen already knows about). Used
   * only to preview the labels that will be created — the server is the
   * final authority on the actual suffix assigned.
   */
  existingBoxCount: number;
  onConfirm: (additionalBoxes: number, reason: string) => void;
  isSubmitting?: boolean;
}

/**
 * spec-55 — "Agregar bultos" sheet. The pickup crew is standing at the
 * retailer with more physical boxes than the CARTON_ID accounts for; this
 * mints the additional Aureon carton IDs on the spot.
 */
export function ExpandCartonSheet({
  open,
  onOpenChange,
  parentLabel,
  existingBoxCount,
  onConfirm,
  isSubmitting = false,
}: ExpandCartonSheetProps) {
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState('');

  const previewLabels = useMemo(
    () =>
      Array.from(
        { length: count },
        (_, i) => `${parentLabel}-${existingBoxCount + 1 + i}`
      ),
    [parentLabel, existingBoxCount, count]
  );

  const canConfirm = reason.trim().length > 0 && count >= MIN_BOXES && count <= MAX_BOXES && !isSubmitting;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(count, reason.trim());
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCount(1);
      setReason('');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar bultos a {parentLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-text mb-2">
              ¿Cuántos bultos adicionales?
            </p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Menos"
                disabled={count <= MIN_BOXES}
                onClick={() => setCount((c) => Math.max(MIN_BOXES, c - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center font-mono text-lg" data-testid="box-count">
                {count}
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Más"
                disabled={count >= MAX_BOXES}
                onClick={() => setCount((c) => Math.min(MAX_BOXES, c + 1))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-text mb-2">Motivo</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {QUICK_REASONS.map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={reason === r ? 'default' : 'outline'}
                  onClick={() => setReason(r === 'Otro' ? '' : r)}
                >
                  {r}
                </Button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo (obligatorio)"
              aria-label="Motivo"
              rows={2}
            />
          </div>

          <div className="bg-surface-raised rounded-md p-3">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">
              Se crearán
            </p>
            <p className="font-mono text-sm text-text" data-testid="expand-preview">
              {previewLabels.join(', ')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Creando...
              </>
            ) : (
              'Confirmar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
