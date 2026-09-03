'use client';

import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FilterOption } from '@/lib/dispatch/pre-route-filters';

/**
 * spec-75 task 2b — a generic multi-select popover, shared by the Comuna,
 * Andén and Cliente pre-ruta filters. `Select` (shadcn) only supports one
 * value at a time, so this composes `Popover` + `Command` instead — no new
 * UI library, just shadcn primitives that weren't wired together for this
 * shape yet.
 *
 * Code-review finding: `components/ui/checkbox.tsx` wraps Radix's
 * `CheckboxPrimitive.Root`, a real tabbable `<button role="checkbox">` —
 * rendering one inside a `CommandItem` (already `role="option"`, already
 * focusable via cmdk's roving index) nests two interactive controls, and
 * `aria-hidden` on a focusable element is an axe violation on its own. The
 * checkmark below is a plain glyph, not a control — selection state lives
 * on the `CommandItem` itself via `aria-checked`, matching the standard
 * shadcn multi-select combobox shape.
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
              {options.map((opt) => {
                const isSelected = selected.includes(opt.id);
                return (
                  // value carries the id too — cmdk keys its internal store
                  // by `value`, so two options sharing a display name (e.g.
                  // a comuna split across andenes, exactly what
                  // has_split_dock_zone flags) would otherwise collide and
                  // break filter-typing for that pair.
                  <CommandItem
                    key={opt.id}
                    value={`${opt.name} ${opt.id}`}
                    aria-checked={isSelected}
                    onSelect={() => toggle(opt.id)}
                  >
                    <Check className={cn('mr-2 h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    {opt.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
