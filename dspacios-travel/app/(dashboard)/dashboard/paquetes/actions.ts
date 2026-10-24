"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database, Json } from "@/types/database";
import { columnasProcedencia } from "@/lib/tarifario/procedenciaTarifario";
import {
  noches as calcNoches,
  liquidarHotelNochesConTemporadas,
  liquidarHotelMasBaratoConTemporada,
  marcar,
  aporteVuelo,
  componerTarifa,
  precioMenorDeDos,
  redondearVenta,
  factorLiquidacion,
  toTemporadaRango,
  type TemporadaRango,
} from "@/lib/calc/paquetes";
import { empaquetadoVigente, hoyBogota } from "@/lib/reservar/origen";
import { motivoMonedaBloqueoVsPaquete } from "@/lib/vuelos/monedaBloqueo";
import { serviciosSinPrecioInfante } from "@/lib/reservar/menoresDeDos";
import { seleccionarSalidasVigentes } from "@/lib/reservar/salidaDinamicaVigente";
import {
  MODO_OFERTA_63,
  aCop63,
  aporteVueloVinculada63,
  copiarDeFuente63,
  esModo63,
  etiquetaSalidaVinculada63,
  evaluarFuenteVinculada63,
  feeACop63,
  fuenteCoincideConSalida63,
  impuestoPorPersona63,
  mensajeFuenteCambio63,
  validarTrm63,
  type FuenteEmpaquetado63,
} from "@/lib/reservar/ofertaDinamica63";
import {
  filtrarCandidatos,
  mensajeErrorBase,
  leerInfoFuentes,
  motivoRechazoFuente,
  prepararGuardadoDestinosAereos,
  resolverDestinosAereosPaquete,
  validarLoteOrigenesAereos,
  MENSAJES as MENSAJES_DEST_AEREOS,
  type DestinoCatalogo,
} from "@/lib/paquetes/destinosAereos67";
import {
  validarCondicionPago,
  validarRestriccionComercialCatalogo,
  type CondicionPagoEntrada,
} from "@/lib/cotizacion/condicionPagoCatalogo";
import { construirSetParesPublicados, todosLosParesConfiguradosPublicados, primerParConfiguradoSinPublicar } from "@/lib/calc/paresPublicadosUnidad";

import type { ResultadoLote } from "@/lib/paquetes/seleccionMasiva";

type Result = { ok: true; id?: number; aviso?: string } | { ok: false; error: string };
const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const dNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s : null);

type ImpuestoTipo = Database["public"]["Enums"]["impuesto_tipo"];
type Acomodacion = Database["public"]["Enums"]["acomodacion_tipo"];

const ACOMODACIONES: Acomodacion[] = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"];
const COL_NETO: Record<Acomodacion, string> = {
  sencilla: "neto_sencilla",
  doble: "neto_doble",
  triple: "neto_triple",
  multiple: "neto_multiple",
  nino: "neto_nino",       // Niño 1 (Chd1)
  nino2: "neto_nino2",     // Niño 2 (Chd2)
  infante: "neto_infante", // por noche, 0 = gratis (igual que niño)
};

export interface PaqueteConfig {
  nombre: string;
  tipo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
  noches: number;
  destinoId: number | null;
  fechaCompraInicio: string;
  fechaCompraFin: string;
  fechaViajeInicio: string;
  fechaViajeFin: string;
  pctMk: number;          // porcentaje (20 = 20 %); se guarda como fracción
  impuestoTipo: ImpuestoTipo;
  impuestoFijo: number;
  activo: boolean;
  notas: string;
  // Condición de pago (migración 164) — aplica a los 4 tipos de paquete por
  // igual (bloqueo/porción terrestre/servicios/dinámico): es un atributo de
  // `armado_paquetes`, no del tipo. `restriccionComercial` solo admite
  // 'normal'|'promocional_no_reembolsable_no_endosable' (CHECK real de la
  // tabla; 'no_reembolsable_no_endosable' NO es válido aquí).
  condicionPagoTipo?: unknown;
  condicionPagoPctInicial?: unknown; // 1–99, no fracción
  condicionPagoDiasSaldo?: unknown;
  restriccionComercial?: unknown;
  // Descripción manual del paquete (migración 169) — texto libre, un
  // elemento por línea. Reemplaza la generación automática de "Incluye".
  // Pertenece al paquete, nunca al hotel: se comparte por todos sus
  // hoteles/opciones.
  programaIncluye: string;
  programaNoIncluye: string;
  programaTarifasEspeciales: string;
  programaCondicionesComerciales: string;
  // Destinos aéreos alternativos (migración 220, #67) — OPCIONALES: un
  // formulario anterior que no los envía no toca la configuración aérea
  // guardada. `destinosAereosIds` son SOLO las alternativas (el destino
  // comercial es siempre `destinoId` y nunca se repite aquí).
  destinosAereosAlternativos?: boolean;
  destinosAereosIds?: number[];
  // Modo de oferta (migración 227, #63) — OPCIONALES: un formulario anterior que
  // no los envía no toca lo guardado. `cop_trm_63` (solo Dinámico) publica el
  // tarifario en COP con la TRM del paquete; `legacy` es el de siempre.
  modoOferta?: unknown;
  trmOferta?: unknown;
}

// Modo de oferta + TRM del paquete (#63). Sin los campos = no se toca. TRM obligatoria
// y positiva en `cop_trm_63` (nunca 1 por omisión); `legacy` guarda la TRM en NULL.
function validarModoOfertaPaquete(c: PaqueteConfig):
  | { ok: true; campos: { modo_oferta?: string; trm_oferta?: number | null } }
  | { ok: false; error: string } {
  if (c.modoOferta === undefined && c.trmOferta === undefined) return { ok: true, campos: {} };
  if (c.modoOferta !== MODO_OFERTA_63 && c.modoOferta !== "legacy" && c.modoOferta !== undefined)
    return { ok: false, error: "El modo de oferta del paquete no es válido." };
  if (esModo63(c.modoOferta)) {
    if (c.tipo !== "dinamico") return { ok: false, error: "El modo COP con TRM solo está disponible para paquetes Dinámico." };
    const t = validarTrm63(c.trmOferta);
    if (!t.ok) return { ok: false, error: t.error };
    return { ok: true, campos: { modo_oferta: MODO_OFERTA_63, trm_oferta: t.trm } };
  }
  return { ok: true, campos: { modo_oferta: "legacy", trm_oferta: null } };
}

function validarCondicionYRestriccionPaquete(
  c: PaqueteConfig,
): { ok: true; condicion_pago_tipo: string; condicion_pago_pct_inicial: number | null; condicion_pago_dias_saldo: number | null; restriccion_comercial: string } | { ok: false; error: string } {
  const cp = validarCondicionPago(
    {
      tipo: c.condicionPagoTipo ?? "normal",
      pctInicial: c.condicionPagoPctInicial,
      diasSaldo: c.condicionPagoDiasSaldo,
    } satisfies CondicionPagoEntrada,
    "producto",
  );
  if (!cp.ok) return { ok: false, error: cp.error };
  const rc = validarRestriccionComercialCatalogo(c.restriccionComercial ?? "normal");
  if (!rc.ok) return { ok: false, error: rc.error };
  return { ok: true, ...cp.value, restriccion_comercial: rc.value };
}

function configToRow(c: PaqueteConfig, condicion: { condicion_pago_tipo: string; condicion_pago_pct_inicial: number | null; condicion_pago_dias_saldo: number | null; restriccion_comercial: string }) {
  return {
    nombre: c.nombre.trim(),
    tipo: c.tipo,
    noches: Number(c.noches) || 3,
    destino_id: c.destinoId,
    fecha_compra_inicio: dNull(c.fechaCompraInicio),
    fecha_compra_fin: dNull(c.fechaCompraFin),
    fecha_viaje_inicio: dNull(c.fechaViajeInicio),
    fecha_viaje_fin: dNull(c.fechaViajeFin),
    pct_mk: (Number(c.pctMk) || 0) / 100,
    impuesto_tipo: c.impuestoTipo,
    impuesto_fijo: Number(c.impuestoFijo) || 0,
    activo: c.activo,
    notas: oNull(c.notas),
    condicion_pago_tipo: condicion.condicion_pago_tipo,
    condicion_pago_pct_inicial: condicion.condicion_pago_pct_inicial,
    condicion_pago_dias_saldo: condicion.condicion_pago_dias_saldo,
    restriccion_comercial: condicion.restriccion_comercial,
    programa_incluye: oNull(c.programaIncluye),
    programa_no_incluye: oNull(c.programaNoIncluye),
    programa_tarifas_especiales: oNull(c.programaTarifasEspeciales),
    programa_condiciones_comerciales: oNull(c.programaCondicionesComerciales),
  };
}

// No regenera el tarifario: la configuración inicial (incluida la condición de
// pago) no participa del cálculo de precio del motor (`lib/calc/paquetes.ts`
// no lee estas columnas) — solo viaja al desglose de exigencia de pago. Igual
// que el resto de esta pantalla (nombre/fechas/mk no regeneran por sí solos),
// el botón explícito "Generar tarifario" sigue siendo quien dispara el cálculo.
// ¿El formulario envió la configuración de destinos aéreos (#67)? Si no, no se toca.
function entradaDestinosAereos(c: PaqueteConfig) {
  if (c.destinosAereosAlternativos === undefined && c.destinosAereosIds === undefined) return null;
  return {
    destinoComercialId: c.destinoId,
    alternativos: c.destinosAereosAlternativos === true,
    alternativaIds: (c.destinosAereosIds ?? []).map(Number),
  };
}

