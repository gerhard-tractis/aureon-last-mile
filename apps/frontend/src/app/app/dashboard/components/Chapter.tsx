import type { ReactNode } from 'react';

interface ChapterProps {
  annotation: string;
  headline: string;
  children: ReactNode;
}

export function Chapter({ annotation, headline, children }: ChapterProps) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {annotation}
        </span>
        <h2 className="text-4xl font-semibold italic [font-family:var(--font-display)]">
          {headline}
        </h2>
      </div>
      {children}
    </section>
  );
}
