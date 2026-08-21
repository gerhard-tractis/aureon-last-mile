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

interface ManualCodeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (code: string) => void;
}

/**
 * spec-62 3q — the only touch input on the unloading screen. The Zebra
 * trigger drives everything else; this sheet exists purely for a label the
 * scanner cannot read (damaged, dirty, crumpled). A code typed here is a
 * scan, not a different kind of event: it must submit through the exact
 * same `onSubmit` the trigger uses, never a path of its own.
 *
 * Opening this sheet steals focus from the always-focused scanner field
 * elsewhere on the screen. That is expected — do not add anything here
 * that tries to refocus the scanner behind it.
 */
export function ManualCodeSheet({ open, onOpenChange, onSubmit }: ManualCodeSheetProps) {
  const [code, setCode] = useState('');

  // `open` can flip via the parent (e.g. the session closes and reopens
  // this sheet for the next box) as well as via the internal Radix dismiss
  // path, so clearing lives here rather than duplicated in a handler —
  // this is the single place that sees every way the sheet re-opens.
  useEffect(() => {
    if (open) {
      setCode('');
    }
  }, [open]);

  const handleSubmit = () => {
    const trimmed = code.trim();
    // A phone keyboard on the andén adds leading/trailing spaces constantly;
    // an all-blank code is not a real scan and must be a silent no-op —
    // no mutation, no toast, and the sheet stays open.
    if (trimmed === '') {
      return;
    }
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Ingresar código manualmente</SheetTitle>
          <SheetDescription>
            Usá esto solo si la etiqueta está ilegible para el lector.
          </SheetDescription>
        </SheetHeader>

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            // The operator is typing one-handed at the truck — the phone
            // keyboard's Go/Enter key must submit the same way the button
            // does, not require a second reach for the button afterward.
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
            placeholder="CL7742891088"
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
