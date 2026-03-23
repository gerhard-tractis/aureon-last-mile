'use client';

import { Moon, Sun, Palette } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { useBranding } from '@/providers/BrandingProvider';

interface ThemeToggleProps {
  compact?: boolean;
}

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
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
              className="h-4 w-4 rounded-sm inline-block border border-sidebar-border"
              style={{ background: palette.brand_primary }}
            />
          ) : (
            <Palette className="h-4 w-4" />
          ),
        }]
      : []),
  ];

  // Compact mode: single button that cycles through modes
  if (compact) {
    const currentIdx = options.findIndex((o) => o.value === mode);
    const current = options[currentIdx] ?? options[0];
    const nextMode = options[(currentIdx + 1) % options.length].value;

    return (
      <button
        onClick={() => setMode(nextMode)}
        aria-label={`Theme: ${current.label}. Click to switch.`}
        className="p-2 rounded-md text-sidebar-text hover:bg-sidebar-hover transition-colors"
      >
        {current.icon}
      </button>
    );
  }

  // Full mode: inline button group
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Theme mode">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          aria-label={opt.label}
          aria-pressed={mode === opt.value}
          className={`p-1.5 rounded-md transition-colors ${
            mode === opt.value
              ? 'bg-sidebar-hover text-sidebar-active'
              : 'text-sidebar-text hover:text-sidebar-active hover:bg-sidebar-hover'
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
