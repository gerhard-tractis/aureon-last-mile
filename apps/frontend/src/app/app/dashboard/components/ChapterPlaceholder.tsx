import type { ReactNode } from 'react';

interface ChapterPlaceholderProps {
  reason: string;
  children?: ReactNode;
}

export function ChapterPlaceholder({ reason, children }: ChapterPlaceholderProps) {
  return (
    <div className="border-l-4 border-muted pl-6 py-4 rounded-r-lg flex flex-col gap-3 opacity-60">
      <span className="font-mono tabular-nums text-5xl md:text-6xl font-bold leading-none text-muted-foreground">
        —
      </span>
      <p className="text-sm text-muted-foreground">{reason}</p>
      {children}
    </div>
  );
}
