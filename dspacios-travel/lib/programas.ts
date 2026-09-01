import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ProgramaResumen } from "@/app/tarifario/TarifarioPublic";
import {
  calcularPvpAcomodacionSalida,
  type ModoBaseComisionable,
  type ModalidadMk,
} from "@/lib/calc/programaPrecio";
// `pvpPrograma`/`PvpOpciones` viven en lib/calc/programaPrecio.ts (revisión de
// PR #277, defecto 5: ese módulo no tiene imports con alias `@/`, así que
// node:test lo puede importar directo y ejecutar el MOTOR REAL en vez de una
// copia textual mantenida a mano en el archivo de pruebas). Re-exportados acá
// para no romper ningún call-site existente (todos siguen importando de
// "@/lib/programas" como siempre).
export { pvpPrograma, type PvpOpciones } from "@/lib/calc/programaPrecio";
import { pvpPrograma, type PvpOpciones } from "@/lib/calc/programaPrecio";

type SB = SupabaseClient<Database>;
type ProgramaRow = Database["public"]["Tables"]["programas"]["Row"];

/** Solo markup: neto / (1 - mk). Se mantiene para compatibilidad. */
export function pvpDesdeNeto(neto: number, pctMk: number): number {
  const mk = Number(pctMk) || 0;
  return mk > 0 && mk < 1 ? Math.round(neto / (1 - mk)) : Math.round(neto);
}

/**
 * Resumen de programas para el tarifario (con precio "desde" en PVP).
 *
 * ⚠️ Modalidad de MK (revisión PR #277, defecto 2). ANTES este resumen leía
 * el `neto` mínimo persistido y llamaba `pvpPrograma(neto, opt)` una sola vez
 * al final — sin mirar la regla comisionable ni la modalidad, así que un
 * programa en la modalidad nueva podía mostrar en la tarjeta "Desde" un
 * precio DISTINTO al que `getProgramaDetalle` mostraba en su ficha, para la
 * MISMA salida/acomodación (la tarjeta usaba el neto histórico tal cual sin
 * recalcular con `calcularNetoProgramaConModalidad`).
 *
 * Ahora, para cada candidato (fila de `programa_precios` en modo categoría, o
 * salida×acomodación en modo salida), se calcula su PVP en el momento — con
 * el camino de SIEMPRE (`pvpPrograma(neto, opt)`, sin 3er argumento) salvo
 * cuando la regla está activa, la modalidad es la nueva Y esa acomodación
 * puntual tiene una tarifa de proveedor cargada, en cuyo caso usa la MISMA
 * `calcularNetoProgramaConModalidad()` que `getProgramaDetalle`/el editor —
 * y el mínimo se toma sobre los PVP resultantes, nunca sobre los netos
 * crudos (`montoSinMarkup` varía por tarifa, así que comparar netos entre
 * candidatos de distinta modalidad/tarifa ya no garantiza el mismo orden que
 * comparar sus PVP finales).
 *
 * Para las filas que NO califican (modo categoría siempre; modo salida sin
 * tarifa de proveedor, con la regla apagada, o en modalidad histórica) el
 * camino es EXACTAMENTE el de antes — mismo `opt` (con `dias` de CABECERA,
 * nunca el de la salida puntual, tal como calculaba siempre este resumen) y
 * la MISMA llamada a `pvpPrograma`; como esa función es monótona no-
 * decreciente en `neto` para un `opt` fijo, calcular su PVP por candidato y
 * tomar el mínimo da el MISMO número, byte a byte, que el código viejo
 * (mínimo neto → un solo `pvpPrograma` al final).
 */
