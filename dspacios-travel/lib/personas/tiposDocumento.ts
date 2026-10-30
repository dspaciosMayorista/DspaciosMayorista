// #40 E2 — Catálogo de tipos de documento que pueden devolver la RPC de personas (#32/214) y reglas de captura de un CLIENTE/TITULAR.
// Una sola lista para todos los formularios: lo que la búsqueda puede proponer siempre es representable en el <select> y aceptado al guardar.
import { TIPOS_DOC_PERSONA, type TipoDocPersona } from "@/lib/personas/identidad";

/** El valor guardado es el código; la etiqueta solo cambia donde el código no se entiende solo. */
export const ETIQUETA_TIPO_DOC: Record<TipoDocPersona, string> = {
  CC: "CC", CE: "CE", TI: "TI", RC: "RC", PAS: "Pasaporte", PPT: "PPT", NIT: "NIT",
};

/** Lo que la reserva acepta para un PASAJERO: la función atómica de pasajeros (migración 167) exige solo dígitos salvo PAS, así que PPT (alfanumérico) y NIT no se ofrecen. */
export const TIPOS_DOC_PASAJERO = ["CC", "CE", "TI", "RC", "PAS"] as const;

/** Al copiar el cliente a un pasajero: si su tipo no es admitido como pasajero, se copian solo los nombres y el documento queda por capturar (no se inventa uno). */
export function documentoPasajeroDesdeCliente(tipoDoc: string, numeroDoc: string): { tipoDoc: string; numeroDoc: string } {
  return (TIPOS_DOC_PASAJERO as readonly string[]).includes(tipoDoc) ? { tipoDoc, numeroDoc } : { tipoDoc: "CC", numeroDoc: "" };
}

const SOLO_DIGITOS: readonly string[] = ["CC", "CE", "TI", "RC", "NIT"];

/** Número de un CLIENTE/titular coherente con su tipo (misma gramática que la 214): PAS y PPT admiten letras, el resto solo dígitos. Vacío = aún sin número. */
export function documentoClienteAdmitido(tipo: string, numero: string): boolean {
  const n = numero.trim();
  return n === "" || !SOLO_DIGITOS.includes(tipo) || /^\d+$/.test(n);
}

/** Tipo del cliente a guardar: vacío o sin número ⇒ null (no se inventa un tipo); fuera del catálogo ⇒ error. */
export function tipoDocumentoCliente(tipo: unknown, numero: unknown): { ok: true; tipo: TipoDocPersona | null } | { ok: false; error: string } {
  const t = typeof tipo === "string" ? tipo.trim() : "";
  if (t === "") return { ok: true, tipo: null };
  if (!(TIPOS_DOC_PERSONA as readonly string[]).includes(t)) return { ok: false, error: "Elige un tipo de documento válido." };
  const n = typeof numero === "string" ? numero.trim() : "";
  return { ok: true, tipo: n === "" ? null : (t as TipoDocPersona) };
}

/**
 * Tipo a copiar a `ventas` al CONVERTIR una cotización/reserva ya capturada (no al teclear): tolerante, porque cotizaciones viejas traen etiquetas
 * fuera del catálogo («PASAPORTE») y el CHECK de la base las rechazaría, tumbando la conversión. Catálogo ⇒ el código; «PASAPORTE» ⇒ PAS; cualquier
 * otra cosa, o sin número ⇒ null (no se inventa un tipo).
 */
export function tipoDocumentoParaVenta(tipo: unknown, numero: unknown): TipoDocPersona | null {
  if (typeof numero !== "string" || numero.trim() === "") return null;
  const t = typeof tipo === "string" ? tipo.trim().toUpperCase() : "";
  const codigo = t === "PASAPORTE" ? "PAS" : t;
  return (TIPOS_DOC_PERSONA as readonly string[]).includes(codigo) ? (codigo as TipoDocPersona) : null;
}
