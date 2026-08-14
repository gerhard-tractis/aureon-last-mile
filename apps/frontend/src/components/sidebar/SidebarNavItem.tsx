'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { LucideIcon } from 'lucide-react';

interface SidebarNavItemProps {
  href: string;
  label: string;
  icon: LucideIcon;
  pinned: boolean;
  /** Queue size. null while unresolved; omit entirely for items with no queue. */
  count?: number | null;
  countTone?: 'neutral' | 'warning';
  /** Unread marker — a dot rather than a number (Conversaciones). */
  showDot?: boolean;
}

export function SidebarNavItem({
  href,
  label,
  icon: Icon,
  pinned,
  count,
  countTone = 'neutral',
  showDot = false,
}: SidebarNavItemProps) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');

  const content = (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-[7px] transition-colors',
        // The active state carries a 2px left border, so the inactive state
        // reserves the same 2px transparently — otherwise every label shifts
        // sideways as you navigate.
        'border-l-2',
        pinned ? 'px-2.5 py-2' : 'justify-center p-2',
        active
          ? 'bg-surface border-sidebar-active'
          : 'border-transparent hover:bg-sidebar-hover',
      )}
    >
      <Icon
        className={cn('h-[15px] w-[15px] flex-shrink-0', active ? 'text-sidebar-active' : 'text-sidebar-text')}
      />
      {pinned ? (
        <span
          className={cn(
            'text-[12.5px] leading-none truncate',
            active ? 'font-semibold text-sidebar-active' : 'font-medium text-sidebar-text',
          )}
        >
          {label}
        </span>
      ) : (
        <span className="sr-only">{label}</span>
      )}

      {/* Counters and the unread dot are suppressed in the icon rail: there is
          no room for them to mean anything, and a floating number next to an
          unlabelled icon is noise. */}
      {pinned && count != null && (
        <span
          data-testid={`nav-count-${href}`}
          className={cn(
            'ml-auto rounded font-mono text-[10px] font-semibold leading-none px-1.5 py-[3px]',
            countTone === 'warning'
              ? 'bg-status-warning-bg text-status-warning-text'
              : 'bg-sidebar-raised text-sidebar-text',
          )}
        >
          {count}
        </span>
      )}
      {pinned && showDot && (
        <span
          data-testid={`nav-dot-${href}`}
          aria-label="Mensajes sin leer"
          className="ml-auto h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
    </Link>
  );

  if (!pinned) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {label}
          {count != null && ` · ${count}`}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
