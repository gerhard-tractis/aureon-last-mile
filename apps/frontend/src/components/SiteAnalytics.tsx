'use client';
import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import { GoogleAnalytics } from '@next/third-parties/google';
import { getCookie } from 'cookies-next/client';
import CookieConsent from '@/components/Cookies';

// Authenticated internal areas: no analytics, no consent banner. The banner
// used to overlay primary action buttons on /app/* for warehouse crew on
// phones, and product decided these areas should carry no tracking at all.
const INTERNAL_PREFIXES = ['/app', '/admin'];

function isInternalRoute(pathname: string): boolean {
    return INTERNAL_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}

interface SiteAnalyticsProps {
    gaId?: string;
}

/**
 * Single decision point for what analytics/consent UI renders on a given
 * route. Replaces three previously-independent mounts in the root layout
 * (Vercel Analytics, the cookie banner, and GA) that didn't coordinate with
 * each other — GA loaded regardless of what the user answered in the banner.
 */
const SiteAnalytics = ({ gaId }: SiteAnalyticsProps) => {
    const pathname = usePathname();

    // Consent must live in state (not just read once at mount) so that
    // clicking Accept can flip GA on immediately, in the same render pass,
    // without requiring a page reload to re-read the cookie.
    const [consent, setConsent] = useState<string | undefined>(() => {
        const value = getCookie('cookie-accept');
        return typeof value === 'string' ? value : undefined;
    });

    if (isInternalRoute(pathname)) {
        return null;
    }

    const shouldRenderGA = Boolean(gaId) && consent === 'accepted';

    return (
        <>
            {/* Vercel Web Analytics is cookieless — it stays on regardless of consent. */}
            <Analytics />
            <CookieConsent onDecision={setConsent} />
            {shouldRenderGA && <GoogleAnalytics gaId={gaId as string} />}
        </>
    );
};

export default SiteAnalytics;
