"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { ACOM_ROOMS, type AcomRoom } from "@/lib/acomodaciones";
import {
  generarTarifas, analizarMixta, clavePromoMixta, renombrarTemporadaEnParams, validarDubaiParams,
  filaSustitucionMixta, aplicarAdultsOnly, valoresDeFila, CAMPOS_VALOR_TARIFA, fotoTarifas,
  type DubaiParams, type MixtaParams, type CorporativaParams, type ValoresTarifa, type FotoTarifa,
} from "@/lib/calc/calculadoras";
import { separarFilasConGrupos, separarFilasVencidas } from "@/lib/calc/promoCalculadora";
import { contextoGeneracion } from "@/lib/hoteles/contextoGeneracionTarifas";
import { regenerarTarifariosDeHotel } from "../../paquetes/actions";
import type { Json } from "@/types/database";
import { puedeEscribir } from "@/lib/roles";
import { normalizarProveedorHotelId } from "@/lib/hoteles/proveedor";
import { eliminarHotelSeguro, type ResultadoEliminarHotel } from "@/lib/hoteles/eliminarHotel";
import { validarCondicionPago, type CondicionPagoEntrada } from "@/lib/cotizacion/condicionPagoCatalogo";
import { validarFechasVigencia, fechasGuardadas, anioVigenteBogota, type FechasVigencia } from "@/lib/hoteles/validarFechasVigencia";
import { mensajeBorrarVigenciaConGrupos } from "@/lib/hoteles/alcanceGrupos";
import { validarCamposPromo, mensajePromo300, validarCombinacion, textoFamilias, type ColumnasPromo, type EleccionDias, type CombinacionEntrada } from "@/lib/hoteles/promocionesVigencia";
import type { ReglaNocheGratis, UnidadMonto } from "@/lib/calc/promocionesGrupo";

// `cambioPendiente` (entrega 5, P3): el cambio de una promoción que se vende crea una coincidencia con EBB / Long Stay sin
// configurar; quedó GUARDADO como pendiente (la versión autorizada sigue vendiéndose) y la UI ofrece configurarla y activarlo.
type Result = { ok: true; id?: number; aviso?: string; cambioPendiente?: { promocionId: number; familias: ("ebb" | "long_stay")[] } } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);
// #43/#60 (299): un empate de prioridad lo rechaza la base al confirmar; su mensaje ya es claro, sin el prefijo técnico.
const sinPrefijoEmpate = (m: string) => m.replace(/^EMPATE_PRIORIDAD:\s*/, "");

