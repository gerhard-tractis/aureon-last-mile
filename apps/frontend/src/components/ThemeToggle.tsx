'use client';

import { Moon, Sun, Palette } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { useBranding } from '@/providers/BrandingProvider';

export default function ThemeToggle() {
  const { hasBranding, palette } = useBranding();
  const { mode, setMode } = useTheme({ hasCustomBranding: hasBranding });

  const options: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light mode', icon: <Sun className="h-4 w-4" /> },
    { value: 'dark',  label: 'Dark mode',  icon: <Moon className="h-4 w-4" /> },
    ...(hasBranding
      ? [{
          value: 'custom' as ThemeMode,
          label: 'Brand mode',
          icon: palette?.brand_primary ? (
            <span
              className="h-4 w-4 rounded-sm inline-block border border-border"
              style={{ background: palette.brand_primary }}
            />
          ) : (
            <Palette className="h-4 w-4" />
          ),
        }]
      : []),
  ];

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Theme mode">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          aria-label={opt.label}
          aria-pressed={mode === opt.value}
          className={`p-2 rounded-md transition-colors ${
            mode === opt.value
              ? 'bg-accent text-accent-foreground'
              : 'text-text-secondary hover:text-text hover:bg-surface-raised'
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
