// ─────────────────────────────────────────────────────────────────────────
// #120 · Hoteles a solicitud (sin tarifa publicada). Módulo PURO (sin I/O; import relativo a propósito: se prueba con `node --test`).
//
// Un hotel marcado «bajo solicitud» no tiene filas en `tarifa_hotel`. La solicitud del cliente crea una cotización `pendiente_tarifa` SIN importes; cuando un
// operador carga la NETA TOTAL del hotel para toda la estadía y todas las habitaciones, esa neta se convierte en una tarifa SINTÉTICA EN MEMORIA (nunca se escribe en
// `tarifa_hotel`) y entra por el MISMO motor de siempre (`evaluarHotelPorFechas`: markup del paquete, servicios incluidos, vuelo, impuesto, redondeo).
//
// REGLA DE REPARTO CONFIRMADA POR EL DUEÑO (reemplaza el «igual para todos»):
//   · Sin niños: el hotel se carga a los ADULTOS (sin elección).
//   · Con niños: el operador elige «Cargar hotel a los adultos» (niños con neta hotelera $0) o «Distribuir» (neta por adulto y por niño para toda la estadía; deben sumar la
//     neta total, con tolerancia de centavos).
//   · Infantes: SIEMPRE neta hotelera $0, en cualquier modo.
//   Los conteos (adultos = habitaciones × pax de tarifa; niños; infantes) salen de la solicitud guardada con las reglas de edad vigentes del hotel.
// ─────────────────────────────────────────────────────────────────────────

import type { DatosHotelPaquete, FilaTarifaHotelRaw, FilaTemporadaHotelRaw } from "./liquidacionHotel.ts";

/** Texto EXACTO que ve el cliente en lugar de un precio. */
export const TEXTO_BAJO_SOLICITUD = "Tarifa y disponibilidad bajo solicitud";
export const ESTADO_PENDIENTE_TARIFA = "pendiente_tarifa";
export const ITEM_REF_HOTEL = "hotel";
export const NOMBRE_TEMPORADA_SOLICITUD = "SOLICITUD";

export type ModalidadTarifa = "tarifada" | "bajo_solicitud";
export const esBajoSolicitud = (m: unknown): boolean => m === "bajo_solicitud";

export type ModoReparto = "adultos" | "distribuir";
export type ConteosViajeros = { adultos: number; ninos: number; infantes: number };

/** Elección congelada (PRIVADA: vive en `cotizacion_tarifa_solicitud`, nunca en payload/detalle públicos). Los importes son por persona para TODA la estadía. */
export type RepartoNeta = ConteosViajeros & { modo: ModoReparto; netaAdulto: number; netaNino: number; netaInfante: 0 };

/** Neta cargada por el operador (la que viaja desde `cotizacion_tarifa_solicitud`, jamás desde el navegador). */
export type NetaSolicitud = { netaTotal: number; moneda: "COP" | "USD"; reparto: RepartoNeta };

/** Aporte del vuelo del paquete por persona (bloqueo/empaquetado) y su fee de infante; porción terrestre = sin vuelo. */
export type VueloSolicitud = { aporte: number; feeInfante: number; impuesto: number };

export function validarNeta(valor: unknown): { ok: true; neta: number } | { ok: false; error: string } {
  const n = typeof valor === "number" ? valor : Number(String(valor ?? "").trim().replace(/\s/g, ""));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "La neta del hotel debe ser un número mayor que cero." };
  if (n > 1e12) return { ok: false, error: "La neta del hotel es demasiado grande." };
  return { ok: true, neta: Math.round(n * 100) / 100 };
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** Redondeo mínimo admitido entre la suma de los importes por tipo y la neta total: un centavo por persona que paga hotel (dos importes con centavos). */
export function toleranciaCentavos(personasQuePagan: number): number {
  return Math.max(1, personasQuePagan) * 0.01 + 1e-9;
}

export type EntradaReparto = { netaTotal?: unknown; modo?: unknown; netaAdulto?: unknown; netaNino?: unknown; netaInfante?: unknown };

