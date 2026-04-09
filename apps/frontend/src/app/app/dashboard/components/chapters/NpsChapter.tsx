import { Chapter } from '@/app/app/dashboard/components/Chapter';
import { ChapterPlaceholder } from '@/app/app/dashboard/components/ChapterPlaceholder';
import { CHAPTER_LABELS, PLACEHOLDER_COPY } from '@/app/app/dashboard/lib/labels.es';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

interface NpsChapterProps {
  operatorId: string;
  period: DashboardPeriod;
}

// ---------------------------------------------------------------------------
// Inline placeholder tactical card — used only within this chapter
// ---------------------------------------------------------------------------

interface PlaceholderCardProps {
  title: string;
  explanation: string;
}

function NpsTacticalPlaceholder({ title, explanation }: PlaceholderCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-2 opacity-60">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </span>
      <span className="font-mono tabular-nums text-3xl font-semibold leading-none text-muted-foreground">
        —
      </span>
      <span className="text-xs text-muted-foreground">{explanation}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapter component
// ---------------------------------------------------------------------------

export function NpsChapter({ operatorId: _operatorId, period: _period }: NpsChapterProps) {
  return (
    <Chapter
      annotation={CHAPTER_LABELS.npsAnnotation}
      headline={CHAPTER_LABELS.nps}
    >
      <ChapterPlaceholder reason={PLACEHOLDER_COPY.nps} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <NpsTacticalPlaceholder
          title="Incidentes por categoría"
          explanation="Requiere taxonomía de incidentes"
        />
        <NpsTacticalPlaceholder
          title="Detractores"
          explanation="Requiere encuesta post-entrega"
        />
        <NpsTacticalPlaceholder
          title="Temas"
          explanation="Requiere clasificación LLM de comentarios"
        />
      </div>
    </Chapter>
  );
}
