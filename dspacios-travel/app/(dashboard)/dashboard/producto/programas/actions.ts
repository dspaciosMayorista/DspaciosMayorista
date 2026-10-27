"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { parsearPrograma } from "@/lib/programasImport";
import { limpiarAlojamientoPrevisto } from "@/lib/programas";
import { salidaTieneContenido, tieneImpuestoAcomodacionNegativo, tieneTarifaNegativa } from "@/lib/programas/salidasGuardado";
import { validarHotelesParaGuardar, errorModoHotelConAereo, nochesIncluidasPrograma, esFechaIso, MODALIDADES_SERVICIOS, CLAVES_TARIFA, type PorAcom, type ClaveTarifa, type ModalidadServicios, type BaseHotelFila, type NocheTarifaFila, type DiaItinerario, type HotelEstancia } from "@/lib/programas/estanciaHotel88";
import { calcularVistaPrevia, type VistaPrevia } from "@/lib/programas/vistaPrevia409";
import { miRol, puedeEscribir } from "@/lib/roles";
import { resolverValorReglaAcomodacion, validarReglaComisionable, validarTarifaModalidad, esModalidadMkValida, type ModalidadMk } from "@/lib/calc/programaPrecio";
import {
  validarCondicionPago,
  validarRestriccionComercialCatalogo,
  type CondicionPagoEntrada,
  type CondicionPagoPersistible,
} from "@/lib/cotizacion/condicionPagoCatalogo";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const oNull = (s?: string | null) => (s && String(s).trim() !== "" ? String(s).trim() : null);
const num = (v: unknown) => {
  // OJO: Number("") === 0 en JS. Un campo vacío NO es 0 → debe ser null, o se
  // guardaría una tarifa de 0 (que luego inventa precios fantasma con asistencia/fee).
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function rev(id: number | string) {
  revalidatePath(`/dashboard/producto/programas/${id}`);
  revalidatePath("/dashboard/producto/programas");
  revalidatePath("/tarifario");
  revalidatePath("/dashboard/tarifario");
}

// ── Cabecera ────────────────────────────────────────────────────────────────
export type CabeceraInput = {
  nombre: string;
  proveedorId: number | null;
  subtitulo: string;
  dias: number | null;
  noches: number | null;
  moneda: string;
  salidas: string;
  vigenciaDesde: string;
  vigenciaHasta: string;
  minPax: number | null;
  maxPax: number | null;
  pctMk: number;
  pctFeeTarjeta: number;
  ninoEdadMax: number | null;
  ninoValorServicios: number | null;
  edadNinoMin: number | null;
  edadNinoMax: number | null;
  edadInfanteMax: number | null;
  textoCondiciones: string;
  textoCancelacion: string;
  textoPagos: string;
  notas: string;            // observaciones internas (NO salen en el PDF público)
  highlights: string;       // atractivos del programa, uno por línea
  desdePrecio: number | null;
  tipoTransporte: "ninguno" | "aereo" | "terrestre";
  portadaUrl: string;
  asistenciaMedicaDia: number | null;
  modoPrecio: string;
  videoUrl: string;
  // Condición de pago (migración 164). `condicionPagoTipo` es 'normal'|'pago_total'|
  // 'anticipo_saldo'; `restriccionComercial` solo admite 'normal'|
  // 'promocional_no_reembolsable_no_endosable' (el CHECK real de `programas` NO
  // admite 'no_reembolsable_no_endosable', a diferencia de cotizacion/contrato).
  condicionPagoTipo?: unknown;
  condicionPagoPctInicial?: unknown; // 1–99, no fracción
  condicionPagoDiasSaldo?: unknown;
  restriccionComercial?: unknown;
  /**
   * Destino fijo del programa (migración 213). `undefined` = el cliente no lo envió
   * (formulario viejo): NO se toca la columna al guardar. `null` = sin destino.
   */
  destinoFijoId?: number | null;
  /**
   * Proveedor de la asistencia médica (#88, migración 245). `undefined` = el cliente no lo envió: NO se toca la columna. `null` = sin proveedor.
   * Un programa por hotel y vigencia con asistencia diaria > 0 exige uno para poder reservarse.
   */
  proveedorAsistenciaId?: number | null;
};

function validarCondicionYRestriccionPrograma(
  input: CabeceraInput,
): { ok: true; condicion: CondicionPagoPersistible; restriccion: string } | { ok: false; error: string } {
  const d = input.destinoFijoId;
  if (d !== undefined && d !== null && !(Number.isInteger(d) && d > 0)) return { ok: false, error: "Destino inválido." };
  const pa = input.proveedorAsistenciaId;
  if (pa !== undefined && pa !== null && !(Number.isInteger(pa) && pa > 0)) return { ok: false, error: "Proveedor de la asistencia inválido." };
  // #88: el modo por hotel y vigencia es solo terrestre; la base también lo impide (programas_modo_hotel_terrestre_chk).
  if (input.modoPrecio === "hotel") {
    const aereo = errorModoHotelConAereo({ tipo_transporte: input.tipoTransporte, incluye_aereo: input.tipoTransporte === "aereo" });
    if (aereo) return { ok: false, error: aereo };
  }
  const cp = validarCondicionPago(
    {
      tipo: input.condicionPagoTipo ?? "normal",
      pctInicial: input.condicionPagoPctInicial,
      diasSaldo: input.condicionPagoDiasSaldo,
    } satisfies CondicionPagoEntrada,
    "producto",
  );
  if (!cp.ok) return { ok: false, error: cp.error };
  const rc = validarRestriccionComercialCatalogo(input.restriccionComercial ?? "normal");
  if (!rc.ok) return { ok: false, error: rc.error };
  return { ok: true, condicion: cp.value, restriccion: rc.value };
}

// "uno por línea" (o separado por '|') → array limpio para text[].
function parseHighlights(s: string): string[] {
  return (s || "")
    .split(/\r?\n|\|/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function cabeceraRow(input: CabeceraInput, condicion: CondicionPagoPersistible, restriccion: string) {
  return {
    nombre: input.nombre.trim(),
    proveedor_id: input.proveedorId,
    subtitulo: oNull(input.subtitulo),
    dias: input.dias,
    noches: input.noches,
    moneda: (input.moneda || "USD").toUpperCase(),
    salidas: oNull(input.salidas),
    vigencia_desde: oNull(input.vigenciaDesde),
    vigencia_hasta: oNull(input.vigenciaHasta),
    min_pax: input.minPax,
    max_pax: input.maxPax,
    pct_mk: input.pctMk || 0,
    pct_fee_tarjeta: input.pctFeeTarjeta || 0,
    nino_edad_max: input.ninoEdadMax,
    nino_valor_servicios: input.ninoValorServicios,
    edad_nino_min: input.edadNinoMin ?? 2,
    edad_nino_max: input.edadNinoMax ?? 11,
    edad_infante_max: input.edadInfanteMax ?? 1,
    texto_condiciones: oNull(input.textoCondiciones),
    texto_cancelacion: oNull(input.textoCancelacion),
    texto_pagos: oNull(input.textoPagos),
    notas: oNull(input.notas),
    highlights: parseHighlights(input.highlights),
    desde_precio: input.desdePrecio,
    tipo_transporte: input.tipoTransporte || "ninguno",
    incluye_aereo: input.tipoTransporte === "aereo", // compat, ya no es la fuente de verdad
    portada_url: oNull(input.portadaUrl),
    asistencia_medica_dia: input.asistenciaMedicaDia ?? 0,
    modo_precio: input.modoPrecio === "salida" || input.modoPrecio === "hotel" ? input.modoPrecio : "categoria",
    video_url: oNull(input.videoUrl),
    condicion_pago_tipo: condicion.condicion_pago_tipo,
    condicion_pago_pct_inicial: condicion.condicion_pago_pct_inicial,
    condicion_pago_dias_saldo: condicion.condicion_pago_dias_saldo,
    restriccion_comercial: restriccion,
    // Solo se escribe si el cliente lo manda: un guardado de cabecera nunca borra el destino por omisión.
    ...(input.destinoFijoId === undefined ? {} : { destino_fijo_id: input.destinoFijoId }),
    ...(input.proveedorAsistenciaId === undefined ? {} : { proveedor_asistencia_id: input.proveedorAsistenciaId }),
  };
}

export async function crearPrograma(input: CabeceraInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const v = validarCondicionYRestriccionPrograma(input);
  if (!v.ok) return v;
  const sb = await createClient();
  const { data, error } = await sb
    .from("programas")
    .insert(cabeceraRow(input, v.condicion, v.restriccion))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/programas");
  return { ok: true, id: data.id };
}

export async function guardarCabecera(id: number, input: CabeceraInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const v = validarCondicionYRestriccionPrograma(input);
  if (!v.ok) return v;
  const sb = await createClient();
  const { error } = await sb
    .from("programas")
    .update({ ...cabeceraRow(input, v.condicion, v.restriccion), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(id);
  return { ok: true, id };
}

// Guarda la URL pública de una pieza/imagen subida del programa (o la quita con null).
export async function guardarImagenPrograma(
  id: number,
  campo: "portada_url" | "flyer_url" | "historia_url",
  url: string | null
): Promise<Result> {
  const sb = await createClient();
  const patch =
    campo === "portada_url" ? { portada_url: url }
    : campo === "flyer_url" ? { flyer_url: url }
    : { historia_url: url };
  const { error } = await sb.from("programas").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(id);
  revalidatePath("/tarifario");
  return { ok: true, id };
}

export async function setPublicado(id: number, publicado: boolean): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("programas").update({ publicado }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(id);
  return { ok: true, id };
}

export async function eliminarPrograma(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("programas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/programas");
  return { ok: true };
}

// ── Ciudades (ruta) ───────────────────────────────────────────────────────────
export async function guardarCiudades(
  programaId: number,
  ciudades: { nombre: string; codigoIata: string; noches: number | null; alojamientoPrevisto?: string | null }[]
): Promise<Result> {
  const sb = await createClient();
  // Reemplazo ATÓMICO en la base (migración 212): borrar + insertar en una sola
  // transacción, serializada por programa. Si el cliente no manda el campo
  // (pestaña/bundle viejo) la RPC conserva el alojamiento ya guardado de la
  // ciudad con ese nombre; si lo manda (aunque vacío) manda lo enviado.
  const { error } = await sb.rpc("reemplazar_ruta_programa", {
    p_programa_id: programaId,
    p_ciudades: ciudades
      .filter((c) => c.nombre.trim())
      .map((c) => ({
        nombre: c.nombre.trim(),
        codigo_iata: oNull(c.codigoIata),
        noches: num(c.noches) ?? 0,
        ...(c.alojamientoPrevisto === undefined ? {} : { alojamiento_previsto: limpiarAlojamientoPrevisto(c.alojamientoPrevisto) }),
      })),
  });
  if (error) return { ok: false, error: error.message };
  rev(programaId);
  return { ok: true };
}

// ── Itinerario (días) ──────────────────────────────────────────────────────────
export async function guardarDias(
  programaId: number,
  dias: { dia: number; titulo: string; desayuno: boolean; almuerzo: boolean; cena: boolean; descripcion: string }[]
): Promise<Result> {
  const sb = await createClient();
  await sb.from("programa_dias").delete().eq("programa_id", programaId);
  const filas = dias
    .filter((d) => num(d.dia) != null)
    .map((d) => ({
      programa_id: programaId,
      dia: num(d.dia) ?? 0,
      titulo: oNull(d.titulo),
      desayuno: !!d.desayuno,
      almuerzo: !!d.almuerzo,
      cena: !!d.cena,
      descripcion: oNull(d.descripcion),
    }));
  if (filas.length) {
    const { error } = await sb.from("programa_dias").insert(filas);
    if (error) return { ok: false, error: error.message };
  }
  rev(programaId);
  return { ok: true };
}

// ── Matriz: categorías + hoteles por ciudad + precios ──────────────────────────
export type CategoriaInput = {
  nombre: string;
  hoteles: { ciudad: string; hotel: string }[];
  precios: { acomodacion: string; neto: number | null; bajoSolicitud: boolean }[];
};

export async function guardarMatriz(
  programaId: number,
  categorias: CategoriaInput[]
): Promise<Result> {
  const sb = await createClient();
  // Borra categorías del programa (cascada limpia hoteles y precios).
  await sb.from("programa_categorias").delete().eq("programa_id", programaId);
  for (let i = 0; i < categorias.length; i++) {
    const cat = categorias[i];
    const { data: catRow, error: ce } = await sb
      .from("programa_categorias")
      .insert({ programa_id: programaId, orden: i, nombre: oNull(cat.nombre) })
      .select("id")
      .single();
    if (ce) return { ok: false, error: ce.message };
    const catId = catRow.id;

    const hoteles = cat.hoteles
      .filter((h) => h.ciudad.trim())
      .map((h, j) => ({ categoria_id: catId, ciudad: h.ciudad.trim(), hotel: oNull(h.hotel), orden: j }));
    if (hoteles.length) {
      const { error } = await sb.from("programa_categoria_hoteles").insert(hoteles);
      if (error) return { ok: false, error: error.message };
    }

    const precios = cat.precios
      // Solo se guarda una tarifa si tiene neto > 0 o está "a solicitud".
      // Un neto 0/vacío no es una acomodación válida (evita columnas fantasma).
      .filter((p) => {
        const n = num(p.neto);
        return p.acomodacion.trim() && ((n != null && n > 0) || p.bajoSolicitud);
      })
      .map((p) => ({
        categoria_id: catId,
        acomodacion: p.acomodacion.trim(),
        neto: p.bajoSolicitud ? null : num(p.neto),
        bajo_solicitud: !!p.bajoSolicitud,
      }));
    if (precios.length) {
      const { error } = await sb.from("programa_precios").insert(precios);
      if (error) return { ok: false, error: error.message };
    }
  }
  rev(programaId);
  return { ok: true };
}

// ── Salidas (modo de precio por fecha) ─────────────────────────────────────────
export type SalidaInput = {
  etiqueta: string;
  fechaDesde: string;
  fechaHasta: string;
  noches: number | null;
  columna: string;
  netoSencilla: number | null;
  netoDoble: number | null;
  netoTriple: number | null;
  netoMultiple: number | null;
  netoNino: number | null;
  bajoSolicitud: boolean;
  // Tarifa ORIGINAL del proveedor por acomodación (§ "tarifa comisionable",
  // migración 151) — dato de origen del neto de arriba, se guarda aparte y
  // nunca se reconstruye desde el neto. Niño no tiene tarifa de proveedor.
  tarifaSencilla: number | null;
  tarifaDoble: number | null;
  tarifaTriple: number | null;
  tarifaMultiple: number | null;
  impuestoSencilla: number | null;
  impuestoDoble: number | null;
  impuestoTriple: number | null;
  impuestoMultiple: number | null;
};

// Configuración de la regla "el proveedor da tarifa comisionable" — vive a
// nivel de PROGRAMA (una sola regla para todas sus salidas), se guarda junto
// con las salidas porque comparten el mismo botón "Guardar" en la UI.
export type ReglaComisionableInput = {
  activa: boolean;
  modo: "pct" | "impuesto" | "ninguno";
  valor: number | null;
  pctComision: number | null;
  // Migración 161 — qué fórmula aplica el markup del programa sobre el
  // resultado de la calculadora (ver lib/calc/programaPrecio.ts). Vive a
  // nivel de programa, igual que modo/valor/pctComision de arriba.
  modalidadMk: ModalidadMk;
  impuestoPorAcomodacion: boolean;
};

// Guarda la regla comisionable del programa y reemplaza sus salidas en una
// sola transacción de Postgres (`guardar_programa_salidas`, migración 151):
// un DELETE + INSERT hecho con dos llamadas sueltas de supabase-js no es
// atómico — si el INSERT falla después de un DELETE exitoso, el programa
// queda sin salidas aunque esta acción reporte el error. La función de BD
// revierte las dos operaciones juntas si cualquier fila falla.
export async function guardarSalidas(
  programaId: number,
  salidas: SalidaInput[],
  regla: ReglaComisionableInput
): Promise<Result> {
  // Frontera `unknown`: `regla` llega de una Server Action invocable desde el
  // navegador con cualquier body — `modalidadMk` puede traer CUALQUIER cosa
  // (undefined, un string arbitrario, un número, etc.). Se rechaza ANTES de
  // pasarla a `validarReglaComisionable` (que asume el tipo ya angosto) — un
  // valor manipulado nunca debe llegar a la RPC con la esperanza de que el
  // CHECK de BD lo atrape solo; el mensaje de error acá es legible, el de BD no.
  const modalidadMkRaw: unknown = (regla as { modalidadMk?: unknown })?.modalidadMk;
  if (!esModalidadMkValida(modalidadMkRaw)) {
    return { ok: false, error: "La modalidad de MK no es válida." };
  }
  const impuestoPorAcomodacionRaw: unknown = (regla as { impuestoPorAcomodacion?: unknown })?.impuestoPorAcomodacion;
  if (typeof impuestoPorAcomodacionRaw !== "boolean") {
    return { ok: false, error: "La modalidad del impuesto no es valida." };
  }
  if (impuestoPorAcomodacionRaw && regla.modo !== "impuesto") {
    return { ok: false, error: "El impuesto por acomodacion solo aplica a Tarifa - impuesto." };
  }
  // Repite la validación del navegador: no depender solo de él. `num()` ya
  // convierte "" / no-numérico a null, igual que `parseNumOrNull` del lado
  // cliente — los dos deben llegar exactamente a los mismos null/número.
  const valorNum = num(regla.valor);
  const pctComisionNum = num(regla.pctComision);
  const validacion = validarReglaComisionable({
    activa: !!regla.activa,
    modo: regla.modo,
    valor: valorNum,
    pctComision: pctComisionNum,
    modalidadMk: modalidadMkRaw,
  });
  if (!validacion.ok) return { ok: false, error: validacion.error };

  const sb = await createClient();
  const filas = salidas
    .filter(salidaTieneContenido)
    .map((s, i) => ({
      orden: i,
      etiqueta: oNull(s.etiqueta),
      fecha_desde: oNull(s.fechaDesde),
      fecha_hasta: oNull(s.fechaHasta),
      noches: num(s.noches),
      columna: oNull(s.columna),
      neto_sencilla: num(s.netoSencilla),
      neto_doble: num(s.netoDoble),
      neto_triple: num(s.netoTriple),
      neto_multiple: num(s.netoMultiple),
      neto_nino: num(s.netoNino),
      bajo_solicitud: !!s.bajoSolicitud,
      tarifa_sencilla: num(s.tarifaSencilla),
      tarifa_doble: num(s.tarifaDoble),
      tarifa_triple: num(s.tarifaTriple),
      tarifa_multiple: num(s.tarifaMultiple),
      impuesto_sencilla: num(s.impuestoSencilla),
      impuesto_doble: num(s.impuestoDoble),
      impuesto_triple: num(s.impuestoTriple),
      impuesto_multiple: num(s.impuestoMultiple),
    }));

  // Última barrera del lado app antes del CHECK de BD
  // (`programa_salidas_tarifas_no_negativas_check`) — mensaje legible en vez
  // de propagar el texto crudo de la violación del constraint.
  if (tieneTarifaNegativa(filas)) {
    return { ok: false, error: "Las tarifas del proveedor no pueden ser negativas." };
  }
  if (tieneImpuestoAcomodacionNegativo(filas)) {
    return { ok: false, error: "Los impuestos por acomodacion no pueden ser negativos." };
  }

  // (Revisión PR #277, defecto 3) Con la regla ACTIVA, cada tarifa cargada se
  // valida individualmente contra la modalidad de MK: `validarTarifaModalidad`
  // es un no-op (ok:true) salvo con la modalidad NUEVA, así que los datos/
  // programas en modalidad histórica JAMÁS quedan bloqueados por esta regla —
  // solo aplica a `'base_neta_impuestos_al_final'`, donde una base neta
  // negativa es una configuración inválida (ver el comentario del archivo
  // fuente) que debe rechazarse ANTES del RPC, no convertirse en un PVP
  // fabricado en 0. Con la regla apagada no se valida nada (mismo criterio
  // que `validarReglaComisionable`: inactiva no impone restricciones).
  if (regla.activa) {
    const reglaNum = { modo: regla.modo, valor: valorNum ?? 0, pctComision: pctComisionNum ?? 0 };
    for (const f of filas) {
      const pares = [
        [f.tarifa_sencilla, f.impuesto_sencilla, "sencilla"],
        [f.tarifa_doble, f.impuesto_doble, "doble"],
        [f.tarifa_triple, f.impuesto_triple, "triple"],
        [f.tarifa_multiple, f.impuesto_multiple, "multiple"],
      ] as const;
      for (const [tarifa, impuestoAcomodacion, nombre] of pares) {
        if (tarifa == null) continue;
        // Igual criterio que el editor (`tarifa > 0` guarda ambos chequeos) y
        // que el RPC (`v_tarifa > 0`): una tarifa <= 0 no es una acomodación
        // ofrecida por el proveedor, así que no exige su impuesto ni se
        // resuelve un valor para ella — antes de este fix, esta segunda
        // rama sí lo exigía incondicionalmente y podía rechazar un guardado
        // válido (tarifa 0 sin impuesto) que el editor y el RPC aceptaban.
        if (tarifa > 0) {
          if (impuestoPorAcomodacionRaw && impuestoAcomodacion == null) {
            return { ok: false, error: `Falta el impuesto de la acomodacion ${nombre}.` };
          }
          const valor = resolverValorReglaAcomodacion({
            modo: regla.modo,
            valorGeneral: reglaNum.valor,
            impuestoPorAcomodacion: impuestoPorAcomodacionRaw,
            impuestoAcomodacion,
          });
          if (valor == null) return { ok: false, error: `El impuesto de la acomodacion ${nombre} no es valido.` };
          const v = validarTarifaModalidad(tarifa, { ...reglaNum, valor }, modalidadMkRaw);
          if (!v.ok) return { ok: false, error: v.error };
        }
      }
    }
  }

  const { error } = await sb.rpc("guardar_programa_salidas", {
    p_programa_id: programaId,
    p_regla: {
      activa: !!regla.activa,
      modo: regla.modo,
      valor: valorNum,
      pctComision: pctComisionNum,
      modalidadMk: modalidadMkRaw,
      impuestoPorAcomodacion: impuestoPorAcomodacionRaw,
    },
    p_salidas: filas,
  });
  if (error) return { ok: false, error: error.message };
  rev(programaId);
  return { ok: true };
}

// ── Hoteles, vigencias y noches adicionales (#88, migración 244) ───────────────
export type HotelVigenciaInput = {
  id?: number | null;
  nombre: string;
  zona: string;
  tipoHabitacion: string;
  maxPaxHabitacion: string;
  maxMenoresHabitacion: string;
  proveedorId: number | null;
  base: { desde: string; hasta: string; modalidad: string; bajoSolicitud: boolean; neto: Record<ClaveTarifa, string> }[];
  noches: { desde: string; hasta: string; unidad: string; neto: Record<ClaveTarifa, string> }[];
};

const netosDe = (n: Record<ClaveTarifa, string>): PorAcom => {
  const o = { sencilla: null, doble: null, triple: null, multiple: null, nino: null } as PorAcom;
  for (const k of CLAVES_TARIFA) o[k] = num(n?.[k]);
  return o;
};
const entero = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Number.isInteger(n) ? n : Number.NaN;
};

type FilaHotel = {
  id: number | null; nombre: string; zona: string | null; tipoHabitacion: string | null;
  maxPaxHabitacion: number | null; maxMenoresHabitacion: number | null; proveedorId: number | null;
  base: { desde: string; hasta: string; modalidad: string; bajoSolicitud: boolean; neto: PorAcom }[];
  noches: { desde: string; hasta: string; unidad: string; neto: PorAcom }[];
};

/**
 * Normaliza y VALIDA el catálogo de hoteles recibido del navegador (guardado y vista previa comparten esta entrada, así que
 * el borrador que se previsualiza pasa por las mismas reglas que el que se guarda: capacidad, noches ligadas a las
 * vigencias base, solapes, valores). Mensaje legible o las filas listas.
 */
function prepararHoteles(hoteles: HotelVigenciaInput[]): { ok: true; filas: FilaHotel[] } | { ok: false; error: string } {
  if (!Array.isArray(hoteles)) return { ok: false, error: "La lista de hoteles no es válida." };
  const filas: FilaHotel[] = hoteles.map((h) => ({
    id: Number.isInteger(h.id) ? (h.id as number) : null,
    nombre: String(h.nombre ?? ""),
    zona: oNull(h.zona),
    tipoHabitacion: oNull(h.tipoHabitacion),
    maxPaxHabitacion: entero(h.maxPaxHabitacion),
    maxMenoresHabitacion: entero(h.maxMenoresHabitacion),
    proveedorId: Number.isInteger(h.proveedorId) && (h.proveedorId as number) > 0 ? (h.proveedorId as number) : null,
    base: (h.base ?? []).map((b) => ({ desde: String(b.desde ?? ""), hasta: String(b.hasta ?? ""), modalidad: String(b.modalidad ?? ""), bajoSolicitud: !!b.bajoSolicitud, neto: netosDe(b.neto) })),
    // Por habitación el menor va incluido: su campo no se guarda (un valor pegado por error no se cobra ni se exige).
    noches: (h.noches ?? []).map((t) => {
      const neto = netosDe(t.neto);
      if (String(t.unidad ?? "") === "habitacion") neto.nino = null;
      return { desde: String(t.desde ?? ""), hasta: String(t.hasta ?? ""), unidad: String(t.unidad ?? ""), neto };
    }),
  }));
  if (filas.some((f) => Number.isNaN(f.maxPaxHabitacion) || Number.isNaN(f.maxMenoresHabitacion))) {
    return { ok: false, error: "La ocupación permitida debe ser un número entero." };
  }
  const error = validarHotelesParaGuardar(filas);
  if (error) return { ok: false, error };
  return { ok: true, filas };
}

/**
 * Reemplaza el catálogo de hoteles de un programa por hotel y vigencia. Valida
 * antes (unidad de cobro obligatoria, fechas, valores, vigencias que no se solapan)
 * y delega en la RPC atómica `guardar_programa_hoteles` (conserva los ids de los
 * hoteles que ya existen). La RLS de siempre decide quién puede escribir.
 */
export async function guardarHoteles(programaId: number, hoteles: HotelVigenciaInput[]): Promise<Result> {
  const prep = prepararHoteles(hoteles);
  if (!prep.ok) return prep;
  const filas = prep.filas;

  const sb = await createClient();
  const { error: e } = await sb.rpc("guardar_programa_hoteles", {
    p_programa_id: programaId,
    p_hoteles: filas.map((f) => ({
      id: f.id,
      nombre: f.nombre.trim(),
      zona: f.zona,
      tipo_habitacion: f.tipoHabitacion,
      max_pax_habitacion: f.maxPaxHabitacion,
      max_menores_habitacion: f.maxMenoresHabitacion,
      proveedor_id: f.proveedorId,
      base: f.base.map((b) => ({
        desde: b.desde, hasta: b.hasta, modalidad_servicios: b.modalidad, bajo_solicitud: b.bajoSolicitud,
        neto_sencilla: b.neto.sencilla, neto_doble: b.neto.doble, neto_triple: b.neto.triple, neto_multiple: b.neto.multiple, neto_nino: b.neto.nino,
      })),
      noches: f.noches.map((t) => ({
        desde: t.desde, hasta: t.hasta, unidad_cobro: t.unidad,
        neto_sencilla: t.neto.sencilla, neto_doble: t.neto.doble, neto_triple: t.neto.triple, neto_multiple: t.neto.multiple, neto_nino: t.neto.nino,
      })),
    })) as never,
  });
  if (e) return { ok: false, error: e.message };
  rev(programaId);
  return { ok: true };
}

// ── Vista previa de solo lectura (PR #409) ───────────────────────────────────
export type SeleccionVistaPrevia = {
  /** Posición del hotel dentro de la lista enviada (puede ser un hotel aún sin guardar). */
  hotelIndex: number;
  modalidad: string;
  fechaEntrada: string;
  nochesAdicionales: number;
  habitaciones: Record<string, number>;
  ninos: number;
  infantes: number;
};

/**
 * Calcula la liquidación de una selección sobre el catálogo que le envían (guardado o borrador sin publicar) con el MISMO motor que la
 * reserva. SOLO LECTURA: lee la cabecera del programa (y su itinerario si no llega el borrador) y no escribe nada — no crea
 * cotización, contrato, CxP ni publicación, y no revalida páginas. Muestra netos únicamente a quien edita el producto.
 */
export async function calcularVistaPreviaPrograma(
  programaId: number,
  hoteles: HotelVigenciaInput[],
  seleccion: SeleccionVistaPrevia,
  diasBorrador?: DiaItinerario[],
): Promise<VistaPrevia> {
  const rol = await miRol();
  if (!puedeEscribir("producto", rol)) return { ok: false, causa: "No tienes permiso para ver la vista previa con costos del programa." };

  const prep = prepararHoteles(hoteles);
  if (!prep.ok) return { ok: false, causa: prep.error };
  const fila = prep.filas[seleccion.hotelIndex];
  if (!fila) return { ok: false, causa: "Elige un hotel de la lista." };
  if (!(MODALIDADES_SERVICIOS as readonly string[]).includes(seleccion.modalidad)) return { ok: false, causa: "Elige la modalidad de servicios (privados o regulares)." };
  if (!esFechaIso(seleccion.fechaEntrada)) return { ok: false, causa: "Elige una fecha de entrada válida." };

  const sb = await createClient();
  const { data: prog } = await sb
    .from("programas")
    .select("moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, dias, noches, regla_comisionable, regla_comisionable_modalidad_mk, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision, regla_comisionable_impuesto_por_acomodacion")
    .eq("id", programaId)
    .maybeSingle();
  if (!prog) return { ok: false, causa: "Programa no encontrado." };
  const incluidas = nochesIncluidasPrograma(prog);
  if (!incluidas.ok) return { ok: false, causa: incluidas.error };

  let dias = diasBorrador;
  if (!dias) {
    const { data } = await sb.from("programa_dias").select("dia, titulo, desayuno, almuerzo, cena, descripcion").eq("programa_id", programaId).order("dia");
    dias = (data ?? []).map((d) => ({ dia: d.dia, titulo: d.titulo, desayuno: !!d.desayuno, almuerzo: !!d.almuerzo, cena: !!d.cena, descripcion: d.descripcion }));
  }

  // Ids sintéticos: el borrador puede traer hoteles que aún no existen en la base.
  const hid = seleccion.hotelIndex + 1;
  const hotel: HotelEstancia = {
    id: hid, nombre: fila.nombre.trim(), zona: fila.zona, tipoHabitacion: fila.tipoHabitacion,
    maxPaxHabitacion: fila.maxPaxHabitacion, maxMenoresHabitacion: fila.maxMenoresHabitacion, proveedorId: null,
  };
  const base: BaseHotelFila[] = fila.base.map((b, i) => ({ id: i + 1, hotelId: hid, desde: b.desde, hasta: b.hasta, modalidad: b.modalidad as ModalidadServicios, bajoSolicitud: b.bajoSolicitud, neto: b.neto }));
  const noches: NocheTarifaFila[] = fila.noches.map((n, i) => ({ id: i + 1, hotelId: hid, desde: n.desde, hasta: n.hasta, unidad: n.unidad as NocheTarifaFila["unidad"], neto: n.neto }));
  const habitaciones: Record<string, number> = {};
  for (const [k, v] of Object.entries(seleccion.habitaciones ?? {})) if (Number(v) > 0) habitaciones[k] = Math.trunc(Number(v));

  return calcularVistaPrevia({
    programa: prog,
    nochesIncluidas: incluidas.noches,
    hotel,
    base,
    noches,
    seleccion: {
      modalidad: seleccion.modalidad as ModalidadServicios,
      fechaEntrada: seleccion.fechaEntrada,
      nochesAdicionales: Math.trunc(Number(seleccion.nochesAdicionales) || 0),
      habitaciones,
      ninos: Math.trunc(Number(seleccion.ninos) || 0),
      infantes: Math.trunc(Number(seleccion.infantes) || 0),
    },
    itinerario: dias,
    verNetos: true,
  });
}

// ── Inclusiones (incluye / no incluye) ─────────────────────────────────────────
export async function guardarInclusiones(
  programaId: number,
  inclusiones: { ciudad: string; tipo: string; texto: string }[]
): Promise<Result> {
  const sb = await createClient();
  await sb.from("programa_inclusiones").delete().eq("programa_id", programaId);
  const filas = inclusiones
    .filter((x) => x.texto.trim())
    .map((x, i) => ({
      programa_id: programaId,
      ciudad: oNull(x.ciudad),
      tipo: x.tipo === "no_incluye" ? "no_incluye" : "incluye",
      texto: x.texto.trim(),
      orden: i,
    }));
  if (filas.length) {
    const { error } = await sb.from("programa_inclusiones").insert(filas);
    if (error) return { ok: false, error: error.message };
  }
  rev(programaId);
  return { ok: true };
}

// ── Tours opcionales ───────────────────────────────────────────────────────────
export async function guardarTours(
  programaId: number,
  tours: { ciudad: string; nombre: string; precio: number | null; minPax: number | null; diasOperacion: string; descripcion: string }[]
): Promise<Result> {
  const sb = await createClient();
  await sb.from("programa_tours").delete().eq("programa_id", programaId);
  const filas = tours
    .filter((t) => t.nombre.trim())
    .map((t, i) => ({
      programa_id: programaId,
      ciudad: oNull(t.ciudad),
      nombre: t.nombre.trim(),
      precio: num(t.precio),
      min_pax: num(t.minPax) ?? 2,
      dias_operacion: oNull(t.diasOperacion),
      descripcion: oNull(t.descripcion),
      orden: i,
    }));
  if (filas.length) {
    const { error } = await sb.from("programa_tours").insert(filas);
    if (error) return { ok: false, error: error.message };
  }
  rev(programaId);
  return { ok: true };
}

// ── Blackouts ──────────────────────────────────────────────────────────────────
export async function guardarBlackouts(
  programaId: number,
  blackouts: { fechaInicio: string; fechaFin: string; motivo: string; ciudad: string }[]
): Promise<Result> {
  const sb = await createClient();
  await sb.from("programa_blackouts").delete().eq("programa_id", programaId);
  const filas = blackouts
    .filter((b) => b.fechaInicio || b.fechaFin || b.motivo.trim())
    .map((b) => ({
      programa_id: programaId,
      fecha_inicio: oNull(b.fechaInicio),
      fecha_fin: oNull(b.fechaFin),
      motivo: oNull(b.motivo),
      ciudad: oNull(b.ciudad),
    }));
  if (filas.length) {
    const { error } = await sb.from("programa_blackouts").insert(filas);
    if (error) return { ok: false, error: error.message };
  }
  rev(programaId);
  return { ok: true };
}

// ── Importar desde el texto del proveedor ──────────────────────────────────────
// Parsea el texto crudo (Word/PDF pegado) y, según las casillas marcadas,
// reemplaza el itinerario, la ruta y/o las inclusiones del programa. También
// puede actualizar días/noches de la cabecera. Es destructivo por sección:
// solo toca lo que el usuario eligió importar.
export type ImportarOpciones = {
  itinerario: boolean;
  ruta: boolean;
  inclusiones: boolean;
  diasNoches: boolean;
};

export async function importarDesdeTexto(
  programaId: number,
  texto: string,
  opciones: ImportarOpciones
): Promise<Result> {
  if (!texto.trim()) return { ok: false, error: "Pega primero el texto del proveedor." };
  const parsed = parsearPrograma(texto);
  const sb = await createClient();

  if (opciones.diasNoches && (parsed.dias != null || parsed.noches != null)) {
    const { error } = await sb
      .from("programas")
      .update({
        ...(parsed.dias != null ? { dias: parsed.dias } : {}),
        ...(parsed.noches != null ? { noches: parsed.noches } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", programaId);
    if (error) return { ok: false, error: error.message };
  }

  if (opciones.ruta && parsed.ciudades.length) {
    // El alojamiento previsto no viene en el texto del proveedor: se omite la
    // clave y la RPC atómica (migración 212) conserva el de cada ciudad por
    // nombre y orden de aparición, en la misma transacción que reemplaza la ruta.
    const { error } = await sb.rpc("reemplazar_ruta_programa", {
      p_programa_id: programaId,
      p_ciudades: parsed.ciudades.map((nombre) => ({ nombre: nombre.trim(), codigo_iata: null, noches: 0 })),
    });
    if (error) return { ok: false, error: error.message };
  }

  if (opciones.itinerario && parsed.itinerario.length) {
    await sb.from("programa_dias").delete().eq("programa_id", programaId);
    const filas = parsed.itinerario.map((d) => ({
      programa_id: programaId,
      dia: d.dia,
      titulo: oNull(d.titulo),
      desayuno: d.desayuno,
      almuerzo: d.almuerzo,
      cena: d.cena,
      descripcion: oNull(d.descripcion),
    }));
    const { error } = await sb.from("programa_dias").insert(filas);
    if (error) return { ok: false, error: error.message };
  }

  if (opciones.inclusiones && (parsed.incluye.length || parsed.noIncluye.length)) {
    await sb.from("programa_inclusiones").delete().eq("programa_id", programaId);
    const filas = [
      ...parsed.incluye.map((texto, i) => ({ tipo: "incluye", texto, orden: i })),
      ...parsed.noIncluye.map((texto, i) => ({ tipo: "no_incluye", texto, orden: parsed.incluye.length + i })),
    ].map((x) => ({ programa_id: programaId, ciudad: null, ...x }));
    if (filas.length) {
      const { error } = await sb.from("programa_inclusiones").insert(filas);
      if (error) return { ok: false, error: error.message };
    }
  }

  rev(programaId);
  return { ok: true };
}
