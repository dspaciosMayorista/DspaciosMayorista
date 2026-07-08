import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fija la raíz del proyecto (había un package-lock.json suelto en C:\Users\Asus
  // que hacía que Next infiriera mal el workspace root).
  turbopack: {
    root: __dirname,
  },
  // Las subidas de archivos del CMS (subirArchivoWeb) viajan como FormData a
  // través de un Server Action — el límite por defecto de Next (1 MB) las
  // rompía antes de llegar a nuestra propia validación de 15 MB en upload.ts.
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
