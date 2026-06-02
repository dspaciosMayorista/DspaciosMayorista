import type { Metadata } from "next";
import { Jost } from "next/font/google";
import "../styles/globals.css";

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "D'spacios Travel",
  description: "Sistema Integral — Mayorista de Turismo",
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