export async function crearHotel(input: {
  nombre: string;
  destinoId: number;
  proveedorId: number | null;
  zona: string;
  edadInfanteMin: number;
  edadInfanteMax: number;
  edadNinoMin: number;
  edadNinoMax: number;
  categoriaIds: number[];
  regimenIds: number[];
  rangosEdad?: number[];
  contactoTelefono?: string;
  emailComercial?: string;
  moneda?: string;
}): Promise<Result> {
  const sb = await createClient();
  const { data: hotel, error } = await sb
    .from("hoteles")
    .insert({
      nombre: input.nombre.trim(),
      destino_id: input.destinoId,
      proveedor_id: input.proveedorId,
      zona: oNull(input.zona),
      moneda: input.moneda === "USD" ? "USD" : "COP",
      edad_infante_min: input.edadInfanteMin,
      edad_infante_max: input.edadInfanteMax,
      edad_nino_min: input.edadNinoMin,
      edad_nino_max: input.edadNinoMax,
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
      contacto_telefono: oNull(input.contactoTelefono ?? ""),
      email_comercial: oNull(input.emailComercial ?? ""),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (input.categoriaIds.length) {
    const { error: ce } = await sb.from("hotel_categorias").insert(
      input.categoriaIds.map((categoria_id) => ({ hotel_id: hotel.id, categoria_id }))
    );
    if (ce) return { ok: false, error: ce.message };
  }
  if (input.regimenIds.length) {
    const { error: re } = await sb.from("hotel_regimenes").insert(
      input.regimenIds.map((plan_id) => ({ hotel_id: hotel.id, plan_id }))
    );
    if (re) return { ok: false, error: re.message };
  }

  revalidatePath("/dashboard/producto/hoteles");
  return { ok: true, id: hotel.id };
}

// Nunca borra un hotel vinculado a paquetes (ver lib/hoteles/eliminarHotel.ts).
export async function eliminarHotel(id: number): Promise<ResultadoEliminarHotel> {
  const sb = await createClient();
  const r = await eliminarHotelSeguro(sb, id);
  if (r.ok) revalidatePath("/dashboard/producto/hoteles");
  return r;
}

// Reemplaza las categorías de habitación y regímenes asignados a un hotel.
// No toca las tarifas ya cargadas (tarifa_hotel guarda categoría/régimen como texto).
export async function actualizarHotelCategoriasRegimenes(
  hotelId: number,
  categoriaIds: number[],
  regimenIds: number[],
): Promise<Result> {
  const sb = await createClient();
  await sb.from("hotel_categorias").delete().eq("hotel_id", hotelId);
  await sb.from("hotel_regimenes").delete().eq("hotel_id", hotelId);
  if (categoriaIds.length) {
    const { error } = await sb.from("hotel_categorias").insert(
      categoriaIds.map((categoria_id) => ({ hotel_id: hotelId, categoria_id }))
    );
    if (error) return { ok: false, error: error.message };
  }
  if (regimenIds.length) {
    const { error } = await sb.from("hotel_regimenes").insert(
      regimenIds.map((plan_id) => ({ hotel_id: hotelId, plan_id }))
    );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

export async function actualizarHotelConfig(
  hotelId: number,
  input: {
    nombre?: string;
    destinoId?: number | null;
    proveedorId?: unknown;
    zona: string;
    edadInfanteMin: number;
    edadInfanteMax: number;
    edadNinoMin: number;
    edadNinoMax: number;
    rangosEdad: number[];
    contactoTelefono?: string;
    emailComercial?: string;
    estrellas?: number | null;
    clasificacion?: string;
    descripcion?: string;
    ubicacion?: string;
    videoUrl?: string;
    moneda?: string;
    ninoNota?: string;
    adultsOnly?: boolean;
    petFriendly?: boolean;
    petCostoNeto?: number;
    petCostoDesc?: string;
    petNota?: string;
  }
): Promise<Result> {
  const sb = await createClient();
  const proveedor = normalizarProveedorHotelId(input.proveedorId);
  if (!proveedor.ok) return proveedor;
  if (proveedor.proveedorId != null) {
    const { data: proveedorHotel, error: proveedorError } = await sb
      .from("proveedores")
      .select("id")
      .eq("id", proveedor.proveedorId)
      .eq("tipo", "hotelero")
      .maybeSingle();
    if (proveedorError) return { ok: false, error: "No fue posible validar el proveedor seleccionado." };
    if (!proveedorHotel) return { ok: false, error: "El proveedor seleccionado no es un proveedor hotelero valido." };
  }
  const { error } = await sb
    .from("hoteles")
    .update({
      ...(input.nombre && input.nombre.trim() ? { nombre: input.nombre.trim() } : {}),
      ...(input.destinoId != null ? { destino_id: input.destinoId } : {}),
      ...(proveedor.proveedorId !== undefined ? { proveedor_id: proveedor.proveedorId } : {}),
      zona: oNull(input.zona),
      ...(input.moneda ? { moneda: input.moneda === "USD" ? "USD" : "COP" } : {}),
      edad_infante_min: input.edadInfanteMin,
      edad_infante_max: input.edadInfanteMax,
      edad_nino_min: input.edadNinoMin,
      edad_nino_max: input.edadNinoMax,
      rangos_edad: input.rangosEdad.length ? input.rangosEdad : null,
      contacto_telefono: oNull(input.contactoTelefono ?? ""),
      email_comercial: oNull(input.emailComercial ?? ""),
      estrellas: input.estrellas && input.estrellas > 0 ? input.estrellas : null,
      clasificacion: oNull(input.clasificacion ?? ""),
      descripcion: oNull(input.descripcion ?? ""),
      ubicacion: oNull(input.ubicacion ?? ""),
      video_url: oNull(input.videoUrl ?? ""),
      nino_nota: oNull(input.ninoNota ?? ""),
      adults_only: !!input.adultsOnly,
      pet_friendly: !!input.petFriendly,
      pet_costo_neto: Math.max(0, Number(input.petCostoNeto) || 0),
      pet_costo_desc: oNull(input.petCostoDesc ?? ""),
      pet_nota: oNull(input.petNota ?? ""),
    })
    .eq("id", hotelId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  revalidatePath("/dashboard/producto/hoteles");
  revalidatePath("/dashboard/producto/destinos");
  return { ok: true };
}

// #120 — Marca «bajo solicitud» del hotel (migración 270). Apagada por defecto y SIN clasificación automática: solo la cambia una persona de producto. Las reglas que
// importan (no marcar con tarifas, no marcar un hotel por unidad, no desmarcar con solicitudes abiertas) las impone la base; aquí solo se traduce su mensaje.
export async function setHotelBajoSolicitud(hotelId: number, valor: boolean): Promise<Result> {
  const sb = await createClient();
  const { data: h, error: eH } = await sb.from("hoteles").select("modelo_tarifario").eq("id", hotelId).maybeSingle();
  if (eH || !h) return { ok: false, error: "No se pudo leer el hotel." };
  if (valor && h.modelo_tarifario === "unidad") return { ok: false, error: "Un hotel por unidad (Bernalo) no se ofrece bajo solicitud." };
  const { data, error } = await sb.from("hoteles").update({ tarifa_bajo_solicitud: !!valor }).eq("id", hotelId).select("id");
  if (error) return { ok: false, error: error.message.replace(/^HOTEL_BAJO_SOLICITUD:\s*/, "") };
  if (!data?.length) return { ok: false, error: "No tienes permiso para cambiar este hotel." };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  revalidatePath("/dashboard/paquetes");
  revalidatePath("/tarifario");
  return { ok: true };
}

// Qué editor de tarifas está activo para el hotel (persona | unidad Bernalo,
// migración 174). Enum validado server-side — nunca se confía en el string
// que manda el cliente, aunque la UI ya restrinja las opciones a un
// `<button>` por valor. Solo toca `hoteles`: no inserta, actualiza ni borra
// ninguna fila de `tarifa_hotel` ni de `hotel_tarifas_unidad` — es
// exclusivamente el interruptor de qué pantalla se muestra.
const MODELOS_TARIFARIOS = ["persona", "unidad"] as const;
type ModeloTarifarioHotel = (typeof MODELOS_TARIFARIOS)[number];

export async function actualizarModeloTarifarioHotel(hotelId: number, modelo: string): Promise<Result> {
  if (!(MODELOS_TARIFARIOS as readonly string[]).includes(modelo)) {
    return { ok: false, error: `Modelo tarifario inválido: "${modelo}". Debe ser "persona" o "unidad".` };
  }
  const sb = await createClient();
  const { data, error } = await sb
    .from("hoteles")
    .update({ modelo_tarifario: modelo as ModeloTarifarioHotel })
    .eq("id", hotelId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // El `.update()` de Supabase no falla si el `.eq("id", ...)` no encuentra
  // ninguna fila (no es un error de base) — sin este chequeo, un hotelId
  // inexistente devolvería `ok:true` sin haber cambiado nada. Más de una
  // fila afectada sería igual de grave (un filtro roto escribiendo sobre
  // hoteles ajenos): en ambos casos, fail-closed con un mensaje explícito.
  if (!data || data.length === 0) {
    return { ok: false, error: "No se encontró el hotel a actualizar (0 filas afectadas)." };
  }
  if (data.length > 1) {
    return { ok: false, error: `Se afectó más de una fila (${data.length}) al actualizar el modelo tarifario — operación cancelada.` };
  }
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Configuración de acomodaciones por hotel (reservar por habitaciones) ────
export type AcomConfigInput = {
  acomodacion: AcomRoom;
  pax_tarifa: number;
  pax_max: number;
  adt_min: number;
  adt_max: number;
  chd_min: number;
  chd_max: number;
  inf_min: number;
  inf_max: number;
};

export async function actualizarHotelAcomodaciones(
  hotelId: number,
  input: { paxMin: number | null; paxMax: number | null; acomodaciones: AcomConfigInput[] }
): Promise<Result> {
  const sb = await createClient();

  const { error: he } = await sb
    .from("hoteles")
    .update({ pax_min: input.paxMin, pax_max: input.paxMax })
    .eq("id", hotelId);
  if (he) return { ok: false, error: he.message };

  // Upsert por (hotel_id, acomodacion): reemplaza la config completa del hotel.
  const filas = input.acomodaciones
    .filter((a) => ACOM_ROOMS.includes(a.acomodacion))
    .map((a) => ({
      hotel_id: hotelId,
      acomodacion: a.acomodacion,
      pax_tarifa: Math.max(0, Math.trunc(a.pax_tarifa) || 0),
      pax_max: Math.max(0, Math.trunc(a.pax_max) || 0),
      adt_min: Math.max(0, Math.trunc(a.adt_min) || 0),
      adt_max: Math.max(0, Math.trunc(a.adt_max) || 0),
      chd_min: Math.max(0, Math.trunc(a.chd_min) || 0),
      chd_max: Math.max(0, Math.trunc(a.chd_max) || 0),
      inf_min: Math.max(0, Math.trunc(a.inf_min) || 0),
      inf_max: Math.max(0, Math.trunc(a.inf_max) || 0),
    }));
  if (filas.length) {
    const { error } = await sb
      .from("hotel_acomodaciones")
      .upsert(filas, { onConflict: "hotel_id,acomodacion" });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Temporadas y promociones del hotel ─────────────────────────────────────
// Las fechas SÍ se pueden cruzar: la `prioridad` decide cuál prima. Una promo es
// una temporada con tipo 'descuento_pct'/'descuento_monto' (o 'tarifa' de reemplazo).
type RangoFechasInput = { fecha_inicio: string; fecha_fin: string };

export type TemporadaInput = {
  hotelId: number;
  nombre: string;
  inicio: string;
  fin: string;
  prioridad?: number;
  compraInicio?: string;
  compraFin?: string;
  tipo?: string;                 // 'tarifa' | 'descuento_pct' | 'descuento_monto' | 'promo_noche_gratis'
  descuentoValor?: number | null;
  minNoches?: number;            // mínimo de noches de esta vigencia (o, en 'promo_noche_gratis', noches mínimas de la estadía para que aplique)
  regimenRestringido?: string | null; // null = aplica a todos los régimen
  rangos?: RangoFechasInput[];   // múltiples rangos de cobertura (Fase 4)
  blackouts?: RangoFechasInput[]; // fechas excluidas
  // Condición de pago (migración 164) — la restricción comercial NO es
  // seleccionable aquí: se deriva 100% implícita de condicionPagoTipo (ver
  // lib/cotizacion/condicionPagoCatalogo.ts).
  condicionPagoTipo?: unknown;
  condicionPagoPctInicial?: unknown; // 1–99, no fracción
  condicionPagoDiasSaldo?: unknown;
  // #43/#60 entrega 4: elección explícita de las promociones nuevas (ver lib/hoteles/promocionesVigencia.ts).
  descuentoUnidad?: UnidadMonto | null;
  nocheGratisRegla?: ReglaNocheGratis | null;
  diasPromo?: EleccionDias;
};

// Valida y normaliza una lista de rangos (fin >= inicio). Devuelve [] si no hay.
function limpiarRangos(rs?: RangoFechasInput[]): { ok: true; rangos: RangoFechasInput[] } | { ok: false; error: string } {
  const out: RangoFechasInput[] = [];
  for (const r of rs ?? []) {
    const i = (r?.fecha_inicio ?? "").trim();
    const f = (r?.fecha_fin ?? "").trim();
    if (!i && !f) continue;                 // fila vacía: se ignora
    if (!i || !f) return { ok: false, error: "Cada rango necesita fecha de inicio y fin." };
    if (f < i) return { ok: false, error: "En un rango la fecha final no puede ser menor que la inicial." };
    out.push({ fecha_inicio: i, fecha_fin: f });
  }
  return { ok: true, rangos: out };
}

function payloadTemporada(
  input: TemporadaInput,
  rangos: RangoFechasInput[],
  blackouts: RangoFechasInput[],
  condicion: { condicion_pago_tipo: string; condicion_pago_pct_inicial: number | null; condicion_pago_dias_saldo: number | null },
  promo: ColumnasPromo,
) {
  const tipo = input.tipo ?? "tarifa";
  // fecha_inicio/fin = primer rango (compatibilidad y diagnóstico); el motor usa 'rangos' si hay.
  const principal = rangos[0] ?? { fecha_inicio: input.inicio, fecha_fin: input.fin };
  return {
    nombre: input.nombre.trim(),
    fecha_inicio: principal.fecha_inicio,
    fecha_fin: principal.fecha_fin,
    prioridad: Math.max(1, Math.trunc(Number(input.prioridad) || 1)),
    compra_inicio: input.compraInicio || null,
    compra_fin: input.compraFin || null,
    tipo,
    descuento_valor: (tipo === "descuento_pct" || tipo === "descuento_monto") ? Number(input.descuentoValor) || 0 : null,
    min_noches: Math.max(1, Math.trunc(Number(input.minNoches) || 1)),
    regimen_restringido: oNull(input.regimenRestringido ?? ""),
    rangos: rangos as unknown as Json,
    blackouts: blackouts as unknown as Json,
    condicion_pago_tipo: condicion.condicion_pago_tipo,
    condicion_pago_pct_inicial: condicion.condicion_pago_pct_inicial,
    condicion_pago_dias_saldo: condicion.condicion_pago_dias_saldo,
    ...promo,
  };
}

// `previas` = fechas ya guardadas (solo al editar): lo que no cambia no se vuelve a juzgar, así una vigencia histórica se
// puede seguir editando. La validación de fechas (#43) vive en lib/hoteles/validarFechasVigencia.ts y es la misma del formulario.
function validarTemporada(input: TemporadaInput, previas?: FechasVigencia | null): {
  ok: true;
  rangos: RangoFechasInput[];
  blackouts: RangoFechasInput[];
  condicion: { condicion_pago_tipo: string; condicion_pago_pct_inicial: number | null; condicion_pago_dias_saldo: number | null };
} | { ok: false; error: string } {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const fechas = validarFechasVigencia(
    { inicio: input.inicio, fin: input.fin, rangos: input.rangos, blackouts: input.blackouts, compraInicio: input.compraInicio, compraFin: input.compraFin },
    { anioVigente: anioVigenteBogota(), previas },
  );
  if (!fechas.ok) return { ok: false, error: fechas.error };
  // El rango principal (inicio/fin) se suma a la lista de rangos.
  const todos = [{ fecha_inicio: input.inicio, fecha_fin: input.fin }, ...(input.rangos ?? [])];
  const rr = limpiarRangos(todos);
  if (!rr.ok) return rr;
  if (!rr.rangos.length) return { ok: false, error: "Debes indicar al menos un rango de fechas (inicio y fin)." };
  const bb = limpiarRangos(input.blackouts);
  if (!bb.ok) return bb;
  // Un black-out solo tiene sentido DENTRO de la vigencia de viaje: debe quedar
  // contenido en alguno de los rangos de cobertura.
  for (const bo of bb.rangos) {
    const dentro = rr.rangos.some((r) => bo.fecha_inicio >= r.fecha_inicio && bo.fecha_fin <= r.fecha_fin);
    if (!dentro) {
      return { ok: false, error: `El black-out ${bo.fecha_inicio} → ${bo.fecha_fin} está fuera de la vigencia de viaje. Debe estar dentro de un rango de fechas.` };
    }
  }
  const tipo = input.tipo ?? "tarifa";
  if ((tipo === "descuento_pct" || tipo === "descuento_monto") && !(Number(input.descuentoValor) > 0)) {
    return { ok: false, error: "Una promoción de descuento necesita un valor (% o monto) mayor a 0." };
  }
  if (input.compraInicio && input.compraFin && input.compraFin < input.compraInicio) {
    return { ok: false, error: "La vigencia de compra: la fecha final no puede ser menor que la inicial." };
  }
  const cp = validarCondicionPago(
    {
      tipo: input.condicionPagoTipo ?? "sin_condicion",
      pctInicial: input.condicionPagoPctInicial,
      diasSaldo: input.condicionPagoDiasSaldo,
    } satisfies CondicionPagoEntrada,
    "hotel",
  );
  if (!cp.ok) return { ok: false, error: cp.error };
  return { ok: true, rangos: rr.rangos, blackouts: bb.rangos, condicion: cp.value };
}

export async function crearTemporada(input: TemporadaInput): Promise<Result> {
  const v = validarTemporada(input);
  if (!v.ok) return v;
  const p = validarCamposPromo({ ...input, tipo: input.tipo ?? "tarifa" }, null);
  if (!p.ok) return p;
  const sb = await createClient();
  const { data: creada, error } = await sb.from("hotel_temporadas").insert({
    hotel_id: input.hotelId,
    ...payloadTemporada(input, v.rangos, v.blackouts, v.condicion, p.columnas),
  }).select("id").maybeSingle();
  if (error) return { ok: false, error: mensajePromo300(error.message) ?? sinPrefijoEmpate(error.message) };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  await regenerarTarifariosDeHotel(input.hotelId);
  // Una promoción nueva que coincide con EBB / Long Stay nace pendiente (la 301): se avisa. Una tarifa no se consulta.
  const aviso = creada?.id != null && (input.tipo ?? "tarifa") !== "tarifa" ? await avisoPendiente(sb, creada.id) : undefined;
  return { ok: true, ...(creada?.id != null ? { id: creada.id } : {}), ...(aviso ? { aviso } : {}) };
}

// `_hotelIdSolicitado` (segundo parámetro histórico, la UI sigue mandándolo
// — no se toca la UI en esta corrección) NUNCA es la autoridad: un hotelId
// suministrado por el llamador podía divergir del hotel REAL de la fila
// (ej. un origen del clic desincronizado del hotel actual de la página). El
// `hotel_id` real sale de la MISMA fila que se borra (`.delete().select()`,
// autoritativo por construcción) — revalidación y regeneración usan
// SIEMPRE ese valor, nunca el parámetro. Si la fila ya no existe, falla
// explícito: nunca se regenera un hotel inventado.
export async function eliminarTemporada(id: number, _hotelIdSolicitado: number): Promise<Result> {
  void _hotelIdSolicitado; // deliberadamente sin usar — ver la nota arriba
  const sb = await createClient();
  const { data: borrada, error } = await sb
    .from("hotel_temporadas")
    .delete()
    .eq("id", id)
    .select("hotel_id")
    .maybeSingle();
  // #43/#60: una vigencia con grupos preparados no se borra (FK de la 293): mensaje claro en vez del error de la base.
  if (error) return { ok: false, error: mensajeBorrarVigenciaConGrupos(error) ?? mensajePromo300(error.message) ?? error.message };
  if (!borrada) return { ok: false, error: "No se encontró la temporada a eliminar (0 filas afectadas)." };
  const hotelId = borrada.hotel_id;
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  await regenerarTarifariosDeHotel(hotelId);
  return { ok: true };
}

// Copia TODAS las temporadas/vigencias de otro hotel al hotel actual (como copias
// independientes). Útil para cadenas con la misma configuración. No borra ni toca
// las del hotel origen.
export async function copiarTemporadasDesdeHotel(
  hotelDestino: number,
  hotelOrigen: number,
): Promise<{ ok: true; copiadas: number; omitidas?: string[]; avisos?: string[] } | { ok: false; error: string }> {
  if (!hotelOrigen || hotelDestino === hotelOrigen) return { ok: false, error: "Elige un hotel de origen distinto." };
  const sb = await createClient();
  // Se copian TODOS los campos de la vigencia, incluida su condición de pago
  // (migración 164) — una cadena con la misma política de anticipo/pago total
  // en varios hoteles no debería tener que re-configurarla a mano en cada uno.
  const { data: origen, error: e1 } = await sb
    .from("hotel_temporadas")
    .select(
      "nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, orden, min_noches, regimen_restringido, condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo, descuento_unidad, noche_gratis_regla, dias_promo, promo_base_id"
    )
    .eq("hotel_id", hotelOrigen);
  if (e1) return { ok: false, error: e1.message };
  if (!origen?.length) return { ok: false, error: "El hotel de origen no tiene temporadas para copiar." };
  // #43: copiar CREA vigencias, así que rige la misma validación de fechas. Las que no la cumplen (año anterior al vigente,
  // fecha inexistente…) NO se copian ni se corrigen: se informan por nombre para que se revisen en el hotel de origen.
  const anioVigente = anioVigenteBogota();
  const omitidas: string[] = [];
  const copiables = origen.filter((t) => {
    const r = validarFechasVigencia(fechasGuardadas(t), { anioVigente });
    if (!r.ok) omitidas.push(`${t.nombre}: ${r.error}`);
    return r.ok;
  });
  if (!copiables.length) return { ok: false, error: `Ninguna vigencia del hotel de origen se puede crear con las reglas de fechas vigentes. ${omitidas.join(" · ")}` };
  // #43/#60 (300): la noche bonificada, la unidad y los días viajan con la vigencia. El vínculo a una base y sus
  // reglas por grupo son de ESTE hotel (ids): la copia queda sin vínculo y se informa para configurarla allá.
  const avisos: string[] = [];
  const filas = copiables.map(({ promo_base_id, ...t }) => {
    if (promo_base_id != null) avisos.push(`${t.nombre}: se copió sin sus reglas por grupo; configúralas en el hotel destino`);
    return { ...t, hotel_id: hotelDestino };
  });
  const { error } = await sb.from("hotel_temporadas").insert(filas);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelDestino}`);
  await regenerarTarifariosDeHotel(hotelDestino);
  return { ok: true, copiadas: filas.length, ...(omitidas.length ? { omitidas } : {}), ...(avisos.length ? { avisos } : {}) };
}

// Al renombrar una temporada, `tarifa_hotel.temporada` y `hotel_calculadora.params`
// (bases/promos) la referencian por STRING — no hay FK. Sin este cascade, cambiar
// el nombre "huerfanea" TODA la tarifa ya cargada bajo el nombre viejo (deja de
// matchear en tarifario/reservar, obligando a recargarla) y, si el hotel tiene
// calculadora configurada, la próxima vez que se generen tarifas se vuelve a
// escribir el nombre viejo (el bug reaparece).
//
// ⚠️ RIESGO RESIDUAL (documentado, NO resuelto en esta ronda): esta función
// NO es transaccional. Hace 3 operaciones de escritura separadas (update de
// `tarifa_hotel`, select + update opcional de `hotel_calculadora`) y algunas
// de las llamadas que la rodean (`regenerarTarifariosDeHotel` en particular)
// son best-effort por diseño. Un fallo a mitad de camino (ej. se renombran
// las tarifas pero falla el update de la calculadora, o el proceso muere
// entre pasos) puede dejar el hotel en un estado parcialmente renombrado sin
// que el llamador se entere más allá del `aviso`/log puntual de ese paso. La
// solución correcta requeriría diseñar una operación atómica separada (ej.
// una función de Postgres que agrupe las 3 escrituras en una sola
// transacción, al estilo de `reemplazar_tarifas_hotel_calculadora` de la
// migración 179) — deliberadamente fuera de alcance aquí: no se improvisa una
// migración nueva en esta ronda.
async function renombrarTemporadaEnDatos(
  sb: Awaited<ReturnType<typeof createClient>>,
  hotelId: number,
  nombreViejo: string,
  nombreNuevo: string,
): Promise<{ tarifasRenombradas: number; calculadoraActualizada: boolean; calculadoraSinActualizar: boolean }> {
  const { data: tarifasAfectadas } = await sb
    .from("tarifa_hotel")
    .update({ temporada: nombreNuevo })
    .eq("hotel_id", hotelId)
    .eq("temporada", nombreViejo)
    .select("id");
  const tarifasRenombradas = tarifasAfectadas?.length ?? 0;

  let calculadoraActualizada = false, calculadoraSinActualizar = false;
  const { data: calc } = await sb.from("hotel_calculadora").select("tipo, params, version").eq("hotel_id", hotelId).maybeSingle();
  if (calc?.params) {
    const params = calc.params as Record<string, unknown>;
    // Incluye `bases_por_regimen` (valores por régimen de Mixta, #26). Las bases por grupo (297) no
    // guardan el nombre de la vigencia: no se tocan.
    const cambio = renombrarTemporadaEnParams(calc.tipo, params, nombreViejo, nombreNuevo);
    if (cambio) {
      // Condicionada a la versión leída (297): si otra persona guardó la calculadora entre la lectura y
      // esta escritura, NO se pisa su cambio (0 filas) y se avisa. Sin reintento automático.
      const { data: escrita, error } = await sb.from("hotel_calculadora")
        .update({ params: params as unknown as Json })
        .eq("hotel_id", hotelId).eq("version", calc.version)
        .select("version");
      calculadoraActualizada = !error && (escrita?.length ?? 0) > 0;
      calculadoraSinActualizar = !calculadoraActualizada;
    }
  }
  return { tarifasRenombradas, calculadoraActualizada, calculadoraSinActualizar };
}

// `input.hotelId` (el hotel de la página desde la que se editó) NUNCA es la
// autoridad para la cascada de renombre ni para la regeneración. La autoridad
// sale de una LECTURA previa a la fila (`nombre, hotel_id`, con su propio
// `error` capturado explícitamente) — si esa lectura falla o la fila no
// existe, se retorna ANTES de tocar el `update`. El `hotel_id` leído ahí se
// usa además para ACOTAR el propio `update` (`.eq("id", id).eq("hotel_id",
// hotelId)`, no solo `.eq("id", id)`), y se vuelve a pedir de vuelta en el
// `.select("hotel_id")` del update para confirmar explícitamente que la fila
// que se acaba de actualizar sigue perteneciendo al mismo hotel que la
// lectura previa — si algo movió la fila de hotel entre la lectura y el
// update, el filtro hace que el update afecte 0 filas y esta función falla
// explícito en vez de regenerar el hotel equivocado. `input.hotelId` se sigue
// usando para `validarTemporada`/`payloadTemporada` (no lo leen) y se
// mantiene en el tipo compartido con `crearTemporada` (ahí sí es autoritativo:
// es un INSERT, no hay fila previa de la que discrepar) — no se amplía el
// alcance tocando ese tipo ni el formulario que lo llena.
/**
 * `combinacion` (entrega 5): el cambio de una promoción que se vende creó una coincidencia con EBB / Long Stay sin configurar
 * (`requiereCombinacion`); se reenvía el MISMO cambio con la combinación y los dos se guardan en una transacción (RPC
 * `promocion_guardar_combinacion`). Sin ella, el update de siempre.
 */
export async function actualizarTemporada(id: number, input: TemporadaInput, combinacion?: CombinacionEntrada): Promise<Result> {
  const sb = await createClient();
  // La misma lectura de siempre (una sola), ampliada con las fechas guardadas: la validación de fechas necesita saber cuáles NO
  // cambian para dejar editar una vigencia histórica sin tocar sus fechas antiguas (#43). Sin lecturas ni escrituras adicionales.
  const { data: actual, error: eActual } = await sb
    .from("hotel_temporadas")
    .select("nombre, hotel_id, fecha_inicio, fecha_fin, rangos, blackouts, compra_inicio, compra_fin, tipo, descuento_unidad, noche_gratis_regla")
    .eq("id", id)
    .maybeSingle();
  if (eActual) return { ok: false, error: eActual.message };
  if (!actual) return { ok: false, error: "No se encontró la temporada a actualizar." };
  const v = validarTemporada(input, fechasGuardadas(actual));
  if (!v.ok) return v;
  const p = validarCamposPromo({ ...input, tipo: input.tipo ?? "tarifa" }, actual);
  if (!p.ok) return p;
  const hotelId = actual.hotel_id;
  const nombreViejo = actual.nombre?.trim() ?? "";

  const payload = payloadTemporada(input, v.rangos, v.blackouts, v.condicion, p.columnas);
  if (combinacion) {
    const sinPermiso = await sinPermisoProducto(sb);
    if (sinPermiso) return { ok: false, error: sinPermiso };
    const c = validarCombinacion(combinacion);
    if (!c.ok) return c;
    const { error } = await sb.rpc("promocion_guardar_combinacion", {
      p_promocion_id: id, p_combinacion: c.valor as unknown as Json,
      p_cambios: payload as unknown as Json,
    });
    if (error) return { ok: false, error: mensajePromo300(error.message) ?? sinPrefijoEmpate(error.message) };
  } else {
    const { data: actualizada, error } = await sb.from("hotel_temporadas")
      .update(payloadTemporada(input, v.rangos, v.blackouts, v.condicion, p.columnas))
      .eq("id", id)
      .eq("hotel_id", hotelId)
      .select("hotel_id")
      .maybeSingle();
    if (error) {
      if (!/COMBINACION_SIN_CONFIGURAR:/.test(error.message)) return { ok: false, error: mensajePromo300(error.message) ?? sinPrefijoEmpate(error.message) };
      // P3: el cambio se GUARDA como pendiente (persistente, revisable al reabrir); la versión autorizada sigue vendiéndose.
      const prop = await sb.rpc("promocion_cambio_proponer", { p_promocion_id: id, p_cambios: payload as unknown as Json });
      if (prop.error) return { ok: false, error: mensajePromo300(prop.error.message) ?? sinPrefijoEmpate(prop.error.message) };
      const res = prop.data as { estado?: string; faltan?: ("ebb" | "long_stay")[] } | null;
      if (res?.estado === "pendiente") {
        // Familias a responder al activar: las que faltan + las que ya tenía resueltas (la RPC pide todas las que coinciden).
        const { data: cb } = await sb.from("hotel_promocion_combinacion").select("alternativas").eq("promocion_id", id).maybeSingle();
        const familias = (["ebb", "long_stay"] as const).filter((f) => (cb?.alternativas ?? []).includes(f) || (res.faltan ?? []).includes(f));
        revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
        return { ok: true, cambioPendiente: { promocionId: id, familias: [...familias] },
          aviso: `El cambio quedó PENDIENTE de activar: puede coincidir con ${textoFamilias(res.faltan ?? [])} y falta configurar, según el proveedor, si acumula y en qué orden. Se sigue vendiendo la versión autorizada; actívalo o descártalo en «Promociones del hotel».` };
      }
      // `aplicada`: entre medias dejó de faltar configuración y la RPC aplicó el cambio; sigue el camino de siempre.
    } else if (!actualizada) return { ok: false, error: "No se encontró la temporada a actualizar (0 filas afectadas)." };
    else if (actualizada.hotel_id !== hotelId) {
      console.error(`actualizarTemporada: hotel_id divergente entre la lectura (${hotelId}) y el update (${actualizada.hotel_id}) para temporada id=${id}`);
      return { ok: false, error: "La temporada cambió de hotel durante la operación; vuelve a intentarlo." };
    }
  }

  let aviso: string | undefined;
  const nombreNuevo = input.nombre.trim();
  if (nombreViejo && nombreNuevo && nombreViejo !== nombreNuevo) {
    const r = await renombrarTemporadaEnDatos(sb, hotelId, nombreViejo, nombreNuevo);
    if (r.tarifasRenombradas > 0 || r.calculadoraActualizada) {
      const partes = [
        r.tarifasRenombradas > 0 ? `${r.tarifasRenombradas} tarifa(s) ya cargadas` : null,
        r.calculadoraActualizada ? "la calculadora del hotel" : null,
      ].filter(Boolean);
      aviso = `Se actualizó de "${nombreViejo}" a "${nombreNuevo}" en: ${partes.join(" y ")}.`;
    }
    if (r.calculadoraSinActualizar) {
      aviso = `${aviso ? `${aviso} ` : ""}La calculadora del hotel NO se actualizó (alguien la guardó al mismo tiempo): ábrela, revisa que sus bases digan "${nombreNuevo}" y guárdala.`;
    }
  }

  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  await regenerarTarifariosDeHotel(hotelId);
  const pend = (input.tipo ?? "tarifa") !== "tarifa" ? await avisoPendiente(sb, id) : undefined;
  return { ok: true, aviso: [aviso, pend].filter(Boolean).join(" ") || undefined };
}

async function sinPermisoProducto(sb: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data: rol, error } = await sb.rpc("mi_rol");
  if (error) return "No se pudo verificar tu permiso. Intenta de nuevo.";
  return puedeEscribir("producto", (rol as string | null) ?? null) ? null : "No tienes permiso para configurar promociones de este hotel.";
}

/** Aviso si la promoción quedó pendiente de configurar (no se vende hasta responder la combinación). */
async function avisoPendiente(sb: Awaited<ReturnType<typeof createClient>>, id: number): Promise<string | undefined> {
  const { data } = await sb.from("hotel_promocion_combinacion").select("estado, alternativas").eq("promocion_id", id).maybeSingle();
  if (data?.estado !== "pendiente") return undefined;
  return `La promoción puede coincidir con ${textoFamilias(data.alternativas)}: no se venderá hasta configurar, según el proveedor, si acumula y en qué orden (Promociones del hotel).`;
}

/**
 * P3: activa el cambio PENDIENTE de una promoción (con su combinación si hace falta). La RPC valida en una transacción que siga
 * pendiente, que la promoción no haya cambiado desde que se propuso y que no queden pares sin resolver ni contradicciones.
 */
export async function activarCambioPromocion(promocionId: number, combinacion?: CombinacionEntrada): Promise<Result> {
  const sb = await createClient();
  const sinPermiso = await sinPermisoProducto(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  let comb: Json | null = null;
  if (combinacion) { const c = validarCombinacion(combinacion); if (!c.ok) return c; comb = c.valor as unknown as Json; }
  const { data: antes, error: eAntes } = await sb.from("hotel_temporadas").select("nombre, hotel_id").eq("id", promocionId).maybeSingle();
  if (eAntes) return { ok: false, error: eAntes.message };
  if (!antes) return { ok: false, error: "La promoción ya no existe." };
  const { error } = await sb.rpc("promocion_cambio_activar", { p_promocion_id: promocionId, p_combinacion: comb });
  if (error) return { ok: false, error: mensajePromo300(error.message) ?? sinPrefijoEmpate(error.message) };
  // El cambio activado puede renombrar la promoción: mismo arrastre del nombre que un guardado normal.
  let aviso: string | undefined;
  const { data: despues } = await sb.from("hotel_temporadas").select("nombre").eq("id", promocionId).maybeSingle();
  const viejo = antes.nombre?.trim() ?? "", nuevo = despues?.nombre?.trim() ?? "";
  if (viejo && nuevo && viejo !== nuevo) {
    const r = await renombrarTemporadaEnDatos(sb, antes.hotel_id, viejo, nuevo);
    if (r.calculadoraSinActualizar) aviso = `La calculadora del hotel NO se actualizó al nuevo nombre "${nuevo}": ábrela, revisa sus bases y guárdala.`;
  }
  revalidatePath(`/dashboard/producto/hoteles/${antes.hotel_id}`);
  await regenerarTarifariosDeHotel(antes.hotel_id);
  return { ok: true, aviso };
}

/** P3: descarta el cambio pendiente de una promoción (la versión autorizada no cambia). */
export async function descartarCambioPromocion(promocionId: number): Promise<Result> {
  const sb = await createClient();
  const sinPermiso = await sinPermisoProducto(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { error } = await sb.rpc("promocion_cambio_descartar", { p_promocion_id: promocionId });
  if (error) return { ok: false, error: mensajePromo300(error.message) ?? error.message };
  const { data: t } = await sb.from("hotel_temporadas").select("hotel_id").eq("id", promocionId).maybeSingle();
  if (t?.hotel_id) revalidatePath(`/dashboard/producto/hoteles/${t.hotel_id}`);
  return { ok: true };
}

/**
 * Entrega 5: guarda la combinación de una promoción con EBB / Long Stay. Con `cambios`, guarda en la MISMA transacción el cambio de
 * la promoción que la necesitaba (lo que `actualizarTemporada` rechazó con `requiereCombinacion`).
 */
export async function guardarCombinacionPromocion(promocionId: number, combinacion: CombinacionEntrada, cambios?: TemporadaInput): Promise<Result> {
  if (cambios) return actualizarTemporada(promocionId, cambios, combinacion);
  const sb = await createClient();
  const sinPermiso = await sinPermisoProducto(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const c = validarCombinacion(combinacion);
  if (!c.ok) return c;
  const { error } = await sb.rpc("promocion_guardar_combinacion", { p_promocion_id: promocionId, p_combinacion: c.valor as unknown as Json });
  if (error) return { ok: false, error: mensajePromo300(error.message) ?? sinPrefijoEmpate(error.message) };
  const { data: t } = await sb.from("hotel_temporadas").select("hotel_id").eq("id", promocionId).maybeSingle();
  if (t?.hotel_id) { revalidatePath(`/dashboard/producto/hoteles/${t.hotel_id}`); await regenerarTarifariosDeHotel(t.hotel_id); }
  return { ok: true };
}

// ── Tarifa neta del hotel ─────────────────────────────────────────────────
export async function crearTarifa(input: {
  hotelId: number;
  tipoHabitacion: string;
  alimentacion: string;
  temporada: string;
  netoSencilla: number | null;
  netoDoble: number | null;
  netoTriple: number | null;
  netoMultiple: number | null;
  netoNino: number | null;
  netoNino2: number | null;
  netoInfante?: number | null;
  notaInfante?: string | null;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("tarifa_hotel").insert({
    hotel_id: input.hotelId,
    tipo_habitacion: oNull(input.tipoHabitacion),
    alimentacion: oNull(input.alimentacion),
    temporada: oNull(input.temporada),
    neto_sencilla: input.netoSencilla,
    neto_doble: input.netoDoble,
    neto_triple: input.netoTriple,
    neto_multiple: input.netoMultiple,
    neto_nino: input.netoNino,
    neto_nino2: input.netoNino2,
    neto_infante: input.netoInfante ?? null,
    nota_infante: oNull(input.notaInfante ?? ""),
  });
  if (error) return { ok: false, error: sinPrefijoEmpate(error.message) };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  await regenerarTarifariosDeHotel(input.hotelId);
  return { ok: true };
}

// `_hotelIdSolicitado` (segundo parámetro histórico, la UI sigue mandándolo
// — no se toca la UI en esta corrección) NUNCA es la autoridad — mismo
// criterio que `eliminarTemporada`/`actualizarTemporada`: el `hotel_id` real
// sale de la fila efectivamente actualizada (`.update().select()`).
export async function actualizarTarifa(
  id: number,
  _hotelIdSolicitado: number,
  input: {
    tipoHabitacion: string;
    alimentacion: string;
    temporada: string;
    netoSencilla: number | null;
    netoDoble: number | null;
    netoTriple: number | null;
    netoMultiple: number | null;
    netoNino: number | null;
    netoNino2: number | null;
    netoInfante?: number | null;
    notaInfante?: string | null;
  }
): Promise<Result> {
  void _hotelIdSolicitado; // deliberadamente sin usar — ver la nota arriba
  const sb = await createClient();
  const { data: actualizada, error } = await sb
    .from("tarifa_hotel")
    .update({
      tipo_habitacion: oNull(input.tipoHabitacion),
      alimentacion: oNull(input.alimentacion),
      temporada: oNull(input.temporada),
      neto_sencilla: input.netoSencilla,
      neto_doble: input.netoDoble,
      neto_triple: input.netoTriple,
      neto_multiple: input.netoMultiple,
      neto_nino: input.netoNino,
      neto_nino2: input.netoNino2,
      neto_infante: input.netoInfante ?? null,
      nota_infante: oNull(input.notaInfante ?? ""),
    })
    .eq("id", id)
    .select("hotel_id")
    .maybeSingle();
  if (error) return { ok: false, error: sinPrefijoEmpate(error.message) };
  if (!actualizada) return { ok: false, error: "No se encontró la tarifa a actualizar (0 filas afectadas)." };
  const hotelId = actualizada.hotel_id;
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  await regenerarTarifariosDeHotel(hotelId);
  return { ok: true };
}

// `_hotelIdSolicitado`: ver la nota de `actualizarTarifa` arriba — mismo criterio.
export async function eliminarTarifa(id: number, _hotelIdSolicitado: number): Promise<Result> {
  void _hotelIdSolicitado; // deliberadamente sin usar — ver la nota arriba
  const sb = await createClient();
  const { data: borrada, error } = await sb
    .from("tarifa_hotel")
    .delete()
    .eq("id", id)
    .select("hotel_id")
    .maybeSingle();
  if (error) return { ok: false, error: sinPrefijoEmpate(error.message) };
  if (!borrada) return { ok: false, error: "No se encontró la tarifa a eliminar (0 filas afectadas)." };
  const hotelId = borrada.hotel_id;
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  await regenerarTarifariosDeHotel(hotelId);
  return { ok: true };
}

// ── Cargas masivas (CSV) ───────────────────────────────────────────────────
type CargaResult = { ok: boolean; insertados: number; errores: string[] };
const numCsv = (s?: string) => (s ? parseInt(String(s).replace(/[^\d-]/g, ""), 10) || 0 : 0);
const numCsvN = (s?: string) => (s && s.trim() !== "" ? numCsv(s) : null);

export async function cargarHotelesMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const [{ data: destinos }, { data: provs }, { data: cats }, { data: regs }, { data: rangos }] = await Promise.all([
    sb.from("destinos").select("id, nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "hotelero"),
    sb.from("categorias_habitacion").select("id, nombre"),
    sb.from("planes_alimentacion").select("id, codigo"),
    sb.from("rangos_edad").select("id, denominacion"),
  ]);
  const dmap = new Map((destinos ?? []).map((d) => [d.nombre.trim().toLowerCase(), d.id]));
  const pmap = new Map((provs ?? []).map((p) => [p.nombre.trim().toLowerCase(), p.id]));
  const cmap = new Map((cats ?? []).map((c) => [c.nombre.trim().toLowerCase(), c.id]));
  const rmap = new Map((regs ?? []).map((r) => [r.codigo.trim().toLowerCase(), r.id]));
  const remap = new Map((rangos ?? []).map((x) => [x.denominacion.trim().toLowerCase(), x.id]));
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.nombre || "").trim();
    if (!nombre) { errores.push(`Fila ${linea}: falta nombre.`); continue; }
    const destinoId = r.destino ? dmap.get(r.destino.trim().toLowerCase()) : undefined;
    if (!destinoId) { errores.push(`Fila ${linea} (${nombre}): destino "${r.destino ?? ""}" no existe.`); continue; }
    const provId = r.proveedor ? pmap.get(r.proveedor.trim().toLowerCase()) ?? null : null;
    const rangosEdad = (r.rangos_edad || "")
      .split(/[|;]/).map((x) => remap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    const { data: hotel, error } = await sb
      .from("hoteles")
      .insert({
        nombre, destino_id: destinoId, proveedor_id: provId, zona: oNull(r.zona || ""),
        edad_infante_min: numCsv(r.edad_infante_min) || 0, edad_infante_max: numCsv(r.edad_infante_max) || 2,
        edad_nino_min: numCsv(r.edad_nino_min) || 2, edad_nino_max: numCsv(r.edad_nino_max) || 10,
        rangos_edad: rangosEdad.length ? rangosEdad : null,
        pax_min: numCsvN(r.pax_min), pax_max: numCsvN(r.pax_max),
        contacto_telefono: oNull(r.contacto_telefono || ""), email_comercial: oNull(r.email_comercial || ""),
      })
      .select("id")
      .single();
    if (error || !hotel) { errores.push(`Fila ${linea} (${nombre}): ${error?.message ?? "no se insertó"}`); continue; }
    const catIds = (r.categorias || "").split(/[|;]/).map((x) => cmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    const regIds = (r.regimenes || "").split(/[|;]/).map((x) => rmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    if (catIds.length) await sb.from("hotel_categorias").insert(catIds.map((categoria_id) => ({ hotel_id: hotel.id, categoria_id })));
    if (regIds.length) await sb.from("hotel_regimenes").insert(regIds.map((plan_id) => ({ hotel_id: hotel.id, plan_id })));
    insertados++;
  }
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: errores.length === 0, insertados, errores };
}

export async function cargarTarifasMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const { data: hoteles } = await sb.from("hoteles").select("id, nombre, destino_id, destinos(nombre)");
  type HRow = { id: number; nombre: string; destino_id: number; destinos: { nombre: string } | null };
  const lista = (hoteles ?? []) as unknown as HRow[];
  const errores: string[] = [];
  let insertados = 0;
  const tocados = new Set<number>();
  const paraGrupos = new Map<string, { hotelId: number; temporada: string; filas: { linea: number; grupo: string; r: Record<string, string> }[] }>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.hotel || "").trim().toLowerCase();
    if (!nombre) { errores.push(`Fila ${linea}: falta hotel.`); continue; }
    let candidatos = lista.filter((h) => h.nombre.trim().toLowerCase() === nombre);
    if (candidatos.length > 1 && r.destino) {
      candidatos = candidatos.filter((h) => (h.destinos?.nombre ?? "").trim().toLowerCase() === r.destino.trim().toLowerCase());
    }
    if (!candidatos.length) { errores.push(`Fila ${linea}: hotel "${r.hotel}" no encontrado.`); continue; }
    if (candidatos.length > 1) { errores.push(`Fila ${linea}: hotel "${r.hotel}" está duplicado; agrega columna destino.`); continue; }
    // #43/#60 (299): con «grupo», la fila va al BORRADOR de ese grupo (se agrupa por vigencia y se escribe al final,
    // una RPC atómica por vigencia). Nunca se escribe una tarifa por grupo directo en la venta.
    if ((r.grupo ?? "").trim()) {
      const k = `${candidatos[0].id}\u001f${(r.temporada ?? "").trim()}`;
      const lote = paraGrupos.get(k) ?? { hotelId: candidatos[0].id, temporada: (r.temporada ?? "").trim(), filas: [] };
      lote.filas.push({ linea, grupo: r.grupo.trim(), r });
      paraGrupos.set(k, lote);
      continue;
    }
    const { error } = await sb.from("tarifa_hotel").insert({
      hotel_id: candidatos[0].id,
      tipo_habitacion: oNull(r.categoria || ""),
      alimentacion: oNull(r.regimen || ""),
      temporada: oNull(r.temporada || ""),
      neto_sencilla: numCsvN(r.neto_sencilla),
      neto_doble: numCsvN(r.neto_doble),
      neto_triple: numCsvN(r.neto_triple),
      neto_multiple: numCsvN(r.neto_multiple),
      neto_nino: numCsvN(r.neto_nino),
      neto_nino2: numCsvN(r.neto_nino2),
      neto_infante: numCsvN(r.neto_infante),
      nota_infante: oNull(r.nota_infante || ""),
    });
    if (error) {
      errores.push(`Fila ${linea} (${r.hotel}): ${/tiene tarifas por grupo de días|ya tiene tarifas por grupo/.test(error.message)
        ? `la temporada "${r.temporada}" se vende por grupos de días: indica en la columna «grupo» a qué grupo va la fila.`
        : error.message}`);
      continue;
    }
    insertados++;
    tocados.add(candidatos[0].id);
  }
  // Filas con grupo → borrador del grupo: 1 lectura de vigencias para todos los hoteles + 1 lectura y 1 RPC por vigencia.
  let alBorrador = 0;
  if (paraGrupos.size > 0) {
    const hotelesG = [...new Set([...paraGrupos.values()].map((l) => l.hotelId))];
    const { data: vigs, error: eVigs } = await sb.from("hotel_temporadas")
      .select("id, hotel_id, nombre, tipo, hotel_temporada_grupos(id, nombre)").in("hotel_id", hotelesG);
    for (const lote of paraGrupos.values()) {
      const lineas = lote.filas.map((f) => f.linea).join(", ");
      if (eVigs) { errores.push(`Filas ${lineas}: no se pudieron leer las temporadas (${eVigs.message}).`); continue; }
      const cands = (vigs ?? []).filter((v) => v.hotel_id === lote.hotelId && v.nombre.trim() === lote.temporada && (v.tipo ?? "tarifa") === "tarifa");
      if (cands.length !== 1) { errores.push(`Filas ${lineas}: la temporada "${lote.temporada}" ${cands.length ? "está repetida" : "no existe"} en el hotel.`); continue; }
      const grupos = (cands[0].hotel_temporada_grupos ?? []) as { id: string; nombre: string }[];
      const filas: Record<string, unknown>[] = [];
      let malas = false;
      for (const { linea, grupo, r } of lote.filas) {
        const g = grupos.find((x) => x.nombre.trim().toLowerCase() === grupo.toLowerCase());
        if (!g) { errores.push(`Fila ${linea}: la temporada "${lote.temporada}" no tiene el grupo "${grupo}".`); malas = true; continue; }
        // Sin ningún neto, la RPC lo leería como «quitar esta combinación del borrador»: un CSV nunca borra.
        if (["neto_sencilla", "neto_doble", "neto_triple", "neto_multiple", "neto_nino", "neto_nino2", "neto_infante"].every((c) => numCsvN(r[c]) == null)) {
          errores.push(`Fila ${linea}: no trae ningún neto (una fila del CSV no quita combinaciones del borrador).`); malas = true; continue;
        }
        filas.push({
          grupo_id: g.id, tipo_habitacion: (r.categoria ?? "").trim(), alimentacion: (r.regimen ?? "").trim(),
          neto_sencilla: numCsvN(r.neto_sencilla), neto_doble: numCsvN(r.neto_doble), neto_triple: numCsvN(r.neto_triple),
          neto_multiple: numCsvN(r.neto_multiple), neto_nino: numCsvN(r.neto_nino), neto_nino2: numCsvN(r.neto_nino2),
          neto_infante: numCsvN(r.neto_infante), origen_tarifa_id: null,
          ...((r.nota_infante ?? "").trim() ? { nota_infante: r.nota_infante.trim() } : {}),
        });
      }
      if (malas) continue;   // la vigencia entera se rechaza: el lote de un borrador es atómico
      const { data: cfg, error: eCfg } = await sb.rpc("grupos_dias_config", { p_temporada_id: cands[0].id });
      const huella = (cfg as { huella?: string } | null)?.huella;
      if (eCfg || !huella) { errores.push(`Filas ${lineas}: ${eCfg?.message ?? "no se pudo leer la configuración de grupos"}.`); continue; }
      const { error: eProp } = await sb.rpc("grupos_dias_guardar_propuesta", {
        p_temporada_id: cands[0].id, p_huella: huella, p_modo: "actualizar", p_grupo_id: null, p_filas: filas as unknown as Json,
      });
      if (eProp) { errores.push(`Filas ${lineas} (${lote.temporada}): ${eProp.message.replace(/^[A-Z][A-Z_]{5,}:\s*/, "")}`); continue; }
      alBorrador += filas.length;
    }
    if (alBorrador > 0) errores.push(`Aviso: ${alBorrador} fila(s) fueron al borrador de sus grupos de días. No se venden hasta revisarlas y aplicarlas en «Grupos de días».`);
  }
  revalidatePath("/dashboard/producto/hoteles");
  { const inicioRegen = Date.now(); for (const hid of tocados) await regenerarTarifariosDeHotel(hid, inicioRegen); }
  return { ok: errores.length === 0 || errores.every((e) => e.startsWith("Aviso:")), insertados: insertados + alBorrador, errores };
}

// Carga masiva de TEMPORADAS del hotel (nombre + rango de fechas). Es la info que
// le faltaba al cargue de tarifas: aquí se definen las FECHAS de cada temporada.
// Mismo criterio que el formulario manual: las fechas no pueden cruzarse.
export async function cargarTemporadasMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const { data: hoteles } = await sb.from("hoteles").select("id, nombre, destino_id, destinos(nombre)");
  type HRow = { id: number; nombre: string; destino_id: number; destinos: { nombre: string } | null };
  const lista = (hoteles ?? []) as unknown as HRow[];
  const errores: string[] = [];
  let insertados = 0;
  const tocados = new Set<number>();
  const reFecha = /^\d{4}-\d{2}-\d{2}$/;
  const anioVigente = anioVigenteBogota();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const hotelNombre = (r.hotel || "").trim().toLowerCase();
    const nombre = (r.temporada || "").trim();
    const inicio = (r.fecha_inicio || "").trim();
    const fin = (r.fecha_fin || "").trim();
    if (!hotelNombre) { errores.push(`Fila ${linea}: falta hotel.`); continue; }
    if (!nombre) { errores.push(`Fila ${linea}: falta el nombre de la temporada.`); continue; }
    if (!reFecha.test(inicio) || !reFecha.test(fin)) { errores.push(`Fila ${linea} (${r.temporada}): las fechas deben ir como AAAA-MM-DD.`); continue; }
    if (fin < inicio) { errores.push(`Fila ${linea} (${r.temporada}): la fecha final no puede ser menor que la inicial.`); continue; }

    let candidatos = lista.filter((h) => h.nombre.trim().toLowerCase() === hotelNombre);
    if (candidatos.length > 1 && r.destino) {
      candidatos = candidatos.filter((h) => (h.destinos?.nombre ?? "").trim().toLowerCase() === r.destino.trim().toLowerCase());
    }
    if (!candidatos.length) { errores.push(`Fila ${linea}: hotel "${r.hotel}" no encontrado.`); continue; }
    if (candidatos.length > 1) { errores.push(`Fila ${linea}: hotel "${r.hotel}" duplicado; agrega columna destino.`); continue; }
    const hotelId = candidatos[0].id;

    // Verifica solapamiento (incluye las temporadas insertadas en filas previas).
    const { data: existentes } = await sb
      .from("hotel_temporadas")
      .select("nombre, fecha_inicio, fecha_fin")
      .eq("hotel_id", hotelId);
    // Solo se omite el duplicado EXACTO (mismo nombre + mismas fechas).
    // Los cruces de fechas ahora son válidos (la prioridad decide cuál prima).
    let saltar = false;
    for (const e of existentes ?? []) {
      if (e.nombre?.trim().toLowerCase() === nombre.toLowerCase() && e.fecha_inicio === inicio && e.fecha_fin === fin) {
        saltar = true; break;
      }
    }
    if (saltar) continue;

    const ci = (r.compra_inicio || "").trim();
    const cf = (r.compra_fin || "").trim();
    // #43: esta fila CREA una vigencia (el duplicado exacto histórico ya se omitió arriba): fechas reales, sin años anteriores
    // al vigente y, si la fila trae compra, también válida — antes una compra mal escrita se descartaba en silencio (= siempre abierta).
    const fechasOk = validarFechasVigencia({ inicio, fin, compraInicio: ci, compraFin: cf }, { anioVigente });
    if (!fechasOk.ok) { errores.push(`Fila ${linea} (${nombre}): ${fechasOk.error}`); continue; }
    const { error } = await sb.from("hotel_temporadas").insert({
      hotel_id: hotelId, nombre, fecha_inicio: inicio, fecha_fin: fin,
      prioridad: Math.max(1, numCsv(r.prioridad) || 1),
      compra_inicio: reFecha.test(ci) ? ci : null,
      compra_fin: reFecha.test(cf) ? cf : null,
    });
    if (error) { errores.push(`Fila ${linea} (${nombre}): ${error.message}`); continue; }
    insertados++;
    tocados.add(hotelId);
  }
  revalidatePath("/dashboard/producto/hoteles");
  { const inicioRegen = Date.now(); for (const hid of tocados) await regenerarTarifariosDeHotel(hid, inicioRegen); }
  return { ok: errores.length === 0, insertados, errores };
}

// Carga masiva de ACOMODACIONES por hotel ("reservar por habitaciones"): pax que
// cubre la tarifa de 1 habitación, pax máx por habitación y mín/máx de
// adultos/niños/infantes. Una fila = una acomodación (sencilla/doble/triple/múltiple).
export async function cargarAcomodacionesMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const { data: hoteles } = await sb.from("hoteles").select("id, nombre, destinos(nombre)");
  type HRow = { id: number; nombre: string; destinos: { nombre: string } | null };
  const lista = (hoteles ?? []) as unknown as HRow[];
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const hotelNombre = (r.hotel || "").trim().toLowerCase();
    const acom = (r.acomodacion || "").trim().toLowerCase() as AcomRoom;
    if (!hotelNombre) { errores.push(`Fila ${linea}: falta hotel.`); continue; }
    if (!ACOM_ROOMS.includes(acom)) { errores.push(`Fila ${linea}: acomodación "${r.acomodacion}" inválida (usa: ${ACOM_ROOMS.join(", ")}).`); continue; }
    let candidatos = lista.filter((h) => h.nombre.trim().toLowerCase() === hotelNombre);
    if (candidatos.length > 1 && r.destino) {
      candidatos = candidatos.filter((h) => (h.destinos?.nombre ?? "").trim().toLowerCase() === r.destino.trim().toLowerCase());
    }
    if (!candidatos.length) { errores.push(`Fila ${linea}: hotel "${r.hotel}" no encontrado.`); continue; }
    if (candidatos.length > 1) { errores.push(`Fila ${linea}: hotel "${r.hotel}" duplicado; agrega columna destino.`); continue; }

    const fila = {
      hotel_id: candidatos[0].id,
      acomodacion: acom,
      pax_tarifa: numCsv(r.pax_tarifa) || 0,
      pax_max: numCsv(r.pax_max) || 0,
      adt_min: numCsv(r.adt_min) || 0, adt_max: numCsv(r.adt_max) || 0,
      chd_min: numCsv(r.chd_min) || 0, chd_max: numCsv(r.chd_max) || 0,
      inf_min: numCsv(r.inf_min) || 0, inf_max: numCsv(r.inf_max) || 0,
    };
    const { error } = await sb.from("hotel_acomodaciones").upsert(fila, { onConflict: "hotel_id,acomodacion" });
    if (error) { errores.push(`Fila ${linea} (${r.hotel}): ${error.message}`); continue; }
    insertados++;
  }
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: errores.length === 0, insertados, errores };
}

// ── Calculadora de tarifas (estructura especial por hotel) ──────────────────
// Guarda el tipo + parámetros de la calculadora del hotel.
const CALCULADORA_DESACTUALIZADA =
  "La calculadora cambió desde que la abriste (otra persona la guardó o se renombró una vigencia). Recarga la página y revisa antes de guardar.";
// Escritura CONDICIONADA a la versión leída (migración 297): `versionLeida` null = el hotel aún no tenía
// calculadora (se inserta; si otra persona la creó a la vez, choca con la unicidad de hotel_id). Si la
// versión ya no coincide no se escribe nada y se pide recargar (sin reintento). Las bases por grupo viven
// en otra tabla: guardar o cambiar el tipo de calculadora no las toca.
export async function guardarCalculadora(
  hotelId: number,
  tipo: string,
  params: DubaiParams | MixtaParams | CorporativaParams,
  versionLeida: number | null,
): Promise<{ ok: true; version: number } | { ok: false; error: string; desactualizada?: true }> {
  // Fail-closed ANTES de escribir: un config Dubai con rangos/promos
  // imposibles, solapados o incompletos nunca llega a `hotel_calculadora`
  // (el servidor es la autoridad — nunca confía en que el editor ya validó
  // en el navegador). Mixta/Corporativa no ganan validación nueva en esta
  // ronda (fuera del alcance del encargo).
  if (tipo === "dubai") {
    const errores = validarDubaiParams(params as DubaiParams);
    if (errores.length > 0) {
      return { ok: false, error: errores.map((e) => e.mensaje).join(" ") };
    }
  }
  if (versionLeida !== null && !(Number.isInteger(versionLeida) && versionLeida > 0)) return { ok: false, error: "Versión de la calculadora no válida." };
  const sb = await createClient();
  const fila = { tipo, params: params as unknown as Json };
  const { data, error } = versionLeida === null
    ? await sb.from("hotel_calculadora").insert({ hotel_id: hotelId, ...fila }).select("version")
    : await sb.from("hotel_calculadora").update(fila).eq("hotel_id", hotelId).eq("version", versionLeida).select("version");
  if (error?.code === "23505") return { ok: false, desactualizada: true, error: CALCULADORA_DESACTUALIZADA };
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, desactualizada: true, error: CALCULADORA_DESACTUALIZADA };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true, version: data[0].version };
}

const etiquetaBloqueo = (temporada: string, categoria: string, regimen: string) => `${temporada} · ${categoria} · ${regimen}`;
// Los rechazos de la RPC ya vienen redactados para la persona; se quita el prefijo técnico.
const mensajeRpc = (m: string) => m.replace(/^generar_tarifas_hotel_calculadora:\s*/, "");
const SIN_FOTO = "Falta la foto de las tarifas cargadas. Recarga la página y vuelve a revisar la vista previa.";

// Genera las filas de tarifa_hotel a partir de la calculadora del hotel.
//  - modo "agregar" (por defecto): reemplaza SOLO las filas que genera ahora
//    (misma categoría + régimen + temporada). Otras temporadas del mismo
//    régimen (p. ej. una promoción ya cargada), otros regímenes y filas
//    manuales que no genera la calculadora quedan intactas (pendiente #26:
//    antes borraba TODAS las filas del régimen).
//  - modo "reemplazar": borra las tarifas VIGENTES del hotel y deja solo las
//    nuevas. Las de vigencias con compra cerrada se conservan. Se NIEGA si hay
//    promociones con valores escritos a mano (las borraría sin decisión).
// En ambos modos las vigencias con compra cerrada no se reescriben ni se
// recrean (histórico), las promociones escritas a mano no se tocan (se
// sustituyen solo con `sustituirPromoManualMixta`), y cada fila reemplazada o
// borrada queda en `tarifa_hotel_historial` (migración 203).
// `previas` = las tarifas que el cliente tenía cargadas en la vista previa. La
// RPC las compara con lo que hay AL ESCRIBIR, con el hotel bloqueado: si
// alguien cambió algo entretanto, rechaza y pide recargar. Lo que se decide
// aquí (qué promos quedan intactas) la RPC lo vuelve a exigir en SQL.
export async function generarTarifasCalculadora(
  hotelId: number,
  modo: "agregar" | "reemplazar",
  previas: FotoTarifa[],
): Promise<{ ok: true; generadas: number; vencidasConservadas: string[]; conGruposConservadas: string[]; promosManualesIntactas: string[] } | { ok: false; error: string }> {
  if (!Array.isArray(previas)) return { ok: false, error: SIN_FOTO };
  const sb = await createClient();
  const { calc, adultsOnly, error: errCtx, ctx, hoy } = await contextoGeneracion(sb, hotelId);
  if (!calc) return { ok: false, error: "Este hotel no tiene calculadora configurada. Guárdala primero." };
  if (errCtx) return { ok: false, error: errCtx };

  const calculadas = generarTarifas(calc.tipo, calc.params, ctx);
  const regimenMixta = calc.tipo === "mixta" ? ((calc.params as unknown as MixtaParams).regimen ?? "").trim() : "";
  const promosManualesIntactas = calc.tipo === "mixta"
    ? analizarMixta(calc.params as unknown as MixtaParams, ctx).promos
        .flatMap((a) => (a.bloqueadas ?? []).map((b) => etiquetaBloqueo(a.temporada, b.categoria, regimenMixta)))
    : [];
  if (modo === "reemplazar" && promosManualesIntactas.length > 0) {
    return {
      ok: false,
      error: `"Reemplazar TODAS" borraría promociones escritas a mano (${promosManualesIntactas.join("; ")}). ` +
        "Decide primero si sustituirlas por el valor calculado, o usa \"Generar (agregar/actualizar)\", que no las toca.",
    };
  }
  const { generables: sinVencidas, vencidas } = separarFilasVencidas(calculadas, ctx.vigencias, hoy);
  // #43/#60 (299): las vigencias que se venden por grupos (y sus promociones calculadas) no se escriben aquí.
  const { generables: filasBase, conGrupos } = separarFilasConGrupos(sinVencidas, ctx.vigencias);
  if (!filasBase.length) {
    const motivos = [
      vencidas.length ? `compra cerrada: ${vencidas.join(", ")}` : "",
      conGrupos.length ? `se venden por grupos de días (se calculan con «Calcular para» el grupo): ${conGrupos.join(", ")}` : "",
    ].filter(Boolean);
    return {
      ok: false,
      error: motivos.length
        ? `No hay tarifas para generar: las temporadas con valores se conservan sin cambios (${motivos.join("; ")}).`
        : "No hay bases con precio para generar tarifas.",
    };
  }
  const filas = aplicarAdultsOnly(filasBase, adultsOnly);

  // Reemplazo TRANSACCIONAL y ACOTADO (migración 203,
  // `generar_tarifas_hotel_calculadora`): bloqueo del hotel + comprobación +
  // borrado + inserción en una sola función de Postgres. La función vuelve a
  // calcular en servidor qué vigencias tienen la compra cerrada, rechaza si
  // las filas cambiaron respecto de `previas`, nunca pisa una promo escrita a
  // mano y nunca borra fuera de las claves del lote (salvo "reemplazar", que
  // conserva las vencidas).
  const { data: resultado, error } = await sb.rpc("generar_tarifas_hotel_calculadora", {
    p_hotel_id: hotelId,
    p_filas: filas as unknown as Json,
    p_previas: fotoTarifas(previas) as unknown as Json,
    p_reemplazar_todo: modo === "reemplazar",
  });
  if (error) return { ok: false, error: mensajeRpc(error.message) };

  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  await regenerarTarifariosDeHotel(hotelId);
  const insertadas = (resultado as { insertadas?: number } | null)?.insertadas ?? filas.length;
  return { ok: true, generadas: insertadas, vencidasConservadas: vencidas, conGruposConservadas: conGrupos, promosManualesIntactas };
}

// Acción EXPLÍCITA (pendiente #15): sustituye los valores escritos a mano de
// UNA promoción en UNA categoría y UN régimen por el valor calculado desde su
// base (−% de la vigencia). Escribe solo esa fila (borrado acotado a su clave,
// motivo `calculadora_sustituir_manual`, versión anterior al historial). El
// cliente guarda antes la calculadora y envía lo que mostró la vista previa;
// si el cálculo del servidor no coincide exactamente, no escribe nada. La RPC
// exige además que la celda siga siendo la promo escrita a mano que se
// confirmó (`previas`): si otra persona la cambió, rechaza.
export async function sustituirPromoManualMixta(
  hotelId: number,
  objetivo: { temporada: string; regimen: string; categoria: string },
  esperado: ValoresTarifa,
  previas: FotoTarifa[],
): Promise<{ ok: true; anterior: ValoresTarifa | null; nuevo: ValoresTarifa } | { ok: false; error: string }> {
  if (!Array.isArray(previas)) return { ok: false, error: SIN_FOTO };
  const sb = await createClient();
  const { calc, adultsOnly, error: errCtx, ctx, hoy } = await contextoGeneracion(sb, hotelId);
  if (!calc || calc.tipo !== "mixta") return { ok: false, error: "Este hotel no tiene calculadora Mixta guardada." };
  if (errCtx) return { ok: false, error: errCtx };
  const calculo = filaSustitucionMixta(calc.params as unknown as MixtaParams, ctx, objetivo);
  if (!calculo.ok) return { ok: false, error: calculo.error };
  if (separarFilasConGrupos([calculo.fila], ctx.vigencias).generables.length === 0) {
    return { ok: false, error: `"${objetivo.temporada}" se calcula desde una vigencia que se vende por grupos de días: no se sustituye desde la calculadora general.` };
  }
  if (separarFilasVencidas([calculo.fila], ctx.vigencias, hoy).generables.length === 0) {
    return { ok: false, error: `"${objetivo.temporada}" tiene la compra cerrada: sus tarifas se conservan y no se sustituyen.` };
  }
  const [final] = aplicarAdultsOnly([calculo.fila], adultsOnly);
  const clave = clavePromoMixta(objetivo.categoria, objetivo.regimen, objetivo.temporada);
  const difiere = CAMPOS_VALOR_TARIFA.find((c) => (final[c] ?? null) !== (esperado[c] ?? null));
  if (difiere) {
    return { ok: false, error: "Lo calculado no coincide con la vista previa (¿cambió la calculadora o las vigencias?). Recarga la página y vuelve a revisar." };
  }
  const anterior = ctx.tarifasExistentes.find((t) =>
    !!t.tipo_habitacion && !!t.alimentacion && !!t.temporada &&
    clavePromoMixta(t.tipo_habitacion, t.alimentacion, t.temporada) === clave);

  const { error } = await sb.rpc("generar_tarifas_hotel_calculadora", {
    p_hotel_id: hotelId,
    p_filas: [final] as unknown as Json,
    p_previas: fotoTarifas(previas) as unknown as Json,
    p_reemplazar_todo: false,
    p_motivo: "calculadora_sustituir_manual",
  });
  if (error) return { ok: false, error: mensajeRpc(error.message) };

  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  await regenerarTarifariosDeHotel(hotelId);
  return { ok: true, anterior: anterior ? valoresDeFila(anterior as ValoresTarifa) : null, nuevo: valoresDeFila(final) };
}

// ── #43/#60 entrega 4: promociones por grupo ─────────────────────────────────
export type ReglaPromoInput = { grupo_id: string | null; valor: number; dias: number[] | null };

/** Guarda el vínculo a la base y las reglas por grupo de una promoción, en UNA transacción (RPC de la 300).
 * `previas` = lo que vio quien edita (foto); si cambió, la base rechaza y se pide recargar. */
export async function guardarReglasPromocion(input: {
  hotelId: number; promocionId: number; baseId: number | null;
  reglas: ReglaPromoInput[]; previas: { base: number | null; reglas: ReglaPromoInput[] };
}): Promise<Result> {
  const reglas = Array.isArray(input.reglas) ? input.reglas : [];
  for (const r of reglas) {
    if (!(Number(r.valor) > 0)) return { ok: false, error: "Cada regla necesita un valor mayor a 0." };
    if (r.dias != null && (!Array.isArray(r.dias) || !r.dias.length)) return { ok: false, error: "Con «Elegir días» marca al menos un día." };
  }
  const sb = await createClient();
  const { error } = await sb.rpc("promocion_guardar_reglas", {
    p_promocion_id: input.promocionId,
    p_base_id: input.baseId as number,
    p_reglas: reglas.map((r) => ({ grupo_id: r.grupo_id, valor: Number(r.valor), dias: r.dias })) as unknown as Json,
    p_previas: { base: input.previas.base, reglas: input.previas.reglas } as unknown as Json,
  });
  if (error) {
    if (error.code === "PT409") return { ok: false, error: "La promoción cambió mientras la editabas; recarga la página y vuelve a revisarla." };
    return { ok: false, error: mensajePromo300(error.message) ?? error.message };
  }
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  await regenerarTarifariosDeHotel(input.hotelId);
  return { ok: true };
}