export async function crearPaquete(c: PaqueteConfig): Promise<Result> {
  if (!c.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const v = validarCondicionYRestriccionPaquete(c);
  if (!v.ok) return v;
  const oferta = validarModoOfertaPaquete(c);
  if (!oferta.ok) return oferta;
  const sb = await createClient();
  // #67: se valida la configuración aérea ANTES de crear nada.
  const entradaAerea = entradaDestinosAereos(c);
  let destinosAereos: number[] | null = null;
  if (entradaAerea && (entradaAerea.alternativos || entradaAerea.alternativaIds.length)) {
    const prep = await prepararGuardadoDestinosAereos(sb, null, entradaAerea);
    if (!prep.ok) return { ok: false, error: prep.error };
    destinosAereos = prep.destinosIds;
  }
  const { data, error } = await sb
    .from("armado_paquetes")
    .insert({ ...configToRow(c, v), ...oferta.campos })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  if (entradaAerea && destinosAereos) {
    const { error: eAereo } = await sb.rpc("guardar_destinos_aereos_67", {
      p_paquete_id: data.id, p_destino_id: c.destinoId, p_activo: entradaAerea.alternativos, p_destinos: destinosAereos,
    });
    if (eAereo) {
      // El paquete recién creado aún no tiene vuelos ni ventas: se elimina para no dejarlo a medias.
      await sb.from("armado_paquetes").delete().eq("id", data.id);
      return { ok: false, error: mensajeErrorBase(eAereo.message) };
    }
  }
  revalidatePath("/dashboard/paquetes");
  return { ok: true, id: data.id };
}

export async function actualizarPaquete(id: number, c: PaqueteConfig): Promise<Result> {
  if (!c.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const v = validarCondicionYRestriccionPaquete(c);
  if (!v.ok) return v;
  const oferta = validarModoOfertaPaquete(c);
  if (!oferta.ok) return oferta;
  const sb = await createClient();
  // #67: configuración aérea. Primero se valida TODO sin escribir (país
  // comparable, alternativas activas, y que ningún vuelo ya vinculado quede
  // incompatible: hay que desvincularlo explícitamente, nunca se borra solo);
  // después se guarda destino + check + alternativas en UNA transacción, y solo
  // si eso se confirma se actualiza el resto de la configuración.
  const entradaAerea = entradaDestinosAereos(c);
  if (entradaAerea) {
    const prep = await prepararGuardadoDestinosAereos(sb, id, entradaAerea);
    if (!prep.ok) return { ok: false, error: prep.error };
    const { error: eAereo } = await sb.rpc("guardar_destinos_aereos_67", {
      p_paquete_id: id, p_destino_id: c.destinoId, p_activo: entradaAerea.alternativos, p_destinos: prep.destinosIds,
    });
    if (eAereo) return { ok: false, error: mensajeErrorBase(eAereo.message) };
  }
  const { error } = await sb
    .from("armado_paquetes")
    .update({ ...configToRow(c, v), ...oferta.campos, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: mensajeErrorOferta63(error.message) };
  revalidatePath(`/dashboard/paquetes/${id}`);
  return { ok: true, id };
}

// Candidatos para el selector de destinos aéreos alternativos del editor (#67):
// destinos ACTIVOS del MISMO país que el destino comercial. Se piden al servidor
// (no se filtran en el navegador) para que la regla de país sea una sola.
export type CandidatosDestinosAereos =
  | { ok: true; candidatos: { id: number; nombre: string; codigo_iata: string | null }[]; motivo: string | null }
  | { ok: false; error: string };

export async function listarDestinosAereosCandidatos(destinoComercialId: number | null): Promise<CandidatosDestinosAereos> {
  if (!destinoComercialId) return { ok: true, candidatos: [], motivo: "Elige primero el destino comercial." };
  const sb = await createClient();
  const { data, error } = await sb.from("destinos").select("id, nombre, codigo_iata, pais, activo");
  if (error) return { ok: false, error: MENSAJES_DEST_AEREOS.tecnico };
  const r = filtrarCandidatos(destinoComercialId, (data ?? []) as DestinoCatalogo[]);
  return {
    ok: true,
    motivo: r.motivo,
    candidatos: r.candidatos.map((d) => ({ id: d.id, nombre: d.nombre ?? "", codigo_iata: d.codigo_iata })),
  };
}

export async function eliminarPaquete(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("armado_paquetes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/paquetes");
  return { ok: true };
}

// ── Adición de vuelo: alta/baja + decisión de margen (mk o TA) ─────────────
// Solo el vuelo decide margen. TA = Tarifa Administrativa (valor fijo).
export async function setVuelo(
  paqueteId: number,
  bloqueoId: number,
  checked: boolean,
  aplicaMk: boolean,
  ta: number
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    // Desvincular siempre se permite (es la desvinculación explícita que pide
    // #67 antes de retirar un destino aéreo). Ahora también se revisa su error.
    const { error } = await sb.from("armado_vuelos").delete().eq("paquete_id", paqueteId).eq("bloqueo_id", bloqueoId);
    if (error) return { ok: false, error: error.message };
  } else {
    // #67: el destino de llegada del vuelo debe estar entre los destinos aéreos
    // permitidos del paquete — validado aquí (POST directo incluido) y, además,
    // por la base. Se valida ANTES de escribir.
    const val = await validarLoteOrigenesAereos(sb, paqueteId, [{ tipo: "bloqueo", id: bloqueoId }]);
    if (!val.ok) return { ok: false, error: val.error };
    const { error } = await sb
      .from("armado_vuelos")
      .upsert(
        { paquete_id: paqueteId, bloqueo_id: bloqueoId, aplica_mk: aplicaMk, ta: Number(ta) || 0 },
        { onConflict: "paquete_id,bloqueo_id" }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Seleccionar / quitar TODOS los vuelos disponibles ─────────────────────
export async function setTodosVuelos(
  paqueteId: number,
  bloqueoIds: number[],
  checked: boolean
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    const { error } = await sb.from("armado_vuelos").delete().eq("paquete_id", paqueteId);
    if (error) return { ok: false, error: error.message };
  } else if (bloqueoIds.length) {
    // #67: lote TODO O NADA. Se deduplica y se valida cada vuelo contra los
    // destinos permitidos ANTES de escribir; si uno solo no cumple, no se
    // vincula ninguno.
    const val = await validarLoteOrigenesAereos(sb, paqueteId, bloqueoIds.map((id) => ({ tipo: "bloqueo" as const, id })));
    if (!val.ok) return { ok: false, error: val.error };
    const { error } = await sb
      .from("armado_vuelos")
      .upsert(
        val.fuentes.map((f) => ({ paquete_id: paqueteId, bloqueo_id: f.id, aplica_mk: true, ta: 0 })),
        { onConflict: "paquete_id,bloqueo_id", ignoreDuplicates: true }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Adición de hotel (con check). El hotel siempre va con el mk del paquete ─
export async function setHotel(paqueteId: number, hotelId: number, checked: boolean): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    const { error } = await sb.from("armado_hoteles").delete().eq("paquete_id", paqueteId).eq("hotel_id", hotelId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await sb
      .from("armado_hoteles")
      .upsert({ paquete_id: paqueteId, hotel_id: hotelId }, { onConflict: "paquete_id,hotel_id" });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Hoteles recomendados (prioridad 1-6 DENTRO del paquete, migración 183) ──
// La recomendación pertenece a la OFERTA hotel+paquete (`armado_hoteles`),
// nunca al hotel físico global — este `update` solo toca la fila de ESE
// paquete, nunca `hoteles` ni las filas de otros paquetes que usen el mismo
// hotel_id. `null` = no recomendado; 1-6 = prioridad manual. El rango (1-6) y
// la unicidad por paquete (nunca global) los garantiza la base (CHECK +
// índice único parcial, migración 183) — este `update` nunca valida el rango
// ni la duplicidad en JS de antemano: confía en que la base rechace lo
// inválido y traduce el código de error a un mensaje comprensible. Así la
// garantía real vive en la base (resiste dos guardados concurrentes desde dos
// pestañas), no solo en la validación del cliente.
export async function setHotelPrioridad(paqueteId: number, hotelId: number, prioridad: number | null): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("armado_hoteles")
    .update({ prioridad })
    .eq("paquete_id", paqueteId)
    .eq("hotel_id", hotelId);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Ya hay otro hotel con la prioridad ${prioridad} en este paquete. Elige otra prioridad o quítasela primero al que ya la tiene.` };
    }
    if (error.code === "23514") {
      return { ok: false, error: "La prioridad debe ser un número entre 1 y 6, o vacía para quitar la recomendación." };
    }
    return { ok: false, error: error.message };
  }
  // La prioridad es metadata de presentación (migración 184): no regenera
  // el snapshot, pero ambas superficies deben releer armado_hoteles.
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  revalidatePath("/tarifario");
  return { ok: true };
}

// Seleccionar/quitar TODOS los hoteles disponibles (con todas las categorías y
// regímenes por defecto; luego se afina cada uno desde su ventana).
export async function setTodosHoteles(paqueteId: number, hotelIds: number[], checked: boolean): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    const { error } = await sb.from("armado_hoteles").delete().eq("paquete_id", paqueteId);
    if (error) return { ok: false, error: error.message };
  } else if (hotelIds.length) {
    const { error } = await sb
      .from("armado_hoteles")
      .upsert(
        hotelIds.map((h) => ({ paquete_id: paqueteId, hotel_id: h })),
        { onConflict: "paquete_id,hotel_id", ignoreDuplicates: true }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Tarifas de un hotel (para la ventana de selección) ─────────────────────
//
// Hallazgo confirmado: este editor siempre consultaba `tarifa_hotel`, pero un
// hotel `modelo_tarifario = "unidad"` (Bernalo) administra sus tarifas en
// `hotel_tarifas_unidad` — `tarifa_hotel` para ese hotel está simplemente
// vacía. El resultado era categorías/regímenes vacíos, y al guardar "todas"
// (arreglo vacío = sentinela de "todas" para persona) `setHotelFiltros`
// escribía `armado_hoteles.categorias/regimenes = null`, que
// `computarReservaBernalo`/`cargarHotelesBernaloDescubiertos` interpretan
// como "configuración incompleta" (mismo bug que exigió corregir a mano con
// SQL el paquete 50 / hotel 216). Unión discriminada por `modelo`: persona
// conserva EXACTAMENTE la consulta/forma de siempre; unidad lee
// EXCLUSIVAMENTE `hotel_tarifas_unidad` con `estado = "publicada"` — nunca
// `tarifa_hotel`, nunca borradores/inactivas.
export type TarifaHotelPreview = {
  categoria: string;
  regimen: string;
  temporada: string;
  neto_sencilla: number | null;
  neto_doble: number | null;
  neto_triple: number | null;
  neto_multiple: number | null;
  neto_nino: number | null;
};

// Referencia de una tarifa Bernalo — NUNCA se presenta bajo las columnas
// falsas Doble/Triple/Niño de `TarifaHotelPreview` (esa tarifa no es
// per-cápita: `unidadCobro` puede ser pareja/habitación/apartamento, donde
// `valorBaseBruto` es el valor de LA UNIDAD completa, no de una persona). El
// valor es BRUTO/comisionable (ver `TarifaAlojamiento.comisionPct` en
// `lib/calc/unidadAlojamiento.ts`) — deliberadamente nunca llamado "neto".
export type TarifaUnidadPreview = {
  categoria: string;
  alimentacion: string;
  temporada: string;
  unidadCobro: string; // "persona" | "pareja" | "habitacion" | "apartamento" (payload); "" si no se pudo leer
  valorBaseBruto: number | null; // payload.valores.adulto — bruto/comisionable de la unidad completa
};

// Hallazgo confirmado (segunda ronda): la primera versión de este editor
// consultaba `hoteles.modelo_tarifario` descartando el `error` de Supabase
// (`const { data: hotelRow } = await sb...`) — un error transitorio de la
// consulta dejaba `hotelRow` en `undefined`, y `hotelRow?.modelo_tarifario
// === "unidad"` caía en `false` en silencio, tratando CUALQUIER error de red/
// permisos como si el hotel fuera "persona". Ahora es una unión discriminada
// con un tercer caso `{ ok: false; error }`: falla cerrado si Supabase
// devuelve error, si el hotel no existe, o si `modelo_tarifario` trae un
// valor que no sea EXACTAMENTE "persona" o "unidad" — nunca hay un `else`
// implícito que interprete "no es unidad" como "por lo tanto es persona".
export type TarifasHotelResultado =
  | { ok: false; error: string }
  | { ok: true; modelo: "persona"; categorias: string[]; regimenes: string[]; tarifas: TarifaHotelPreview[] }
  | { ok: true; modelo: "unidad"; categorias: string[]; regimenes: string[]; tarifas: TarifaUnidadPreview[] };

export async function getTarifasHotel(hotelId: number): Promise<TarifasHotelResultado> {
  const sb = await createClient();
  const { data: hotelRow, error: eHotel } = await sb.from("hoteles").select("modelo_tarifario").eq("id", hotelId).maybeSingle();
  if (eHotel) return { ok: false, error: `No se pudo consultar el modelo tarifario del hotel: ${eHotel.message}` };
  if (!hotelRow) return { ok: false, error: "El hotel no existe." };
  const modelo = hotelRow.modelo_tarifario;

  if (modelo === "unidad") {
    // Exclusivamente `hotel_tarifas_unidad`, exclusivamente `publicada` —
    // nunca borrador/inactiva, nunca `tarifa_hotel`.
    const { data, error: eUnidad } = await sb
      .from("hotel_tarifas_unidad")
      .select("categoria, alimentacion, temporada, payload")
      .eq("hotel_id", hotelId)
      .eq("estado", "publicada");
    // Un error real de la consulta NUNCA debe verse igual que "cero tarifas
    // publicadas" — lo primero es un fallo técnico (recuperable reintentando),
    // lo segundo es un estado legítimo del catálogo que el modal explica y
    // bloquea el guardado; confundirlos ocultaría el fallo técnico como si
    // fuera "falta publicar una tarifa".
    if (eUnidad) return { ok: false, error: `No se pudieron consultar las tarifas por unidad del hotel: ${eUnidad.message}` };
    const tarifas: TarifaUnidadPreview[] = (data ?? []).map((r) => {
      // Lectura DEFENSIVA del payload solo para referencia visual (nunca
      // autoritativa: la fuente de verdad de si una tarifa es utilizable es
      // `adaptarTarifaAlojamientoPersistida`/el motor, no este listado) —
      // un payload malformado nunca debe romper la ventana de selección,
      // solo mostrar "—" en su lugar.
      const payload = r.payload as { unidadCobro?: unknown; valores?: { adulto?: unknown } } | null;
      const unidadCobroCruda = payload?.unidadCobro;
      const valorCrudo = payload?.valores?.adulto;
      return {
        categoria: r.categoria ?? "",
        alimentacion: r.alimentacion ?? "",
        temporada: r.temporada ?? "",
        unidadCobro: typeof unidadCobroCruda === "string" ? unidadCobroCruda : "",
        valorBaseBruto: typeof valorCrudo === "number" && Number.isFinite(valorCrudo) ? valorCrudo : null,
      };
    });
    // Columnas espejo únicamente — nunca derivadas del payload ni de texto
    // libre histórico de `tarifa_hotel`. Vacíos fuera, duplicados fuera,
    // orden determinista.
    const categorias = [...new Set(tarifas.map((t) => t.categoria).filter(Boolean))].sort();
    const regimenes = [...new Set(tarifas.map((t) => t.alimentacion).filter(Boolean))].sort();
    return { ok: true, modelo: "unidad", categorias, regimenes, tarifas };
  }

  if (modelo === "persona") {
    // Persona: SIN cambios de comportamiento respecto al código anterior.
    const { data } = await sb
      .from("tarifa_hotel")
      .select("tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino")
      .eq("hotel_id", hotelId);
    const tarifas: TarifaHotelPreview[] = (data ?? []).map((r) => ({
      categoria: r.tipo_habitacion ?? "",
      regimen: r.alimentacion ?? "",
      temporada: r.temporada ?? "",
      neto_sencilla: r.neto_sencilla,
      neto_doble: r.neto_doble,
      neto_triple: r.neto_triple,
      neto_multiple: r.neto_multiple,
      neto_nino: r.neto_nino,
    }));
    const categorias = [...new Set(tarifas.map((t) => t.categoria).filter(Boolean))].sort();
    const regimenes = [...new Set(tarifas.map((t) => t.regimen).filter(Boolean))].sort();
    return { ok: true, modelo: "persona", categorias, regimenes, tarifas };
  }

  // Defensa en profundidad: el tipo generado de `hoteles.modelo_tarifario`
  // solo admite "persona"|"unidad", pero eso es una garantía de COMPILACIÓN,
  // no de lo que realmente pueda traer la fila en runtime (un CHECK relajado,
  // un tipo desactualizado, un valor `null` histórico). Cualquier valor que
  // no sea EXACTAMENTE uno de los dos falla cerrado — nunca cae a persona
  // "por default".
  return {
    ok: false,
    error: `El hotel tiene un modelo tarifario desconocido ("${modelo}") — corrígelo en Producto antes de usarlo en un paquete.`,
  };
}

// Guarda el hotel + su filtro de categorías/regímenes.
// Persona: null/vacío sigue significando "todas" — SIN cambios de
// comportamiento.
// Unidad (Bernalo): NUNCA se persiste `null` como sentinela de "todas" —
// `computarReservaBernalo` interpreta un arreglo vacío/null como
// configuración incompleta, no como "todas". Se exige un arreglo explícito
// no vacío, validado autoritativamente (server-side, `hoteles.modelo_tarifario`
// desde la base, nunca confiado del cliente) contra las categorías/
// alimentaciones que de verdad tienen una tarifa `publicada`.
export async function setHotelFiltros(
  paqueteId: number,
  hotelId: number,
  categorias: string[],
  regimenes: string[]
): Promise<Result> {
  const sb = await createClient();
  const { data: hotelRow, error: eHotel } = await sb.from("hoteles").select("modelo_tarifario").eq("id", hotelId).maybeSingle();
  // Mismo criterio fail-closed que `getTarifasHotel`: un error de Supabase
  // NUNCA debe caer a la rama persona (antes, `hotelRow?.modelo_tarifario ===
  // "unidad"` con `hotelRow` en `undefined` por un error descartado
  // producía exactamente eso — la validación de un hotel Bernalo real se
  // saltaba en silencio y se guardaba con el sentinela persona `[] → null`).
  if (eHotel) return { ok: false, error: `No se pudo consultar el modelo tarifario del hotel: ${eHotel.message}` };
  if (!hotelRow) return { ok: false, error: "El hotel no existe." };
  const modelo = hotelRow.modelo_tarifario;

  if (modelo === "unidad") {
    if (!categorias.length || !regimenes.length) {
      return {
        ok: false,
        error: "Este hotel usa el modelo tarifario Bernalo por unidad: selecciona al menos una categoría y una alimentación publicadas (no se puede guardar \"todas\" como vacío para este modelo).",
      };
    }
    const { data: filas, error: eFilas } = await sb
      .from("hotel_tarifas_unidad")
      .select("categoria, alimentacion")
      .eq("hotel_id", hotelId)
      .eq("estado", "publicada");
    if (eFilas) return { ok: false, error: eFilas.message };
    // Hallazgo confirmado (segunda ronda): validar categorías y
    // alimentaciones POR SEPARADO permite combinaciones que nunca se
    // publicaron — ej. "Estándar/FULL" y "Suite/PC" publicadas no implican
    // que "Estándar/PC" tenga tarifa. Se exige el PAR completo — ver
    // `lib/calc/paresPublicadosUnidad.ts` (helper compartido: la MISMA
    // función decide esto acá, en el descubrimiento público de
    // `datosBernalo.ts` y en el aviso de `generarTarifario`).
    const paresPublicados = construirSetParesPublicados(filas ?? []);
    if (!todosLosParesConfiguradosPublicados(categorias, regimenes, paresPublicados)) {
      const faltante = primerParConfiguradoSinPublicar(categorias, regimenes, paresPublicados);
      return {
        ok: false,
        error: faltante
          ? `No hay ninguna tarifa publicada para la combinación "${faltante.categoria}" / "${faltante.alimentacion}" — quita esa categoría o esa alimentación de la selección, o publica la tarifa que falta.`
          : "Selecciona al menos una categoría y una alimentación con tarifa publicada.",
      };
    }
    const { error } = await sb.from("armado_hoteles").upsert(
      { paquete_id: paqueteId, hotel_id: hotelId, categorias, regimenes },
      { onConflict: "paquete_id,hotel_id" }
    );
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/dashboard/paquetes/${paqueteId}`);
    return { ok: true };
  }

  if (modelo === "persona") {
    // Persona: SIN cambios de comportamiento respecto al código anterior.
    const { error } = await sb.from("armado_hoteles").upsert(
      {
        paquete_id: paqueteId,
        hotel_id: hotelId,
        categorias: categorias.length ? categorias : null,
        regimenes: regimenes.length ? regimenes : null,
      },
      { onConflict: "paquete_id,hotel_id" }
    );
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/dashboard/paquetes/${paqueteId}`);
    return { ok: true };
  }

  // Defensa en profundidad — ver el mismo bloque en `getTarifasHotel`.
  return {
    ok: false,
    error: `El hotel tiene un modelo tarifario desconocido ("${modelo}") — corrígelo en Producto antes de usarlo en un paquete.`,
  };
}

// ── Adición de servicio (con check) + modo de cobro (persona/grupo) ────────
export async function setServicio(
  paqueteId: number,
  servicioId: number,
  checked: boolean,
  modo: "persona" | "grupo" = "persona",
  incluido = false
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    const { error } = await sb.from("armado_servicios").delete().eq("paquete_id", paqueteId).eq("servicio_id", servicioId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await sb
      .from("armado_servicios")
      .upsert({ paquete_id: paqueteId, servicio_id: servicioId, modo, incluido }, { onConflict: "paquete_id,servicio_id" });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Servicios POR LOTE (#107): una sola escritura y una sola invalidación ───
// Sustituye al guardado en serie (un `setServicio` por servicio). Marcar = UN upsert; desmarcar = UN delete. Un servicio
// que ya no existe en el catálogo se OMITE y se informa (el resto sí se guarda); no cambia ninguna regla de precio.
export type ServicioLoteItem = { servicioId: number; modo: "persona" | "grupo"; incluido: boolean };

export async function setServicios(paqueteId: number, items: ServicioLoteItem[], checked: boolean): Promise<ResultadoLote> {
  const vistos = new Map<number, ServicioLoteItem>();
  for (const it of items ?? []) {
    const id = Number(it?.servicioId);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Hay un servicio con un identificador inválido." };
    if (it.modo !== "persona" && it.modo !== "grupo") return { ok: false, error: "Hay un servicio con un modo de cobro inválido." };
    vistos.set(id, { servicioId: id, modo: it.modo, incluido: !!it.incluido });
  }
  const lista = [...vistos.values()];
  if (!lista.length) return { ok: false, error: "Elige al menos un servicio." };
  if (lista.length > 500) return { ok: false, error: "Son demasiados servicios en una sola operación (máximo 500)." };
  const sb = await createClient();
  const ids = lista.map((x) => x.servicioId);
  if (!checked) {
    const { error, count } = await sb
      .from("armado_servicios")
      .delete({ count: "exact" })
      .eq("paquete_id", paqueteId)
      .in("servicio_id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/dashboard/paquetes/${paqueteId}`);
    return { ok: true, procesados: count ?? ids.length };
  }
  const { data: existentes, error: eEx } = await sb.from("servicios_adicionales").select("id").in("id", ids);
  if (eEx) return { ok: false, error: eEx.message };
  const hay = new Set(((existentes ?? []) as { id: number }[]).map((x) => x.id));
  const omitidos = lista.filter((x) => !hay.has(x.servicioId)).map((x) => ({ id: x.servicioId, motivo: `El servicio #${x.servicioId} ya no existe.` }));
  const filas = lista.filter((x) => hay.has(x.servicioId)).map((x) => ({ paquete_id: paqueteId, servicio_id: x.servicioId, modo: x.modo, incluido: x.incluido }));
  if (!filas.length) return { ok: false, error: "Ninguno de los servicios elegidos existe ya en el catálogo." };
  const { error } = await sb.from("armado_servicios").upsert(filas, { onConflict: "paquete_id,servicio_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true, procesados: filas.length, ...(omitidos.length ? { omitidos } : {}) };
}

// ── GENERAR TARIFARIO: liquida el paquete y reescribe tarifario_resultado ───
// Auditoría de Fase 1 (ronda 3, hallazgo P2): mensaje FIJO para cualquier
// error TÉCNICO de `generarTarifario` — el `.message` crudo de Postgres/
// Supabase (puede exponer nombres de tabla/columna/constraint) NUNCA se
// persiste en `tarifario_error` ni se devuelve al caller; el detalle real se
// registra SOLO server-side (console.error). Módulo-level porque se usa
// tanto ANTES de que exista un token (fallo de `iniciar_generacion_tarifario`
// mismo) como después (vía `fallarTecnico`, dentro de la función).
const MENSAJE_ERROR_TECNICO_TARIFARIO =
  "No se pudo generar el tarifario por un error técnico. Se registró el detalle en los registros del servidor para revisión.";

export async function generarTarifario(paqueteId: number): Promise<Result> {
  const sb = await createClient();

  // ── Publicación atómica (migración 181) — token de generación capturado
  // como PRIMERA operación de toda la función, antes de leer CUALQUIER
  // fuente ────────────────────────────────────────────────────────────────
  // Auditoría de Fase 1 (ronda 3, hallazgo P1 "carrera entre moneda
  // preliminar y autoritativa"): la versión anterior leía/escribía una
  // moneda "preliminar" ANTES de este punto para evitar que escribirla
  // después invalidara el snapshot recién publicado — pero esa escritura
  // preliminar podía quedar desactualizada si una fuente cambiaba justo
  // entre esa lectura y la captura del token (la revisión capturada ya
  // reflejaría el cambio, así que la publicación no se rechazaba, pero la
  // CACHÉ de moneda seguía con el valor viejo). La corrección: moneda pasó a
  // ser un dato DERIVADO del mismo cálculo que produce `filas` — se resuelve
  // una sola vez, con las lecturas AUTORITATIVAS de más abajo, y se persiste
  // dentro de `publicar_tarifario_resultado` (mismo commit que las filas).
  // Por eso ya no hace falta ninguna lectura antes de este punto: el token
  // es literalmente la primera operación de la función.
  const { data: genRows, error: eGen } = await sb.rpc("iniciar_generacion_tarifario", { p_paquete_id: paqueteId });
  if (eGen || !genRows || !genRows.length) {
    // Todavía NO existe ningún token/generación — `marcar_generacion_fallida`
    // no aplica (no hay nada que marcar). El `.message` crudo (incluido el
    // caso "paquete no encontrado", que sale del mismo `raise exception` de
    // la función) nunca se devuelve ni se persiste — solo se registra.
    if (eGen) console.error(`generarTarifario: iniciar_generacion_tarifario falló (paquete_id=${paqueteId}): ${eGen.message}`);
    return { ok: false, error: MENSAJE_ERROR_TECNICO_TARIFARIO };
  }
  const generacion = genRows[0].generacion;
  const revisionCapturada = genRows[0].revision_capturada;
  // Best-effort: si marcar el fallo en armado_paquetes también falla, nunca
  // debe ocultar ni reemplazar el error de negocio/técnico real que la
  // función ya está por reportar — solo se registra server-side. `sb.rpc()`
  // normalmente DEVUELVE el error en `{ data, error }` (PostgREST), nunca lo
  // lanza — por eso se revisa `error` explícitamente, no solo un try/catch
  // (que sigue ahí para el caso, más raro, de que el cliente sí lance).
  // `p_revision_capturada` (auditoría de Fase 1, segundo hallazgo P1): si la
  // revisión de fuente ya avanzó cuando este intento falla, el RPC se
  // abstiene de tocar `tarifario_estado`/`tarifario_error` — un fallo VIEJO
  // nunca debe pisar el estado de un intento más nuevo.
  const marcarFallo = async (mensajePersistido: string) => {
    try {
      const { error: eMarcar } = await sb.rpc("marcar_generacion_fallida", {
        p_paquete_id: paqueteId,
        p_generacion: generacion,
        p_revision_capturada: revisionCapturada,
        p_error: mensajePersistido.slice(0, 2000),
      });
      if (eMarcar) {
        console.error(
          `generarTarifario: marcar_generacion_fallida falló (paquete_id=${paqueteId}, generacion=${generacion}): ${eMarcar.message}`
        );
      }
    } catch (err) {
      console.error(
        `generarTarifario: marcar_generacion_fallida lanzó una excepción (paquete_id=${paqueteId}, generacion=${generacion}):`,
        err
      );
    }
  };
  // Errores de NEGOCIO: mensajes ya escritos por ESTE archivo (nunca texto
  // crudo de Postgres/Supabase) — estables y seguros por construcción, se
  // persisten en `tarifario_error` y se devuelven al caller tal cual.
  const fallar = async (mensaje: string): Promise<Result> => {
    await marcarFallo(mensaje);
    return { ok: false, error: mensaje };
  };
  // Errores TÉCNICOS: el `.message` crudo de una consulta/RPC de Supabase se
  // registra SOLO server-side; lo que se guarda/devuelve es el mensaje FIJO
  // de módulo (ver arriba) — nunca el texto interno de Postgres.
  const fallarTecnico = async (detalleCrudo: string): Promise<Result> => {
    console.error(`generarTarifario: error técnico (paquete_id=${paqueteId}, generacion=${generacion}): ${detalleCrudo}`);
    await marcarFallo(MENSAJE_ERROR_TECNICO_TARIFARIO);
    return { ok: false, error: MENSAJE_ERROR_TECNICO_TARIFARIO };
  };

  // ── FASE AUTORITATIVA — TODO se lee fresco, DESPUÉS del token ──────────
  const { data: pq, error: ePq } = await sb
    .from("armado_paquetes")
    .select("*, destinos(nombre)")
    .eq("id", paqueteId)
    .single();
  if (ePq) return await fallarTecnico(ePq.message);
  if (!pq) return await fallar("Paquete no encontrado.");

  const pctMk = Number(pq.pct_mk) || 0;
  const paqueteNombre = pq.nombre;
  const paqueteActivo = pq.activo;
  const paqueteDestinoId = pq.destino_id;
  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;
  // La clasificación de hoteles Bernalo (P2, ver más abajo) necesita saber
  // el tipo del paquete ANTES de decidir si sus ofertas por unidad son
  // compatibles con Vista Booking.
  const tipo = (pq.tipo ?? "bloqueo") as "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";

  // #63 — modo de oferta del paquete. `cop_trm_63`: el tarifario se publica en
  // COP; todo neto en USD (hotel/servicios/salida manual) se convierte × la TRM
  // del paquete ANTES del markup. La TRM es obligatoria y positiva (nunca 1).
  // Cualquier otro valor = comportamiento de siempre, sin cambios.
  const modo63 = esModo63((pq as { modo_oferta?: unknown }).modo_oferta);
  let trm63 = 0;
  if (modo63) {
    const t = validarTrm63((pq as { trm_oferta?: unknown }).trm_oferta);
    if (!t.ok) return await fallar(t.error);
    trm63 = t.trm;
  }
  // Neto → moneda de publicación. En el modo de siempre es la identidad.
  const aMonedaOferta = (neto: number, monedaOrigen: string | null | undefined) => (modo63 ? aCop63(neto, monedaOrigen, trm63) : neto);

  const [{ data: vuelosSel, error: eVuelosSel }, { data: empaquetadosSel, error: eEmpaquetadosSel }, { data: hotelesSel, error: eHotelesSel }, { data: serviciosSel, error: eServiciosSel }] = await Promise.all([
    sb
      .from("armado_vuelos")
      .select("bloqueo_id, aplica_mk, ta, bloqueos_vuelo(id, record, ruta, fecha_ida, fecha_regreso, tarifa_para_empaquetar, fee_infante, moneda)")
      .eq("paquete_id", paqueteId),
    // Vuelos por SISTEMA (Empaquetados, migración 156) — mismo patrón que
    // armado_vuelos/bloqueos_vuelo; ver la nota de integración más abajo.
    sb
      .from("armado_empaquetados")
      .select("empaquetado_id, aplica_mk, ta, empaquetados(id, record, ruta, fecha_ida, fecha_regreso, tarifa_para_empaquetar, fee_infante, moneda, activo, compra_inicio, compra_fin)")
      .eq("paquete_id", paqueteId),
    sb
      .from("armado_hoteles")
      .select("hotel_id, categorias, regimenes, hoteles(nombre, moneda, modelo_tarifario, adults_only)")
      .eq("paquete_id", paqueteId),
    sb
      .from("armado_servicios")
      .select("servicio_id, modo, incluido, servicios_adicionales(nombre, precio_persona, precio_infante, liquidacion, descripcion, recargo_individual, moneda)")
      .eq("paquete_id", paqueteId),
  ]);
  if (eVuelosSel) return await fallarTecnico(eVuelosSel.message);
  if (eEmpaquetadosSel) return await fallarTecnico(eEmpaquetadosSel.message);
  if (eHotelesSel) return await fallarTecnico(eHotelesSel.message);
  if (eServiciosSel) return await fallarTecnico(eServiciosSel.message);

  // Rangos de grupo de los servicios seleccionados
  const servicioIds = (serviciosSel ?? []).map((s) => s.servicio_id);
  const gruposPorServicio = new Map<number, { pax_desde: number; pax_hasta: number; precio: number }[]>();
  if (servicioIds.length) {
    // El snapshot del tarifario usa la tarifa BASE (GENERAL); las temporadas se
    // aplican al reservar (re-escala por fecha del viaje).
    const { data: gr, error: eGrupos } = await sb
      .from("servicio_tarifa_pax")
      .select("servicio_id, pax_desde, pax_hasta, precio")
      .eq("temporada", "GENERAL")
      .in("servicio_id", servicioIds);
    if (eGrupos) return await fallarTecnico(eGrupos.message);
    for (const g of gr ?? []) {
      const arr = gruposPorServicio.get(g.servicio_id) ?? [];
      arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
      gruposPorServicio.set(g.servicio_id, arr);
    }
  }

  const hoteles = hotelesSel ?? [];
  const servicios = serviciosSel ?? [];

  // ── Consistencia de moneda (CERO mezcla) — validación AUTORITATIVA ─────
  // Un paquete es de UNA sola moneda. Todos los hoteles Y todos los servicios
  // (incluidos u opcionales) deben coincidir; si no, el PVP mezclaría COP y
  // USD. `paqueteMoneda` acá es SOLO para el mensaje de error — la moneda ya
  // se guardó en la fase preliminar de arriba, no se vuelve a escribir.
  const monedaDe = (m: string | null | undefined) => (m === "USD" ? "USD" : "COP");
  const svcMoneda = (s: { servicios_adicionales: unknown }) =>
    monedaDe((s.servicios_adicionales as { moneda?: string | null } | null)?.moneda);
  const monedasHotel = Array.from(
    new Set(hoteles.map((h) => monedaDe((h.hoteles as unknown as { moneda?: string | null } | null)?.moneda)))
  );
  // Modo `cop_trm_63`: cada neto se convierte a COP con la TRM del paquete antes
  // del markup, así que hoteles y servicios en monedas distintas NO se mezclan.
  if (!modo63 && monedasHotel.length > 1)
    return await fallar("Los hoteles del paquete tienen monedas distintas (COP y USD). Un paquete debe ser de una sola moneda.");
  const monedasServicio = Array.from(new Set(servicios.map(svcMoneda)));

  let paqueteMoneda: "COP" | "USD";
  if (modo63) {
    paqueteMoneda = "COP";
  } else if (hoteles.length) {
    // La moneda la fija el hotel; cualquier servicio en otra moneda se rechaza.
    paqueteMoneda = monedasHotel[0];
    if (monedasServicio.some((m) => m !== paqueteMoneda))
      return await fallar(`El paquete está en ${paqueteMoneda} (por el hotel) pero hay servicios en otra moneda. Todo el paquete debe estar en ${paqueteMoneda}.`);
  } else {
    // Paquete de solo servicios: todos deben compartir moneda.
    if (monedasServicio.length > 1)
      return await fallar("Los servicios del paquete tienen monedas distintas (COP y USD). Un paquete debe ser de una sola moneda.");
    paqueteMoneda = monedasServicio[0] ?? "COP";
  }

  // Temporadas y tarifas netas de cada hotel involucrado.
  //
  // Fase 3 Bernalo (guardia, ver informe de la tarea): un hotel con
  // `modelo_tarifario = 'unidad'` administra su tarifa en
  // `hotel_tarifas_unidad` (fase 2), NO en `tarifa_hotel` — ese hotel se
  // EXCLUYE de esta consulta y de la generación de filas más abajo
  // (`hotelesBernaloExcluidos`), en vez de leer `tarifa_hotel` en silencio
  // (que para un hotel Bernalo puede estar vacío, o peor, contener datos
  // viejos de antes de migrar a Bernalo). La integración real de
  // `hotel_tarifas_unidad` con el tarifario queda fuera de esta fase — el
  // desglose por acomodación (columna sencilla/doble/triple/multiple/niño/
  // niño2/infante) que este archivo escribe en `tarifario_resultado` no
  // tiene una forma no ambigua de derivarse de una tarifa Bernalo (la
  // comisión se aplica una sola vez sobre el total, no por categoría) sin
  // aproximar — ver el informe de la tarea.
  const hotelesBernaloFilas = hoteles.filter(
    (h) => (h.hoteles as unknown as { modelo_tarifario?: string | null } | null)?.modelo_tarifario === "unidad"
  );
  const hotelesBernaloExcluidos = hotelesBernaloFilas.map(
    (h) => (h.hoteles as unknown as { nombre?: string | null } | null)?.nombre ?? `#${h.hotel_id}`
  );
  const hotelIds = hoteles
    .filter((h) => (h.hoteles as unknown as { modelo_tarifario?: string | null } | null)?.modelo_tarifario !== "unidad")
    .map((h) => h.hotel_id);

  // P3 (hallazgo confirmado, validación final): un paquete "dinamico" cuyo
  // alojamiento es 100% Bernalo (`hotelIds.length === 0`, ningún hotel
  // persona) no tiene NADA real que ofrecer — el modelo unidad no vive en
  // `tarifa_hotel`/`tarifario_resultado` y el tipo "dinamico" tampoco está
  // soportado por Vista Booking (ver `tipoCompatibleConVistaBooking` más
  // abajo). Antes esta guardia vivía DESPUÉS de publicar servicios
  // opcionales y de borrar/reescribir `tarifario_resultado` — como los
  // servicios SIEMPRE suman filas (`filas.push` más abajo, sin importar el
  // tipo), un paquete dinámico 100% unidad CON al menos un servicio
  // opcional terminaba con `filas.length > 0` y se colaba por la rama
  // `if (filas.length)` del `insert` en vez de caer en el `else if` — se
  // guardaba `ok:true` con un snapshot que son SOLO servicios (sin
  // alojamiento real, la parte que el usuario más necesita) y sin ningún
  // aviso de que el paquete no sirve. Esta prevalidación corre ANTES de
  // tocar `armado_servicios`/`servicio_tarifa_pax`, ANTES del
  // `delete().eq("paquete_id", paqueteId)` y ANTES de cualquier `insert` —
  // nunca se publica un snapshot parcial (solo servicios) ni se borra uno
  // previo válido al rechazar. Un paquete dinámico con AL MENOS un hotel
  // persona (`hotelIds.length > 0`) nunca entra aquí, sin importar cuántos
  // hoteles Bernalo tenga además — sigue su flujo normal. Bloqueo y porción
  // terrestre no se tocan (la condición exige `tipo === "dinamico"`).
  if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {
    return await fallar(
      "Dinámico: el modelo tarifario por unidad todavía no está integrado con paquetes dinámicos (el motor de cotización Bernalo no soporta salidas dinámicas). Usa un hotel con modelo por persona, o cambia este paquete a Bloqueo/Porción terrestre."
    );
  }

  // P4 (hallazgo confirmado, validación final): TODA la clasificación de
  // abajo (válido / sin publicar / no compatible por tipo) usa `hotel_id`
  // como llave — nunca el nombre. Antes se armaba un `Set` de NOMBRES
  // válidos y se filtraban los excluidos comparando también por nombre
  // (`hotelesBernaloSinPublicar = hotelesBernaloExcluidos.filter(n =>
  // !hotelesBernaloValidosSet.has(n))`): dos hoteles DISTINTOS con el mismo
  // nombre —uno válido, otro sin publicar/no compatible— se clasificaban
  // mal, porque el nombre compartido "contaminaba" al otro en el filtro por
  // string. El nombre se resuelve SOLO al final, para construir el texto.
  const nombrePorHotelBernalo = new Map<number, string>(
    hotelesBernaloFilas.map((h, i) => [h.hotel_id, hotelesBernaloExcluidos[i]])
  );

  // P2 (hallazgo confirmado, validación final): el motor de cotización
  // Bernalo (`computarReservaBernalo`) no soporta `salidas_dinamicas`
  // todavía, y el tipo "servicios" no tiene concepto de hotel cotizable —
  // `lib/tarifario/datosBernalo.ts` ya excluye esos dos tipos del
  // descubrimiento de Vista Booking (`cargarHotelesBernaloDescubiertos`).
  // Un hotel Bernalo de un paquete de ese tipo NUNCA puede contarse como
  // "disponible en Vista Booking" acá tampoco, sin importar si tiene
  // tarifa publicada o no — sería anunciar algo que la UI no puede
  // mostrar/cotizar todavía.
  const tipoCompatibleConVistaBooking = tipo === "bloqueo" || tipo === "porcion_terrestre";

  // P1-3 (hallazgo confirmado): "excluido de la generación legacy" NO es lo
  // mismo que "disponible para cotización dinámica" — un hotel Bernalo sin
  // categorías/alimentación configuradas, o sin tarifa `publicada` para
  // TODO el cartesiano configurado, sigue excluido de `tarifario_resultado`
  // (correcto), pero el aviso NUNCA debe contarlo como disponible. Mismo
  // helper puro compartido que `setHotelFiltros`/`datosBernalo.ts`
  // (`lib/calc/paresPublicadosUnidad.ts`) — una sola función decide "¿este
  // hotel Bernalo está realmente publicado?" en los tres lugares.
  const paresPublicadosPorHotelBernalo = new Map<number, Set<string>>();
  if (hotelesBernaloFilas.length && tipoCompatibleConVistaBooking) {
    const { data: tarifasPublicadasBernalo, error: eTarifasBernalo } = await sb
      .from("hotel_tarifas_unidad")
      .select("hotel_id, categoria, alimentacion")
      .in("hotel_id", hotelesBernaloFilas.map((h) => h.hotel_id))
      .eq("estado", "publicada");
    // Un error TÉCNICO acá no debe hacer que el paquete parezca "sin
    // hoteles Bernalo disponibles" en silencio — se propaga como cualquier
    // otro error de esta función.
    if (eTarifasBernalo) return await fallarTecnico(eTarifasBernalo.message);
    const filasPorHotelBernalo = new Map<number, { categoria: string | null; alimentacion: string | null }[]>();
    for (const t of tarifasPublicadasBernalo ?? []) {
      const arr = filasPorHotelBernalo.get(t.hotel_id) ?? [];
      arr.push({ categoria: t.categoria, alimentacion: t.alimentacion });
      filasPorHotelBernalo.set(t.hotel_id, arr);
    }
    for (const [hotelId, filasPub] of filasPorHotelBernalo) {
      paresPublicadosPorHotelBernalo.set(hotelId, construirSetParesPublicados(filasPub));
    }
  }
  // Clasificación por id, en un único recorrido — nunca por nombre (P4).
  const idsBernaloValidos = new Set<number>();
  const idsBernaloSinPublicar = new Set<number>();
  const idsBernaloNoCompatibles = new Set<number>();
  for (const h of hotelesBernaloFilas) {
    if (!tipoCompatibleConVistaBooking) { idsBernaloNoCompatibles.add(h.hotel_id); continue; }
    const categorias = (h.categorias as string[] | null) ?? [];
    const regimenes = (h.regimenes as string[] | null) ?? [];
    const paresPublicados = paresPublicadosPorHotelBernalo.get(h.hotel_id) ?? new Set<string>();
    if (todosLosParesConfiguradosPublicados(categorias, regimenes, paresPublicados)) idsBernaloValidos.add(h.hotel_id);
    else idsBernaloSinPublicar.add(h.hotel_id);
  }
  const nombresDeIdsBernalo = (ids: Set<number>) => [...ids].map((id) => nombrePorHotelBernalo.get(id) ?? `#${id}`);
  const hotelesBernaloValidos = nombresDeIdsBernalo(idsBernaloValidos);

  const temporadasPorHotel = new Map<number, TemporadaRango[]>();
  type TarifaRow = Record<string, unknown>;
  const tarifasPorHotel = new Map<number, TarifaRow[]>();
  if (hotelIds.length) {
    const [{ data: temps }, { data: tarifas }] = await Promise.all([
      sb.from("hotel_temporadas").select("hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, regimen_restringido").in("hotel_id", hotelIds),
      sb.from("tarifa_hotel").select("*").in("hotel_id", hotelIds),
    ]);
    for (const t of temps ?? []) {
      const arr = temporadasPorHotel.get(t.hotel_id) ?? [];
      arr.push(toTemporadaRango(t));
      temporadasPorHotel.set(t.hotel_id, arr);
    }
    for (const r of (tarifas ?? []) as TarifaRow[]) {
      const hid = r.hotel_id as number;
      const arr = tarifasPorHotel.get(hid) ?? [];
      arr.push(r);
      tarifasPorHotel.set(hid, arr);
    }
  }

  type ResultadoInsert = Database["public"]["Tables"]["tarifario_resultado"]["Insert"];
  const filas: ResultadoInsert[] = [];

  // Servicios INCLUIDOS se hornean por persona en la tarifa del hotel.
  // (Los OPCIONALES no se hornean: se agregan como add-on en la reserva.)
  function aporteServiciosIncluidos(numNoches: number): number {
    let total = 0;
    for (const s of servicios) {
      if (!(s.incluido as boolean)) continue;
      const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; liquidacion: string | null } | null;
      if (srv?.precio_persona == null) continue;
      // Cobro amarrado a la duración: por noche × noches, por día × (noches+1).
      total += marcar(aMonedaOferta(Number(srv.precio_persona) || 0, svcMoneda(s)), pctMk) * factorLiquidacion(srv.liquidacion, numNoches);
    }
    return total;
  }

  // Tarifa de infante (migración 226): lo mismo para un MENOR DE 2 AÑOS — cada
  // servicio incluido por persona con su `precio_infante` (NETO, con el mismo
  // markup que el de adulto) o, si el servicio no lo configuró (NULL ≠ $0), el
  // precio de adulto. Los incluidos por grupo no se hornean (ni para adulto).
  function aporteServiciosIncluidosMenor(numNoches: number): number {
    let total = 0;
    for (const s of servicios) {
      if (!(s.incluido as boolean)) continue;
      const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; precio_infante: number | null; liquidacion: string | null } | null;
      if (srv?.precio_persona == null) continue;
      const neto = srv.precio_infante != null ? Number(srv.precio_infante) || 0 : Number(srv.precio_persona) || 0;
      total += marcar(aMonedaOferta(neto, svcMoneda(s)), pctMk) * factorLiquidacion(srv.liquidacion, numNoches);
    }
    return total;
  }

  // Genera las filas de hotel para una estadía (fechaIda + numNoches).
  // `aporteVueloVal` es el aporte del vuelo al PVP (0 en porción terrestre);
  // `impuesto` es la BNC que se resta del PVP.
  function filasHoteles(
    fechaIda: string,
    numNoches: number,
    aporteVueloVal: number,
    impuesto: number,
    modulo: Database["public"]["Enums"]["tarifario_modulo"],
    bloqueoId: number | null,
    bloqueoLabel: string | null,
    fechaRegreso: string | null,
    // Tarifario "desde": toma la tarifa más barata de la ventana de viaje
    // [fechaIda, fechaRegreso] en vez de liquidar una fecha fija. Para porción,
    // donde el asesor elige fecha al reservar (re-liquida). Bloqueo = fecha fija.
    masBarato = false,
    salidaId: number | null = null,
    // Origen "Sistema" (empaquetados, migración 156) — mutuamente excluyente
    // con bloqueoId: una fila de un paquete tipo 'bloqueo' viene de UN cupo
    // negociado (bloqueoId) O de UNA tarifa de sistema (empaquetadoId), nunca
    // de los dos a la vez. Se guarda en su propia columna
    // (tarifario_resultado.empaquetado_id) para que la procedencia quede
    // inequívoca en el resultado — ver la nota de integración más abajo.
    empaquetadoId: number | null = null,
    // Fee de infante de la fuente de vuelo (0 a 1,99 años): precio = costo, sin
    // MK ni TA (migración 226). 0 en porción terrestre (sin vuelo).
    feeInfante = 0,
  ) {
    if (numNoches <= 0) return;
    const aporteServ = aporteServiciosIncluidos(numNoches); // solo servicios incluidos
    const aporteServMenor = aporteServiciosIncluidosMenor(numNoches);
    for (const h of hoteles) {
      const hotelMeta = h.hoteles as unknown as { nombre: string; moneda?: string | null; adults_only?: boolean | null } | null;
      const hotelAdultsOnly = hotelMeta?.adults_only === true;
      const hotelNombre = hotelMeta?.nombre ?? null;
      const monedaHotelOrigen = (hotelMeta?.moneda ?? "COP") === "USD" ? "USD" : "COP";
      // Moneda de PUBLICACIÓN: la del hotel de siempre; en modo 63 siempre COP
      // (el neto del hotel se convierte × TRM antes del markup, ver `publicarFila`).
      const monedaHotel = modo63 ? "COP" : monedaHotelOrigen;
      const filtroCat = (h.categorias as string[] | null) ?? null;
      const filtroReg = (h.regimenes as string[] | null) ?? null;
      const temporadas = temporadasPorHotel.get(h.hotel_id) ?? [];
      const tarifas = tarifasPorHotel.get(h.hotel_id) ?? [];
      // Agrupa por (categoría, régimen) -> (temporada -> fila de tarifa)
      const combos = new Map<string, Map<string, TarifaRow>>();
      for (const r of tarifas) {
        const cat = (r.tipo_habitacion as string) ?? "";
        const reg = (r.alimentacion as string) ?? "";
        const key = `${cat}|||${reg}`;
        if (!combos.has(key)) combos.set(key, new Map());
        combos.get(key)!.set((r.temporada as string) ?? "", r);
      }
      for (const [key, tempMap] of combos) {
        const [categoria, regimen] = key.split("|||");
        // Filtro de la ventana del hotel (null/vacío = todas)
        if (filtroCat && filtroCat.length && !filtroCat.includes(categoria)) continue;
        if (filtroReg && filtroReg.length && !filtroReg.includes(regimen)) continue;
        // Temporadas de este combo marcadas como PRECIO FINAL AUTORITATIVO
        // (migración 179) — evita que una promoción Dubai con descuento/
        // suplemento propio se recalcule desde su temporada base al congelar
        // el PVP del tarifario. Vacío en combos legacy/sin promociones.
        const precioFinalTemporadas = new Set<string>();
        for (const [temp, row] of tempMap) if (row.precio_final_autoritativo === true) precioFinalTemporadas.add(temp);
        let hayHabitacion = false;
        let hayInfante = false;
        let procedenciaHab: ReturnType<typeof columnasProcedencia> | null = null;
        const publicarFila = (acom: Acomodacion, costoHotel: number, procedencia: ReturnType<typeof columnasProcedencia>) => {
          const esRoom = acom !== "nino" && acom !== "nino2" && acom !== "infante";
          const aporteHotel = marcar(aMonedaOferta(costoHotel, monedaHotelOrigen), pctMk); // hotel siempre con mk (en modo 63: neto × TRM primero)
          const t = componerTarifa({
            aporteHotel,
            aporteServicios: aporteServ,
            aporteVuelo: aporteVueloVal,
            impuesto,
            moneda: monedaHotel,
          });
          filas.push({
            paquete_id: paqueteId,
            paquete_nombre: paqueteNombre,
            paquete_activo: paqueteActivo,
            modulo,
            bloqueo_id: bloqueoId,
            bloqueo_label: bloqueoLabel,
            empaquetado_id: empaquetadoId,
            hotel_id: h.hotel_id,
            hotel_nombre: hotelNombre,
            destino_id: paqueteDestinoId,
            destino_nombre: destinoNombre,
            categoria: categoria || null,
            regimen: regimen || null,
            acomodacion: acom,
            noches: numNoches,
            fecha_ida: fechaIda,
            fecha_regreso: fechaRegreso,
            base_comisionable: t.baseComisionable,
            impuesto: t.impuesto,
            precio_pvp: t.pvp,
            // Menor de 2 años de ESTA clase de hotel: hotel de la clase + servicios
            // con su precio de infante, redondeo al mil/dólar, y el fee de infante
            // del vuelo EXACTO (regla B, migración 226). NULL en habitaciones adultas.
            precio_pvp_menor2: esRoom ? null : precioMenorDeDos({ aporteHotel, aporteServiciosMenor: aporteServMenor, feeInfante, moneda: monedaHotel }),
            moneda: monedaHotel,
            salida_id: salidaId,
            temporada_ganadora: procedencia.temporada_ganadora,
            es_promocion: procedencia.es_promocion,
            precio_final_autoritativo: procedencia.precio_final_autoritativo,
            procedencia_temporadas: procedencia.procedencia_temporadas as unknown as Json,
            procedencia_mixta: procedencia.procedencia_mixta,
          });
        };
        for (const acom of ACOMODACIONES) {
          const col = COL_NETO[acom];
          const netoPorTemporada: Record<string, number | null> = {};
          for (const [temp, row] of tempMap) {
            const v = row[col];
            netoPorTemporada[temp] = v == null ? null : Number(v);
          }
          // Procedencia REAL del precio ganador (migración 180) — SIEMPRE
          // sale de la MISMA búsqueda que produce el total, nunca se infiere
          // después de `fecha_ida` (en `masBarato` el precio ganador puede
          // venir de CUALQUIER noche de la ventana, no necesariamente la de
          // entrada — ese era exactamente el defecto confirmado).
          const resultado = masBarato
            ? liquidarHotelMasBaratoConTemporada({ desde: fechaIda, hasta: fechaRegreso ?? fechaIda, numNoches, temporadas, netoPorTemporada, regimen, precioFinalTemporadas })
            : liquidarHotelNochesConTemporadas({ fechaIda, numNoches, temporadas, netoPorTemporada, regimen, precioFinalTemporadas });
          const costoHotel = resultado?.total ?? null;
          // Procedencia deduplicada de TODAS las noches que aportaron al
          // total (nunca solo el checkin) — ver lib/tarifario/procedenciaTarifario.ts.
          const procedencia = columnasProcedencia(resultado?.procedencia);
          // null = no aplica (no se publica). En HABITACIONES, 0 también es "no
          // aplica" (no es gratis); en niños e infante el 0 sí es válido (gratis).
          const esRoom = acom !== "nino" && acom !== "nino2" && acom !== "infante";
          if (costoHotel == null) continue;
          if (esRoom && costoHotel <= 0) continue;
          if (esRoom) { hayHabitacion = true; procedenciaHab = procedenciaHab ?? procedencia; }
          if (acom === "infante") hayInfante = true;
          publicarFila(acom, costoHotel, procedencia);
        }
        // Infante (migración 226): un hotel sin tarifa de infante para este combo NO
        // deja al menor de 2 años gratis en silencio — se publica la fila con hotel
        // $0 para que el fee de infante del vuelo y los servicios con su precio de
        // infante se cobren igual. Solo si el combo tiene alguna habitación publicada
        // y el hotel acepta niños (Adults Only no publica infante).
        if (hayHabitacion && !hayInfante && !hotelAdultsOnly && procedenciaHab) publicarFila("infante", 0, procedenciaHab);
      }
    }
  }

  // #67 — destinos aéreos permitidos del paquete (solo Bloqueo/Sistema). Un
  // vuelo vinculado solo se publica si su destino de llegada está entre los
  // efectivos HOY: check apagado = destino comercial exacto; encendido =
  // comercial + alternativas válidas del mismo país. Es la misma regla que usan
  // la vinculación, la venta y la vitrina; aquí evita publicar (o seguir
  // publicando) un vuelo cuyo país/destino cambió después de vincularlo. Un
  // error de lectura aborta la generación como fallo técnico (nunca "sin
  // vuelos"). Dinámico no pasa por aquí: sus salidas manuales siguen #62.
  let permiteDestinoAereo = (_tipo: "bloqueo" | "empaquetado", _id: number) => true;
  let excluidosPorDestinoAereo = 0;
  if (tipo === "bloqueo" && ((vuelosSel?.length ?? 0) + (empaquetadosSel?.length ?? 0)) > 0) {
    const efAereo = await resolverDestinosAereosPaquete(sb, paqueteId);
    if (!efAereo.ok) return await fallarTecnico(efAereo.error);
    if (!efAereo.efectivos.ok) return await fallar(`Bloqueo: ${efAereo.efectivos.error}`);
    const permitidos = efAereo.efectivos.ids;
    const fuentesAereas = [
      ...(vuelosSel ?? []).map((v) => ({ tipo: "bloqueo" as const, id: v.bloqueo_id })),
      ...(empaquetadosSel ?? []).map((v) => ({ tipo: "empaquetado" as const, id: v.empaquetado_id })),
    ];
    const infoAerea = await leerInfoFuentes(sb, fuentesAereas);
    if (!infoAerea.ok) return await fallarTecnico(infoAerea.error);
    permiteDestinoAereo = (t, id) => motivoRechazoFuente(permitidos, infoAerea.info.get(`${t}:${id}`) ?? null) === null;
    excluidosPorDestinoAereo = fuentesAereas.filter((f) => !permiteDestinoAereo(f.tipo, f.id)).length;
  }

  const vuelos = (vuelosSel ?? [])
    .map((v) => ({
      aplica_mk: v.aplica_mk as boolean,
      ta: Number(v.ta) || 0,
      b: v.bloqueos_vuelo as unknown as {
        id: number;
        record: string | null;
        ruta: string | null;
        fecha_ida: string | null;
        fecha_regreso: string | null;
        tarifa_para_empaquetar: number;
        fee_infante: number | null;
        moneda: string | null;
      } | null,
    }))
    .filter((v): v is typeof v & { b: NonNullable<typeof v.b> } => !!v.b && !!v.b.fecha_ida && !!v.b.fecha_regreso && permiteDestinoAereo("bloqueo", v.b.id));

  // Vuelos por SISTEMA (Empaquetados) — mismo shape que `vuelos`, filtrando
  // los desactivados (un empaquetado apagado a mano no debe seguir
  // alimentando un tarifario ya generado con una tarifa que ya no aplica) Y
  // los que están fuera de su vigencia de compra (revisión de PR #268,
  // defecto 2, checkpoint "al generar tarifario"). Esta NO es la única
  // validación de vigencia — `computarReserva` la vuelve a revisar en vivo
  // al resolver la reserva (`tarifario_resultado` es una caché, no la
  // fuente de verdad) — pero evitar publicar de entrada una tarifa vencida
  // reduce el caso de "se ve en el tarifario pero no se puede reservar".
  const empaquetadosVuelos = (empaquetadosSel ?? [])
    .map((v) => ({
      aplica_mk: v.aplica_mk as boolean,
      ta: Number(v.ta) || 0,
      e: v.empaquetados as unknown as {
        id: number;
        record: string | null;
        ruta: string | null;
        fecha_ida: string | null;
        fecha_regreso: string | null;
        tarifa_para_empaquetar: number;
        fee_infante: number | null;
        moneda: string | null;
        activo: boolean;
        compra_inicio: string | null;
        compra_fin: string | null;
      } | null,
    }))
    .filter((v): v is typeof v & { e: NonNullable<typeof v.e> } =>
      !!v.e && v.e.activo && !!v.e.fecha_ida && !!v.e.fecha_regreso
      && empaquetadoVigente(v.e.compra_inicio, v.e.compra_fin, hoyBogota(new Date()))
      && permiteDestinoAereo("empaquetado", v.e.id)
    );

  // 231 (#90 Entrega B, regla D8): lo mismo para los Bloqueos aéreos. Fuera del modo cop_trm_63 la moneda de las tarifas del Bloqueo debe
  // coincidir con la del paquete; sin acreditar (null) se lee como COP —así se vendió siempre— y solo se rechaza contra un paquete USD.
  // (En modo 63 un Bloqueo no entra al tarifario: ese modo publica solo salidas dinámicas.)
  if (!modo63) {
    for (const v of vuelos) {
      const motivo = motivoMonedaBloqueoVsPaquete(v.b.moneda, paqueteMoneda === "USD" ? "USD" : "COP", v.b.record || v.b.ruta || `#${v.b.id}`);
      if (motivo) return await fallar(motivo);
    }
  }

  // 230 (regla D8): fuera del modo cop_trm_63 un tarifario es de UNA moneda. El vuelo de Empaquetados (que ahora puede estar en
  // USD) debe coincidir con la moneda del paquete; si no, NO se genera (nada de sumar dólares a pesos sin conversión).
  {
    const distinto = empaquetadosVuelos.find((v) => (v.e.moneda === "USD" ? "USD" : "COP") !== paqueteMoneda);
    if (distinto) {
      const monedaVuelo = distinto.e.moneda === "USD" ? "USD" : "COP";
      return await fallar(
        `El vuelo de Empaquetados ${distinto.e.ruta || "#" + distinto.e.id} está en ${monedaVuelo} pero este paquete se publica en ${paqueteMoneda}. Un paquete debe ser de una sola moneda: usa un hotel de la misma moneda o, si es Dinámico, el modo COP con TRM.`
      );
    }
  }

  // `tipo` ya se resolvió arriba (justo tras leer `pq`) — lo necesita la
  // clasificación de hoteles Bernalo antes de llegar aquí.

  // Salidas dinámicas (vuelo por sistema): solo para el tipo 'dinamico'.
  //
  // #62: ya no basta `activo` — se publica solo lo que la regla común
  // (lib/reservar/salidaDinamicaVigente.ts) considera elegible HOY: activa,
  // ventana de compra abierta (inclusiva, Bogotá) y viaje no pasado. Es la
  // misma regla con la que cargarDatosTarifario() oculta lo ya publicado y
  // computarReserva() rechaza la venta. Un error de lectura aborta la
  // generación (antes se ignoraba y el paquete quedaba "sin salidas").
  const { data: salidasRaw, error: eSalidas } = tipo === "dinamico"
    ? await sb.from("salidas_dinamicas").select("*").eq("paquete_id", paqueteId).order("fecha_ida")
    : { data: null, error: null };
  if (eSalidas) return await fallarTecnico(eSalidas.message);
  const { vigentes: salidas, descartadas: salidasDescartadas } = seleccionarSalidasVigentes(salidasRaw ?? []);

  // #63 — salidas VINCULADAS a un vuelo de Empaquetados sin record. Se leen sus
  // fuentes VIVAS (una sola consulta) y se valida, antes de publicar nada:
  // elegibilidad de la fuente (activa, sin record, ventana de compra, viaje
  // futuro, COP), que la copia guardada en la salida siga coincidiendo con la
  // fuente, y que su destino de llegada esté entre los destinos aéreos efectivos
  // del paquete (#67/220, misma regla que Bloqueo/Sistema). Una vinculada que no
  // cumple NO se publica y se reporta; nunca se publica con datos viejos.
  const vinculadas63 = tipo === "dinamico"
    ? salidas.filter((x) => (x as { empaquetado_id?: number | null }).empaquetado_id != null)
    : [];
  const fuentes63 = new Map<number, FuenteEmpaquetado63>();
  const omitidas63: string[] = [];
  let permiteVinculada63: (empaquetadoId: number) => boolean = () => true;
  if (vinculadas63.length) {
    if (!modo63)
      return await fallar("Dinámico: las salidas vinculadas a Empaquetados exigen el modo COP con TRM en la configuración del paquete.");
    const idsFuente = [...new Set(vinculadas63.map((x) => (x as { empaquetado_id: number }).empaquetado_id))];
    const { data: fuentesRows, error: eFuentes } = await sb
      .from("empaquetados")
      .select("id, activo, record, compra_inicio, compra_fin, fecha_ida, fecha_regreso, ruta, aerolinea, destino_id, moneda, tarifa_para_empaquetar, fee_infante")
      .in("id", idsFuente);
    if (eFuentes) return await fallarTecnico(eFuentes.message);
    for (const fr of (fuentesRows ?? []) as unknown as (FuenteEmpaquetado63 & { id: number })[]) fuentes63.set(fr.id, fr);
    const efAerea63 = await resolverDestinosAereosPaquete(sb, paqueteId);
    if (!efAerea63.ok) return await fallarTecnico(efAerea63.error);
    if (!efAerea63.efectivos.ok) return await fallar(`Dinámico: ${efAerea63.efectivos.error}`);
    const permitidos63 = efAerea63.efectivos.ids;
    const infoAerea63 = await leerInfoFuentes(sb, idsFuente.map((id) => ({ tipo: "empaquetado" as const, id })));
    if (!infoAerea63.ok) return await fallarTecnico(infoAerea63.error);
    permiteVinculada63 = (id) => motivoRechazoFuente(permitidos63, infoAerea63.info.get(`empaquetado:${id}`) ?? null) === null;
  }

  // Validaciones según el tipo (mensajes claros en vez de 0 silencioso).
  // 'bloqueo' acepta cupos negociados (armado_vuelos) O tarifas de Sistema
  // (armado_empaquetados) — no se limita en silencio a solo bloqueos: el
  // mismo tipo de paquete ('bloqueo', el único con paso de "vuelo" en el
  // armado) es el punto de integración natural para Empaquetados, igual que
  // ya lo es para bloqueos negociados. 'porcion_terrestre'/'servicios' no
  // tienen vuelo en absoluto; 'dinamico' ya tiene su propio mecanismo
  // dedicado (`salidas_dinamicas`, deliberadamente no fusionado con
  // Empaquetados — ver la migración 156).
  if (tipo === "bloqueo" && !vuelos.length && !empaquetadosVuelos.length)
    return await fallar(
      excluidosPorDestinoAereo
        ? `Bloqueo: los ${excluidosPorDestinoAereo} vuelo(s) vinculado(s) ya no cumplen los destinos aéreos permitidos del paquete. Revisa la configuración de destinos aéreos o desvincula esos vuelos.`
        : "Bloqueo: selecciona al menos un vuelo o un empaquetado."
    );
  if (tipo === "porcion_terrestre" && (!pq.fecha_viaje_inicio || !pq.fecha_viaje_fin))
    return await fallar("Porción terrestre: define el rango de viaje (fechas) en la Configuración inicial.");
  if (tipo === "dinamico" && !salidas.length)
    return await fallar(
      salidasDescartadas
        ? "Dinámico: ninguna salida está vigente (activa, con compra abierta y viaje futuro). Revisa sus fechas de compra y de viaje."
        : "Dinámico: agrega al menos una salida (vuelo por sistema)."
    );
  if ((tipo === "bloqueo" || tipo === "porcion_terrestre" || tipo === "dinamico") && !hoteles.length)
    return await fallar("Agrega al menos un hotel.");
  if (tipo === "servicios" && !servicios.length)
    return await fallar("Agrega al menos un servicio.");

  if (tipo === "bloqueo") {
    // MÓDULO BLOQUEOS: una liquidación por ciclo aéreo negociado
    for (const { aplica_mk, ta, b } of vuelos) {
      const numNoches = calcNoches(b.fecha_ida!, b.fecha_regreso!);
      const costoTiquete = Number(b.tarifa_para_empaquetar) || 0;
      const aporteVueloVal = aporteVuelo(costoTiquete, aplica_mk, pctMk, ta);
      const impuesto = pq.impuesto_tipo === "tiquete" ? costoTiquete : Number(pq.impuesto_fijo) || 0;
      // Etiqueta pública del vuelo: solo la ruta (el record/PNR es interno y
      // NO debe aparecer en el tarifario que ven clientes B2C/B2B).
      const label = b.ruta || "";
      filasHoteles(b.fecha_ida!, numNoches, aporteVueloVal, impuesto, "bloqueo", b.id, label, b.fecha_regreso, false, null, null, Number(b.fee_infante) || 0);
    }
    // MÓDULO BLOQUEOS (Sistema): una liquidación por empaquetado — MISMA
    // matemática que un ciclo aéreo negociado, el único cambio es la fuente
    // del costo del tiquete (`empaquetados.tarifa_para_empaquetar` en vez de
    // `bloqueos_vuelo.tarifa_para_empaquetar`).
    //
    // Base y NO doble margen: la fila trae DOS tarifas (`tarifa_proveedor` =
    // neto crudo del proveedor/sistema, informativo — no entra al PVP aquí,
    // igual que `bloqueos_vuelo` tampoco expone un "neto" separado en este
    // cálculo; y `tarifa_para_empaquetar` = ya lista para reventa). Se usa
    // ÚNICAMENTE `tarifa_para_empaquetar` como `costoTiquete`, exactamente
    // igual que un bloqueo negociado — entra UNA sola vez a `aporteVuelo()`,
    // que aplica el margen (`aplica_mk`+`pctMk`) O la TA (nunca ambos, es un
    // if/else dentro de esa función). `aplica_mk`/`ta` vienen del enlace
    // `armado_empaquetados` (decisión POR PAQUETE, igual que `armado_vuelos`)
    // — no hay un segundo punto donde se vuelva a marginar el mismo costo.
    for (const { aplica_mk, ta, e } of empaquetadosVuelos) {
      const numNoches = calcNoches(e.fecha_ida!, e.fecha_regreso!);
      const costoTiquete = Number(e.tarifa_para_empaquetar) || 0;
      const aporteVueloVal = aporteVuelo(costoTiquete, aplica_mk, pctMk, ta);
      const impuesto = pq.impuesto_tipo === "tiquete" ? costoTiquete : Number(pq.impuesto_fijo) || 0;
      // Mismo criterio de privacidad que un bloqueo negociado: solo la ruta
      // en el label público, nunca el record/PNR.
      const label = e.ruta || "";
      filasHoteles(e.fecha_ida!, numNoches, aporteVueloVal, impuesto, "bloqueo", null, label, e.fecha_regreso, false, null, e.id, Number(e.fee_infante) || 0);
    }
  } else if (tipo === "porcion_terrestre" && pq.fecha_viaje_inicio) {
    // MÓDULO PORCIÓN TERRESTRE: sin vuelo; noches del paquete desde la fecha inicio
    const numNoches = Number(pq.noches) || 3;
    filasHoteles(pq.fecha_viaje_inicio, numNoches, 0, Number(pq.impuesto_fijo) || 0, "porcion_terrestre", null, null, pq.fecha_viaje_fin, true);
  } else if (tipo === "dinamico") {
    // MÓDULO DINÁMICO: una liquidación por SALIDA (vuelo por sistema, sin record).
    // El hotel se liquida por las noches de la salida; el vuelo es valor_tiquete
    // (adulto 2+) con mk o TA. fecha fija → no "más barato".
    for (const sal of salidas) {
      const fIda = sal.fecha_ida as string;
      const fReg = (sal.fecha_regreso as string | null) ?? null;
      if (!fIda || !fReg) continue;
      const numNoches = calcNoches(fIda, fReg);
      if (numNoches <= 0) continue;
      // #63 — salida vinculada: R (precio final del aéreo) entra al PVP SIN markup
      // ni TA; F (fee de infante) se suma exacto; el hotel y los servicios siguen
      // el motor de siempre. Camino aparte de la salida manual (no la altera).
      const empaquetadoVinculado = (sal as { empaquetado_id?: number | null }).empaquetado_id ?? null;
      if (empaquetadoVinculado != null) {
        const etiqueta63 = etiquetaSalidaVinculada63(sal);
        const fuente63 = fuentes63.get(empaquetadoVinculado) ?? null;
        const elegible63 = evaluarFuenteVinculada63(fuente63, hoyBogota(new Date()));
        if (!elegible63.ok) { omitidas63.push(`${etiqueta63}: ${elegible63.error}`); continue; }
        if (!permiteVinculada63(empaquetadoVinculado)) {
          omitidas63.push(`${etiqueta63}: su destino aéreo no está permitido para este paquete.`);
          continue;
        }
        const coincide63 = fuenteCoincideConSalida63(sal, fuente63!);
        if (!coincide63.ok) { omitidas63.push(`${etiqueta63}: ${mensajeFuenteCambio63(coincide63.campos)}`); continue; }
        // 230: R en USD se convierte × TRM UNA sola vez (sin markup ni TA); en COP queda exacto.
        const tarifaR63 = aCop63(Number(fuente63!.tarifa_para_empaquetar) || 0, fuente63!.moneda, trm63);
        const impuesto63 = impuestoPorPersona63({ tipo: pq.impuesto_tipo, tarifaParaEmpaquetar: tarifaR63, fijoCop: Number(pq.impuesto_fijo) || 0 });
        const feeF63 = feeACop63(Number(fuente63!.fee_infante) || 0, fuente63!.moneda, trm63);
        filasHoteles(fIda, numNoches, aporteVueloVinculada63(tarifaR63), impuesto63, "dinamico", null, etiqueta63, fReg, false, sal.id as number, null, feeF63);
        continue;
      }
      // #63 — salida MANUAL en modo COP: el tiquete/TA/fee conservan la moneda
      // acreditada de la salida y se convierten × TRM antes de publicar en COP.
      if (modo63) {
        const monedaManual = (sal as { moneda?: string | null }).moneda ?? "COP";
        const tiqueteCop = aCop63(Number(sal.valor_tiquete) || 0, monedaManual, trm63);
        const taCop = aCop63(Number(sal.ta) || 0, monedaManual, trm63);
        const impuestoManual = pq.impuesto_tipo === "tiquete" ? tiqueteCop : Number(pq.impuesto_fijo) || 0;
        const etiquetaManual = etiquetaSalidaVinculada63(sal);
        filasHoteles(fIda, numNoches, aporteVuelo(tiqueteCop, sal.aplica_mk as boolean, pctMk, taCop), impuestoManual, "dinamico", null, etiquetaManual, fReg, false, sal.id as number, null, feeACop63(Number(sal.fee_infante) || 0, monedaManual, trm63));
        continue;
      }
      const costoTiquete = Number(sal.valor_tiquete) || 0;
      const aporteVueloVal = aporteVuelo(costoTiquete, sal.aplica_mk as boolean, pctMk, Number(sal.ta) || 0);
      const impuesto = pq.impuesto_tipo === "tiquete" ? costoTiquete : Number(pq.impuesto_fijo) || 0;
      // Etiqueta pública de la salida: ruta + fecha (NO hay record/PNR).
      const label = `${sal.ruta || ""}${sal.ruta && fIda ? " · " : ""}${fIda ? fIda.split("-").reverse().join("/") : ""}`.trim();
      filasHoteles(fIda, numNoches, aporteVueloVal, impuesto, "dinamico", null, label || (sal.ruta ?? "Salida"), fReg, false, sal.id as number, null, Number(sal.fee_infante) || 0);
    }
  }

  // #63 — si el paquete quedó sin ninguna salida dinámica publicable por culpa de
  // las vinculadas omitidas, se dice por qué (no es "sin salidas" a secas).
  if (tipo === "dinamico" && omitidas63.length && !filas.some((x) => x.modulo === "dinamico")) {
    return await fallar(`Dinámico: ninguna salida quedó disponible. ${omitidas63.slice(0, 3).join(" ")}`);
  }

  // Noches del paquete para amarrar el cobro de los servicios por día/noche.
  let nochesPaq = Number(pq.noches) || 1;
  if (tipo === "bloqueo" && vuelos.length) {
    nochesPaq = calcNoches(vuelos[0].b.fecha_ida!, vuelos[0].b.fecha_regreso!) || nochesPaq;
  }

  // SERVICIOS: se publican siempre (módulo Servicios y/o add-ons en la reserva),
  // sin importar el tipo. Persona = una fila; grupo = una fila por rango de pax.
  for (const s of servicios) {
    if (s.incluido as boolean) continue; // los incluidos se hornean, no se publican
    const srv = s.servicios_adicionales as unknown as { nombre: string; precio_persona: number | null; precio_infante: number | null; liquidacion: string | null; descripcion: string | null; recargo_individual: number | null; moneda: string | null } | null;
    if (!srv) continue;
    const fLiq = factorLiquidacion(srv.liquidacion, nochesPaq);
    const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
    // Cada servicio se publica en SU moneda (redondeo a mil en COP, a dólar en USD).
    const monedaSrvOrigen = svcMoneda(s);
    // Modo 63: se publica en COP (neto × TRM antes del markup); si no, en la moneda del servicio.
    const monedaSrv = modo63 ? "COP" : monedaSrvOrigen;
    const comun = {
      paquete_id: paqueteId,
      paquete_nombre: paqueteNombre,
      paquete_activo: paqueteActivo,
      modulo: "servicios" as const,
      servicio_id: s.servicio_id,
      servicio_nombre: srv.nombre,
      destino_id: paqueteDestinoId,
      destino_nombre: destinoNombre,
      tipo_tarifa: modo,
      impuesto: 0,
      moneda: monedaSrv,
      descripcion: srv.descripcion ?? null,
      // Procedencia (migración 180): las filas de servicio no vienen de
      // `columnasProcedencia()` como las de hotel — sin esto, el insert
      // masivo manda `procedencia_mixta` NULL (viola el NOT NULL) porque el
      // DEFAULT de la columna no aplica cuando la propiedad simplemente está
      // ausente del objeto en un insert de filas heterogéneas.
      temporada_ganadora: null,
      es_promocion: null,
      precio_final_autoritativo: null,
      procedencia_temporadas: null,
      procedencia_mixta: false,
    };
    if (modo === "grupo") {
      for (const g of gruposPorServicio.get(s.servicio_id) ?? []) {
        const pvp = redondearVenta(marcar(aMonedaOferta(Number(g.precio) || 0, monedaSrvOrigen), pctMk) * fLiq, monedaSrv);
        filas.push({ ...comun, pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, base_comisionable: pvp, precio_pvp: pvp });
      }
    } else if (srv.precio_persona != null) {
      const pvp = redondearVenta(marcar(aMonedaOferta(Number(srv.precio_persona) || 0, monedaSrvOrigen), pctMk) * fLiq, monedaSrv);
      // Recargo individual: suplemento del proveedor cuando va 1 pax (cobro por
      // persona). Es un COSTO, así que el lado de venta sube con su markup; el
      // costo neto lo toma Reservar del catálogo para la CxP del proveedor.
      const recargoNeto = Math.max(Number(srv.recargo_individual) || 0, 0);
      const recargoPvp = recargoNeto > 0 ? redondearVenta(marcar(aMonedaOferta(recargoNeto, monedaSrvOrigen), pctMk), monedaSrv) : 0;
      // Precio de infante (0 a 1,99 años) del servicio: NETO con el mismo markup.
      // NULL = el servicio no lo configuró → el infante paga como adulto (NULL ≠ $0).
      const infantePvp = srv.precio_infante != null ? redondearVenta(marcar(aMonedaOferta(Number(srv.precio_infante) || 0, monedaSrvOrigen), pctMk) * fLiq, monedaSrv) : null;
      filas.push({ ...comun, base_comisionable: pvp, precio_pvp: pvp, precio_pvp_menor2: infantePvp, recargo_individual: recargoPvp });
    }
  }

  // Hallazgo confirmado: un paquete cuyos hoteles son TODOS Bernalo
  // (`modelo_tarifario = 'unidad'`) queda con `hotelIds` vacío arriba —
  // nunca genera ninguna fila legacy de `tarifario_resultado` (correcto:
  // ese modelo no vive ahí, ver el comentario de `hotelesBernaloExcluidos`
  // más arriba), así que `filas.length` cae en 0 igual que un paquete
  // realmente roto (sin temporadas/tarifas). Sin este chequeo, un paquete
  // Bernalo VÁLIDO (con sus tarifas por unidad bien cargadas y publicadas
  // en `hotel_tarifas_unidad`) nunca podía guardarse. P1-3 (hallazgo
  // confirmado): la condición usa `hotelesBernaloValidos` (con tarifa
  // publicada compatible), no `hotelesBernaloExcluidos` (todo hotel
  // unidad, publicado o no) — un paquete cuyos hoteles Bernalo existen
  // pero NINGUNO tiene tarifa publicada compatible sigue sin nada que
  // ofrecer en Vista Booking, así que el error legacy sigue aplicando.
  // El caso "dinamico 100% Bernalo" ya se rechazó ARRIBA, antes de pedir la
  // generación (ver el comentario junto a `hotelIds`/`hotelesBernaloFilas`
  // al inicio de la función) — nunca puede llegar aquí.
  if (!filas.length && (tipo === "bloqueo" || tipo === "porcion_terrestre") && hotelesBernaloValidos.length === 0) {
    return await fallar(
      "No se generaron tarifas. Revisa que el hotel tenga temporadas y tarifas netas que cubran el rango de fechas del viaje."
    );
  }

  // ── Publicación atómica (migración 181) ───────────────────────────────
  // Reemplaza el `delete`+`insert` directo de antes: UNA sola llamada RPC,
  // dentro de una transacción, que solo toca `tarifario_resultado` si la
  // generación Y la revisión de fuente capturadas al principio siguen
  // vigentes. El cálculo de `filas` de arriba no cambió en absoluto — la
  // matemática es idéntica a la versión anterior de esta función.
  // #63: un paquete en modo COP/TRM publica por el envoltorio de la 227, que
  // llama al publicador VIGENTE (el de la 226, sin copiar su cuerpo) y guarda la
  // TRM/modo/fuentes de ESA publicación en la misma transacción. El resto de los
  // paquetes sigue por el publicador de siempre, sin cambios.
  const { data: publicado, error: ePublicar } = modo63
    ? await sb.rpc("publicar_tarifario_resultado_63", {
        p_paquete_id: paqueteId,
        p_generacion: generacion,
        p_revision_capturada: revisionCapturada,
        p_moneda: paqueteMoneda,
        p_filas: filas as unknown as Json,
        p_modo: MODO_OFERTA_63,
        p_trm: trm63,
      })
    : await sb.rpc("publicar_tarifario_resultado", {
        p_paquete_id: paqueteId,
        p_generacion: generacion,
        p_revision_capturada: revisionCapturada,
        p_moneda: paqueteMoneda,
        p_filas: filas as unknown as Json,
      });
  if (ePublicar) return await fallarTecnico(ePublicar.message);
  if (!publicado) {
    // Generación o revisión de fuente superadas DURANTE este cálculo — NUNCA
    // se trata como éxito engañoso: alguien más ya pidió (o ya publicó) una
    // versión más reciente de este mismo paquete mientras estas ~10
    // consultas corrían. No es un "fallo" propio (el intento vigente ya no
    // es este, `marcar_generacion_fallida` no aplica) ni hace falta
    // reintentar desde acá — la mutación que invalidó ya disparó su propio
    // recálculo automático por su cuenta (ver `regenerarTarifariosDe*`).
    return {
      ok: false,
      error:
        "Se descartó este cálculo: los datos del paquete cambiaron mientras se generaba el tarifario (ya hay una versión más reciente en curso o publicada).",
    };
  }

  // La moneda ya quedó guardada DENTRO de `publicar_tarifario_resultado`
  // (mismo commit que las filas, con el valor autoritativo `paqueteMoneda`)
  // — no hay ninguna escritura aparte que hacer acá.

  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  revalidatePath("/tarifario");
  // Hallazgo confirmado (Vista Booking unificada): el texto del aviso
  // anterior afirmaba que la integración con el tarifario todavía no
  // existía para ese modelo — eso ya no es cierto (Vista Booking muestra
  // estos hoteles mezclados con los persona, con cotización dinámica en
  // vivo) y sonaba a fracaso/pendiente incluso con el paquete bien
  // configurado. El aviso ahora distingue explícitamente (a) cuántas
  // tarifas persona/legacy se publicaron en `tarifario_resultado`, (b)
  // cuántos hoteles por unidad quedan REALMENTE disponibles para
  // cotización dinámica (con tarifa publicada compatible, `hotelesBernaloValidos`,
  // clasificado por id — P4), (c) cuáles tienen el modelo pero no una
  // tarifa publicada completa, y (d) cuáles simplemente no son compatibles
  // porque su paquete es "dinamico"/"servicios" (P2) — nunca presenta (b)
  // como una carencia, y nunca cuenta (c)/(d) como "disponible".
  const hotelesBernaloSinPublicar = nombresDeIdsBernalo(idsBernaloSinPublicar);
  const hotelesBernaloNoCompatibles = nombresDeIdsBernalo(idsBernaloNoCompatibles);
  const avisoValidos = hotelesBernaloValidos.length
    ? `${hotelesBernaloValidos.length === 1 ? "el hotel" : "los hoteles"} ${hotelesBernaloValidos.join(", ")} usa${hotelesBernaloValidos.length === 1 ? "" : "n"} el modelo tarifario por unidad — no genera${hotelesBernaloValidos.length === 1 ? "" : "n"} filas en el tarifario clásico, pero queda${hotelesBernaloValidos.length === 1 ? "" : "n"} disponible${hotelesBernaloValidos.length === 1 ? "" : "s"} en Vista Booking mediante cotización dinámica por ocupación.`
    : null;
  const avisoSinPublicar = hotelesBernaloSinPublicar.length
    ? ` ${hotelesBernaloSinPublicar.length === 1 ? "El hotel" : "Los hoteles"} ${hotelesBernaloSinPublicar.join(", ")} también usa${hotelesBernaloSinPublicar.length === 1 ? "" : "n"} el modelo por unidad, pero no tiene${hotelesBernaloSinPublicar.length === 1 ? "" : "n"} una tarifa publicada que cubra su configuración — no aparecerá${hotelesBernaloSinPublicar.length === 1 ? "" : "n"} en Vista Booking hasta publicar la tarifa que falta.`
    : "";
  const avisoNoCompatibles = hotelesBernaloNoCompatibles.length
    ? ` ${hotelesBernaloNoCompatibles.length === 1 ? "El hotel" : "Los hoteles"} ${hotelesBernaloNoCompatibles.join(", ")} también usa${hotelesBernaloNoCompatibles.length === 1 ? "" : "n"} el modelo por unidad, pero el tipo de paquete (${tipo === "dinamico" ? "dinámico" : "servicios"}) todavía no está integrado con Vista Booking — no aparecerá${hotelesBernaloNoCompatibles.length === 1 ? "" : "n"} ahí hasta que exista esa integración.`
    : "";
  const avisoVinculadas63 = omitidas63.length
    ? ` ${omitidas63.length} salida(s) vinculada(s) no se publicaron: ${omitidas63.slice(0, 3).join(" ")}`
    : "";
  const avisoDestinosAereos = excluidosPorDestinoAereo
    ? ` ${excluidosPorDestinoAereo} vuelo(s) vinculado(s) se omitieron porque su destino aéreo ya no está permitido para este paquete.`
    : "";
  // Servicios por persona (incluidos u opcionales) SIN precio de infante: el infante
  // (0 a 1,99 años) pagará como adulto en ellos hasta que se configure (NULL ≠ $0).
  const sinPrecioInfante = serviciosSinPrecioInfante(
    servicios.map((sv) => ({
      nombre: (sv.servicios_adicionales as unknown as { nombre?: string | null } | null)?.nombre ?? null,
      modo: (sv.modo as string) === "grupo" ? "grupo" : "persona",
      precioPersona: (sv.servicios_adicionales as unknown as { precio_persona?: number | null } | null)?.precio_persona ?? null,
      precioInfante: (sv.servicios_adicionales as unknown as { precio_infante?: number | null } | null)?.precio_infante ?? null,
    }))
  );
  const avisoInfante = sinPrecioInfante.length
    ? ` Atención: ${sinPrecioInfante.length === 1 ? "el servicio" : "los servicios"} ${sinPrecioInfante.join(", ")} ${sinPrecioInfante.length === 1 ? "no tiene" : "no tienen"} precio de infante: los menores de 2 años pagarán como adulto en ${sinPrecioInfante.length === 1 ? "él" : "ellos"}. Configúralo en Producto → Servicios.`
    : "";
  return {
    ok: true,
    id: filas.length,
    ...(avisoValidos || avisoSinPublicar || avisoNoCompatibles || avisoDestinosAereos || avisoVinculadas63 || avisoInfante
      ? { aviso: `${filas.length} tarifa(s) persona publicada(s) en el tarifario.${avisoValidos ? ` Además, ${avisoValidos}` : ""}${avisoSinPublicar}${avisoNoCompatibles}${avisoDestinosAereos}${avisoVinculadas63}${avisoInfante}` }
      : {}),
  };
}

// ── PAQUETES CON TARIFARIO ANTERIOR A LA TARIFA DE INFANTE (migración 226) ──
// Los tarifarios publicados antes de la 226 no traen `precio_pvp_menor2` (precio del menor de 2 años) en las filas de
// niño/infante: mientras no se regeneren, reservar con infantes pide regenerar. Esta lista (solo paquetes ACTIVOS) alimenta
// el aviso del listado de Paquetes para que se regeneren a mano, uno por uno, con el botón de siempre. Solo lectura: nunca
// regenera nada. Paginada por la cantidad REAL de filas recibidas (el límite de filas de PostgREST puede truncar en silencio).
export async function paquetesConTarifarioAnteriorAInfante(): Promise<
  { ok: true; paquetes: { id: number; nombre: string }[] } | { ok: false }
> {
  try {
    const sb = await createClient();
    const PAGINA = 1000;
    const MAX_PAGINAS = 200;
    const vistos = new Map<number, string>();
    let desde = 0;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const { data, error } = await sb
        .from("tarifario_resultado")
        .select("id, paquete_id, paquete_nombre")
        .eq("paquete_activo", true)
        .in("acomodacion", ["nino", "nino2", "infante"])
        .is("precio_pvp_menor2", null)
        .order("id")
        .range(desde, desde + PAGINA - 1);
      if (error) return { ok: false };
      const filas = data ?? [];
      if (!filas.length) return { ok: true, paquetes: [...vistos].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)) };
      for (const f of filas) if (!vistos.has(f.paquete_id)) vistos.set(f.paquete_id, f.paquete_nombre ?? `Paquete #${f.paquete_id}`);
      desde += filas.length;
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// ── AUTO-RECÁLCULO ─────────────────────────────────────────────────────────
// Regenera el tarifario de TODOS los paquetes activos que usan un hotel. Se
// llama tras editar tarifas/vigencias del hotel para que el tarifario (y el PVP
// que lee Reservar) se actualice solo, sin volver a "Generar" a mano. No lanza:
// un fallo de un paquete no debe tumbar el guardado de la tarifa.
export async function regenerarTarifariosDeHotel(hotelId: number): Promise<void> {
  if (!hotelId) return;
  try {
    const sb = await createClient();
    const { data: pkgs, error: ePkgs } = await sb
      .from("armado_hoteles")
      .select("paquete_id, armado_paquetes!inner(activo)")
      .eq("hotel_id", hotelId);
    // Hallazgo confirmado: Supabase NUNCA lanza por un error de consulta (lo
    // devuelve como `{ data: null, error }`) — sin este chequeo, `pkgs` caía
    // en `null` y `ids` quedaba vacío SIN NINGÚN rastro, indistinguible de
    // "este hotel no está en ningún paquete". Un fallo técnico (RLS, red,
    // columna renombrada) se disfrazaba de "nada que regenerar" — exactamente
    // el silencio que el resto de esta función ya corrigió para
    // `Promise.allSettled` (ver el comentario de abajo). Mensaje SANEADO
    // (nunca el error crudo) con `hotelId` — mismo criterio de logging que el
    // resto de la función. Sigue siendo best-effort: se retorna sin lanzar,
    // nunca bloquea la edición de la tarifa/temporada que disparó esta llamada.
    if (ePkgs) {
      console.error(`regenerarTarifariosDeHotel: no se pudo consultar armado_hoteles para hotel_id=${hotelId}: ${ePkgs.message}`);
      return;
    }
    const ids = [...new Set((pkgs ?? [])
      .filter((p) => (p.armado_paquetes as unknown as { activo: boolean } | null)?.activo)
      .map((p) => p.paquete_id))];
    // En paralelo: son independientes (cada uno solo toca sus propias filas de
    // tarifario_resultado) y un hotel usado en muchos paquetes tardaba segundos
    // regenerando uno por uno. Sigue siendo best-effort (nunca bloquea la
    // edición del hotel), pero un paquete que falla YA NO desaparece en
    // silencio: se loguea con su id y el motivo — antes `Promise.allSettled`
    // descartaba el array de resultados completo, así que un tarifario
    // desactualizado por un fallo técnico no dejaba ningún rastro. Dos formas
    // de fallo, ambas se detectan: la promesa RECHAZADA (excepción/error de
    // red) Y la promesa CUMPLIDA con `{ ok: false, error }` — `generarTarifario`
    // nunca lanza por un error de negocio, lo devuelve como valor resuelto, así
    // que un `status === "rejected"` a secas se lo pierde por completo.
    const resultados = await Promise.allSettled(ids.map((id) => generarTarifario(id)));
    resultados.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`regenerarTarifariosDeHotel: falló generarTarifario(paquete_id=${ids[i]}) para hotel_id=${hotelId}:`, r.reason);
      } else if (!r.value.ok) {
        console.error(`regenerarTarifariosDeHotel: generarTarifario(paquete_id=${ids[i]}) para hotel_id=${hotelId} devolvió ok:false: ${r.value.error}`);
      }
    });
  } catch (err) {
    // Sigue siendo best-effort (nunca bloquea la edición del hotel), pero ya
    // no absorbe el error en silencio total — un fallo ANTES de llegar al
    // Promise.allSettled (ej. la consulta a armado_hoteles) quedaba sin
    // ningún rastro, igual que el hallazgo ya corregido dentro del try.
    console.error(`regenerarTarifariosDeHotel: fallo técnico para hotel_id=${hotelId}:`, err);
  }
}

// Regenera el tarifario de los paquetes activos que usan un BLOQUEO aéreo. Se
// llama tras editar/eliminar el bloqueo (tarifa de empaquetar, fechas, ruta).
export async function regenerarTarifariosDeBloqueo(bloqueoId: number): Promise<void> {
  if (!bloqueoId) return;
  try {
    const sb = await createClient();
    const { data: pkgs } = await sb
      .from("armado_vuelos")
      .select("paquete_id, armado_paquetes!inner(activo)")
      .eq("bloqueo_id", bloqueoId);
    const ids = [...new Set((pkgs ?? [])
      .filter((p) => (p.armado_paquetes as unknown as { activo: boolean } | null)?.activo)
      .map((p) => p.paquete_id))];
    await Promise.allSettled(ids.map((id) => generarTarifario(id)));
  } catch { /* best-effort */ }
}

// Regenera el tarifario de los paquetes activos que usan un SERVICIO. Se llama
// tras editar/eliminar el servicio (precio por persona o tarifas por grupo).
export async function regenerarTarifariosDeServicio(servicioId: number): Promise<void> {
  if (!servicioId) return;
  try {
    const sb = await createClient();
    const { data: pkgs } = await sb
      .from("armado_servicios")
      .select("paquete_id, armado_paquetes!inner(activo)")
      .eq("servicio_id", servicioId);
    const ids = [...new Set((pkgs ?? [])
      .filter((p) => (p.armado_paquetes as unknown as { activo: boolean } | null)?.activo)
      .map((p) => p.paquete_id))];
    await Promise.allSettled(ids.map((id) => generarTarifario(id)));
  } catch { /* best-effort */ }
}

// ── SALIDAS DINÁMICAS (vuelo por sistema, sin record) ───────────────────────
export type SalidaDinamicaInput = {
  aerolinea: string;
  ruta: string;
  origen: string;
  fechaIda: string;
  fechaRegreso: string;
  horaSalidaIda: string;
  horaLlegadaIda: string;
  horaSalidaReg: string;
  horaLlegadaReg: string;
  valorTiquete: number;       // NETO adulto (2+) por pax, en la moneda del paquete
  aplicaMk: boolean;          // true: valor/(1-mk) · false: valor + ta
  ta: number;
  feeInfante: number;         // 0–1.99 años
  compraInicio: string;
  compraFin: string;
  notas: string;
  // #63: moneda acreditada de tiquete/TA/fee de la salida MANUAL en modo COP (se convierte × TRM del
  // paquete). Opcional: sin ella no se toca (la base deja COP por omisión).
  moneda?: "COP" | "USD";
};

function salidaRow(paqueteId: number, input: SalidaDinamicaInput) {
  return {
    paquete_id: paqueteId,
    aerolinea: oNull(input.aerolinea),
    ruta: oNull(input.ruta),
    origen: oNull(input.origen)?.toUpperCase() ?? null,
    fecha_ida: input.fechaIda,
    fecha_regreso: dNull(input.fechaRegreso),
    hora_salida_ida: oNull(input.horaSalidaIda),
    hora_llegada_ida: oNull(input.horaLlegadaIda),
    hora_salida_reg: oNull(input.horaSalidaReg),
    hora_llegada_reg: oNull(input.horaLlegadaReg),
    valor_tiquete: Math.max(Number(input.valorTiquete) || 0, 0),
    aplica_mk: !!input.aplicaMk,
    ta: Math.max(Number(input.ta) || 0, 0),
    fee_infante: Math.max(Number(input.feeInfante) || 0, 0),
    compra_inicio: dNull(input.compraInicio),
    compra_fin: dNull(input.compraFin),
    notas: oNull(input.notas),
    ...(input.moneda === "USD" || input.moneda === "COP" ? { moneda: input.moneda } : {}),
  };
}

export async function crearSalidaDinamica(paqueteId: number, input: SalidaDinamicaInput): Promise<Result> {
  const sb = await createClient();
  if (!input.fechaIda) return { ok: false, error: "La fecha de ida es obligatoria." };
  const { error } = await sb.from("salidas_dinamicas").insert(salidaRow(paqueteId, input));
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  try { await generarTarifario(paqueteId); } catch { /* sigue */ }
  return { ok: true };
}

export async function actualizarSalidaDinamica(id: number, input: SalidaDinamicaInput): Promise<Result> {
  const sb = await createClient();
  if (!input.fechaIda) return { ok: false, error: "La fecha de ida es obligatoria." };
  const { data: prev } = await sb.from("salidas_dinamicas").select("paquete_id, empaquetado_id").eq("id", id).maybeSingle();
  // #63: una salida vinculada guarda una COPIA de su fuente; editar esos campos a mano
  // la dejaría distinta del vuelo real. Se actualiza solo desde la fuente.
  if ((prev as { empaquetado_id?: number | null } | null)?.empaquetado_id != null) {
    return { ok: false, error: "Esta salida está vinculada a un vuelo de Empaquetados: sus datos no se editan aquí. Usa \"Actualizar desde la fuente\" o desvincúlala." };
  }
  const { paquete_id: _omit, ...row } = salidaRow(prev?.paquete_id ?? 0, input);
  void _omit;
  const { error } = await sb.from("salidas_dinamicas").update(row).eq("id", id);
  if (error) return { ok: false, error: mensajeErrorOferta63(error.message) };
  if (prev?.paquete_id) {
    revalidatePath(`/dashboard/paquetes/${prev.paquete_id}`);
    try { await generarTarifario(prev.paquete_id); } catch { /* sigue */ }
  }
  return { ok: true };
}

export async function eliminarSalidaDinamica(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: prev } = await sb.from("salidas_dinamicas").select("paquete_id").eq("id", id).maybeSingle();
  const { error } = await sb.from("salidas_dinamicas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (prev?.paquete_id) {
    revalidatePath(`/dashboard/paquetes/${prev.paquete_id}`);
    try { await generarTarifario(prev.paquete_id); } catch { /* sigue */ }
  }
  return { ok: true };
}

// ── SALIDAS VINCULADAS A EMPAQUETADOS SIN RECORD (#63, migración 227) ───────
// Una salida vinculada toma de un vuelo de Empaquetados SIN record sus fechas, ruta y tarifas
// (R = precio final del aéreo, sin markup; F = fee de infante). Se consulta SOLO la tabla
// `empaquetados` (nunca contratos ni vuelos con PNR); la lista es múltiple, muestra todas las
// elegibles ya revisadas y NO incorpora nada sola: las nuevas aparecen como pendientes y el
// usuario las agrega y regenera. Reutiliza la configuración de destinos aéreos de la 220.

const SELECT_FUENTE_63 =
  "id, activo, record, compra_inicio, compra_fin, fecha_ida, fecha_regreso, ruta, aerolinea, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, destino_id, moneda, tarifa_para_empaquetar, fee_infante";

const MSG_TECNICO_63 = "No se pudo completar la operación por un error técnico. Intenta nuevamente.";

/** Traduce los errores de las guardas de la 227 a mensajes de negocio (nunca texto crudo de Postgres). */
function mensajeErrorOferta63(mensaje: string | null | undefined): string {
  const m = mensaje ?? "";
  if (/salida_vinculada_modo/i.test(m)) return "Las salidas vinculadas a Empaquetados exigen que el paquete sea Dinámico en modo COP con TRM.";
  if (/salida_vinculada_moneda/i.test(m)) return "La salida debe tener la misma moneda que su vuelo de Empaquetados. Actualízala desde la fuente.";
  if (/salida_vinculada_record/i.test(m)) return "Ese vuelo de Empaquetados ya tiene record (PNR): una salida vinculada solo admite vuelos de sistema sin record.";
  if (/salida_vinculada_unica/i.test(m) || /salidas_dinamicas_paquete_empaquetado_uk/i.test(m)) return "Ese vuelo de Empaquetados ya está vinculado a este paquete.";
  if (/modo_oferta_vinculadas/i.test(m)) return "Hay salidas vinculadas a Empaquetados: desvincúlalas antes de cambiar el modo de oferta del paquete.";
  if (/destino_aereo_vinculos|destino_aereo_no_permitido|destino_aereo_config/i.test(m)) return mensajeErrorBase(m);
  return MENSAJE_ERROR_TECNICO_TARIFARIO;
}

export type CandidatoSalida63 = {
  id: number;
  ruta: string | null;
  aerolinea: string | null;
  fechaIda: string;
  fechaRegreso: string;
  compraInicio: string | null;
  compraFin: string | null;
  /** Precio final del aéreo por pasajero (R) y fee de infante (F): datos de venta, nunca el costo N. */
  tarifaParaEmpaquetar: number;
  feeInfante: number;
  /** 230: moneda de R y F (COP o USD). */
  moneda: "COP" | "USD";
  salidaId: number | null;
  /** true = ya hay una salida vinculada a este vuelo en el paquete. */
  vinculado: boolean;
  /** true = la salida vinculada guarda una copia distinta de la fuente o la fuente dejó de ser elegible. */
  desactualizado: boolean;
};

type PaqueteOferta63 = { id: number; tipo: string; destino_id: number | null; modo_oferta: string | null; trm_oferta: number | null };

async function leerPaqueteOferta63(
  sb: Awaited<ReturnType<typeof createClient>>,
  paqueteId: number
): Promise<{ ok: true; paquete: PaqueteOferta63 } | { ok: false; error: string }> {
  const { data, error } = await sb.from("armado_paquetes").select("id, tipo, destino_id, modo_oferta, trm_oferta").eq("id", paqueteId).maybeSingle();
  if (error) return { ok: false, error: MSG_TECNICO_63 };
  if (!data) return { ok: false, error: "El paquete ya no existe." };
  const p = data as unknown as PaqueteOferta63;
  if (p.tipo !== "dinamico") return { ok: false, error: "Las salidas vinculadas a Empaquetados solo existen en paquetes Dinámico." };
  if (!esModo63(p.modo_oferta)) return { ok: false, error: "Activa el modo COP con TRM en la configuración del paquete para vincular salidas de Empaquetados." };
  return { ok: true, paquete: p };
}

/** Todas las filas ACTIVAS de `empaquetados` (paginado por filas REALES: PostgREST puede truncar sin error). */
async function leerEmpaquetadosActivos63(
  sb: Awaited<ReturnType<typeof createClient>>
): Promise<{ ok: true; filas: (FuenteEmpaquetado63 & { id: number })[] } | { ok: false }> {
  const PAGINA = 1000;
  const MAX_PAGINAS = 100;
  const filas: (FuenteEmpaquetado63 & { id: number })[] = [];
  let desde = 0;
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { data, error } = await sb
      .from("empaquetados")
      .select(SELECT_FUENTE_63)
      .eq("activo", true)
      .order("fecha_ida")
      .order("id")
      .range(desde, desde + PAGINA - 1);
    if (error) return { ok: false };
    const lote = (data ?? []) as unknown as (FuenteEmpaquetado63 & { id: number })[];
    if (!lote.length) return { ok: true, filas };
    filas.push(...lote);
    desde += lote.length;
  }
  return { ok: false };
}

export async function listarEmpaquetadosParaSalidas63(
  paqueteId: number
): Promise<{ ok: true; candidatos: CandidatoSalida63[]; pendientes: number } | { ok: false; error: string }> {
  const sb = await createClient();
  const pq = await leerPaqueteOferta63(sb, paqueteId);
  if (!pq.ok) return pq;
  const [fuentes, vinculadas, ef] = await Promise.all([
    leerEmpaquetadosActivos63(sb),
    sb
      .from("salidas_dinamicas")
      .select("id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, moneda")
      .eq("paquete_id", paqueteId)
      .not("empaquetado_id", "is", null),
    resolverDestinosAereosPaquete(sb, paqueteId),
  ]);
  if (!fuentes.ok || vinculadas.error || !ef.ok) return { ok: false, error: MSG_TECNICO_63 };
  if (!ef.efectivos.ok) return { ok: false, error: ef.efectivos.error };
  const permitidos = ef.efectivos.ids;
  const salidaPorFuente = new Map<number, Record<string, unknown>>();
  for (const v of (vinculadas.data ?? []) as unknown as (Record<string, unknown> & { empaquetado_id: number })[]) {
    salidaPorFuente.set(v.empaquetado_id, v);
  }
  const hoy = hoyBogota(new Date());
  const candidatos: CandidatoSalida63[] = [];
  for (const f of fuentes.filas) {
    const ya = salidaPorFuente.get(f.id) ?? null;
    const elegible = evaluarFuenteVinculada63(f, hoy).ok;
    const destinoOk =
      motivoRechazoFuente(permitidos, { id: f.id, destino_id: f.destino_id ?? null, ruta: f.ruta ?? null, record: f.record ?? null }) === null;
    // Las ya vinculadas se muestran aunque dejaran de ser elegibles (para poder revisarlas);
    // las demás, solo si lo son hoy (sin record, vigentes, destino aéreo permitido).
    if (!ya && !(elegible && destinoOk)) continue;
    candidatos.push({
      id: f.id,
      ruta: f.ruta ?? null,
      aerolinea: f.aerolinea ?? null,
      fechaIda: f.fecha_ida as string,
      fechaRegreso: f.fecha_regreso as string,
      compraInicio: f.compra_inicio ?? null,
      compraFin: f.compra_fin ?? null,
      tarifaParaEmpaquetar: Number(f.tarifa_para_empaquetar) || 0,
      feeInfante: Number(f.fee_infante) || 0,
      moneda: f.moneda === "USD" ? "USD" : "COP",
      salidaId: ya ? Number(ya.id) : null,
      vinculado: !!ya,
      desactualizado: ya ? !fuenteCoincideConSalida63(ya as never, f).ok || !elegible || !destinoOk : false,
    });
  }
  return { ok: true, candidatos, pendientes: candidatos.filter((c) => !c.vinculado).length };
}

/**
 * Vincula VARIOS vuelos de Empaquetados sin record como salidas del paquete: TODO o NADA.
 * Se valida cada fuente (elegibilidad + destino aéreo de la 220) ANTES de escribir; un solo
 * INSERT; la base repite las guardas. Deduplica y respeta la unicidad (paquete, fuente).
 */
export async function vincularSalidasEmpaquetados63(paqueteId: number, empaquetadoIds: number[]): Promise<Result> {
  const sb = await createClient();
  const ids = [...new Set((empaquetadoIds ?? []).map(Number))];
  if (!ids.length || ids.length > 200 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    return { ok: false, error: "Elige al menos un vuelo de Empaquetados." };
  }
  const pq = await leerPaqueteOferta63(sb, paqueteId);
  if (!pq.ok) return pq;
  const { data: fuentesRows, error: eF } = await sb.from("empaquetados").select(SELECT_FUENTE_63).in("id", ids);
  if (eF) return { ok: false, error: MSG_TECNICO_63 };
  const porId = new Map(((fuentesRows ?? []) as unknown as (FuenteEmpaquetado63 & { id: number })[]).map((x) => [x.id, x]));
  const hoy = hoyBogota(new Date());
  const rechazos: string[] = [];
  for (const id of ids) {
    const fuente = porId.get(id) ?? null;
    const ev = evaluarFuenteVinculada63(fuente, hoy);
    if (!ev.ok) rechazos.push(`${fuente ? etiquetaSalidaVinculada63(fuente) : `#${id}`}: ${ev.error}`);
  }
  if (rechazos.length) return { ok: false, error: `No se vinculó ningún vuelo. ${rechazos.slice(0, 3).join(" ")}` };
  const val = await validarLoteOrigenesAereos(sb, paqueteId, ids.map((id) => ({ tipo: "empaquetado" as const, id })));
  if (!val.ok) return { ok: false, error: val.error };
  const { data: ya, error: eYa } = await sb.from("salidas_dinamicas").select("empaquetado_id").eq("paquete_id", paqueteId).in("empaquetado_id", ids);
  if (eYa) return { ok: false, error: MSG_TECNICO_63 };
  const yaVinculados = new Set(((ya ?? []) as { empaquetado_id: number | null }[]).map((x) => x.empaquetado_id));
  const nuevos = ids.filter((id) => !yaVinculados.has(id));
  if (!nuevos.length) return { ok: false, error: "Todos esos vuelos ya están vinculados a este paquete." };
  const filas = nuevos.map((id) => ({ paquete_id: paqueteId, empaquetado_id: id, ...copiarDeFuente63(porId.get(id) as FuenteEmpaquetado63) }));
  const { error } = await sb.from("salidas_dinamicas").insert(filas);
  if (error) return { ok: false, error: mensajeErrorOferta63(error.message) };
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  const regen = await generarTarifario(paqueteId).catch(() => null);
  if (!regen || !regen.ok) {
    return {
      ok: true,
      id: nuevos.length,
      aviso: `Se vincularon ${nuevos.length} salida(s), pero el tarifario no se pudo regenerar${regen && !regen.ok ? `: ${regen.error}` : ""}. Genéralo desde el paquete.`,
    };
  }
  return { ok: true, id: nuevos.length, ...(regen.aviso ? { aviso: regen.aviso } : {}) };
}

/**
 * Desvincula VARIAS salidas vinculadas a Empaquetados de una vez (#107): UN delete, UNA invalidación y UNA regeneración
 * del tarifario (antes, cada salida eliminada regeneraba el tarifario completo). Solo toca salidas VINCULADAS de ESTE
 * paquete; el vuelo de Empaquetados no se toca. Las que ya no estaban vinculadas se informan como omitidas.
 */
export async function desvincularSalidasEmpaquetados63(paqueteId: number, salidaIds: number[]): Promise<ResultadoLote> {
  const ids = [...new Set((salidaIds ?? []).map(Number))];
  if (!ids.length || ids.length > 200 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    return { ok: false, error: "Elige al menos una salida vinculada." };
  }
  const sb = await createClient();
  const { data, error } = await sb
    .from("salidas_dinamicas")
    .delete()
    .eq("paquete_id", paqueteId)
    .not("empaquetado_id", "is", null)
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, error: mensajeErrorOferta63(error.message) };
  const borrados = new Set(((data ?? []) as { id: number }[]).map((x) => x.id));
  if (!borrados.size) return { ok: false, error: "Esas salidas ya no estaban vinculadas a este paquete." };
  const omitidos = ids.filter((id) => !borrados.has(id)).map((id) => ({ id, motivo: `La salida #${id} ya no estaba vinculada.` }));
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  const regen = await generarTarifario(paqueteId).catch(() => null);
  const aviso = !regen || !regen.ok
    ? `Se desvincularon las salidas, pero el tarifario no se pudo regenerar${regen && !regen.ok ? `: ${regen.error}` : ""}. Genéralo desde el paquete.`
    : regen.aviso;
  return { ok: true, procesados: borrados.size, ...(omitidos.length ? { omitidos } : {}), ...(aviso ? { aviso } : {}) };
}

/** Vuelve a copiar de la fuente VIVA los datos de una salida vinculada (la copia quedó vieja) y regenera. */
export async function actualizarSalidaDesdeFuente63(salidaId: number): Promise<Result> {
  const sb = await createClient();
  const { data: sal, error: eS } = await sb.from("salidas_dinamicas").select("id, paquete_id, empaquetado_id").eq("id", salidaId).maybeSingle();
  if (eS) return { ok: false, error: MSG_TECNICO_63 };
  const s = sal as unknown as { id: number; paquete_id: number; empaquetado_id: number | null } | null;
  if (!s || s.empaquetado_id == null) return { ok: false, error: "Esta salida no está vinculada a un vuelo de Empaquetados." };
  const { data: f, error: eF } = await sb.from("empaquetados").select(SELECT_FUENTE_63).eq("id", s.empaquetado_id).maybeSingle();
  if (eF) return { ok: false, error: MSG_TECNICO_63 };
  const fuente = f as unknown as (FuenteEmpaquetado63 & { id: number }) | null;
  const ev = evaluarFuenteVinculada63(fuente, hoyBogota(new Date()));
  if (!ev.ok) return { ok: false, error: ev.error };
  const val = await validarLoteOrigenesAereos(sb, s.paquete_id, [{ tipo: "empaquetado", id: s.empaquetado_id }]);
  if (!val.ok) return { ok: false, error: val.error };
  const { error } = await sb.from("salidas_dinamicas").update(copiarDeFuente63(fuente as FuenteEmpaquetado63)).eq("id", salidaId);
  if (error) return { ok: false, error: mensajeErrorOferta63(error.message) };
  revalidatePath(`/dashboard/paquetes/${s.paquete_id}`);
  const regen = await generarTarifario(s.paquete_id).catch(() => null);
  if (!regen || !regen.ok) {
    return { ok: true, aviso: `La salida se actualizó, pero el tarifario no se pudo regenerar${regen && !regen.ok ? `: ${regen.error}` : ""}. Genéralo desde el paquete.` };
  }
  return { ok: true, ...(regen.aviso ? { aviso: regen.aviso } : {}) };
}
