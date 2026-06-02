import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fija la raíz del proyecto (había un package-lock.json suelto en C:\Users\Asus
  // que hacía que Next infiriera mal el workspace root).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
