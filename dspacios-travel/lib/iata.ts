// Catálogo IATA → ciudad y utilidades de ruta.
//
// 👉 PARA AGREGAR CIUDADES/CÓDIGOS: añade una línea a `IATA_CIUDAD` con el
//    código IATA (3 letras) en MAYÚSCULAS y el nombre de la ciudad.
//
// La RUTA de un bloqueo viene como "ORIGEN - DESTINO - ORIGEN" (ej. "MDE - CTG - MDE").
//   Origen  = primer código  (MDE → Medellín)
//   Destino = segundo código (CTG → Cartagena)

export const IATA_CIUDAD: Record<string, string> = {
  // Colombia
  BOG: "Bogotá",
  MDE: "Medellín",
  CTG: "Cartagena",
  SMR: "Santa Marta",
  CLO: "Cali",
  BAQ: "Barranquilla",
  ADZ: "San Andrés",
  PEI: "Pereira",
  BGA: "Bucaramanga",
  CUC: "Cúcuta",
  SMTA: "Santa Marta",
  RCH: "Riohacha",
  MTR: "Montería",
  VVC: "Villavicencio",
  AXM: "Armenia",
  NVA: "Neiva",
  EOH: "Medellín (Olaya Herrera)",
  // Internacionales frecuentes
  PTY: "Ciudad de Panamá",
  MIA: "Miami",
  CUN: "Cancún",
  PUJ: "Punta Cana",
  MAD: "Madrid",
  LIM: "Lima",
};

/** Nombre de la ciudad para un código IATA (o null si no está en el catálogo). */
export function ciudadIata(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  return IATA_CIUDAD[codigo.trim().toUpperCase()] ?? null;
}

/** "Medellín (MDE)" si conozco la ciudad, si no solo "MDE". Vacío si no hay código. */
export function etiquetaIata(codigo: string | null | undefined): string {
  const c = (codigo ?? "").trim().toUpperCase();
  if (!c) return "";
  const ciudad = ciudadIata(c);
  return ciudad ? `${ciudad} (${c})` : c;
}

/** Parte una ruta "MDE - CTG - MDE" en { origen, destino } (códigos IATA). */
export function parseRuta(ruta: string | null | undefined): { origen: string | null; destino: string | null } {
  if (!ruta) return { origen: null, destino: null };
  const codigos = ruta.split(/[^A-Za-z]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  return { origen: codigos[0] ?? null, destino: codigos[1] ?? null };
}
