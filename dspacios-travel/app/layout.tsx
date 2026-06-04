import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import "../styles/globals.css";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

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
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png",
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
      <head>
        {/* Aplica el tema guardado antes de pintar (evita parpadeo). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('dsp-theme');if(t==='indigo')document.documentElement.setAttribute('data-theme','indigo');}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full bg-white text-gray-900 font-sans">
        {children}
        <ThemeSwitcher />
      </body>
    </html>
  );
}
