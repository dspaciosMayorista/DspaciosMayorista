// ─────────────────────────────────────────────────────────────────────────
// Composición de los servicios INCLUIDOS de un paquete por salida (servidor, cliente admin).
//
// Para cada salida fija (bloqueo: vuelos bloqueados y empaquetados; dinámico: salidas activas) calcula, con la MISMA regla que la publicación y la reserva
// (`incluidoEnEstadia` en la fecha de ida), qué incluidos se omiten por no tener tarifa vigente. El resultado se cuelga de `descripcionPorPaquete[paqueteId].composicion`
// y alimenta el «Incluye» por salida (ver incluyePorSalida.ts). No escribe nada. Un error de lectura NO se ignora: marca `composicionNoDisponible` y el «Incluye» manual
// no se presenta (no se afirma algo que no se pudo contrastar con lo que se cobra).
// ─────────────────────────────────────────────────────────────────────────
import type { createAdminClient } from "@/lib/supabase/admin";
import { cargarVigenciasServicios } from "@/lib/reservar/temporadasServicio";
import { incluidoEnEstadia, type VigenciasServicio } from "@/lib/calc/servicioVigencias";
import type { ComposicionIncluidos, DescripcionPaqueteRaw } from "./descripcionPaquete";

type Admin = ReturnType<typeof createAdminClient>;

/** Ids de los incluidos que NO se cobran en la fecha de ida (cualquier causa por la que `incluidoEnEstadia` no devuelve una tarifa: la salida no los promete). PURO. */
export function omitidosEnFecha(
  incluidos: readonly { servicioId: number; modo: "persona" | "grupo"; vigencias: VigenciasServicio | undefined }[], fechaIda: string,
): number[] {
  const out: number[] = [];
  for (const s of incluidos) {
    const r = s.vigencias ? incluidoEnEstadia(s.vigencias, s.modo, fechaIda, fechaIda) : null;
    if (!r || !r.ok) out.push(s.servicioId);
  }
  return out;
}

/**
 * Agrega `composicion` a cada paquete con servicios incluidos. Muta y devuelve el mismo mapa. Sin cliente admin o sin paquetes: no hace nada.
 * `onError` recibe el mensaje técnico (para observabilidad); los paquetes afectados quedan con `composicionNoDisponible`.
 */
export async function adjuntarComposicionIncluidos(
  admin: Admin | null | undefined,
  descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>,
  onError?: (mensaje: string) => void,
): Promise<Record<number, DescripcionPaqueteRaw>> {
  const ids = Object.keys(descripcionPorPaquete).map(Number);
  if (!admin || !ids.length) return descripcionPorPaquete;
  const fallar = (m: string) => {
    onError?.(m);
    for (const id of ids) descripcionPorPaquete[id] = { ...descripcionPorPaquete[id], composicionNoDisponible: true };
    return descripcionPorPaquete;
  };
  try {
    const { data: inc, error: eInc } = await admin
      .from("armado_servicios").select("paquete_id, servicio_id, modo, servicios_adicionales(nombre)").in("paquete_id", ids).eq("incluido", true);
    if (eInc) return fallar(`armado_servicios: ${eInc.message}`);
    const filas = (inc ?? []) as unknown as { paquete_id: number; servicio_id: number; modo: string | null; servicios_adicionales: { nombre?: string | null } | null }[];
    if (!filas.length) return descripcionPorPaquete;
    const rv = await cargarVigenciasServicios(admin, filas.map((f) => ({ id: f.servicio_id, nombre: f.servicios_adicionales?.nombre ?? `#${f.servicio_id}` })));
    if (!rv.ok) return fallar(`vigencias: ${rv.error}`);

    const paqIds = [...new Set(filas.map((f) => f.paquete_id))];
    const [pq, av, ae, sd] = await Promise.all([
      admin.from("armado_paquetes").select("id, tipo").in("id", paqIds),
      admin.from("armado_vuelos").select("paquete_id, bloqueo_id").in("paquete_id", paqIds),
      admin.from("armado_empaquetados").select("paquete_id, empaquetado_id").in("paquete_id", paqIds),
      admin.from("salidas_dinamicas").select("paquete_id, fecha_ida, activo").in("paquete_id", paqIds),
    ]);
    const err = pq.error ?? av.error ?? ae.error ?? sd.error;
    if (err) return fallar(`salidas: ${err.message}`);
    const bloqIds = [...new Set((av.data ?? []).map((x) => x.bloqueo_id).filter((x): x is number => x != null))];
    const empIds = [...new Set((ae.data ?? []).map((x) => x.empaquetado_id).filter((x): x is number => x != null))];
    const [bq, em] = await Promise.all([
      bloqIds.length ? admin.from("bloqueos_vuelo").select("id, fecha_ida").in("id", bloqIds) : Promise.resolve({ data: [], error: null }),
      empIds.length ? admin.from("empaquetados").select("id, fecha_ida").in("id", empIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (bq.error || em.error) return fallar(`fechas: ${(bq.error ?? em.error)!.message}`);
    const fechaBloqueo = new Map((bq.data ?? []).map((b) => [b.id as number, b.fecha_ida as string | null]));
    const fechaEmpaquetado = new Map((em.data ?? []).map((b) => [b.id as number, b.fecha_ida as string | null]));
    const tipoPaquete = new Map((pq.data ?? []).map((p) => [p.id as number, String(p.tipo)]));

    for (const paqueteId of paqIds) {
      const tipo = tipoPaquete.get(paqueteId);
      const fechas = new Set<string>();
      if (tipo === "bloqueo") {
        for (const x of av.data ?? []) if (x.paquete_id === paqueteId) { const f = fechaBloqueo.get(x.bloqueo_id as number); if (f) fechas.add(f); }
        for (const x of ae.data ?? []) if (x.paquete_id === paqueteId) { const f = fechaEmpaquetado.get(x.empaquetado_id as number); if (f) fechas.add(f); }
      } else if (tipo === "dinamico") {
        for (const x of sd.data ?? []) if (x.paquete_id === paqueteId && x.activo === true && x.fecha_ida) fechas.add(x.fecha_ida as string);
      }
      const delPaquete = filas.filter((f) => f.paquete_id === paqueteId);
      const incluidos = delPaquete.map((f) => ({ servicioId: f.servicio_id, modo: (f.modo === "grupo" ? "grupo" : "persona") as "persona" | "grupo", vigencias: rv.porServicio.get(f.servicio_id) }));
      const omitidosPorFecha: Record<string, number[]> = {};
      for (const fecha of fechas) { const o = omitidosEnFecha(incluidos, fecha); if (o.length) omitidosPorFecha[fecha] = o; }
      const composicion: ComposicionIncluidos = {
        servicios: delPaquete.map((f) => ({ servicioId: f.servicio_id, nombre: f.servicios_adicionales?.nombre ?? `Servicio ${f.servicio_id}` })),
        omitidosPorFecha,
      };
      const base = descripcionPorPaquete[paqueteId];
      if (base) descripcionPorPaquete[paqueteId] = { ...base, composicion };
    }
    return descripcionPorPaquete;
  } catch (e) {
    return fallar(e instanceof Error ? e.message : "error desconocido");
  }
}