export async function getProgramasResumen(sb: SB, soloPublicados = true): Promise<ProgramaResumen[]> {
  let q = sb
    .from("programas")
    .select(
      "id, nombre, subtitulo, dias, noches, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, publicado, desde_precio, incluye_aereo, tipo_transporte, portada_url, regla_comisionable, regla_comisionable_modalidad_mk, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision"
    )
    .eq("activo", true);
  if (soloPublicados) q = q.eq("publicado", true);
  const { data: programas } = await q.order("nombre");
  if (!programas?.length) return [];

  const programaById = new Map(programas.map((p) => [p.id, p]));
  const ids = programas.map((p) => p.id);
  const { data: cats } = await sb.from("programa_categorias").select("id, programa_id").in("programa_id", ids);
  const catToProg = new Map<number, number>();
  for (const c of cats ?? []) catToProg.set(c.id, c.programa_id);
  const catIds = [...catToProg.keys()];

  // Ciudades por programa (para el filtro de destino en la vitrina).
  const { data: ciudadesRows } = await sb
    .from("programa_ciudades")
    .select("programa_id, nombre, orden")
    .in("programa_id", ids)
    .order("orden");
  const ciudadesPorProg = new Map<number, string[]>();
  for (const c of ciudadesRows ?? []) {
    const arr = ciudadesPorProg.get(c.programa_id) ?? [];
    if (c.nombre) arr.push(c.nombre);
    ciudadesPorProg.set(c.programa_id, arr);
  }

  const minPvp = new Map<number, number>();
  const setMinPvp = (pid: number, pvp: number) => {
    if (!(pvp > 0)) return;
    const prev = minPvp.get(pid);
    if (prev == null || pvp < prev) minPvp.set(pid, pvp);
  };

  // Modo "categoría": nunca tiene tarifa comisionable/modalidad — camino de
  // siempre, sin cambios.
  if (catIds.length) {
    const { data: precios } = await sb
      .from("programa_precios")
      .select("categoria_id, neto")
      .in("categoria_id", catIds)
      .not("neto", "is", null);
    for (const row of precios ?? []) {
      const pid = catToProg.get(row.categoria_id);
      if (pid == null) continue;
      const p = programaById.get(pid);
      if (!p) continue;
      const neto = Number(row.neto ?? 0);
      if (!(neto > 0)) continue;
      setMinPvp(
        pid,
        pvpPrograma(neto, { pctMk: p.pct_mk, asistenciaDia: p.asistencia_medica_dia, dias: p.dias, pctFee: p.pct_fee_tarjeta, moneda: p.moneda })
      );
    }
  }

  // Modo "salida": por acomodación, con tarifa de proveedor si la modalidad
  // nueva la requiere (ver comentario de la función).
  const { data: salidas } = await sb
    .from("programa_salidas")
    .select(
      "programa_id, noches, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud, tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple"
    )
    .in("programa_id", ids);
  const ACOM_RESUMEN: [
    "neto_sencilla" | "neto_doble" | "neto_triple" | "neto_multiple" | "neto_nino",
    ("tarifa_sencilla" | "tarifa_doble" | "tarifa_triple" | "tarifa_multiple") | null,
  ][] = [
    ["neto_doble", "tarifa_doble"],
    ["neto_triple", "tarifa_triple"],
    ["neto_multiple", "tarifa_multiple"],
    ["neto_sencilla", "tarifa_sencilla"],
    ["neto_nino", null],
  ];
  for (const s of salidas ?? []) {
    if (s.bajo_solicitud) continue;
    const p = programaById.get(s.programa_id);
    if (!p) continue;
    const reglaActiva = p.regla_comisionable === true;
    const modalidadMk: ModalidadMk = p.regla_comisionable_modalidad_mk === "base_neta_impuestos_al_final" ? "base_neta_impuestos_al_final" : "historica";
    const reglaModo = (p.regla_comisionable_modo as ModoBaseComisionable) || "pct";
    const reglaValor = Number(p.regla_comisionable_valor) || 0;
    const reglaPctComision = Number(p.regla_comisionable_pct_comision) || 0;
    // Camino viejo: SIEMPRE `dias` de cabecera (nunca las noches de la salida
    // puntual) — así calculaba este resumen desde antes de la 161, se
    // conserva byte a byte para todo lo que no califica para la modalidad
    // nueva. El camino nuevo sí usa las noches de la salida, para que la
    // tarjeta "Desde" coincida con `getProgramaDetalle`/`pvpDeSalida`.
    const optVieja: PvpOpciones = { pctMk: p.pct_mk, asistenciaDia: p.asistencia_medica_dia, dias: p.dias, pctFee: p.pct_fee_tarjeta, moneda: p.moneda };
    const optNueva: PvpOpciones = { ...optVieja, dias: s.noches != null ? s.noches : p.dias };

    for (const [netoCol, tarifaCol] of ACOM_RESUMEN) {
      const neto = s[netoCol] as number | null;
      const tarifa = tarifaCol ? (s[tarifaCol] as number | null) : null;
      // La FÓRMULA (¿histórica o modalidad nueva?) la decide ÚNICAMENTE
      // `calcularPvpAcomodacionSalida` — lo único que se resuelve acá es
      // CUÁL `opt` (con qué `dias`) pasarle, porque este resumen usa un
      // fallback de días distinto entre el camino histórico y el nuevo (ver
      // comentario de la función arriba). Se repite la MISMA condición de
      // calificación que usa la función pura internamente — no es la
      // fórmula, es solo "cuál de los dos `opt` corresponde".
      const calificaNueva =
        reglaActiva && modalidadMk === "base_neta_impuestos_al_final" && tarifa != null && Number.isFinite(Number(tarifa)) && Number(tarifa) > 0;
      const pvp = calcularPvpAcomodacionSalida({
        neto,
        tarifa,
        reglaActiva,
        reglaModo,
        reglaValor,
        reglaPctComision,
        modalidadMk,
        opt: calificaNueva ? optNueva : optVieja,
      });
      if (pvp != null) setMinPvp(s.programa_id, pvp);
    }
  }

  return programas.map((p) => {
    const pvpMin = minPvp.get(p.id);
    // El "Desde" manual de la cabecera manda sobre el mínimo calculado de la matriz.
    const desdeManual = p.desde_precio != null && p.desde_precio > 0 ? Number(p.desde_precio) : null;
    return {
      id: p.id,
      nombre: p.nombre,
      subtitulo: p.subtitulo,
      dias: p.dias,
      noches: p.noches,
      moneda: p.moneda,
      desde_pvp: desdeManual ?? (pvpMin != null ? pvpMin : null),
      tipo_transporte: (p.tipo_transporte as "ninguno" | "aereo" | "terrestre" | undefined) ?? (p.incluye_aereo ? "aereo" : "ninguno"),
      portada_url: p.portada_url ?? null,
      ciudades: ciudadesPorProg.get(p.id) ?? [],
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
    moneda: prow.moneda,
  };

  const [{ data: ciudades }, { data: dias }, { data: categorias }, { data: hoteles }, { data: precios }, { data: salidasRaw }, { data: inclusiones }, { data: tours }, { data: blackouts }] =
    await Promise.all([
      sb.from("programa_ciudades").select("id, nombre, codigo_iata, noches").eq("programa_id", id).order("orden"),
      sb.from("programa_dias").select("dia, titulo, desayuno, almuerzo, cena, descripcion").eq("programa_id", id).order("dia"),
      sb.from("programa_categorias").select("id, nombre, orden").eq("programa_id", id).order("orden"),
      sb.from("programa_categoria_hoteles").select("categoria_id, ciudad, hotel, orden").order("orden"),
      sb.from("programa_precios").select("categoria_id, acomodacion, neto, bajo_solicitud"),
      sb.from("programa_salidas").select("id, etiqueta, fecha_desde, fecha_hasta, noches, columna, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud, tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple").eq("programa_id", id).order("orden"),
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
      // Descarta tarifas en 0/negativas (no son acomodaciones reales): así no
      // generan columnas fantasma con solo el costo de asistencia/fee. Las "a
      // solicitud" sí se conservan (sin precio).
      .filter((p) => p.bajo_solicitud || (p.neto != null && p.neto > 0))
      .map((p) => ({
        acomodacion: p.acomodacion,
        neto: p.neto,
        pvp: p.neto != null && p.neto > 0 && !p.bajo_solicitud ? pvpPrograma(p.neto, pvpOpt) : null,
        bajo_solicitud: p.bajo_solicitud,
      })),
  }));
  void catIds;

  // Salidas (modo de precio por fecha). El PVP usa las noches de la salida
  // (variables) para el componente de asistencia médica; si no hay, cae a la
  // cabecera. Niño = nino (sin tarifa de proveedor — migración 151, se ajusta
  // directo, nunca pasa por la calculadora de modalidad).
  //
  // ⚠️ Modalidad de MK (migración 161): con `regla_comisionable` activa Y
  // modalidad 'base_neta_impuestos_al_final' Y una TARIFA de proveedor
  // cargada para esa acomodación puntual (no toda salida/acomodación la
  // tiene — "una acomodación sin tarifa del proveedor no se toca", mismo
  // criterio de la 151), se RECALCULA en caliente con
  // `calcularNetoProgramaConModalidad()` (la MISMA función pura que usa el
  // editor en vivo y la validación) en vez de leer `neto_x` tal cual — así el
  // %MK vigente del programa siempre se aplica correctamente, sin depender de
  // que `neto_x` (persistido, semántica histórica) se haya recalculado. Sin
  // tarifa cargada, o con la regla apagada, o en modalidad histórica: el
  // camino es EXACTAMENTE el de siempre (`pvpPrograma(neto, optSalida)`, sin
  // el 3er argumento) — cero cambio de comportamiento.
  const reglaActiva = prow.regla_comisionable === true;
  const modalidadMk: ModalidadMk = prow.regla_comisionable_modalidad_mk === "base_neta_impuestos_al_final" ? "base_neta_impuestos_al_final" : "historica";
  const reglaModo = (prow.regla_comisionable_modo as ModoBaseComisionable) || "pct";
  const reglaValor = Number(prow.regla_comisionable_valor) || 0;
  const reglaPctComision = Number(prow.regla_comisionable_pct_comision) || 0;

  const ACOM_SALIDA: [
    string,
    "neto_sencilla" | "neto_doble" | "neto_triple" | "neto_multiple" | "neto_nino",
    ("tarifa_sencilla" | "tarifa_doble" | "tarifa_triple" | "tarifa_multiple") | null,
  ][] = [
    ["sencilla", "neto_sencilla", "tarifa_sencilla"],
    ["doble", "neto_doble", "tarifa_doble"],
    ["triple", "neto_triple", "tarifa_triple"],
    ["multiple", "neto_multiple", "tarifa_multiple"],
    ["nino", "neto_nino", null],
  ];
  const pvpDeSalida = (
    s: NonNullable<typeof salidasRaw>[number],
    neto: number,
    optSalida: PvpOpciones,
    tarifaCol: ("tarifa_sencilla" | "tarifa_doble" | "tarifa_triple" | "tarifa_multiple") | null
  ): number =>
    // `neto` ya viene validado > 0 por el único call-site (más abajo), así
    // que `calcularPvpAcomodacionSalida` nunca devuelve null acá — el `?? 0`
    // es defensivo, no un camino real.
    calcularPvpAcomodacionSalida({
      neto,
      tarifa: tarifaCol ? (s[tarifaCol] as number | null) : null,
      reglaActiva,
      reglaModo,
      reglaValor,
      reglaPctComision,
      modalidadMk,
      opt: optSalida,
    }) ?? 0;
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
      precios: ACOM_SALIDA.map(([acom, col, tarifaCol]) => {
        const neto = s[col] as number | null;
        return {
          acomodacion: acom,
          neto,
          pvp: neto != null && neto > 0 && !s.bajo_solicitud ? pvpDeSalida(s, neto, optSalida, tarifaCol) : null,
        };
      }).filter((p) => p.neto != null && p.neto > 0),
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
    // El tour se monta en NETO; se publica con el mismo markup/fee del programa
    // (sin asistencia médica, que es propia del paquete base, no del tour suelto).
    tours: (tours ?? []).map((t) => ({
      ...t,
      precio: t.precio != null && t.precio > 0 ? pvpPrograma(t.precio, { ...pvpOpt, asistenciaDia: 0, dias: 0 }) : t.precio,
    })),
    blackouts: blackouts ?? [],
  };
}
