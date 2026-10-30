// Transformaciones PURAS de la consulta de PORCIÓN TERRESTRE (#56): validar
// la búsqueda, armar la entrada de los motores vigentes y reducir sus salidas
// a la lista blanca.
//
// Motores (consumidos, nunca editados):
//   · `buscarHoteles` (lib/reservar/cotizar.ts): reliquida EN VIVO cada hotel
//     de porción publicable para fechas y composición reales.
//   · `cotizarPorFechas`: PVP por persona de un hotel por combo, con
//     sugerencias de fecha y el aviso de servicios cobrados por grupo.
//   · `computarReserva` (rama con fechas): el total que usa la venta.
// El "desde" publicado del tarifario NUNCA se presenta como cotización.
import type { FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import type { ReservaInput } from "@/lib/reservar/computo";
import type { BusquedaResultado, CotizarResult } from "@/lib/reservar/cotizar";
import type { CondicionHotelFechas, SugerenciaFecha } from "@/lib/reservar/liquidacionHotel";
import { LIMITE_MAXIMO_BUSQUEDA } from "@/lib/salesbot/contrato";
import {
  habitacionesComoLista,
  preciosPublicables,
  validarComposicion,
  type Composicion,
  type CotizacionPaquete,
  type CotizacionPorcionPorPersona,
  type ResultadoBusquedaPorcion,
  type ResultadoPorcion,
} from "@/lib/salesbot/paquetes/contrato";

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const esFecha = (v: string) => FECHA_ISO.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Destinos con porción terrestre publicada (los mismos nombres exactos que filtra `buscarHoteles`). */
export function destinosPorcion(filas: readonly FilaTarifario[]): string[] {
  const s = new Set<string>();
  for (const f of filas) if (f.modulo === "porcion_terrestre" && f.destino_nombre?.trim()) s.add(f.destino_nombre.trim());
  return [...s].sort((a, b) => a.localeCompare(b, "es"));
}

/** ¿Existe esa combinación paquete + hotel en la porción publicada visible? (falla cerrado). */
export function porcionPublicada(filas: readonly FilaTarifario[], paqueteId: number, hotelId: number): boolean {
  return filas.some((f) => f.modulo === "porcion_terrestre" && f.paquete_id === paqueteId && f.hotel_id === hotelId);
}

export type ConsultaPorcion = {
  destino: string;
  fechaIda: string;
  fechaRegreso: string;
  adultos: number;
  composicion: Composicion;
  limite?: number;
};

function validarFechas(entrada: Record<string, string | undefined>, campos: string[]): { fechaIda: string; fechaRegreso: string } | null {
  const ida = (entrada.fechaIda ?? "").trim();
  const reg = (entrada.fechaRegreso ?? "").trim();
  if (!esFecha(ida)) campos.push("fechaIda");
  if (!esFecha(reg)) campos.push("fechaRegreso");
  if (esFecha(ida) && esFecha(reg) && reg <= ida) campos.push("fechaRegreso");
  return esFecha(ida) && esFecha(reg) && reg > ida ? { fechaIda: ida, fechaRegreso: reg } : null;
}

/**
 * Valida la búsqueda de porción. El destino es OBLIGATORIO y debe ser uno de
 * los destinos publicados: así nunca se reliquida el catálogo completo.
 */
export function validarConsultaPorcion(
  entrada: Record<string, string | undefined>,
  destinosValidos: readonly string[]
): { ok: true; consulta: ConsultaPorcion } | { ok: false; campos: string[] } {
  const campos: string[] = [];
  const destino = (entrada.destino ?? "").trim();
  if (!destino || !destinosValidos.includes(destino)) campos.push("destino");
  const fechas = validarFechas(entrada, campos);
  const adultos = Number((entrada.adultos ?? "").trim());
  if (!Number.isInteger(adultos) || adultos < 1 || adultos > 40) campos.push("adultos");
  const comp = validarComposicion(entrada);
  if (!comp.ok) campos.push(...comp.campos);
  const limiteTxt = (entrada.limite ?? "").trim();
  let limite: number | undefined;
  if (limiteTxt) {
    const n = Number(limiteTxt);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO_BUSQUEDA) campos.push("limite");
    else limite = n;
  }
  if (campos.length || !fechas || !comp.ok) return { ok: false, campos: [...new Set(campos)] };
  return { ok: true, consulta: { destino, ...fechas, adultos, composicion: comp.composicion, limite } };
}

/** Entrada de `buscarHoteles`: la misma forma que envía el buscador de Vista Booking. */
export function entradaBuscarHoteles(c: ConsultaPorcion) {
  return {
    fechaIda: c.fechaIda,
    fechaRegreso: c.fechaRegreso,
    habitaciones: habitacionesComoLista(c.composicion.habitaciones),
    adultos: c.adultos,
    cantidadMenores: c.composicion.edadesMenores.length,
    edadesMenores: [...c.composicion.edadesMenores],
    destino: c.destino,
  };
}

function condicionPublica(c: CondicionHotelFechas | null | undefined): ResultadoPorcion["condicion_pago"] {
  if (!c) return null;
  return { tipo: String(c.condicionPagoTipo), pct_inicial: c.pctInicial, dias_saldo: c.diasSaldo, no_reembolsable: c.restringido };
}

const sugerenciasPublicas = (s: readonly SugerenciaFecha[] | undefined) =>
  (s ?? []).map((x) => ({ fecha_ida: x.fechaIda, fecha_regreso: x.fechaRegreso, noches: x.noches, etiqueta: x.etiqueta }));

