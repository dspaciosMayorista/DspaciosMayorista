"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { regenerarTarifariosDeServicio, generarTarifario } from "../../paquetes/actions";
import { exigirEscrituraCatalogoGlobal } from "@/lib/auth/contextoAgencia";
import { formatearHora, parseHora, validarFranjas, type FranjaSuplemento } from "@/lib/calc/trasladoFranjas";
import type { ClasificacionServicio, FilaPrecioAlcance } from "@/lib/calc/servicioAlcance";
import { guardarClasificacion, reemplazarPreciosAlcance } from "@/lib/servicios/alcanceDatos";
import { MENSAJE_SERVICIO_CON_OBLIGACIONES, mensajeErrorEliminarServicio } from "@/lib/servicios/eliminarServicio";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type Liquidacion = "dia" | "noche" | "paquete";
export type TierPax = { paxDesde: number; paxHasta: number; precio: number };

// ── Temporadas del servicio (tarifa por fecha + vigencia de compra) ─────────
// Una temporada es una tarifa COMPLETA para su rango de fechas: precio por
// persona + recargo individual + rangos por grupo. La tarifa de siempre es la
// temporada 'GENERAL' (sin fechas). Los rangos por grupo de una temporada viven
// en servicio_tarifa_pax con temporada = nombre de la temporada.
export type TemporadaServicioInput = {
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  compraInicio: string;
  compraFin: string;
  prioridad: number;
  precioPersona: number | null;
  // NETO por infante (0 a 1,99 años) en esta temporada. null = hereda el de la
  // tarifa GENERAL (y si tampoco lo tiene, el infante paga como adulto).
  precioInfante?: number | null;
  recargoIndividual: number | null;
  grupoTiers: TierPax[];
};

