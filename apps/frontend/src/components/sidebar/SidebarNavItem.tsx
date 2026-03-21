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
}

export function SidebarNavItem({ href, label, icon: Icon, pinned }: SidebarNavItemProps) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');

  const content = (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-md transition-colors',
        pinned ? 'px-2 py-1.5' : 'justify-center p-2',
        active
          ? 'bg-sidebar-active/10 text-sidebar-active border-l-2 border-sidebar-active'
          : 'text-sidebar-text hover:bg-sidebar-hover border-l-2 border-transparent',
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {pinned ? (
        <span className="text-sm truncate">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </Link>
  );

  if (!pinned) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
