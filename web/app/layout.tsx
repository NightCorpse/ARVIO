import type { Metadata, Viewport } from "next";
import { UpdateWatcher } from "@/components/shell/UpdateWatcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARVIO",
  description: "ARVIO media hub for web, iPad, desktop, and TV browsers",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/arvio-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/arvio-icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    // ?v= busts iOS's per-origin touch-icon cache — if Safari cached a miss
    // during an earlier bad-bundle/rate-limit window it keeps showing the "A"
    // fallback on Add to Home Screen until the URL changes.
    apple: [{ url: "/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    title: "ARVIO",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Cover the iOS status-bar area — without this the page top bleeds through
  // above fullscreen surfaces like the player.
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* iOS reads these raw links most reliably when adding to the home
            screen. `precomposed` is the legacy fallback older iOS honors; both
            carry the version bust. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2" />
        <link rel="apple-touch-icon-precomposed" sizes="180x180" href="/apple-touch-icon.png?v=2" />
      </head>
      <body>
        <UpdateWatcher />
        {children}
      </body>
    </html>
  );
}
