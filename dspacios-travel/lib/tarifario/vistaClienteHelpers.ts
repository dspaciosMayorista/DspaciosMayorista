// Lógica PURA del cliente de tarifario (TarifarioPublic.tsx/VistaBooking.tsx)
// para la carga progresiva ("carga bajo demanda", ronda posterior a la
// caché compartida rechazada por Next — "items over 2MB can not be
// cached"). Vive en un archivo `.ts` SIN JSX ni imports de React/Next a
// propósito: `app/tarifario/TarifarioPublic.tsx` es un componente cliente
// con JSX real — bajo `node --test --experimental-strip-types` (que solo
// borra anotaciones de tipo, no transforma JSX) importar algo de VALOR
// desde ahí revienta al cargar el módulo. Los imports de TIPO desde
// TarifarioPublic.tsx (`FilaTarifario`, `CapHotel`, `InfoHotel`,
// `ModuloKey`) sí son seguros — se borran por completo antes de ejecutar,
// nunca cargan el módulo real (mismo patrón que ya usa lib/tarifario/datos.ts).
import type { FilaTarifario, CapHotel, InfoHotel, ModuloKey } from "@/app/tarifario/TarifarioPublic";
import type { PlanesInfo } from "@/app/tarifario/RegimenInfo";
import { PAGE_SIZE_PUBLICO, PAGE_SIZE_BLOQUEO, type ModuloTarifario } from "./consulta.ts";

export type Enriquecimiento = {
  cuposPorBloqueo: Record<number, number>;
  origenPorBloqueo: Record<number, string>;
  fotosPorHotel: Record<number, string>;
  fotosPorServicio: Record<number, string>;
  infoPorHotel: InfoHotel;
  planesInfo: PlanesInfo;
  capPorHotel: CapHotel;
  ventanaPorPaquete: Record<number, { min: string | null; max: string | null }>;
  incluidosPorPaquete: Record<number, string[]>;
  filasAddon: FilaTarifario[];
};

// Une el enriquecimiento nuevo con el ya cargado — usado por "Cargar más"
// (los mapas SIGUEN creciendo con cada página). Para cupos/origen el valor
// NUEVO siempre gana (es la lectura EN VIVO más reciente de esa salida; ver
// lib/tarifario/datos.ts, nunca se sirve desde una caché con TTL).
export function fusionarEnriquecimiento(prev: Enriquecimiento, nuevo: Enriquecimiento): Enriquecimiento {
  return {
    cuposPorBloqueo: { ...prev.cuposPorBloqueo, ...nuevo.cuposPorBloqueo },
    origenPorBloqueo: { ...prev.origenPorBloqueo, ...nuevo.origenPorBloqueo },
    fotosPorHotel: { ...prev.fotosPorHotel, ...nuevo.fotosPorHotel },
    fotosPorServicio: { ...prev.fotosPorServicio, ...nuevo.fotosPorServicio },
    infoPorHotel: { ...prev.infoPorHotel, ...nuevo.infoPorHotel },
    planesInfo: { ...prev.planesInfo, ...nuevo.planesInfo },
    capPorHotel: { ...prev.capPorHotel, ...nuevo.capPorHotel },
    ventanaPorPaquete: { ...prev.ventanaPorPaquete, ...nuevo.ventanaPorPaquete },
    incluidosPorPaquete: { ...prev.incluidosPorPaquete, ...nuevo.incluidosPorPaquete },
    filasAddon: [...prev.filasAddon, ...nuevo.filasAddon],
  };
}

// "receptivos" (etiqueta de Vista Booking) es el módulo "servicios" (dato real).
export function moduloDeSub(sub: "bloqueo" | "porcion_terrestre" | "receptivos"): ModuloTarifario {
  return sub === "receptivos" ? "servicios" : sub;
}
export function subDeModulo(modulo: ModuloKey): "bloqueo" | "porcion_terrestre" | "receptivos" {
  if (modulo === "servicios") return "receptivos";
  if (modulo === "porcion_terrestre") return "porcion_terrestre";
  return "bloqueo";
}
export function pageSizeDe(modulo: ModuloTarifario): number {
  return modulo === "bloqueo" ? PAGE_SIZE_BLOQUEO : PAGE_SIZE_PUBLICO;
}
