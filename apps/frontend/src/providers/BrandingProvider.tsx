'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import {
  generateBrandTokens,
  isValidHexColor,
  type BrandPalette,
} from '@/lib/design/color-utils';

export interface BrandingConfig {
  logoUrl: string | null;
  faviconUrl: string | null;
  companyName: string | null;
  palette: BrandPalette | null;
  hasBranding: boolean;
  isLoading: boolean;
}

const DEFAULTS: BrandingConfig = {
  logoUrl: null,
  faviconUrl: null,
  companyName: null,
  palette: null,
  hasBranding: false,
  isLoading: true,
};

const BrandingContext = createContext<BrandingConfig>(DEFAULTS);

export function useBranding(): BrandingConfig {
  return useContext(BrandingContext);
}

interface RawBranding {
  logo_url?: string | null;
  favicon_url?: string | null;
  company_name?: string | null;
  brand_primary?: string | null;
  brand_background?: string | null;
  brand_text?: string | null;
  brand_secondary?: string | null;
}

function parsePalette(raw: RawBranding | null): BrandPalette | null {
  if (!raw) return null;
  const { brand_primary, brand_background, brand_text } = raw;
  if (
    !brand_primary || !isValidHexColor(brand_primary) ||
    !brand_background || !isValidHexColor(brand_background) ||
    !brand_text || !isValidHexColor(brand_text)
  ) {
    return null;
  }
  return {
    brand_primary,
    brand_background,
    brand_text,
    brand_secondary: raw.brand_secondary ?? undefined,
  };
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { operatorId } = useOperatorId();

  const { data: rawBranding, isLoading } = useQuery({
    queryKey: ['branding', operatorId],
    queryFn: async (): Promise<RawBranding | null> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('operators')
        .select('settings')
        .eq('id', operatorId!)
        .single() as { data: { settings: Record<string, unknown> | null } | null; error: unknown };
      if (error || !data) return null;
      return (data.settings?.branding as RawBranding) ?? null;
    },
    enabled: !!operatorId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const palette = useMemo(() => parsePalette(rawBranding ?? null), [rawBranding]);

  const branding = useMemo<BrandingConfig>(() => ({
    logoUrl: rawBranding?.logo_url ?? null,
    faviconUrl: rawBranding?.favicon_url ?? null,
    companyName: rawBranding?.company_name ?? null,
    palette,
    hasBranding: palette !== null,
    isLoading,
  }), [rawBranding, palette, isLoading]);

  // Inject brand CSS tokens into <html> when a valid palette is active
  useEffect(() => {
    if (!palette) return;
    const tokens = generateBrandTokens(palette);
    const root = document.documentElement;
    const applied: string[] = [];

    for (const [prop, val] of Object.entries(tokens)) {
      root.style.setProperty(prop, val);
      applied.push(prop);
    }

    return () => {
      for (const prop of applied) {
        root.style.removeProperty(prop);
      }
    };
  }, [palette]);

  // Update browser title
  useEffect(() => {
    document.title = branding.companyName
      ? `${branding.companyName} — Aureon Last Mile`
      : 'Aureon Last Mile';
  }, [branding.companyName]);

  // Dynamic favicon override
  useEffect(() => {
    if (!branding.faviconUrl) return;

    const setFavicon = (rel: string, href: string) => {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = href;
    };

    const originalIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href;
    const originalApple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href;

    setFavicon('icon', branding.faviconUrl);
    setFavicon('apple-touch-icon', branding.faviconUrl);

    return () => {
      if (originalIcon) setFavicon('icon', originalIcon);
      if (originalApple) setFavicon('apple-touch-icon', originalApple);
    };
  }, [branding.faviconUrl]);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}
