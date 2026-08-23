import { ArrowLeft } from 'lucide-react';

/**
 * Gap fix (post spec-62 task 19) — error/null state for the reception
 * session below `lg`. The page's error guard used to fall through to a
 * desktop `max-w-2xl` centred card even on a phone. A route that fails to
 * load is most often seen by an andén operator with a truck in front of
 * them, so this states the failure plainly in Spanish and always offers a
 * touch target of at least 44px back to `/app/reception` — the operator
 * must always have a way out.
 *
 * Kept as its own file (rather than inlined in the page) to keep the page
 * under the repo's 300-line budget.
 */
export interface ReceptionMobileErrorCardProps {
  message: string;
  onBack: () => void;
}

export function ReceptionMobileErrorCard({ message, onBack }: ReceptionMobileErrorCardProps) {
  return (
    <div
      data-testid="reception-mobile-error"
      className="flex min-h-0 flex-1 flex-col justify-center gap-4 px-4 py-6"
    >
      <div className="w-full rounded-[12px] border border-status-error-border bg-status-error-bg px-4 py-5">
        <p className="text-[14px] font-medium leading-[1.4] text-status-error-text">{message}</p>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="flex h-11 w-full flex-none items-center justify-center gap-2 rounded-[12px] border border-border bg-surface text-[13.5px] font-medium text-text transition-colors active:bg-surface-raised"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a recepción
      </button>
    </div>
  );
}
