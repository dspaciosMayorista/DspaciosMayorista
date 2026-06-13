import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ProgramaResumen } from "@/app/tarifario/TarifarioPublic";

type SB = SupabaseClient<Database>;
type ProgramaRow = Database["public"]["Tables"]["programas"]["Row"];

/** Solo markup: neto / (1 - mk). Se mantiene para compatibilidad. */
export function pvpDesdeNeto(neto: number, pctMk: number): number {
  const mk = Number(pctMk) || 0;
  return mk > 0 && mk < 1 ? Math.round(neto / (1 - mk)) : Math.round(neto);
}

export type PvpOpciones = {
  pctMk: number;            // markup del proveedor (ej. 0.25)
  asistenciaDia?: number;   // asistencia médica por pax y por día
  dias?: number | null;     // días del programa
  pctFee?: number;          // fee bancario / TDC (ej. 0.03)
};

/**
 * PVP de venta de un programa por persona, a partir del neto del proveedor:
 *   1) markup:        sub = neto / (1 - mk)
 *   2) asistencia:    sub += asistencia_dia × días   (no se le aplica markup)
 *   3) fee bancario:  pvp  = sub / (1 - fee)          (sobre el total)
 * El orden replica el montaje de D'spacios (neto → +MK → +asistencia → +fee).
 */
export function pvpPrograma(neto: number, opt: PvpOpciones): number {
  const mk = Number(opt.pctMk) || 0;
  const fee = Number(opt.pctFee) || 0;
  const asis = Number(opt.asistenciaDia) || 0;
  const dias = Math.max(0, Number(opt.dias) || 0);

  let sub = mk > 0 && mk < 1 ? neto / (1 - mk) : neto;
  sub += asis * dias;
  if (fee > 0 && fee < 1) sub = sub / (1 - fee);
  return Math.round(sub);
}