/** Interpreta lo que manda el navegador (un número = «cargar a adultos») y lo valida contra los conteos calculados en servidor. */
export function validarReparto(entrada: unknown, c: ConteosViajeros): { ok: true; netaTotal: number; reparto: RepartoNeta } | { ok: false; error: string } {
  const e: EntradaReparto = typeof entrada === "object" && entrada !== null && !Array.isArray(entrada) ? (entrada as EntradaReparto) : { netaTotal: entrada };
  const vn = validarNeta(e.netaTotal);
  if (!vn.ok) return vn;
  const modo = e.modo == null || e.modo === "" ? "adultos" : e.modo;
  if (modo !== "adultos" && modo !== "distribuir") return { ok: false, error: "Elige cómo cargar el hotel: a los adultos o distribuido." };
  if (!(c.adultos >= 1) || !Number.isInteger(c.adultos) || !(c.ninos >= 0) || !(c.infantes >= 0)) return { ok: false, error: "No se pudo contar a los viajeros de la solicitud." };
  // Infantes: SIEMPRE $0. Cualquier otro valor se rechaza (no se ignora en silencio).
  if (e.netaInfante != null && e.netaInfante !== "" && Number(e.netaInfante) !== 0) return { ok: false, error: "Los infantes siempre van con neta hotelera $0." };
  if (modo === "adultos") {
    if (e.netaAdulto != null && e.netaAdulto !== "" || e.netaNino != null && e.netaNino !== "") return { ok: false, error: "«Cargar hotel a los adultos» no lleva importes por tipo; usa «Distribuir» si quieres repartirlos." };
    return { ok: true, netaTotal: vn.neta, reparto: { modo, ...c, netaAdulto: Math.round((vn.neta / c.adultos) * 1e6) / 1e6, netaNino: 0, netaInfante: 0 } };
  }
  if (c.ninos <= 0) return { ok: false, error: "No hay niños en la solicitud: el hotel se carga a los adultos (no hay nada que distribuir)." };
  const na = Number(String(e.netaAdulto ?? "").trim()), nn = Number(String(e.netaNino ?? "").trim());
  if (!Number.isFinite(na) || na <= 0 || !Number.isFinite(nn) || nn <= 0) return { ok: false, error: "Indica la neta por adulto y por niño (mayores que cero) para toda la estadía." };
  const netaAdulto = redondear2(na), netaNino = redondear2(nn);
  const diferencia = c.adultos * netaAdulto + c.ninos * netaNino - vn.neta;
  if (Math.abs(diferencia) > toleranciaCentavos(c.adultos + c.ninos))
    return { ok: false, error: `La distribución no cuadra: ${c.adultos} adulto(s) × ${netaAdulto} + ${c.ninos} niño(s) × ${netaNino} = ${redondear2(c.adultos * netaAdulto + c.ninos * netaNino)}, y la neta total es ${vn.neta} (${diferencia > 0 ? "sobran" : "faltan"} ${Math.abs(redondear2(diferencia))}).` };
  return { ok: true, netaTotal: vn.neta, reparto: { modo, ...c, netaAdulto, netaNino, netaInfante: 0 } };
}

// ── Mismo total en «adultos» y en «distribuir» (regla confirmada) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// El total vendido NO depende de cómo se reparta la neta: el de referencia es el que produce «Cargar hotel a los adultos» con la misma neta (el motor de siempre, redondeo por persona).
// «Distribuir» cambia importes por viajero; como cada importe se redondea por persona (al millar en COP, al dólar en USD), la suma puede diferir del de referencia por ese redondeo.
// Ese residuo (referencia − suma) NO se esconde en el importe de un viajero ni en el costo/CxP: va en UNA línea explícita de la cotización y del contrato («Ajuste de redondeo del reparto
// del hotel», puede ser ±). No es una regla comercial nueva: solo hace que el total sea el mismo que sin repartir. Un residuo mayor que el redondeo posible (una unidad por persona que
// carga hotel) NO es redondeo: se rechaza en vez de absorberlo.
export const DESCRIPCION_AJUSTE_REDONDEO = "Ajuste de redondeo del reparto del hotel";
/** Cómo se rotula esa línea en los documentos de CLIENTE (cotización pública, cotización del cliente y contrato): sin «reparto del hotel» (concepto interno) y solo con importe en «Valor total». El texto completo vive en los ítems guardados (editor interno). */
export const ETIQUETA_AJUSTE_CLIENTE = "Ajuste por redondeo";
/** ¿Es la línea de ajuste? Compara con la constante ÚNICA (nunca con un texto escrito a mano en otro lado). */
export const esLineaAjusteRedondeo = (descripcion: unknown): boolean => descripcion === DESCRIPCION_AJUSTE_REDONDEO;

/** La misma neta cargada toda a los adultos (la referencia del total). Mismos conteos, mismo redondeo de la neta por adulto que `validarReparto`. */
export function repartoDeReferencia(neta: NetaSolicitud): NetaSolicitud {
  const c = neta.reparto;
  return { ...neta, reparto: { modo: "adultos", adultos: c.adultos, ninos: c.ninos, infantes: c.infantes, netaAdulto: Math.round((neta.netaTotal / c.adultos) * 1e6) / 1e6, netaNino: 0, netaInfante: 0 } };
}

export function ajusteRedondeoReparto(a: { totalReferencia: number; total: number; personasQueCargan: number; unidad: number }): { ok: true; ajuste: number } | { ok: false; error: string } {
  const ajuste = Math.round((a.totalReferencia - a.total) * 100) / 100;
  const tope = a.unidad * Math.max(1, a.personasQueCargan);
  if (!Number.isFinite(ajuste) || Math.abs(ajuste) > tope)
    return { ok: false, error: `El total con «Distribuir» difiere ${ajuste} del de «Cargar hotel a los adultos», más que el redondeo posible (±${tope}): no se puede valorar así.` };
  return { ok: true, ajuste: ajuste === 0 ? 0 : ajuste };
}

