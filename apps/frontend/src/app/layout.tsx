import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from '@vercel/analytics/next';
import CookieConsent from "@/components/Cookies";
import { GoogleAnalytics } from '@next/third-parties/google';
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import ConnectionStatusBanner from "@/components/ConnectionStatusBanner";


export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_PRODUCTNAME,
  description: "The best way to build your SaaS product.",
  manifest: "/manifest.json",
  themeColor: "#e6c15c",
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
  let theme = process.env.NEXT_PUBLIC_THEME
  if(!theme) {
    theme = "theme-sass3"
  }
  const gaID = process.env.NEXT_PUBLIC_GOOGLE_TAG;
  return (
    <html lang="en">
    <head>
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    </head>
    <body className={theme}>
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
