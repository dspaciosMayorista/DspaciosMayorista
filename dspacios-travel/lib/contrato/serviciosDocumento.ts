// Sección «Servicios incluidos» de los documentos del cliente (cotización y contrato). Módulo PURO: solo presentación, nunca un importe.
// Muestra QUÉ incluye cada servicio (nombre), CUÁNDO (fechas) y A QUIÉN cubre, sin repetir su precio ni exponer precios por servicio: el importe ya va dentro de las tarifas por pasajero.
//   · El nombre y las fechas salen de la línea del servicio («Servicio · {nombre} · {ida} → {regreso} · {n} pax — sujeto a confirmación…»).
//   · La cobertura sale del resumen por pasajero cuando existe (cuántos adultos/niños/infantes de cuántos): nunca se inventa quiénes son; con solo la línea se dice cuántos pasajeros.
import type { ResumenPrecios } from "../cotizacion/resumenPrecios.ts";

export type ServicioDocumento = {
  nombre: string;
  /** Fechas ISO del servicio; null si no tiene. */
  fechaIda: string | null;
  fechaRegreso: string | null;
  /** Pasajeros que cubre según la línea del servicio (null si no se pudo leer). */
  pax: number | null;
  /** Texto de cobertura listo para el cliente. */
  cubre: string;
};

const FECHA = /^(\d{4}-\d{2}-\d{2})(?: → (\d{4}-\d{2}-\d{2}))?$/;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Lee una línea «Servicio · …». Devuelve null si no es de servicio. */
export function leerLineaServicio(descripcion: string): Omit<ServicioDocumento, "cubre"> | null {
  if (typeof descripcion !== "string" || !descripcion.startsWith("Servicio · ")) return null;
  const cuerpo = descripcion.slice("Servicio · ".length).split(" — ")[0];
  const partes = cuerpo.split(" · ").map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return null;
  const [nombre, ...resto] = partes;
  let fechaIda: string | null = null, fechaRegreso: string | null = null, pax: number | null = null;
  for (const p of resto) {
    const f = FECHA.exec(p);
    if (f) { fechaIda = f[1]; fechaRegreso = f[2] ?? null; continue; }
    const n = /^(\d+) pax$/.exec(p);
    if (n) pax = Number(n[1]);
  }
  return { nombre, fechaIda, fechaRegreso, pax };
}

/** Cuántos pasajeros de cada tipo cubre el servicio `nombre` según el resumen guardado (suma de los grupos que lo incluyen). */
function coberturaEnResumen(resumen: ResumenPrecios, nombre: string): { cubiertos: number; adultos: number; menores: number; total: number } | null {
  let cubiertos = 0, adultos = 0, menores = 0, total = 0;
  for (const u of resumen.unidades) for (const g of u.grupos) {
    total += g.cantidad;
    if (g.incluye.includes(nombre)) { cubiertos += g.cantidad; if (g.tipo === "adulto") adultos += g.cantidad; else menores += g.cantidad; }
  }
  return cubiertos > 0 ? { cubiertos, adultos, menores, total } : null;
}

export function textoCobertura(c: { cubiertos: number; adultos: number; menores: number; total: number }): string {
  if (c.cubiertos === c.total) return `Todos los pasajeros (${c.total})`;
  const detalle = [c.adultos ? plural(c.adultos, "adulto", "adultos") : "", c.menores ? plural(c.menores, "menor", "menores") : ""].filter(Boolean).join(" y ");
  return `${c.cubiertos} de ${c.total} pasajeros${detalle ? ` (${detalle})` : ""}`;
}

/** Servicios que muestra la sección, en el orden de la cotización. Líneas que no son de servicio se ignoran. */
export function serviciosDeDocumento<L extends { descripcion: string }>(lineas: readonly L[], resumen: ResumenPrecios | null, paxTotal: number | null, paxDeLinea?: (l: L) => number | null): ServicioDocumento[] {
  const out: ServicioDocumento[] = [];
  for (const l of lineas) {
    const leida = leerLineaServicio(l.descripcion);
    if (!leida) continue;
    // Cuando la línea no dice cuántos pasajeros cubre, vale el dato congelado de la cotización (snapshot), si lo hay.
    const s = leida.pax == null ? { ...leida, pax: paxDeLinea?.(l) ?? null } : leida;
    const cob = resumen ? coberturaEnResumen(resumen, s.nombre) : null;
    const cubre = cob ? textoCobertura(cob)
      : s.pax != null ? (paxTotal != null && s.pax === paxTotal ? `Todos los pasajeros (${paxTotal})` : paxTotal != null ? `${s.pax} de ${paxTotal} pasajeros` : plural(s.pax, "pasajero", "pasajeros"))
        : "Según lo acordado";
    out.push({ ...s, cubre });
  }
  return out;
}
