"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { parsearPrograma } from "@/lib/programasImport";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const oNull = (s?: string | null) => (s && String(s).trim() !== "" ? String(s).trim() : null);
const num = (v: unknown) => {
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
  textoCondiciones: string;
  textoCancelacion: string;
  textoPagos: string;
  notas: string;
  desdePrecio: number | null;
  incluyeAereo: boolean;
  portadaUrl: string;
  asistenciaMedicaDia: number | null;
};

function cabeceraRow(input: CabeceraInput) {
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
    texto_condiciones: oNull(input.textoCondiciones),
    texto_cancelacion: oNull(input.textoCancelacion),
    texto_pagos: oNull(input.textoPagos),
    notas: oNull(input.notas),
    desde_precio: input.desdePrecio,
    incluye_aereo: !!input.incluyeAereo,
    portada_url: oNull(input.portadaUrl),
    asistencia_medica_dia: input.asistenciaMedicaDia ?? 0,
  };
}

export async function crearPrograma(input: CabeceraInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { data, error } = await sb
    .from("programas")
    .insert(cabeceraRow(input))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/programas");
  return { ok: true, id: data.id };
}

export async function guardarCabecera(id: number, input: CabeceraInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb
    .from("programas")
    .update({ ...cabeceraRow(input), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(id);
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
      .filter((p) => p.acomodacion.trim() && (num(p.neto) != null || p.bajoSolicitud))
      .map((p) => ({
        categoria_id: catId,
        acomodacion: p.acomodacion.trim(),
        neto: num(p.neto),
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
