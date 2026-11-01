// ─────────────────────────────────────────────────────────────────────────
// Lectura ÚNICA de las vigencias de servicio con sus franjas horarias (servidor, cliente admin).
//
// Preview y Producción comparten base: el código puede desplegarse antes de que la migración 255 (tabla de franjas) esté aplicada. Si la relación
// con `servicio_suplementos_franja` no existe (PGRST200 / 42P01 / PGRST205), se vuelve a leer SIN franjas — sin la tabla no hay reglas por horario, así
// que el resultado es el mismo que con la tabla vacía. Cualquier otro error se devuelve tal cual (la liquidación falla cerrada).
// ─────────────────────────────────────────────────────────────────────────
import type { createAdminClient } from "@/lib/supabase/admin";
import { SELECT_TEMPORADAS_CON_FRANJAS, SELECT_TEMPORADAS_CON_FRANJAS_SIN_RANGO, type FilaTemporadaConFranjas } from "@/lib/reservar/liquidacionServicio";
import type { VigenciasServicio } from "@/lib/calc/servicioVigencias";
import { leerAlcanceDeServicios } from "@/lib/servicios/alcanceContexto";
import { NOMBRE_TARIFA_BASE, vigenciaBasePermanente, type BaseServicioCatalogo, type VigenciaBasePermanente } from "@/lib/calc/tarifaBasePermanente";

const SIN_FRANJAS = "id, servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, precio_infante, recargo_individual";
const FALTA_TABLA = new Set(["PGRST200", "PGRST205", "42P01"]);

/**
 * Vigencias de los servicios. FUENTE ÚNICA de venta, costo, CxP y publicación: a un servicio de categoría «asistencia» que no tiene NINGUNA vigencia se le
 * agrega la vigencia sintética «GENERAL» (tarifa base permanente, ver lib/calc/tarifaBasePermanente.ts). Con una o más vigencias no se agrega nada.
 */
export async function leerTemporadasServicio(
  admin: ReturnType<typeof createAdminClient>,
  servicioIds: number[],
): Promise<{ data: FilaTemporadaConFranjas[]; error: { message: string } | null }> {
  const r = await leerTemporadasCrudas(admin, servicioIds);
  if (r.error) return r;
  const sinVigencias = [...new Set(servicioIds)].filter((id) => !r.data.some((t) => t.servicio_id === id));
  if (!sinVigencias.length) return r;
  const base = await admin.from("servicios_adicionales").select("id, categoria, precio_persona, precio_infante, recargo_individual").in("id", sinVigencias);
  if (base.error) return { data: [], error: { message: base.error.message } };
  const sinteticas = ((base.data ?? []) as BaseServicioCatalogo[]).map(vigenciaBasePermanente).filter((v): v is VigenciaBasePermanente => v !== null);
  return { data: [...r.data, ...(sinteticas as unknown as FilaTemporadaConFranjas[])], error: null };
}

async function leerTemporadasCrudas(
  admin: ReturnType<typeof createAdminClient>,
  servicioIds: number[],
): Promise<{ data: FilaTemporadaConFranjas[]; error: { message: string } | null }> {
  if (!servicioIds.length) return { data: [], error: null };
  let conFranjas = await admin.from("servicio_temporadas").select(SELECT_TEMPORADAS_CON_FRANJAS).in("servicio_id", servicioIds);
  // Base sin las columnas de rango de pasajeros de las franjas (262 aún no aplicada): se lee como antes (franjas «para todos»). Cualquier otro error sigue su camino.
  if (conFranjas.error && (conFranjas.error as { code?: string }).code === "42703") conFranjas = await admin.from("servicio_temporadas").select(SELECT_TEMPORADAS_CON_FRANJAS_SIN_RANGO).in("servicio_id", servicioIds);
  if (!conFranjas.error) return { data: (conFranjas.data ?? []) as unknown as FilaTemporadaConFranjas[], error: null };
  if (!FALTA_TABLA.has((conFranjas.error as { code?: string }).code ?? "")) return { data: [], error: { message: conFranjas.error.message } };
  const plano = await admin.from("servicio_temporadas").select(SIN_FRANJAS).in("servicio_id", servicioIds);
  if (plano.error) return { data: [], error: { message: plano.error.message } };
  return { data: (plano.data ?? []) as unknown as FilaTemporadaConFranjas[], error: null };
}

