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
  PVA: "Providencia",
  // Internacionales frecuentes
  PTY: "Ciudad de Panamá",
  MIA: "Miami",
  MCO: "Orlando",
  FLL: "Fort Lauderdale",
  JFK: "Nueva York",
  CUN: "Cancún",
  PUJ: "Punta Cana",
  SDQ: "Santo Domingo",
  MAD: "Madrid",
  LIM: "Lima",
  // Caribe
  CUR: "Curazao",
  AUA: "Aruba",
  BON: "Bonaire",
  SXM: "San Martín",
  NAS: "Nassau",
  MBJ: "Montego Bay",
  KIN: "Kingston",
  GCM: "Gran Caimán",
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

const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Código IATA de una ciudad/destino desde el CATÁLOGO (`IATA_CIUDAD`): coincidencia EXACTA del nombre (sin tildes ni mayúsculas) y única. Si el nombre no está o aparece con dos
 * códigos devuelve null: nunca se infiere ni se adivina (quien llama pide corregir el dato en el catálogo de destinos).
 */
export function codigoIataDeCiudad(nombre: string | null | undefined): string | null {
  const n = sinTildes(nombre ?? "");
  if (!n) return null;
  const hallados = Object.entries(IATA_CIUDAD).filter(([codigo, ciudad]) => /^[A-Z]{3}$/.test(codigo) && sinTildes(ciudad) === n).map(([codigo]) => codigo);
  return hallados.length === 1 ? hallados[0] : null;
}

/** ¿Tiene forma de código IATA (3 letras)? */
export function esCodigoIata(c: string | null | undefined): c is string {
  return typeof c === "string" && /^[A-Za-z]{3}$/.test(c.trim());
}

/**
 * Clave canónica de un ORIGEN de paquete (solo presentación/filtro; el dato del vuelo no cambia): una ciudad del catálogo `IATA_CIUDAD`
 * —dada como código ("MDE") o como nombre exacto ("MEDELLÍN")— resuelve a su único código IATA, así bloqueos y salidas dinámicas caen en
 * la misma opción. Sin correspondencia confiable (fuera del catálogo o con dos códigos) conserva su propio valor: nunca se adivina por texto.
 */
export function claveOrigen(valor: string | null | undefined): string {
  const v = (valor ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!v) return "";
  return codigoIataDeCiudad(IATA_CIUDAD[v] ?? v) ?? v;
}

/** Texto legible de una clave de `claveOrigen`: la ciudad del catálogo, o la clave tal cual si no hay correspondencia. */
export const etiquetaOrigen = (clave: string): string => ciudadIata(clave) ?? clave;
