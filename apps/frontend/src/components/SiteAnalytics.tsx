'use client';
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import { GoogleAnalytics } from '@next/third-parties/google';
import { getCookie } from 'cookies-next/client';
import CookieConsent, { COOKIE_CONSENT_KEY } from '@/components/Cookies';

// Authenticated internal areas: no analytics, no consent banner. The banner
// used to overlay primary action buttons on /app/* for warehouse crew on
// phones, and product decided these areas should carry no tracking at all.
const INTERNAL_PREFIXES = ['/app', '/admin'];

function isInternalRoute(pathname: string): boolean {
    return INTERNAL_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}

type ConsentValue = 'accepted' | 'declined';

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
    const internalRoute = isInternalRoute(pathname);

    // Consent lives in state (not just read once at mount) so that clicking
    // Accept can flip GA on immediately, in the same render pass, without
    // requiring a page reload to re-read the cookie.
    const [consent, setConsent] = useState<ConsentValue | undefined>(() => {
        const value = getCookie(COOKIE_CONSENT_KEY);
        return value === 'accepted' || value === 'declined' ? value : undefined;
    });

    // next/script never tears gtag.js down on unmount (no cleanup registered
    // for the script element or window.dataLayer), so once GA has loaded on
    // a public route, merely unmounting <GoogleAnalytics> on a later internal
    // route does NOT stop it — GA4's default enhanced measurement keeps
    // reporting client-side navigations (e.g. router.push('/app') after
    // login) for the rest of the session. window['ga-disable-<id>'] is
    // Google's documented kill switch: gtag.js checks it before sending any
    // hit, so this must be kept in sync with route + consent on every
    // render, not just set once.
    useEffect(() => {
        if (!gaId) return;
        const disabled = internalRoute || consent !== 'accepted';
        (window as unknown as Record<string, boolean>)[`ga-disable-${gaId}`] = disabled;
    }, [gaId, internalRoute, consent]);

    if (internalRoute) {
        return null;
    }

    return (
        <>
            {/* Vercel Web Analytics is cookieless — it stays on regardless of consent. */}
            <Analytics />
            <CookieConsent onDecision={setConsent} />
            {gaId && consent === 'accepted' && <GoogleAnalytics gaId={gaId} />}
        </>
    );
};

export default SiteAnalytics;
