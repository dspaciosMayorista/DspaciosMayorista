"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type Liquidacion = "dia" | "noche" | "paquete";
export type TierPax = { paxDesde: number; paxHasta: number; precio: number };

export type ServicioInput = {
  nombre: string;
  proveedorId: number | null;
  destinoId: number | null;
  precioPersona: number | null;
  grupoTiers: TierPax[];          // rangos de pax para cobro POR GRUPO
  temporada: string;
  rangosEdad?: number[];
  categoria?: string;             // tour_traslado | asistencia | otro
};

function servicioToRow(input: ServicioInput) {
  return {
    nombre: input.nombre.trim(),
    proveedor_id: input.proveedorId,
    destino_id: input.destinoId,
    precio_persona: input.precioPersona,
    tarifa_neta: input.precioPersona ?? 0,
    temporada: oNull(input.temporada),
    rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    categoria: input.categoria || "otro",
  };
}

async function guardarGrupoTiers(
  sb: Awaited<ReturnType<typeof createClient>>,
  servicioId: number,
  tiers: TierPax[]
) {
  await sb.from("servicio_tarifa_pax").delete().eq("servicio_id", servicioId);
  const validos = tiers.filter((t) => Number(t.precio) > 0);
  if (validos.length) {
    await sb.from("servicio_tarifa_pax").insert(
      validos.map((t) => ({
        servicio_id: servicioId,
        pax_desde: Number(t.paxDesde) || 1,
        pax_hasta: Number(t.paxHasta) || Number(t.paxDesde) || 1,
        precio: Number(t.precio) || 0,
      }))
    );
  }
}

export async function crearServicio(input: ServicioInput): Promise<Result> {
  const sb = await createClient();
  const { data, error } = await sb.from("servicios_adicionales").insert({ ...servicioToRow(input), activo: true }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "No se insertó" };
  await guardarGrupoTiers(sb, data.id, input.grupoTiers);
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function actualizarServicio(id: number, input: ServicioInput): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("servicios_adicionales").update(servicioToRow(input)).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await guardarGrupoTiers(sb, id, input.grupoTiers);
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function eliminarServicio(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("servicios_adicionales").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

// ── Carga masiva (CSV) ─────────────────────────────────────────────────────
const numCsv = (s?: string) => (s ? parseInt(String(s).replace(/[^\d-]/g, ""), 10) || 0 : 0);
const LIQ_VALIDAS = ["dia", "noche", "paquete"];
const CAT_VALIDAS = ["tour_traslado", "asistencia", "otro"];

// Normaliza la categoría (ubica el servicio en el contrato).
function normCategoria(s?: string): string {
  const v = (s || "").trim().toLowerCase();
  if (CAT_VALIDAS.includes(v)) return v;
  if (v.includes("tour") || v.includes("traslad")) return "tour_traslado";
  if (v.includes("asist")) return "asistencia";
  return "otro";
}

// "1-4:500000|5-10:400000" → rangos de pax para cobro POR GRUPO.
function parseTiersCsv(s?: string): TierPax[] {
  if (!s || !s.trim()) return [];
  return s
    .split("|")
    .map((part) => {
      const [rango, precioStr] = part.split(":");
      const [d, h] = (rango || "").split("-");
      const paxDesde = numCsv(d);
      const paxHasta = numCsv(h) || paxDesde;
      return { paxDesde, paxHasta, precio: numCsv(precioStr) };
    })
    .filter((t) => t.precio > 0 && t.paxDesde > 0);
}

export async function cargarServiciosMasivo(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const [{ data: destinos }, { data: provs }, { data: rangos }] = await Promise.all([
    sb.from("destinos").select("id, nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "servicios"),
    sb.from("rangos_edad").select("id, denominacion"),
  ]);
  const dmap = new Map((destinos ?? []).map((d) => [d.nombre.trim().toLowerCase(), d.id]));
  const pmap = new Map((provs ?? []).map((p) => [p.nombre.trim().toLowerCase(), p.id]));
  const rmap = new Map((rangos ?? []).map((x) => [x.denominacion.trim().toLowerCase(), x.id]));
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.nombre || "").trim();
    if (!nombre) { errores.push(`Fila ${linea}: falta nombre.`); continue; }
    const destinoId = r.destino ? dmap.get(r.destino.trim().toLowerCase()) ?? null : null;
    const provId = r.proveedor ? pmap.get(r.proveedor.trim().toLowerCase()) ?? null : null;
    const liq = (r.liquidacion || "paquete").trim().toLowerCase();
    const liquidacion = (LIQ_VALIDAS.includes(liq) ? liq : "paquete") as Liquidacion;
    const precio = numCsv(r.tarifa_neta);
    const rangosEdad = (r.rangos_edad || "")
      .split(/[|;]/).map((x) => rmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    const tiers = parseTiersCsv(r.precio_grupo);

    const { data: sv, error } = await sb.from("servicios_adicionales").insert({
      nombre, proveedor_id: provId, destino_id: destinoId,
      tarifa_neta: precio, precio_persona: precio, temporada: oNull(r.temporada || ""),
      liquidacion, activo: true,
      categoria: normCategoria(r.categoria),
      rangos_edad: rangosEdad.length ? rangosEdad : null,
    }).select("id").single();
    if (error || !sv) { errores.push(`Fila ${linea} (${nombre}): ${error?.message ?? "no se insertó"}`); continue; }
    if (tiers.length) {
      await sb.from("servicio_tarifa_pax").insert(
        tiers.map((t) => ({ servicio_id: sv.id, pax_desde: t.paxDesde, pax_hasta: t.paxHasta, precio: t.precio }))
      );
    }
    insertados++;
  }
  revalidatePath("/dashboard/producto/servicios");
  return { ok: errores.length === 0, insertados, errores };
}
