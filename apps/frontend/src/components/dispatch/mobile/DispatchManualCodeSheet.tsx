'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * spec-76 2f — "Ingresar código" for a barcode the Zebra can't read (damaged,
 * dirty, crumpled). Mirrors reception's `ManualCodeSheet` (spec-62 3q):
 * decision 2 keeps mobile components module-owned, so this is its own copy
 * under `dispatch/mobile/`, not a cross-module import. A code typed here
 * submits through the exact same `onSubmit` the scanner uses — it is a
 * scan, not a different kind of event.
 *
 * Opening this sheet steals focus from the always-focused `ScanField`
 * elsewhere on the screen — that is expected, and nothing here tries to
 * refocus the scanner behind it (same note as reception's own
 * `ManualCodeSheet`). On close, Radix's own dialog behaviour returns focus
 * to whichever element had it before the sheet opened — the "Ingresar
 * código" trigger button, in real browser use — which is enough: the
 * operator can see the field again immediately, and `ScanField`'s own
 * mount/focus effect (or a tap on it) re-arms it from there.
 * DispatchManualCodeSheet.test.tsx's own test covers what jsdom can prove
 * honestly here: this component adds no refocus logic of its own, and the
 * sheet's content genuinely unmounts rather than leaving focus trapped
 * inside a removed, invisible input.
 */
export interface DispatchManualCodeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (code: string) => void;
}

export function DispatchManualCodeSheet({ open, onOpenChange, onSubmit }: DispatchManualCodeSheetProps) {
  const [code, setCode] = useState('');

  useEffect(() => {
    if (open) setCode('');
  }, [open]);

  const handleSubmit = () => {
    const trimmed = code.trim();
    if (trimmed === '') return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Ingresar código manualmente</SheetTitle>
          <SheetDescription>Usá esto solo si la etiqueta está ilegible para el lector.</SheetDescription>
        </SheetHeader>

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <Input
            aria-label="Código del bulto"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="CL8841873"
            className="h-12 font-mono text-base"
          />
          <Button type="submit" className="h-[52px] text-base">
            Registrar
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
