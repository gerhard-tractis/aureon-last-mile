'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAccountMenuItems, useUserIdentity } from '@/components/user-menu/UserAccountMenuItems';

interface SidebarUserMenuProps {
  pinned: boolean;
}

export function SidebarUserMenu({ pinned }: SidebarUserMenuProps) {
  const { email, initials } = useUserIdentity();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sidebar-text hover:bg-sidebar-hover transition-colors">
          <div className="h-7 w-7 rounded-full bg-sidebar-border flex items-center justify-center text-xs font-semibold text-sidebar-text flex-shrink-0">
            {initials}
          </div>
          {pinned && <span className="text-xs truncate">{email}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-48">
        <UserAccountMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
