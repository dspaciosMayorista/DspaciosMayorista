import type { MetadataRoute } from "next";

// Manifest PWA: permite instalar la web como app (Safari → "Agregar a inicio",
// Android → "Instalar"). Los íconos finales se ajustan con la identidad de marca.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "D'spacios Travel",
    short_name: "D'spacios",
    description: "Sistema Integral — Mayorista de Turismo",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1D7C9A",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
