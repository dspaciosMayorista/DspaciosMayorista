// Servicios que NO se pueden ofrecer en la oferta pública por no tener ninguna vigencia con rango de fechas válido. La tarifa «GENERAL» no respalda la venta (migración 255),
// salvo: la asistencia médica SIN ninguna vigencia (tarifaBasePermanente.ts) y un traslado INCLUIDO sin vigencia para la fecha del viaje (servicioVigencias.ts::incluidoEnEstadia). Como opcional, sin vigencia no se ofrece.
export type VigenciaMinima = { fecha_inicio: string | null; fecha_fin: string | null };
export type ServicioMinimo = { id: number; nombre: string; categoria?: string | null };

export const vigenciaConFechasValidas = (v: VigenciaMinima): boolean => !!v.fecha_inicio && !!v.fecha_fin && v.fecha_fin >= v.fecha_inicio;

export function serviciosSinVigencia<S extends ServicioMinimo>(servicios: readonly S[], vigencias: Readonly<Record<number, readonly VigenciaMinima[]>>): S[] {
  return servicios.filter((s) => {
    const lista = vigencias[s.id] ?? [];
    if (s.categoria === "asistencia" && lista.length === 0) return false;
    return !lista.some(vigenciaConFechasValidas);
  });
}
