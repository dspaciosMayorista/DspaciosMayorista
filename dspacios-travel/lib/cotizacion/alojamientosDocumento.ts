// B95-15/18 (owner 2026-11-26) — «Alojamiento» de una cotización dinámica (manual / hija de comparativa) para el documento del CLIENTE. Módulo PURO: solo presentación.
// La cotización manual agrupa lo comercial en UNA fila «PAQUETE TURÍSTICO A …» (#39), pero el cliente debe ver QUÉ hotel, qué categoría, qué plan de alimentación y qué acomodación eligió (antes solo
// los veía en el contrato convertido, y ahí ni siquiera salían: la conversión no escribía `contrato_hoteles`; ver migración 347). Aquí sale de la COPIA guardada en `payload.servicios` (lo que el asesor editó),
// nunca del catálogo vigente.
//   · Solo campos DESCRIPTIVOS: nombre, categoría, régimen (alimentación), acomodación (+ nota libre). Nunca proveedor, plataforma, costo, markup ni la forma de compra: eso es interno.
//   · Ciudad y fechas solo con UN hotel (viaje completo): con varios la cotización no guarda a qué noches corresponde cada uno y NO se inventa (mismo criterio que la conversión a contrato).
//   · En la hija de una comparativa solo viaja el hotel elegido; la madre (varios hoteles = alternativas) no se imprime con este documento.

export type AlojamientoDoc = {
  nombre: string;
  categoria: string | null;
  alimentacion: string | null;
  acomodacion: string | null;
  detalle_acomodacion: string | null;
  ciudad: string | null;
  fecha_ingreso: string | null;
  fecha_salida: string | null;
};

const texto = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};
const fecha = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function alojamientosDeServicios(
  servicios: unknown,
  viaje: { destino?: string | null; fechaIda?: string | null; fechaRegreso?: string | null },
): AlojamientoDoc[] {
  if (!Array.isArray(servicios)) return [];
  const hoteles = servicios.filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && (s as { tipo?: unknown }).tipo === "hotel" && texto((s as { nombre?: unknown }).nombre) !== null);
  const uno = hoteles.length === 1;
  return hoteles.map((h) => ({
    nombre: texto(h.nombre)!,
    categoria: texto(h.categoria),
    alimentacion: texto(h.regimen),
    acomodacion: texto(h.acomodacion),
    detalle_acomodacion: texto(h.detalleAcomodacion),
    ciudad: uno ? texto(viaje.destino) : null,
    fecha_ingreso: uno ? fecha(viaje.fechaIda) : null,
    fecha_salida: uno ? fecha(viaje.fechaRegreso) : null,
  }));
}
