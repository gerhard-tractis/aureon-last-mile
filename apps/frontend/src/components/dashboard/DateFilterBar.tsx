'use client';

export type DatePreset = 'today' | 'yesterday' | 'last_7_days' | 'this_week' | 'this_month' | 'this_year' | 'custom';

interface DateFilterBarProps {
  preset: DatePreset;
  customStart: string;
  customEnd: string;
  onPresetChange: (preset: DatePreset) => void;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
}

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'last_7_days', label: 'Últimos 7 Días' },
  { id: 'this_week', label: 'Esta Semana' },
  { id: 'this_month', label: 'Este Mes' },
  { id: 'this_year', label: 'Este Año' },
  { id: 'custom', label: 'Personalizado' },
];

export default function DateFilterBar({
  preset,
  customStart,
  customEnd,
  onPresetChange,
  onCustomStartChange,
  onCustomEndChange,
}: DateFilterBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border -mx-4 px-4 py-3 sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onPresetChange(id)}
            className={`px-3 py-1.5 text-sm font-medium transition-all duration-200 rounded-full ${
              preset === id
                ? 'bg-gold text-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {label}
          </button>
        ))}
        {preset === 'custom' && (
          <>
            <label className="sr-only" htmlFor="date-filter-start">Desde</label>
            <input
              id="date-filter-start"
              type="date"
              aria-label="Desde"
              value={customStart}
              onChange={(e) => onCustomStartChange(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-gold"
            />
            <label className="sr-only" htmlFor="date-filter-end">Hasta</label>
            <input
              id="date-filter-end"
              type="date"
              aria-label="Hasta"
              value={customEnd}
              onChange={(e) => onCustomEndChange(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-gold"
            />
          </>
        )}
      </div>
    </div>
  );
}
