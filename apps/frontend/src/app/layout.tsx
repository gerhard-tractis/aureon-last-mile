import type { Metadata } from "next";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from '@vercel/analytics/next';
import CookieConsent from "@/components/Cookies";
import { GoogleAnalytics } from '@next/third-parties/google';
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import ConnectionStatusBanner from "@/components/ConnectionStatusBanner";
import SentryUserProvider from "@/components/SentryUserProvider";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-manifest",
  display: "swap",
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_PRODUCTNAME,
  description: "Plataforma de gestión de última milla para operadores logísticos chilenos",
  themeColor: "#e6c15c",
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: process.env.NEXT_PUBLIC_PRODUCTNAME || "Aureon Last Mile",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaID = process.env.NEXT_PUBLIC_GOOGLE_TAG;
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable} ${ibmPlexMono.variable}`}>
    <head>
      {/* Inline script runs before hydration to apply theme class immediately, preventing flash */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{
  var s=localStorage.getItem('aureon-theme');
  var mode=(['light','dark','custom'].indexOf(s)!==-1)?s:null;
  if(!mode){mode=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
  document.documentElement.classList.add(mode);
}catch(e){document.documentElement.classList.add('light');}})();`,
        }}
      />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    </head>
    <body>
      <SentryUserProvider />
      <ServiceWorkerRegistration />
      <ConnectionStatusBanner />
      {children}
      <Analytics />
      <CookieConsent />
      { gaID && (
          <GoogleAnalytics gaId={gaID}/>
      )}

    </body>
    </html>
  );
}
