import { cn } from '@/lib/utils';

/**
 * spec-54 phase 3 — the persistent scan result (mocks 1d, 1e, 1h, 1k).
 *
 * Replaces ScanResultPopup, which auto-hid after 5s and was in English. This
 * block stays until the next scan: an operator who looks away mid-read must be
 * able to look back and still see where the package went.
 *
 * Two rules from the handoff are load-bearing here:
 *   - colour and icon change together, so the state survives a glance and does
 *     not depend on colour vision;
 *   - the code is set at 34px because it is read from about three metres, by
 *     someone holding a box.
 */

type ScanStatus = 'ok' | 'error';

interface ScanResultProps {
  status: ScanStatus;
  /** The decision, e.g. "ANDÉN 3 · SUR ORIENTE" or "NO ESTÁ EN EL MANIFIESTO". */
  title: string;
  /** Supporting detail — order, comuna, retailer, package n of m. */
  context?: string;
  /** Short destination code repeated large, e.g. "A3". Omitted on error. */
  code?: string;
  timestamp?: string;
  className?: string;
}

const TONE = {
  ok: {
    box: 'bg-status-success-bg border-status-success-border',
    icon: 'bg-status-success',
    text: 'text-status-success-text',
  },
  error: {
    box: 'bg-status-error-bg border-status-error-border',
    icon: 'bg-status-error',
    text: 'text-status-error-text',
  },
} as const;

function CheckIcon() {
  return (
    <svg
      data-testid="scan-result-icon-ok"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="3"
      className="h-6 w-6"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      data-testid="scan-result-icon-error"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="3"
      className="h-6 w-6"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ScanResult({
  status,
  title,
  context,
  code,
  timestamp,
  className,
}: ScanResultProps) {
  const tone = TONE[status];

  return (
    <div
      // polite, not assertive: the result is already unmissable visually, and
      // an assertive live region would interrupt the screen reader mid-word on
      // every scan of a continuous run.
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-4 rounded-xl border px-5 py-4',
        tone.box,
        className,
      )}
    >
      <span className={cn('grid h-11 w-11 flex-none place-items-center rounded-xl', tone.icon)}>
        {status === 'ok' ? <CheckIcon /> : <CrossIcon />}
      </span>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={cn('font-heading text-[15px] font-semibold leading-none', tone.text)}>
          {title}
        </span>
        {context && <span className={cn('text-xs leading-none', tone.text)}>{context}</span>}
      </div>

      {code && (
        <div
          data-testid="scan-result-code"
          className="ml-auto flex flex-none flex-col items-end gap-1.5"
        >
          <span className={cn('font-heading text-[34px] font-bold leading-none', tone.text)}>
            {code}
          </span>
          {timestamp && (
            <span className={cn('font-mono text-[10.5px] font-medium leading-none', tone.text)}>
              {timestamp}
            </span>
          )}
        </div>
      )}

      {!code && timestamp && (
        <span className={cn('ml-auto font-mono text-[10.5px] font-medium leading-none', tone.text)}>
          {timestamp}
        </span>
      )}
    </div>
  );
}
