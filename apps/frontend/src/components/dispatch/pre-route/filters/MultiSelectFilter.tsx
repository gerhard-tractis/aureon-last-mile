'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import type { FilterOption } from '@/lib/dispatch/pre-route-filters';

/**
 * spec-75 task 2b — a generic multi-select popover, shared by the Comuna,
 * Andén and Cliente pre-ruta filters. `Select` (shadcn) only supports one
 * value at a time, so this composes `Popover` + `Command` + `Checkbox`
 * instead — no new UI library, just shadcn primitives that weren't wired
 * together for this shape yet.
 */
interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectFilterProps) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10.5px]">
              {selected.length}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} />
          <CommandList className="max-h-60">
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem key={opt.id} value={opt.name} onSelect={() => toggle(opt.id)}>
                  <Checkbox checked={selected.includes(opt.id)} className="mr-2" aria-hidden />
                  {opt.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
