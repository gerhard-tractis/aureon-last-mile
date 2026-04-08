'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { STAGE_KEYS, type StageKey } from './labels.es';

export function useStageQuery(): {
  activeStage: StageKey | null;
  setStage: (key: StageKey | null) => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get('stage');
  const activeStage: StageKey | null =
    raw && (STAGE_KEYS as readonly string[]).includes(raw) ? (raw as StageKey) : null;

  const setStage = (key: StageKey | null) => {
    if (key === null) {
      router.replace(pathname, { scroll: false });
    } else {
      router.replace(`${pathname}?stage=${key}`, { scroll: false });
    }
  };

  return { activeStage, setStage };
}
