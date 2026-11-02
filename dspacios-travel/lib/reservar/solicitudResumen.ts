// #120 (PR #432) · Componentes NO monetarios de una solicitud pendiente de tarifa, congelados al crearla en `detalle.solicitudHotel`.
// Pura (sin I/O). Del vuelo solo viaja lo confirmado en la salida (aerolínea, ruta, fechas, vuelos y horarios): nunca record/PNR, proveedor, costo ni tarifa.

export type VueloSolicitud = {
  aerolinea: string | null; ruta: string | null; fechaIda: string | null; fechaRegreso: string | null;
  vueloIda: string | null; vueloRegreso: string | null;
  salidaIda: string | null; llegadaIda: string | null; salidaRegreso: string | null; llegadaRegreso: string | null;
};
export type ServicioSolicitud = { nombre: string; categoria: string | null };

type DatosVueloCrudos = {
  aerolinea?: string | null; ruta?: string | null; fecha_ida?: string | null; fecha_regreso?: string | null; vuelo_ida?: string | null; vuelo_regreso?: string | null;
  hora_salida_ida?: string | null; hora_llegada_ida?: string | null; hora_salida_reg?: string | null; hora_llegada_reg?: string | null;
};

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const hora = (v: unknown): string | null => { const t = texto(v); return t ? t.slice(0, 5) : null; };

/** Recorta los datos del vuelo de la salida a lo que el cliente puede ver. Un campo que la salida no tiene queda null (nunca se inventa). */
export function vueloParaSolicitud(d: DatosVueloCrudos): VueloSolicitud {
  return {
    aerolinea: texto(d.aerolinea), ruta: texto(d.ruta), fechaIda: texto(d.fecha_ida), fechaRegreso: texto(d.fecha_regreso),
    vueloIda: texto(d.vuelo_ida), vueloRegreso: texto(d.vuelo_regreso),
    salidaIda: hora(d.hora_salida_ida), llegadaIda: hora(d.hora_llegada_ida), salidaRegreso: hora(d.hora_salida_reg), llegadaRegreso: hora(d.hora_llegada_reg),
  };
}

/** Servicios incluidos del paquete, solo nombre y categoría (sin proveedor, tarifa ni modo de cobro), sin repetidos. */
export function serviciosParaSolicitud(filas: { servicios_adicionales?: { nombre?: string | null; categoria?: string | null } | null }[]): ServicioSolicitud[] {
  const vistos = new Set<string>();
  const r: ServicioSolicitud[] = [];
  for (const f of filas) {
    const nombre = texto(f.servicios_adicionales?.nombre);
    if (!nombre || vistos.has(nombre)) continue;
    vistos.add(nombre);
    r.push({ nombre, categoria: texto(f.servicios_adicionales?.categoria) });
  }
  return r;
}
