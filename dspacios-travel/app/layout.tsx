import type { Metadata, Viewport } from "next";
import { Jost } from "next/font/google";
import "../styles/globals.css";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// URL pública del sitio para resolver og:image/links absolutos al compartir.
// En Vercel usa el dominio del deploy automáticamente; si hay dominio propio,
// configúralo en NEXT_PUBLIC_SITE_URL.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const DESCRIPCION = "Mayorista de Turismo — paquetes, tarifario y reservas.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "D'spacios Travel",
  title: { default: "D'spacios Travel", template: "%s · D'spacios Travel" },
  description: DESCRIPCION,
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
  // Previsualización al compartir el link (la imagen sale de app/opengraph-image.tsx).
  openGraph: {
    type: "website",
    siteName: "D'spacios Travel",
    title: "D'spacios Travel",
    description: DESCRIPCION,
    locale: "es_CO",
  },
  twitter: {
    card: "summary_large_image",
    title: "D'spacios Travel",
    description: DESCRIPCION,
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
        {/* Aplica el tema guardado antes de pintar (evita parpadeo) — portal y
            tarifario. Vale para cualquier tema (indigo/verde/web/blueprint). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('dsp-theme');if(t&&t!=='marca')document.documentElement.setAttribute('data-theme',t);}catch(e){}",
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
