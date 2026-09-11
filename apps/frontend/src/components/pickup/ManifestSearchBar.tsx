'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

/**
 * spec-95 fase 8 (mock `5a:82-95`) — the module's OWN search bar, its own
 * row ahead of the client chips. Extracted out of `PickupDesktopView.tsx`
 * to keep that file under the 300-line limit.
 *
 * The app-wide search (orden/paquete/RUT, mock `5a:63-67`) already lives in
 * `TopBar` (`onOpenSearch`, gated by `showOpsTools`) — this component is
 * NOT that search, and never was; the checklist item about the header
 * search becoming "the global one" needed no code here, only the docstring
 * note left on `PickupDesktopHeader.tsx`.
 */
interface ManifestSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function ManifestSearchBar({ value, onChange }: ManifestSearchBarProps) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <Input
        type="search"
        placeholder="Buscar carga, punto de recogida o cliente en este módulo"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
