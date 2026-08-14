'use client';

import { Moon, Palette, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { useBranding } from '@/providers/BrandingProvider';

/**
 * spec-54 phase 2 — segmented Claro / Oscuro control, living in the topbar.
 *
 * It stays a two-way (or three-way, with branding) explicit choice rather than
 * a single cycling button: the user needs to see which theme is active without
 * clicking to find out. It is present at every breakpoint — mobile operators
 * work in dim warehouses and in direct sun on the same shift, so the theme is
 * theirs to pick, not something the screen decides for them.
 */

interface ThemeToggleProps {
  /** Hide the text labels, leaving icon-only pills. Used in tight topbars. */
  compact?: boolean;
}

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { hasBranding, palette } = useBranding();
  const { mode, setMode } = useTheme({ hasCustomBranding: hasBranding });

  const options: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Tema claro', icon: <Sun className="h-3 w-3" /> },
    { value: 'dark', label: 'Tema oscuro', icon: <Moon className="h-3 w-3" /> },
    ...(hasBranding
      ? [
          {
            value: 'custom' as ThemeMode,
            label: 'Tema de marca',
            icon: palette?.brand_primary ? (
              <span
                className="inline-block h-3 w-3 rounded-sm border border-border"
                style={{ background: palette.brand_primary }}
              />
            ) : (
              <Palette className="h-3 w-3" />
            ),
          },
        ]
      : []),
  ];

  const shortLabel: Record<ThemeMode, string> = {
    light: 'Claro',
    dark: 'Oscuro',
    custom: 'Marca',
  };

  return (
    <div
      role="group"
      aria-label="Tema"
      className="flex gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5"
    >
      {options.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => setMode(opt.value)}
            aria-label={opt.label}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold leading-none transition-colors',
              active
                ? 'bg-surface text-text'
                : 'text-text-secondary hover:text-text',
            )}
          >
            {opt.icon}
            {!compact && <span className="hidden sm:inline">{shortLabel[opt.value]}</span>}
          </button>
        );
      })}
    </div>
  );
}
