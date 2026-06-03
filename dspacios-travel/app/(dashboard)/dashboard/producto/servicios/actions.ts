"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type Liquidacion = "dia" | "noche" | "paquete";

export type TierPax = { paxDesde: number; paxHasta: number; precio: number };

export async function crearServicio(input: {
  nombre: string;
  proveedorId: number | null;
  destinoId: number | null;
  tarifaNeta: number;
  temporada: string;
  liquidacion: Liquidacion;
  rangosEdad?: number[];
  tipoTarifa?: string;
  tiers?: TierPax[];
}): Promise<Result> {
  const sb = await createClient();
  const { data, error } = await sb.from("servicios_adicionales").insert({
    nombre: input.nombre.trim(),
    proveedor_id: input.proveedorId,
    destino_id: input.destinoId,
    tarifa_neta: input.tarifaNeta,
    temporada: oNull(input.temporada),
    liquidacion: input.liquidacion,
    rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    tipo_tarifa: input.tipoTarifa ?? "persona",
    activo: true,
  }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "No se insertó" };
  await guardarTiers(sb, data.id, input.tiers ?? []);
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

async function guardarTiers(
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

export async function actualizarServicio(id: number, input: {
  nombre: string;
  proveedorId: number | null;
  destinoId: number | null;
  tarifaNeta: number;
  temporada: string;
  liquidacion: Liquidacion;
  rangosEdad?: number[];
  tipoTarifa?: string;
  tiers?: TierPax[];
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("servicios_adicionales")
    .update({
      nombre: input.nombre.trim(),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
      tarifa_neta: input.tarifaNeta,
      temporada: oNull(input.temporada),
      liquidacion: input.liquidacion,
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
      tipo_tarifa: input.tipoTarifa ?? "persona",
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await guardarTiers(sb, id, input.tiers ?? []);
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

export async function cargarServiciosMasivo(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const [{ data: destinos }, { data: provs }] = await Promise.all([
    sb.from("destinos").select("id, nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "servicios"),
  ]);
  const dmap = new Map((destinos ?? []).map((d) => [d.nombre.trim().toLowerCase(), d.id]));
  const pmap = new Map((provs ?? []).map((p) => [p.nombre.trim().toLowerCase(), p.id]));
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
    const { error } = await sb.from("servicios_adicionales").insert({
      nombre, proveedor_id: provId, destino_id: destinoId,
      tarifa_neta: numCsv(r.tarifa_neta), temporada: oNull(r.temporada || ""),
      liquidacion, activo: true,
    });
    if (error) { errores.push(`Fila ${linea} (${nombre}): ${error.message}`); continue; }
    insertados++;
  }
  revalidatePath("/dashboard/producto/servicios");
  return { ok: errores.length === 0, insertados, errores };
}