/** ¿Es la misma elección? (idempotencia: misma neta, modo, conteos e importes = no-op). */
export function mismaEleccion(a: NetaSolicitud, b: NetaSolicitud): boolean {
  return a.netaTotal === b.netaTotal && a.moneda === b.moneda && a.reparto.modo === b.reparto.modo
    && a.reparto.adultos === b.reparto.adultos && a.reparto.ninos === b.reparto.ninos && a.reparto.infantes === b.reparto.infantes
    && Math.abs(a.reparto.netaAdulto - b.reparto.netaAdulto) < 1e-6 && Math.abs(a.reparto.netaNino - b.reparto.netaNino) < 1e-6;
}

/**
 * Tarifa y vigencia sintéticas para UNA estadía, por TIPO de viajero: la neta por persona se reparte en noches iguales; niño 1 y niño 2 comparten la neta del niño;
 * el infante es siempre $0 (publicado, como el resto del sistema trata un infante gratis). `noches` debe ser > 0.
 */
export function tarifaSinteticaPorTipo(args: {
  reparto: Pick<RepartoNeta, "netaAdulto" | "netaNino">; noches: number; categoria: string; regimen: string; fechaIda: string; fechaRegreso: string;
}): { temporadas: FilaTemporadaHotelRaw[]; tarifas: FilaTarifaHotelRaw[] } | null {
  const { reparto, noches } = args;
  if (!(noches > 0) || !(reparto.netaAdulto > 0) || !(reparto.netaNino >= 0)) return null;
  const adulto = reparto.netaAdulto / noches;
  const nino = reparto.netaNino / noches;
  return {
    temporadas: [{
      nombre: NOMBRE_TEMPORADA_SOLICITUD, fecha_inicio: args.fechaIda, fecha_fin: args.fechaRegreso, prioridad: 1,
      compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: 1, regimen_restringido: null,
    }],
    tarifas: [{
      tipo_habitacion: args.categoria, alimentacion: args.regimen, temporada: NOMBRE_TEMPORADA_SOLICITUD,
      neto_sencilla: adulto, neto_doble: adulto, neto_triple: adulto, neto_multiple: adulto, neto_nino: nino, neto_nino2: nino, neto_infante: 0,
    }],
  };
}

/** Reemplaza las tarifas del hotel por la sintética (y suma el vuelo) sin tocar nada más del paquete. Pura: devuelve una copia. */
export function aplicarNetaSolicitud(
  datos: DatosHotelPaquete,
  args: { sintetica: { temporadas: FilaTemporadaHotelRaw[]; tarifas: FilaTarifaHotelRaw[] }; vuelo?: VueloSolicitud | null },
): DatosHotelPaquete {
  return {
    ...datos,
    paquete: args.vuelo ? { ...datos.paquete, impuesto_fijo: args.vuelo.impuesto } : datos.paquete,
    // Sin filtro de categoría/régimen: un hotel sin tarifas nunca pudo definirlo; la solicitud trae la categoría/régimen pedidos.
    armadoHotel: datos.armadoHotel ? { ...datos.armadoHotel, categorias: null, regimenes: null } : datos.armadoHotel,
    temporadas: args.sintetica.temporadas,
    tarifas: args.sintetica.tarifas,
    blackouts: [],
    redondeoCentavos: true,
    vuelo: args.vuelo ? { aporte: args.vuelo.aporte, feeInfante: args.vuelo.feeInfante } : undefined,
  };
}

/** Una cotización pendiente de tarifa no puede venderse, pagarse ni numerar contrato. Mensaje único para todas las puertas. */
export const MENSAJE_PENDIENTE_TARIFA =
  "Esta solicitud espera la tarifa del hotel: aún no tiene precio, por eso no se puede reservar, cobrar ni convertir en contrato.";
export const estaPendienteTarifa = (estado: unknown): boolean => estado === ESTADO_PENDIENTE_TARIFA;

/** Payload/detalle públicos de una solicitud: SOLO datos del pedido; ningún importe, costo ni neta. */
export const CLAVES_IMPORTE_PROHIBIDAS = ["precioVenta", "precio_venta", "pvp", "pvpPorAcom", "netoPorAcom", "neto", "neta", "netaAdulto", "netaNino", "reparto", "costo", "total", "tarifa", "precios"] as const;

export function contieneImportes(valor: unknown, profundidad = 0): boolean {
  if (profundidad > 8 || valor == null || typeof valor !== "object") return false;
  if (Array.isArray(valor)) return valor.some((v) => contieneImportes(v, profundidad + 1));
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if ((CLAVES_IMPORTE_PROHIBIDAS as readonly string[]).includes(k) && v != null && v !== 0 && v !== "") return true;
    if (contieneImportes(v, profundidad + 1)) return true;
  }
  return false;
}

export const MENSAJE_HOTEL_SOLO_SOLICITUD =
  "Este hotel se ofrece bajo solicitud: pide la cotización para que un asesor confirme tarifa y disponibilidad.";
