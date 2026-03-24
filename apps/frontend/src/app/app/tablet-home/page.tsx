'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { createSPASassClient } from '@/lib/supabase/client';

const WORKFLOW_CARDS = [
  { key: 'home.pickup',       href: '/app/pickup',       permission: 'pickup',       bg: 'bg-blue-600' },
  { key: 'home.reception',    href: '/app/reception',    permission: 'reception',    bg: 'bg-green-600' },
  { key: 'home.distribution', href: '/app/distribution', permission: 'distribution', bg: 'bg-purple-600' },
  { key: 'home.dispatch',     href: '/app/dispatch',     permission: 'dispatch',     bg: 'bg-orange-600' },
] as const;

export default function TabletHomePage() {
  const { permissions, user } = useGlobal();
  const { t } = useTranslation();
  const router = useRouter();

  const visibleCards = WORKFLOW_CARDS.filter((c) => permissions.includes(c.permission));

  const handleSignOut = async () => {
    const client = await createSPASassClient();
    await client.logout();
    router.push('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background p-6">
      <div className="flex-1 grid grid-cols-2 gap-6 content-start">
        {visibleCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`${card.bg} rounded-2xl flex items-center justify-center text-white text-2xl font-bold min-h-[180px] hover:opacity-90 transition-opacity`}
          >
            {t(card.key)}
          </Link>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <span className="text-sm text-text">{user?.email}</span>
        <button
          onClick={handleSignOut}
          className="text-sm text-accent hover:underline min-h-[48px] px-4"
        >
          {t('home.signout')}
        </button>
      </div>
    </div>
  );
}
