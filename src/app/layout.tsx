import type { Metadata, Viewport } from "next";
import { Orbitron, Rajdhani } from "next/font/google";
import "./globals.css";

// Display face: angular, wide, futuristic. Headings, numbers, the wordmark.
const display = Orbitron({
  subsets: ["latin"],
  weight: ["500", "700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

// UI face: condensed and technical, but still comfortable at small sizes on a
// phone — Orbitron is far too wide for body copy.
const sans = Rajdhani({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NOVA FITNESS",
  description: "NOVA FITNESS membership, attendance and access management.",
};

export const viewport: Viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
  // Members use this on phones; allow zoom for accessibility.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-nova-black">
        {/* Ambient backdrop: faint grid + red bloom. Fixed and inert. */}
        <div className="nova-backdrop" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
