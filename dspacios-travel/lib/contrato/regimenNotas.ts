// Cruza el régimen guardado en el contrato (texto, normalmente el código del plan)
// con planes_alimentacion para adjuntar su "nota especial" a cada hotel del contrato.
// Pura: la página hace el fetch y pasa los planes.

export type PlanNota = { codigo: string; nombre: string; nota_especial: string | null };

export function adjuntarNotaRegimen<T extends { alimentacion: string | null }>(
  hoteles: T[],
  planes: PlanNota[],
): (T & { nota_regimen: string | null })[] {
  const map = new Map<string, string>();
  for (const p of planes) {
    if (!p.nota_especial) continue;
    map.set(p.codigo.trim().toLowerCase(), p.nota_especial);
    map.set(p.nombre.trim().toLowerCase(), p.nota_especial);
  }
  return hoteles.map((h) => ({
    ...h,
    nota_regimen: h.alimentacion ? map.get(h.alimentacion.trim().toLowerCase()) ?? null : null,
  }));
}
