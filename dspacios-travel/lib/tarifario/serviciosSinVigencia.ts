// Servicios que NO se pueden ofrecer en la oferta pública por no tener ninguna vigencia con rango de fechas válido. La tarifa «GENERAL» es histórica y
// nunca respalda la venta (migración 255). Excepción vigente: la asistencia médica SIN ninguna vigencia cobra su base permanente (tarifaBasePermanente.ts).
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