/** Resumen de programas para el tarifario (con precio "desde" en PVP). */
export async function getProgramasResumen(sb: SB, soloPublicados = true): Promise<ProgramaResumen[]> {
  let q = sb
    .from("programas")
    .select(
      "id, nombre, subtitulo, dias, noches, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, publicado, desde_precio, incluye_aereo, portada_url"
    )
    .eq("activo", true);
  if (soloPublicados) q = q.eq("publicado", true);
  const { data: programas } = await q.order("nombre");
  if (!programas?.length) return [];

  const ids = programas.map((p) => p.id);
  const { data: cats } = await sb.from("programa_categorias").select("id, programa_id").in("programa_id", ids);
  const catToProg = new Map<number, number>();
  for (const c of cats ?? []) catToProg.set(c.id, c.programa_id);
  const catIds = [...catToProg.keys()];

  const minNeto = new Map<number, number>();
  const setMin = (pid: number, neto: number) => {
    if (neto <= 0) return;
    const prev = minNeto.get(pid);
    if (prev == null || neto < prev) minNeto.set(pid, neto);
  };
  if (catIds.length) {
    const { data: precios } = await sb
      .from("programa_precios")
      .select("categoria_id, neto")
      .in("categoria_id", catIds)
      .not("neto", "is", null);
    for (const row of precios ?? []) {
      const pid = catToProg.get(row.categoria_id);
      if (pid == null) continue;
      setMin(pid, row.neto ?? 0);
    }
  }
  // Modo "salida": el mínimo sale de programa_salidas (neto por acomodación).
  const { data: salidas } = await sb
    .from("programa_salidas")
    .select("programa_id, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud")
    .in("programa_id", ids);
  for (const s of salidas ?? []) {
    if (s.bajo_solicitud) continue;
    for (const v of [s.neto_doble, s.neto_triple, s.neto_multiple, s.neto_sencilla, s.neto_nino]) {
      if (v != null) setMin(s.programa_id, Number(v));
    }
  }

  return programas.map((p) => {
    const neto = minNeto.get(p.id);
    // El "Desde" manual de la cabecera manda sobre el mínimo calculado de la matriz.
    const desdeManual = p.desde_precio != null && p.desde_precio > 0 ? Number(p.desde_precio) : null;
    return {
      id: p.id,
      nombre: p.nombre,
      subtitulo: p.subtitulo,
      dias: p.dias,
      noches: p.noches,
      moneda: p.moneda,
      desde_pvp:
        desdeManual ??
        (neto != null
          ? pvpPrograma(neto, {
              pctMk: p.pct_mk,
              asistenciaDia: p.asistencia_medica_dia,
              dias: p.dias,
              pctFee: p.pct_fee_tarjeta,
            })
          : null),
      incluye_aereo: !!p.incluye_aereo,
      portada_url: p.portada_url ?? null,
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
  salidas: {
    id: number;
    etiqueta: string | null;
    fecha_desde: string | null;
    fecha_hasta: string | null;
    noches: number | null;
    columna: string | null;
    precios: { acomodacion: string; neto: number | null; pvp: number | null }[];
    bajo_solicitud: boolean;
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
  const prow = programa as ProgramaRow;
  const pvpOpt: PvpOpciones = {
    pctMk: prow.pct_mk,
    asistenciaDia: prow.asistencia_medica_dia,
    dias: prow.dias,
    pctFee: prow.pct_fee_tarjeta,
  };

  const [{ data: ciudades }, { data: dias }, { data: categorias }, { data: hoteles }, { data: precios }, { data: salidasRaw }, { data: inclusiones }, { data: tours }, { data: blackouts }] =
    await Promise.all([
      sb.from("programa_ciudades").select("id, nombre, codigo_iata, noches").eq("programa_id", id).order("orden"),
      sb.from("programa_dias").select("dia, titulo, desayuno, almuerzo, cena, descripcion").eq("programa_id", id).order("dia"),
      sb.from("programa_categorias").select("id, nombre, orden").eq("programa_id", id).order("orden"),
      sb.from("programa_categoria_hoteles").select("categoria_id, ciudad, hotel, orden").order("orden"),
      sb.from("programa_precios").select("categoria_id, acomodacion, neto, bajo_solicitud"),
      sb.from("programa_salidas").select("id, etiqueta, fecha_desde, fecha_hasta, noches, columna, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud").eq("programa_id", id).order("orden"),
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
        pvp: p.neto != null && !p.bajo_solicitud ? pvpPrograma(p.neto, pvpOpt) : null,
        bajo_solicitud: p.bajo_solicitud,
      })),
  }));
  void catIds;

  // Salidas (modo de precio por fecha). El PVP usa las noches de la salida
  // (variables) para el componente de asistencia médica; si no hay, cae a la
  // cabecera. Niño = nino.
  const ACOM_SALIDA: [string, "neto_sencilla" | "neto_doble" | "neto_triple" | "neto_multiple" | "neto_nino"][] = [
    ["sencilla", "neto_sencilla"],
    ["doble", "neto_doble"],
    ["triple", "neto_triple"],
    ["multiple", "neto_multiple"],
    ["nino", "neto_nino"],
  ];
  const salidas = (salidasRaw ?? []).map((s) => {
    const optSalida: PvpOpciones = { ...pvpOpt, dias: s.noches != null ? s.noches : prow.dias };
    return {
      id: s.id,
      etiqueta: s.etiqueta,
      fecha_desde: s.fecha_desde,
      fecha_hasta: s.fecha_hasta,
      noches: s.noches,
      columna: s.columna,
      bajo_solicitud: s.bajo_solicitud,
      precios: ACOM_SALIDA.map(([acom, col]) => {
        const neto = s[col] as number | null;
        return {
          acomodacion: acom,
          neto,
          pvp: neto != null && !s.bajo_solicitud ? pvpPrograma(neto, optSalida) : null,
        };
      }).filter((p) => p.neto != null),
    };
  });

  return {
    programa: programa as ProgramaRow,
    proveedorNombre,
    ciudades: ciudades ?? [],
    dias: dias ?? [],
    categorias: cats,
    salidas,
    inclusiones: inclusiones ?? [],
    tours: tours ?? [],
    blackouts: blackouts ?? [],
  };
}
