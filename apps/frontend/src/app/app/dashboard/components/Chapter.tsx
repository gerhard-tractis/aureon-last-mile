import type { ReactNode } from 'react';

interface ChapterProps {
  headline: string;
  children: ReactNode;
}

export function Chapter({ headline, children }: ChapterProps) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-4xl font-semibold italic [font-family:var(--font-display)]">
        {headline}
      </h2>
      {children}
    </section>
  );
}