/** Reduce los resultados de `buscarHoteles` a la lista blanca (total → `total_orientativo`). */
export function aResultadoBusquedaPorcion(
  resultados: readonly BusquedaResultado[],
  sugerencias: readonly SugerenciaFecha[] | undefined,
  limite = 10
): ResultadoBusquedaPorcion {
  const lista: ResultadoPorcion[] = resultados.slice(0, limite).map((r) => ({
    hotel_id: r.hotelId,
    hotel_nombre: r.hotelNombre,
    destino: r.destino,
    paquete_id: r.paqueteId,
    paquete_nombre: r.paqueteNombre,
    fecha_ida: r.fechaIda,
    fecha_regreso: r.fechaRegreso,
    noches: r.noches,
    moneda: (r.moneda ?? "COP").toUpperCase(),
    combos: r.combos.map((c) => ({ categoria: c.categoria, regimen: c.regimen, total_orientativo: c.total, pax: c.pax })),
    condicion_pago: condicionPublica(r.condicion),
    disponibilidad_hotel: "sujeto_a_confirmacion",
  }));
  return {
    resultados: lista,
    total_encontrados: resultados.length,
    truncado: resultados.length > lista.length,
    sugerencias_fecha: sugerenciasPublicas(sugerencias),
  };
}

export type SeleccionPorcion = {
  paqueteId: number;
  hotelId: number;
  fechaIda: string;
  fechaRegreso: string;
  /** Combo y composición: opcionales; con los tres se pide además el total orientativo. */
  categoria: string | null;
  regimen: string | null;
  composicion: Composicion | null;
};

export function validarSeleccionPorcion(entrada: Record<string, string | undefined>): { ok: true; seleccion: SeleccionPorcion } | { ok: false; campos: string[] } {
  const campos: string[] = [];
  const paqueteId = Number(entrada.paquete);
  const hotelId = Number(entrada.hotel);
  if (!Number.isInteger(paqueteId) || paqueteId <= 0) campos.push("paquete");
  if (!Number.isInteger(hotelId) || hotelId <= 0) campos.push("hotel");
  const fechas = validarFechas(entrada, campos);
  const combo = (entrada.combo ?? "").trim();
  let categoria: string | null = null;
  let regimen: string | null = null;
  if (combo) {
    const sep = combo.indexOf("|");
    categoria = sep > 0 ? combo.slice(0, sep).trim() : "";
    regimen = sep > 0 ? combo.slice(sep + 1).trim() : "";
    if (!categoria || !regimen) campos.push("combo");
  }
  let composicion: Composicion | null = null;
  if (combo) {
    const comp = validarComposicion(entrada);
    if (!comp.ok) campos.push(...comp.campos);
    else composicion = comp.composicion;
  }
  if (campos.length || !fechas) return { ok: false, campos: [...new Set(campos)] };
  return { ok: true, seleccion: { paqueteId, hotelId, ...fechas, categoria, regimen, composicion } };
}

/**
 * Entrada de `computarReserva` para el total de porción: la MISMA forma que
 * arma el checkout de Vista Booking (fechas reales, sin vuelo, sin datos
 * personales, sin servicios add-on ni mascotas).
 */
export function entradaComputoPorcion(s: SeleccionPorcion & { categoria: string; regimen: string; composicion: Composicion }): ReservaInput {
  return {
    paqueteId: s.paqueteId,
    bloqueoId: null,
    modulo: "porcion_terrestre",
    hotelId: s.hotelId,
    fechaIda: s.fechaIda,
    fechaRegreso: s.fechaRegreso,
    categoria: s.categoria,
    regimen: s.regimen,
    habitaciones: { ...s.composicion.habitaciones },
    ninos: 0,
    ninos2: 0,
    infantes: 0,
    edadesMenores: [...s.composicion.edadesMenores],
    cantidadMenores: s.composicion.edadesMenores.length,
    cliente: { nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "" },
    tipoAsesor: "interno",
    asesorInterno: "",
    agenciaNombre: "",
    agenciaAsesor: "",
    freelanceNombre: "",
    aliadoId: null,
    plazo: "",
    pasajeros: [],
    servicios: [],
  };
}

/** Reduce `cotizarPorFechas` (ya sin netos) a la lista blanca; nunca copia otra cosa que los PVP publicables. */
export function aCotizacionPorPersona(
  s: SeleccionPorcion,
  r: Extract<CotizarResult, { ok: true }>,
  cotizacion: CotizacionPaquete | null
): CotizacionPorcionPorPersona {
  const combos = r.combos
    .map((c) => ({ categoria: c.categoria, regimen: c.regimen, pvp_por_persona: preciosPublicables(c.precios) }))
    .filter((c) => Object.keys(c.pvp_por_persona).length > 0);
  const pendientes = [...(r.serviciosGrupoPendientes ?? [])];
  return {
    paquete_id: s.paqueteId,
    hotel_id: s.hotelId,
    fecha_ida: s.fechaIda,
    fecha_regreso: s.fechaRegreso,
    noches: r.noches,
    moneda: (r.moneda ?? "COP").toUpperCase(),
    combos,
    condicion_pago: condicionPublica(r.condicion ?? null),
    servicios_grupo_pendientes: pendientes,
    precio_no_final: pendientes.length > 0,
    cotizacion,
    disponibilidad_hotel: "sujeto_a_confirmacion",
  };
}

export { sugerenciasPublicas };
