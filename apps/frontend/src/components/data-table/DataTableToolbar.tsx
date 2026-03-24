import { Input } from '@/components/ui/input';

export interface FilterChip {
  key: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}

interface DataTableToolbarProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filterChips?: FilterChip[];
}

export function DataTableToolbar({ searchPlaceholder, searchValue, onSearchChange, filterChips }: DataTableToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {filterChips?.map((chip) => (
          <button
            key={chip.key}
            onClick={chip.onToggle}
            className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
              chip.active
                ? 'bg-accent text-accent-foreground border-accent'
                : 'bg-surface-raised text-text-secondary border-border hover:border-border'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {searchPlaceholder && (
        <Input
          placeholder={searchPlaceholder}
          value={searchValue ?? ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="max-w-[200px] h-8 text-xs"
        />
      )}
    </div>
  );
}
