import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import "../styles/globals.css";

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  applicationName: "D'spacios Travel",
  title: { default: "D'spacios Travel", template: "%s · D'spacios Travel" },
  description: "Sistema Integral — Mayorista de Turismo",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "D'spacios",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1D7C9A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${jost.variable} h-full antialiased`}>
      <body className="min-h-full bg-white text-gray-900 font-sans">
        {children}
      </body>
    </html>
  );
}
