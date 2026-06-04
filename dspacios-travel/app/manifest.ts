import type { MetadataRoute } from "next";

// Manifest PWA: permite instalar la web como app (Safari → "Agregar a inicio",
// Android → "Instalar"). Íconos derivados del manual de marca (logo blanco sobre
// el degradado oficial).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agencia de Viajes",
    short_name: "Agencia",
    description: "Sistema integral de gestión para agencias de viajes y turismo",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1D7C9A",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