/**
 * Vigencias + rangos + marca de franjas de varios servicios (publicación, reserva interna, edición de contrato). Un error de lectura se devuelve: el
 * llamador falla cerrado, nunca asume "sin vigencias". Acepta el cliente del usuario o el admin.
 */
export async function cargarVigenciasServicios(
  client: Pick<ReturnType<typeof createAdminClient>, "from">,
  servicios: { id: number; nombre: string }[],
): Promise<{ ok: true; porServicio: Map<number, VigenciasServicio> } | { ok: false; error: string }> {
  const ids = [...new Set(servicios.map((s) => s.id))];
  if (!ids.length) return { ok: true, porServicio: new Map() };
  const admin = client as ReturnType<typeof createAdminClient>;
  const [tr, gr] = await Promise.all([
    leerTemporadasServicio(admin, ids),
    admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", ids),
  ]);
  if (tr.error) return { ok: false, error: tr.error.message };
  if (gr.error) return { ok: false, error: gr.error.message };
  const nombres = new Map(servicios.map((s) => [s.id, s.nombre]));
  // 262: clasificación y precios propios por alcance (tolerante: sin la 262 aplicada todo sigue como antes; un fallo técnico detiene la publicación).
  const lecAlc = await leerAlcanceDeServicios(admin, ids, tr.data.map((t) => t.id).filter((x): x is number => x != null));
  if (!lecAlc.ok) return { ok: false, error: lecAlc.error };
  const porServicio = new Map<number, VigenciasServicio>();
  for (const id of ids) {
    const temporadas = tr.data.filter((t) => t.servicio_id === id);
    const usaAlcance = lecAlc.disponible && lecAlc.clasificaciones.some((c) => c.servicio_id === id && c.tipo_receptivo === "traslado");
    const extraAlcance: Partial<VigenciasServicio> = {};
    if (usaAlcance && lecAlc.disponible) {
      const nombrePorId = new Map(temporadas.map((t) => [t.id, t.nombre]));
      const gruposAlcance: VigenciasServicio["gruposAlcance"] = [];
      const personaAlcance = new Map<string, number>();
      const gruposIdaRegreso: VigenciasServicio["gruposIdaRegreso"] = [];
      const personaIdaRegreso = new Map<string, number>();
      for (const f of lecAlc.preciosAlcance) {
        const nombre = nombrePorId.get(f.servicio_temporada_id);
        if (!nombre) continue;
        // Cada alcance publica SU referencia; ninguna se deriva de la otra. Sin precio propio de ida y regreso, la referencia usa la tarifa de la vigencia (servicioVigencias).
        const [grupos, persona] = f.alcance === "trayecto" ? [gruposAlcance, personaAlcance] : [gruposIdaRegreso, personaIdaRegreso];
        if (f.pax_desde != null && f.pax_hasta != null) grupos.push({ pax_desde: f.pax_desde, pax_hasta: f.pax_hasta, precio: Number(f.precio), temporada: nombre });
        else persona.set(nombre, Number(f.precio));
      }
      Object.assign(extraAlcance, { usaAlcance: true, gruposAlcance, personaAlcance, gruposIdaRegreso, personaIdaRegreso });
    }
    porServicio.set(id, {
      ...extraAlcance,
      servicioId: id, nombre: nombres.get(id) ?? `#${id}`, temporadas,
      grupos: (gr.data ?? []).filter((g) => g.servicio_id === id).map((g) => ({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: Number(g.precio), temporada: g.temporada ?? NOMBRE_TARIFA_BASE })),
      conFranjas: new Set(temporadas.filter((t) => (t.servicio_suplementos_franja?.length ?? 0) > 0).map((t) => t.nombre)),
    });
  }
  return { ok: true, porServicio };
}

/** Claves `servicioId|nombre de vigencia` de las vigencias que tienen al menos una franja (rutas que aún no saben evaluar horarios las bloquean). */
export function vigenciasConFranjas(filas: FilaTemporadaConFranjas[]): Set<string> {
  return new Set(filas.filter((f) => (f.servicio_suplementos_franja?.length ?? 0) > 0).map((f) => `${f.servicio_id}|${f.nombre}`));
}
