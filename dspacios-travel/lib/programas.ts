import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ProgramaResumen } from "@/app/tarifario/TarifarioPublic";

type SB = SupabaseClient<Database>;
type ProgramaRow = Database["public"]["Tables"]["programas"]["Row"];

/** PVP a partir del neto y el markup (neto / (1 - mk)). */
export function pvpDesdeNeto(neto: number, pctMk: number): number {
  const mk = Number(pctMk) || 0;
  return mk > 0 && mk < 1 ? Math.round(neto / (1 - mk)) : Math.round(neto);
}

/** Resumen de programas para el tarifario (con precio "desde" en PVP). */
export async function getProgramasResumen(sb: SB, soloPublicados = true): Promise<ProgramaResumen[]> {
  let q = sb.from("programas").select("id, nombre, subtitulo, dias, noches, moneda, pct_mk, publicado").eq("activo", true);
  if (soloPublicados) q = q.eq("publicado", true);
  const { data: programas } = await q.order("nombre");
  if (!programas?.length) return [];

  const ids = programas.map((p) => p.id);
  const { data: cats } = await sb.from("programa_categorias").select("id, programa_id").in("programa_id", ids);
  const catToProg = new Map<number, number>();
  for (const c of cats ?? []) catToProg.set(c.id, c.programa_id);
  const catIds = [...catToProg.keys()];

  const minNeto = new Map<number, number>();
  if (catIds.length) {
    const { data: precios } = await sb
      .from("programa_precios")
      .select("categoria_id, neto")
      .in("categoria_id", catIds)
      .not("neto", "is", null);
    for (const row of precios ?? []) {
      const pid = catToProg.get(row.categoria_id);
      const neto = row.neto ?? 0;
      if (pid == null || neto <= 0) continue;
      const prev = minNeto.get(pid);
      if (prev == null || neto < prev) minNeto.set(pid, neto);
    }
  }

  return programas.map((p) => {
    const neto = minNeto.get(p.id);
    return {
      id: p.id,
      nombre: p.nombre,
      subtitulo: p.subtitulo,
      dias: p.dias,
      noches: p.noches,
      moneda: p.moneda,
      desde_pvp: neto != null ? pvpDesdeNeto(neto, p.pct_mk) : null,
    };
  });
}

export type ProgramaDetalle = {
  programa: ProgramaRow;
  proveedorNombre: string | null;
  ciudades: { id: number; nombre: string; codigo_iata: string | null; noches: number }[];
  dias: { dia: number; titulo: string | null; desayuno: boolean; almuerzo: boolean; cena: boolean; descripcion: string | null }[];
  categorias: {
    id: number;
    nombre: string | null;
    hoteles: { ciudad: string; hotel: string | null }[];
    precios: { acomodacion: string; neto: number | null; pvp: number | null; bajo_solicitud: boolean }[];
  }[];
  inclusiones: { ciudad: string | null; tipo: string; texto: string }[];
  tours: { ciudad: string | null; nombre: string; precio: number | null; min_pax: number; dias_operacion: string | null; descripcion: string | null }[];
  blackouts: { fecha_inicio: string | null; fecha_fin: string | null; motivo: string | null; ciudad: string | null }[];
};

/** Detalle completo de un programa (para la vitrina pública y para reservar). */
export async function getProgramaDetalle(sb: SB, id: number): Promise<ProgramaDetalle | null> {
  const { data: programa } = await sb
    .from("programas")
    .select("*, proveedores(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (!programa) return null;
  const proveedorNombre = (programa.proveedores as unknown as { nombre: string } | null)?.nombre ?? null;
  const mk = (programa as ProgramaRow).pct_mk;

  const [{ data: ciudades }, { data: dias }, { data: categorias }, { data: hoteles }, { data: precios }, { data: inclusiones }, { data: tours }, { data: blackouts }] =
    await Promise.all([
      sb.from("programa_ciudades").select("id, nombre, codigo_iata, noches").eq("programa_id", id).order("orden"),
      sb.from("programa_dias").select("dia, titulo, desayuno, almuerzo, cena, descripcion").eq("programa_id", id).order("dia"),
      sb.from("programa_categorias").select("id, nombre, orden").eq("programa_id", id).order("orden"),
      sb.from("programa_categoria_hoteles").select("categoria_id, ciudad, hotel, orden").order("orden"),
      sb.from("programa_precios").select("categoria_id, acomodacion, neto, bajo_solicitud"),
      sb.from("programa_inclusiones").select("ciudad, tipo, texto").eq("programa_id", id).order("orden"),
      sb.from("programa_tours").select("ciudad, nombre, precio, min_pax, dias_operacion, descripcion").eq("programa_id", id).order("orden"),
      sb.from("programa_blackouts").select("fecha_inicio, fecha_fin, motivo, ciudad").eq("programa_id", id).order("fecha_inicio"),
    ]);

  const catIds = new Set((categorias ?? []).map((c) => c.id));
  const cats = (categorias ?? []).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    hoteles: (hoteles ?? [])
      .filter((h) => h.categoria_id === c.id)
      .map((h) => ({ ciudad: h.ciudad, hotel: h.hotel })),
    precios: (precios ?? [])
      .filter((p) => p.categoria_id === c.id)
      .map((p) => ({
        acomodacion: p.acomodacion,
        neto: p.neto,
        pvp: p.neto != null && !p.bajo_solicitud ? pvpDesdeNeto(p.neto, mk) : null,
        bajo_solicitud: p.bajo_solicitud,
      })),
  }));
  void catIds;

  return {
    programa: programa as ProgramaRow,
    proveedorNombre,
    ciudades: ciudades ?? [],
    dias: dias ?? [],
    categorias: cats,
    inclusiones: inclusiones ?? [],
    tours: tours ?? [],
    blackouts: blackouts ?? [],
  };
}
