'use client';

import React from 'react';
import Link from 'next/link';
import { useBranding } from '@/providers/BrandingProvider';

export default function TabletTopBar() {
  const { logoUrl, companyName } = useBranding();

  return (
    <header className="flex items-center h-14 px-4 bg-sidebar border-b border-sidebar-border">
      <Link
        href="/app/tablet-home"
        aria-label="Ir a inicio"
        className="flex items-center justify-center min-h-[48px] min-w-[48px] text-sm text-sidebar-text hover:text-sidebar-active transition-colors"
      >
        ← Inicio
      </Link>
      <div className="flex-1 flex justify-center">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={companyName || 'Logo'}
            className="max-h-8 object-contain"
          />
        ) : (
          <span className="text-sm font-semibold text-sidebar-active">
            {companyName || 'Aureon'}
          </span>
        )}
      </div>
      {/* Spacer keeps branding centered */}
      <div className="min-w-[48px]" />
    </header>
  );
}
