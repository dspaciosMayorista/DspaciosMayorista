"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { parsearPrograma } from "@/lib/programasImport";
import { salidaTieneContenido, tieneImpuestoAcomodacionNegativo, tieneTarifaNegativa } from "@/lib/programas/salidasGuardado";
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
};

function validarCondicionYRestriccionPrograma(
  input: CabeceraInput,
): { ok: true; condicion: CondicionPagoPersistible; restriccion: string } | { ok: false; error: string } {
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
    modo_precio: input.modoPrecio === "salida" ? "salida" : "categoria",
    video_url: oNull(input.videoUrl),
    condicion_pago_tipo: condicion.condicion_pago_tipo,
    condicion_pago_pct_inicial: condicion.condicion_pago_pct_inicial,
    condicion_pago_dias_saldo: condicion.condicion_pago_dias_saldo,
    restriccion_comercial: restriccion,
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
  ciudades: { nombre: string; codigoIata: string; noches: number | null }[]
): Promise<Result> {
  const sb = await createClient();
  await sb.from("programa_ciudades").delete().eq("programa_id", programaId);
  const filas = ciudades
    .filter((c) => c.nombre.trim())
    .map((c, i) => ({
      programa_id: programaId,
      orden: i,
      nombre: c.nombre.trim(),
      codigo_iata: oNull(c.codigoIata),
      noches: num(c.noches) ?? 0,
    }));
  if (filas.length) {
    const { error } = await sb.from("programa_ciudades").insert(filas);
    if (error) return { ok: false, error: error.message };
  }
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
    await sb.from("programa_ciudades").delete().eq("programa_id", programaId);
    const filas = parsed.ciudades.map((nombre, i) => ({
      programa_id: programaId,
      orden: i,
      nombre: nombre.trim(),
      codigo_iata: null,
      noches: 0,
    }));
    const { error } = await sb.from("programa_ciudades").insert(filas);
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
