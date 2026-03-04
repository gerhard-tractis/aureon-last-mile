'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import { generateColorRamp, isValidHexColor } from '@/utils/generateColorRamp';

export interface BrandingConfig {
  logoUrl: string | null;
  faviconUrl: string | null;
  companyName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  isLoading: boolean;
}

const DEFAULTS: BrandingConfig = {
  logoUrl: null,
  faviconUrl: null,
  companyName: null,
  primaryColor: null,
  secondaryColor: null,
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
  primary_color?: string | null;
  secondary_color?: string | null;
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

  const branding = useMemo<BrandingConfig>(() => ({
    logoUrl: rawBranding?.logo_url ?? null,
    faviconUrl: rawBranding?.favicon_url ?? null,
    companyName: rawBranding?.company_name ?? null,
    primaryColor: rawBranding?.primary_color ?? null,
    secondaryColor: rawBranding?.secondary_color ?? null,
    isLoading,
  }), [rawBranding, isLoading]);

  // AC3: Apply dynamic CSS variable overrides
  useEffect(() => {
    const appliedVars: string[] = [];

    if (branding.primaryColor && isValidHexColor(branding.primaryColor)) {
      const ramp = generateColorRamp('primary', branding.primaryColor);
      for (const [prop, val] of Object.entries(ramp)) {
        document.body.style.setProperty(prop, val);
        appliedVars.push(prop);
      }
    }

    if (branding.secondaryColor && isValidHexColor(branding.secondaryColor)) {
      const ramp = generateColorRamp('secondary', branding.secondaryColor);
      for (const [prop, val] of Object.entries(ramp)) {
        document.body.style.setProperty(prop, val);
        appliedVars.push(prop);
      }
    }

    // Cleanup: remove all applied CSS variables
    return () => {
      for (const prop of appliedVars) {
        document.body.style.removeProperty(prop);
      }
    };
  }, [branding.primaryColor, branding.secondaryColor]);

  // AC5: Update browser title
  useEffect(() => {
    if (branding.companyName) {
      document.title = `${branding.companyName} — Aureon Last Mile`;
    } else {
      document.title = 'Aureon Last Mile';
    }
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