// Precio de infante (migración 226): NULL = sin configurar (el infante paga como
// adulto); 0 = gratis. Un valor negativo o no numérico se rechaza antes de llegar a la BD.
function precioInfanteRow(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function temporadaRow(servicioId: number, input: TemporadaServicioInput) {
  return {
    servicio_id: servicioId,
    nombre: input.nombre.trim() || "Temporada",
    fecha_inicio: oNull(input.fechaInicio),
    fecha_fin: oNull(input.fechaFin),
    compra_inicio: oNull(input.compraInicio),
    compra_fin: oNull(input.compraFin),
    prioridad: Number(input.prioridad) || 1,
    precio_persona: input.precioPersona,
    precio_infante: precioInfanteRow(input.precioInfante),
    recargo_individual: input.recargoIndividual,
  };
}

export async function crearTemporadaServicio(servicioId: number, input: TemporadaServicioInput): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const nombre = input.nombre.trim() || "Temporada";
  if (nombre.toUpperCase() === "GENERAL") return { ok: false, error: "'GENERAL' es la tarifa base; usa otro nombre para la temporada." };
  const { error } = await sb.from("servicio_temporadas").insert(temporadaRow(servicioId, input));
  if (error) return { ok: false, error: error.message };
  await guardarGrupoTiers(sb, servicioId, input.grupoTiers ?? [], nombre);
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function actualizarTemporadaServicio(id: number, input: TemporadaServicioInput): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const nombre = input.nombre.trim() || "Temporada";
  if (nombre.toUpperCase() === "GENERAL") return { ok: false, error: "'GENERAL' es la tarifa base; usa otro nombre para la temporada." };
  // Datos previos: el servicio y el nombre anterior (los rangos por grupo se
  // guardan con el nombre de la temporada, hay que reubicarlos si se renombró).
  const { data: prev } = await sb.from("servicio_temporadas").select("servicio_id, nombre").eq("id", id).maybeSingle();
  if (!prev) return { ok: false, error: "Temporada no encontrada." };
  const { servicio_id: _omit, ...row } = temporadaRow(0, input);
  void _omit;
  const { error } = await sb.from("servicio_temporadas").update(row).eq("id", id);
  if (error) return { ok: false, error: error.message };
  // Si cambió el nombre, limpia los rangos del nombre viejo antes de reescribir.
  if (prev.nombre && prev.nombre !== nombre) {
    await sb.from("servicio_tarifa_pax").delete().eq("servicio_id", prev.servicio_id).eq("temporada", prev.nombre);
  }
  await guardarGrupoTiers(sb, prev.servicio_id, input.grupoTiers ?? [], nombre);
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

// ── Suplementos de traslado por franja horaria (migración 255) ──────────────
// Cuelgan de UNA vigencia (servicio_temporadas.id). Se valida con la misma función pura que usa la liquidación (formato, valor, tramo, medianoche y
// solapes contra las demás franjas de la vigencia); la base repite la comprobación con su propio trigger.
export type FranjaServicioInput = Omit<FranjaSuplemento, "id">;

const MENSAJE_FRANJAS_NO_DISPONIBLES = "Los suplementos por horario todavía no están habilitados en la base de datos (falta aplicar la migración 255).";

function mensajeErrorFranja(e: { code?: string; message?: string }): string {
  if (e.code === "23P01") return e.message ?? "La franja se solapa con otra de la misma vigencia.";
  if (e.code === "42P01") return MENSAJE_FRANJAS_NO_DISPONIBLES;
  if (e.code === "23514") return "La franja no cumple las reglas (horas HH:MM, valor mayor que cero, tramo, tipo y cobro válidos).";
  return "No se pudo guardar la franja. Intenta de nuevo.";
}

export async function guardarFranjaServicio(temporadaId: number, input: FranjaServicioInput, franjaId?: number): Promise<Result> {
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const desde = parseHora(input.hora_desde);
  const hasta = parseHora(input.hora_hasta, true);
  if (desde == null || hasta == null) return { ok: false, error: "Las horas deben tener formato HH:MM (24:00 solo como hora final)." };
  const conRango = input.pax_desde != null || input.pax_hasta != null;
  const nueva: FranjaSuplemento = {
    hora_desde: formatearHora(desde), hora_hasta: hasta === 1440 ? "24:00" : formatearHora(hasta),
    tramo: input.tramo, tipo: input.tipo, valor: Number(input.valor), cobro: input.cobro,
    ...(conRango ? { pax_desde: input.pax_desde ?? null, pax_hasta: input.pax_hasta ?? null } : {}),
  };
  const sb = await createClient();
  // Con la 262 las franjas traen su rango de pasajeros; sin ella esas columnas no existen (42703): se lee sin ellas y se rechaza guardar un rango.
  let lectura = await sb.from("servicio_suplementos_franja").select("id, hora_desde, hora_hasta, tramo, tipo, valor, cobro, pax_desde, pax_hasta").eq("servicio_temporada_id", temporadaId);
  if (lectura.error?.code === "42703") {
    if (conRango) return { ok: false, error: "Los rangos de pasajeros todavía no están habilitados en la base de datos (falta aplicar la migración 262)." };
    lectura = (await sb.from("servicio_suplementos_franja").select("id, hora_desde, hora_hasta, tramo, tipo, valor, cobro").eq("servicio_temporada_id", temporadaId)) as unknown as typeof lectura;
  }
  if (lectura.error) return { ok: false, error: mensajeErrorFranja(lectura.error) };
  const resto = (lectura.data ?? []).filter((f) => f.id !== franjaId).map((f) => ({ ...f, valor: Number(f.valor) })) as FranjaSuplemento[];
  const errores = validarFranjas([...resto, nueva]);
  if (errores.length) return { ok: false, error: errores[errores.length - 1] };
  const fila = { servicio_temporada_id: temporadaId, ...nueva };
  const { error } = franjaId
    ? await sb.from("servicio_suplementos_franja").update(fila).eq("id", franjaId)
    : await sb.from("servicio_suplementos_franja").insert(fila);
  if (error) return { ok: false, error: mensajeErrorFranja(error) };
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

// ── Tipo de receptivo y precios por trayecto (migración 262, provisional) ────────────────────────────────────────────────────────────────────────────────
export async function guardarClasificacionServicio(servicioId: number, input: ClasificacionServicio): Promise<Result> {
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const r = await guardarClasificacion(await createClient(), servicioId, input);
  if (r.ok) revalidatePath("/dashboard/producto/servicios");
  return r;
}

/** Reemplaza los precios por trayecto / ida y regreso de UNA vigencia. GENERAL es histórico y no vendible: no admite precios por trayecto. */
export async function guardarPreciosAlcanceVigencia(temporadaId: number, filas: FilaPrecioAlcance[]): Promise<Result> {
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const { data: t } = await sb.from("servicio_temporadas").select("nombre").eq("id", temporadaId).maybeSingle();
  if (!t) return { ok: false, error: "Vigencia no encontrada." };
  if (String(t.nombre).trim().toUpperCase() === "GENERAL") return { ok: false, error: "GENERAL es la tarifa histórica y no se vende: carga los precios por trayecto en una vigencia con fechas." };
  const r = await reemplazarPreciosAlcance(sb as never, temporadaId, filas);
  if (r.ok) revalidatePath("/dashboard/producto/servicios");
  return r;
}

export async function eliminarFranjaServicio(franjaId: number): Promise<Result> {
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const { error } = await sb.from("servicio_suplementos_franja").delete().eq("id", franjaId);
  if (error) return { ok: false, error: mensajeErrorFranja(error) };
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function eliminarTemporadaServicio(id: number): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const { data: prev } = await sb.from("servicio_temporadas").select("servicio_id, nombre").eq("id", id).maybeSingle();
  const { error } = await sb.from("servicio_temporadas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  // Borra también los rangos por grupo de esa temporada.
  if (prev) await sb.from("servicio_tarifa_pax").delete().eq("servicio_id", prev.servicio_id).eq("temporada", prev.nombre);
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export type ServicioInput = {
  nombre: string;
  proveedorId: number | null;
  destinoId: number | null;
  alcance?: "nacional" | "internacional"; // cuando destinoId es null: catch-all nacional o internacional
  moneda?: "COP" | "USD";         // un servicio = una moneda (su tarifa va en ella)
  precioPersona: number | null;
  // NETO por infante (0 a 1,99 años), solo cobro POR PERSONA. null = sin configurar:
  // el infante paga como adulto (NULL ≠ $0). En cobro por grupo el infante no cuenta
  // para el rango ni paga extra, así que no usa este campo.
  precioInfante?: number | null;
  grupoTiers: TierPax[];          // rangos de pax para cobro POR GRUPO
  temporada: string;
  rangosEdad?: number[];
  categoria?: string;             // tour_traslado | asistencia | otro
  liquidacion?: Liquidacion;      // tipo de cobro: dia | noche | paquete
  descripcion?: string;           // texto del tour (se muestra al cliente)
  recargoIndividual?: number;     // suplemento que se suma a la tarifa si va 1 pax
};

function servicioToRow(input: ServicioInput) {
  return {
    nombre: input.nombre.trim(),
    proveedor_id: input.proveedorId,
    destino_id: input.destinoId,
    // El alcance solo aplica como catch-all cuando NO hay destino específico.
    alcance: input.destinoId == null ? (input.alcance === "internacional" ? "internacional" : "nacional") : "nacional",
    moneda: input.moneda === "USD" ? "USD" : "COP",
    precio_persona: input.precioPersona,
    precio_infante: precioInfanteRow(input.precioInfante),
    tarifa_neta: input.precioPersona ?? 0,
    temporada: oNull(input.temporada),
    rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    categoria: input.categoria || "otro",
    liquidacion: input.liquidacion ?? "paquete",
    descripcion: oNull(input.descripcion ?? ""),
    recargo_individual: Math.max(Number(input.recargoIndividual) || 0, 0),
  };
}

// Reemplaza los rangos por grupo de UNA temporada (default 'GENERAL' = base).
// Acotar por temporada es clave: guardar la base NO debe borrar los rangos de
// las temporadas, y viceversa.
async function guardarGrupoTiers(
  sb: Awaited<ReturnType<typeof createClient>>,
  servicioId: number,
  tiers: TierPax[],
  temporada = "GENERAL"
) {
  await sb.from("servicio_tarifa_pax").delete().eq("servicio_id", servicioId).eq("temporada", temporada);
  const validos = tiers.filter((t) => Number(t.precio) > 0);
  if (validos.length) {
    await sb.from("servicio_tarifa_pax").insert(
      validos.map((t) => ({
        servicio_id: servicioId,
        pax_desde: Number(t.paxDesde) || 1,
        pax_hasta: Number(t.paxHasta) || Number(t.paxDesde) || 1,
        precio: Number(t.precio) || 0,
        temporada,
      }))
    );
  }
}

// Foto de portada del servicio (tour/receptivo): se lee en vivo desde el
// tarifario público (no se denormaliza en tarifario_resultado), así que no
// hace falta regenerar nada al cambiarla.
export async function actualizarFotoServicio(id: number, fotoUrl: string | null): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const { error } = await sb.from("servicios_adicionales").update({ foto_url: fotoUrl }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function crearServicio(input: ServicioInput): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const { data, error } = await sb.from("servicios_adicionales").insert({ ...servicioToRow(input), activo: true }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "No se insertó" };
  await guardarGrupoTiers(sb, data.id, input.grupoTiers);
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function actualizarServicio(id: number, input: ServicioInput): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const { error } = await sb.from("servicios_adicionales").update(servicioToRow(input)).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await guardarGrupoTiers(sb, id, input.grupoTiers);
  revalidatePath("/dashboard/producto/servicios");
  await regenerarTarifariosDeServicio(id); // cambió el precio del servicio → recalcula paquetes
  return { ok: true };
}

export async function eliminarServicio(id: number): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  // 262–265: un servicio con líneas de contrato enlazadas a su cuenta por pagar no se elimina. Aviso previo y claro; la protección real sigue siendo la de la base (si la columna
  // no existe todavía, 42703, no hay nada enlazado y se sigue como siempre; si la RLS no deja leer, el rechazo de la base se traduce abajo).
  const { data: enlazada, error: eEnlace } = await sb.from("cuentas_por_pagar").select("id").eq("servicio_id", id).not("contrato_servicio_id", "is", null).limit(1);
  if (!eEnlace && (enlazada ?? []).length) return { ok: false, error: MENSAJE_SERVICIO_CON_OBLIGACIONES };
  // Captura los paquetes que lo usaban ANTES de borrar; se regeneran después.
  const { data: usados } = await sb.from("armado_servicios").select("paquete_id").eq("servicio_id", id);
  const paqIds = [...new Set((usados ?? []).map((u) => u.paquete_id))];
  const { error } = await sb.from("servicios_adicionales").delete().eq("id", id);
  if (error) return { ok: false, error: mensajeErrorEliminarServicio(error) };
  for (const pid of paqIds) { try { await generarTarifario(pid); } catch { /* sigue */ } }
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

// ── Carga masiva (CSV) ─────────────────────────────────────────────────────
const numCsv = (s?: string) => (s ? parseInt(String(s).replace(/[^\d-]/g, ""), 10) || 0 : 0);
// Como numCsv pero distingue "vacío" (null) de "0": el precio de infante en blanco
// significa "sin configurar" y el infante paga como adulto; "0" significa gratis.
const numCsvNullable = (s?: string) => (s && String(s).trim() !== "" ? Math.max(numCsv(s), 0) : null);
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

    // Alcance del catch-all (solo si no hay destino puntual): nacional/internacional.
    const alcance = destinoId == null && /interna?c/i.test((r.alcance || "").trim()) ? "internacional" : "nacional";
    const moneda = /usd|d[oó]lar/i.test((r.moneda || "").trim()) ? "USD" : "COP";
    const { data: sv, error } = await sb.from("servicios_adicionales").insert({
      nombre, proveedor_id: provId, destino_id: destinoId, alcance, moneda,
      tarifa_neta: precio, precio_persona: precio, temporada: oNull(r.temporada || ""),
      liquidacion, activo: true,
      categoria: normCategoria(r.categoria),
      rangos_edad: rangosEdad.length ? rangosEdad : null,
      descripcion: oNull(r.descripcion || ""),
      recargo_individual: numCsv(r.recargo_individual),
      precio_infante: numCsvNullable(r.precio_infante),
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
