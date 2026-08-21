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

  // `open` can also flip via the parent (e.g. rerender after the session
  // closes and reopens this sheet for the next box), not only through
  // `handleOpenChange` below — so clearing has to react to the prop itself,
  // not just to the internal Radix dismiss path.
  useEffect(() => {
    if (open) {
      setCode('');
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Clear on close so the next box (opened fresh) never sees the
      // previous one's leftover text.
      setCode('');
    }
    onOpenChange(next);
  };

  const handleSubmit = () => {
    const trimmed = code.trim();
    // A phone keyboard on the andén adds leading/trailing spaces constantly;
    // an all-blank code is not a real scan and must be a silent no-op.
    if (trimmed === '') {
      return;
    }
    onSubmit(trimmed);
    handleOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Ingresar código manualmente</SheetTitle>
          <SheetDescription>
            Usá esto solo si la etiqueta está ilegible para el lector.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-3">
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
          <Button
            type="button"
            onClick={handleSubmit}
            className="h-[52px] text-base"
          >
            Registrar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
