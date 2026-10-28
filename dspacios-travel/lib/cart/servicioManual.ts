// ─────────────────────────────────────────────────────────────────────────
// #64 — Servicio MANUAL del carrito (vuelo libre u otro servicio).
//
// Lo agrega personal interno a un carrito del Tarifario y viaja con el resto
// (hotel, add-ons) hasta la cotización y el contrato. NO es un vuelo de
// Sistema: no referencia ningún `bloqueos_vuelo`/`empaquetados`, no reserva
// sillas ni inventa disponibilidad. Es un precio de venta DECLARADO por el
// asesor; la cotización lo muestra como "sujeto a confirmación" y no guarda
// costo ni proveedor (se exigen recién al convertir, antes de numerar).
//
// Módulo PURO (sin React ni Supabase): lo comparten el carrito (cliente) y
// el servidor, que SIEMPRE vuelve a validar lo que llega del navegador.
// ─────────────────────────────────────────────────────────────────────────

import { ciudadIata, esCodigoIata } from "../iata.ts";

export type ClaseServicioManual = "vuelo" | "otro";
export type MonedaManual = "COP" | "USD";
/** Solo vuelo: lo que cubre la línea. En «regreso» la fecha va en `fechaRegreso` y `fechaIda` es null. */
export type TramoVueloManual = "ida" | "regreso" | "ida_regreso";
const TRAMOS: readonly TramoVueloManual[] = ["ida", "regreso", "ida_regreso"];
const ETIQUETA_TRAMO: Record<TramoVueloManual, string> = { ida: "solo ida", regreso: "solo regreso", ida_regreso: "ida y regreso" };

/** Lo que el asesor captura (y lo que se vuelve a validar en el servidor). */
export type ServicioManual = {
  clase: ClaseServicioManual;
  nombre: string;
  /**
   * Solo vuelo: ruta del PRIMER tramo. En «ida» / «ida_regreso» el destino es la ciudad del hotel y el origen la otra; en «regreso» el origen es la
   * ciudad del hotel y el destino la otra. El lado del hotel lo fija el servidor desde el hotel del carrito (no se escribe libremente).
   */
  origen: string | null;
  destino: string | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
  tramo: TramoVueloManual | null;
  /** Solo vuelo: hotel del carrito al que pertenece. En el carrito = `id` del ítem; en la cotización = su `ref` (`item-N`) que fija el servidor. */
  hotelRef: string | null;
  /** Solo vuelo: nombre del hotel (lo fija el servidor; informativo). */
  hotelEtiqueta: string | null;
  pax: number;
  /** Precio de VENTA total (todos los pax) en `moneda`. */
  precio: number;
  moneda: MonedaManual;
  /** Parte del precio que NO es comisionable (p. ej. impuestos del vuelo). 0 ≤ valor ≤ precio; solo lo captura personal interno. Base de comisión B2B = precio − esto. */
  impuestoNoComisionable: number;
  /**
   * Solo vuelo: hora LOCAL de salida del aeropuerto de cada tramo (HH:mm, 24 h). Opcional: null = horario sin confirmar. Nunca se inventa una hora de llegada.
   * `horaIda` solo existe si el vuelo lleva el tramo de ida; `horaRegreso`, si lleva el de regreso. Ausente = null (cotizaciones anteriores).
   */
  horaIda?: string | null;
  horaRegreso?: string | null;
};

export const MAX_MANUALES = 10;
const MAX_PRECIO = 1_000_000_000_000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t && t.length <= max ? t : null;
};
const fechaValida = (v: unknown): string | null => {
  if (typeof v !== "string" || !FECHA.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
};

export type ResultadoManual = { ok: true; valor: ServicioManual } | { ok: false; error: string };

/**
 * Valida un servicio manual crudo. `monedaCotizacion` = moneda ya fijada por el
 * resto del carrito (null si no hay): el manual NUNCA se convierte ni se
 * excluye en silencio — si no coincide, se rechaza.
 */
export function validarServicioManual(raw: unknown, monedaCotizacion: string | null = null): ResultadoManual {
  if (!esObjeto(raw)) return { ok: false, error: "El servicio manual no es válido." };
  const clase = raw.clase;
  if (clase !== "vuelo" && clase !== "otro") return { ok: false, error: "Elige si el servicio es un vuelo u otro servicio." };
  const nombre = texto(raw.nombre, 120);
  if (!nombre || nombre.length < 3) return { ok: false, error: "Escribe la descripción del servicio (3 a 120 caracteres)." };
  const moneda = raw.moneda;
  if (moneda !== "COP" && moneda !== "USD") return { ok: false, error: "Elige la moneda del servicio (COP o USD)." };
  if (monedaCotizacion && moneda !== monedaCotizacion) {
    return { ok: false, error: `El servicio debe estar en ${monedaCotizacion}, la moneda de esta cotización. Cotízalo en otra solicitud o captura el precio en ${monedaCotizacion}.` };
  }
  const pax = raw.pax;
  if (typeof pax !== "number" || !Number.isInteger(pax) || pax < 1 || pax > 99) return { ok: false, error: "Los pasajeros deben ser un entero entre 1 y 99." };
  const precio = raw.precio;
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0 || precio > MAX_PRECIO) return { ok: false, error: "El precio de venta debe ser mayor que cero." };
  if (moneda === "COP" && !Number.isInteger(precio)) return { ok: false, error: "En COP el precio va en pesos enteros." };
  if (moneda === "USD" && Math.abs(precio * 100 - Math.round(precio * 100)) > 1e-6) return { ok: false, error: "En USD el precio admite máximo 2 decimales." };

  const imp = raw.impuestoNoComisionable;
  if (typeof imp !== "number" || !Number.isFinite(imp) || imp < 0) return { ok: false, error: "Indica el impuesto no comisionable (0 si el servicio no tiene)." };
  if (imp > precio) return { ok: false, error: "El impuesto no comisionable no puede superar el precio de venta." };
  if (moneda === "COP" && !Number.isInteger(imp)) return { ok: false, error: "En COP el impuesto no comisionable va en pesos enteros." };
  if (moneda === "USD" && Math.abs(imp * 100 - Math.round(imp * 100)) > 1e-6) return { ok: false, error: "En USD el impuesto no comisionable admite máximo 2 decimales." };

  const origen = raw.origen == null || raw.origen === "" ? null : texto(raw.origen, 60);
  const destino = raw.destino == null || raw.destino === "" ? null : texto(raw.destino, 60);
  if ((raw.origen ?? "") !== "" && !origen) return { ok: false, error: "El origen no es válido." };
  if ((raw.destino ?? "") !== "" && !destino) return { ok: false, error: "El destino no es válido." };
  const fechaIda = raw.fechaIda == null || raw.fechaIda === "" ? null : fechaValida(raw.fechaIda);
  const fechaRegreso = raw.fechaRegreso == null || raw.fechaRegreso === "" ? null : fechaValida(raw.fechaRegreso);
  if ((raw.fechaIda ?? "") !== "" && !fechaIda) return { ok: false, error: "La fecha de ida no es válida." };
  if ((raw.fechaRegreso ?? "") !== "" && !fechaRegreso) return { ok: false, error: "La fecha de regreso no es válida." };
  const comunes = { clase, nombre, moneda, pax, precio: Math.round(precio * 100) / 100, impuestoNoComisionable: Math.round(imp * 100) / 100 } as const;
  if (clase === "otro") {
    if (fechaRegreso && !fechaIda) return { ok: false, error: "Indica la fecha de ida para usar una de regreso." };
    if (fechaIda && fechaRegreso && fechaRegreso < fechaIda) return { ok: false, error: "El regreso no puede ser anterior a la ida." };
    // Un «otro servicio» de una COMPARATIVA se asocia a un grupo (destino + fechas) igual que un vuelo; en el carrito normal no lleva hotel (hotelRef null).
    const hotelRefOtro = raw.hotelRef == null || raw.hotelRef === "" ? null : texto(raw.hotelRef, 80);
    if ((raw.hotelRef ?? "") !== "" && !hotelRefOtro) return { ok: false, error: "El grupo o hotel del servicio no es válido." };
    return { ok: true, valor: { ...comunes, origen: null, destino, fechaIda, fechaRegreso, tramo: null, hotelRef: hotelRefOtro, hotelEtiqueta: null, horaIda: null, horaRegreso: null } };
  }

  // Vuelo: tramo, hotel al que pertenece y ruta completa; cada tramo lleva SOLO sus fechas.
  const tramo = raw.tramo;
  if (typeof tramo !== "string" || !TRAMOS.includes(tramo as TramoVueloManual)) return { ok: false, error: "Elige si el vuelo es de ida, de regreso o de ida y regreso." };
  const hotelRef = texto(raw.hotelRef, 80);
  if (!hotelRef) return { ok: false, error: "Elige el hotel o destino del carrito al que pertenece el vuelo." };
  const hotelEtiqueta = raw.hotelEtiqueta == null || raw.hotelEtiqueta === "" ? null : texto(raw.hotelEtiqueta, 160);
  if (!origen || !destino) return { ok: false, error: "Un vuelo necesita origen y destino." };
  // El origen y el destino de un vuelo son CÓDIGOS IATA (CTG, BOG…), nunca nombres libres.
  if (!esCodigoIata(origen) || !esCodigoIata(destino)) return { ok: false, error: "El origen y el destino del vuelo van como código IATA de 3 letras (por ejemplo BOG o CTG)." };
  if (origen.toUpperCase() === destino.toUpperCase()) return { ok: false, error: "El origen y el destino del vuelo no pueden ser el mismo." };
  if (tramo === "ida" && (!fechaIda || fechaRegreso)) return { ok: false, error: "Un vuelo de solo ida lleva la fecha de ida y ninguna de regreso." };
  if (tramo === "regreso" && (!fechaRegreso || fechaIda)) return { ok: false, error: "Un vuelo de solo regreso lleva la fecha de regreso y ninguna de ida." };
  if (tramo === "ida_regreso") {
    if (!fechaIda || !fechaRegreso) return { ok: false, error: "Un vuelo de ida y regreso necesita las dos fechas." };
    if (fechaRegreso < fechaIda) return { ok: false, error: "El regreso no puede ser anterior a la ida." };
  }
  const hora = (v: unknown, etiqueta: string, aplica: boolean): { ok: true; valor: string | null } | { ok: false; error: string } => {
    if (v == null || v === "") return { ok: true, valor: null };
    if (!aplica) return { ok: false, error: `Un vuelo de ${tramo === "ida" ? "solo ida" : "solo regreso"} no lleva ${etiqueta}.` };
    if (typeof v !== "string" || !HORA.test(v)) return { ok: false, error: `${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} no es válida: usa el formato HH:mm de 24 horas (por ejemplo 06:45).` };
    return { ok: true, valor: v };
  };
  const hIda = hora(raw.horaIda, "la hora de ida", tramo !== "regreso");
  if (!hIda.ok) return hIda;
  const hRegreso = hora(raw.horaRegreso, "la hora de regreso", tramo !== "ida");
  if (!hRegreso.ok) return hRegreso;
  return { ok: true, valor: { ...comunes, origen: origen.toUpperCase(), destino: destino.toUpperCase(), fechaIda, fechaRegreso, tramo: tramo as TramoVueloManual, hotelRef, hotelEtiqueta, horaIda: hIda.valor, horaRegreso: hRegreso.valor } };
}

/** Compara ciudades sin mayúsculas, tildes ni espacios repetidos («Cartagena» = «CARTAGENA»). */
export function normalizarCiudad(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Hotel del carrito tal como lo resolvió el SERVIDOR (o el carrito, en cliente): ciudad y fechas de su estadía. */
export type HotelDeVuelo = {
  ref: string; nombre: string; destino: string | null; fechaIda: string | null; fechaRegreso: string | null;
  /** Código IATA del destino tomado del CATÁLOGO (nunca inferido del nombre). null = el catálogo no tiene un código confiable. */
  destinoIata?: string | null;
};

/** Clave del GRUPO de un viaje: destino IATA + fechas. Los hoteles alternativos con la misma clave comparten sus vuelos. */
export function claveGrupoViaje(iata: string, fechaIda: string, fechaRegreso: string): string {
  return `grupo:${iata.toUpperCase()}|${fechaIda}|${fechaRegreso}`;
}
export const esClaveGrupoViaje = (v: unknown): v is string => typeof v === "string" && /^grupo:[A-Z]{3}\|\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/.test(v);

/** Las fechas de un vuelo salen del PLAN del hotel: ida y vuelta → ambas; solo ida → la ida; solo regreso → el regreso. */
export function fechasDeVuelo(tramo: TramoVueloManual, plan: { fechaIda: string | null; fechaRegreso: string | null }): { fechaIda: string | null; fechaRegreso: string | null } {
  return { fechaIda: tramo === "regreso" ? null : plan.fechaIda, fechaRegreso: tramo === "ida" ? null : plan.fechaRegreso };
}

/** Agrupa hoteles alternativos por destino IATA y fechas. Un hotel sin código IATA confiable o sin fechas NO entra en ningún grupo: se devuelve aparte para pedir la corrección. */
export function agruparHotelesPorViaje<T extends HotelDeVuelo>(hoteles: readonly T[]): { grupos: { clave: string; destinoIata: string; fechaIda: string; fechaRegreso: string; hoteles: T[] }[]; sinDato: T[] } {
  const grupos = new Map<string, { clave: string; destinoIata: string; fechaIda: string; fechaRegreso: string; hoteles: T[] }>();
  const sinDato: T[] = [];
  for (const h of hoteles) {
    if (!esCodigoIata(h.destinoIata) || !h.fechaIda || !h.fechaRegreso) { sinDato.push(h); continue; }
    const clave = claveGrupoViaje(h.destinoIata, h.fechaIda, h.fechaRegreso);
    const g = grupos.get(clave) ?? { clave, destinoIata: h.destinoIata.toUpperCase(), fechaIda: h.fechaIda, fechaRegreso: h.fechaRegreso, hoteles: [] };
    g.hoteles.push(h);
    grupos.set(clave, g);
  }
  return { grupos: [...grupos.values()], sinDato };
}

/**
 * El vuelo contra SU hotel: la ciudad del hotel sale del hotel (se compara con lo que llegó y se rechaza si no coincide), la ida no puede ser anterior a la
 * entrada ni el regreso posterior a la salida, y ninguna fecha cae fuera de la estadía. Devuelve el manual con `hotelRef`/`hotelEtiqueta` y el lado del hotel
 * fijados desde el hotel.
 */
export function validarVueloContraHotel(m: ServicioManual, hotel: HotelDeVuelo): ResultadoManual {
  if (m.clase !== "vuelo" || !m.tramo) return { ok: false, error: "El servicio no es un vuelo." };
  if (!hotel.destino || !hotel.fechaIda || !hotel.fechaRegreso) return { ok: false, error: `El hotel «${hotel.nombre}» no tiene destino y fechas confirmados: no se puede asociar un vuelo.` };
  if (!esCodigoIata(hotel.destinoIata)) {
    return { ok: false, error: `El destino «${hotel.destino}» no tiene un código IATA confiable en el catálogo. Corrígelo en Producto → Destinos antes de agregar el vuelo (no se infiere del nombre).` };
  }
  const iataHotel = hotel.destinoIata.toUpperCase();
  const ladoHotel = m.tramo === "regreso" ? m.origen : m.destino;
  if ((ladoHotel ?? "").toUpperCase() !== iataHotel) {
    return { ok: false, error: `El vuelo ${m.tramo === "regreso" ? "sale de" : "llega a"} ${ladoHotel} pero el hotel «${hotel.nombre}» está en ${hotel.destino} (${iataHotel}).` };
  }
  if (m.fechaIda && m.fechaIda < hotel.fechaIda) return { ok: false, error: `El vuelo de ida no puede ser anterior a la entrada al hotel (${hotel.fechaIda}).` };
  if (m.fechaRegreso && m.fechaRegreso > hotel.fechaRegreso) return { ok: false, error: `El vuelo de regreso no puede ser posterior a la salida del hotel (${hotel.fechaRegreso}).` };
  for (const f of [m.fechaIda, m.fechaRegreso]) {
    if (f && (f < hotel.fechaIda || f > hotel.fechaRegreso)) {
      return { ok: false, error: `La fecha del vuelo (${f}) debe estar dentro de la estadía en «${hotel.nombre}» (${hotel.fechaIda} → ${hotel.fechaRegreso}).` };
    }
  }
  // Las fechas del vuelo son las del PLAN del hotel (ida y vuelta: ambas; solo ida: la ida; solo regreso: el regreso). Si el plan cambió, el vuelo se actualiza.
  const plan = fechasDeVuelo(m.tramo, hotel);
  if (m.fechaIda !== plan.fechaIda || m.fechaRegreso !== plan.fechaRegreso) {
    return { ok: false, error: `Las fechas del vuelo deben ser las del plan de «${hotel.nombre}» (${[plan.fechaIda, plan.fechaRegreso].filter(Boolean).join(" → ")}). Actualiza el vuelo en el carrito.` };
  }
  return { ok: true, valor: { ...m, hotelRef: hotel.ref, hotelEtiqueta: hotel.nombre, ...(m.tramo === "regreso" ? { origen: iataHotel } : { destino: iataHotel }) } };
}

/** Cada vuelo del carrito señala UN hotel del mismo carrito (por el id del ítem): nunca se asigna en silencio al primero. */
export function resolverHotelDeManuales(itemsRaw: unknown, manuales: unknown): { ok: true; posiciones: (number | null)[] } | { ok: false; error: string } {
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const lista = Array.isArray(manuales) ? manuales : [];
  const posiciones: (number | null)[] = [];
  for (const [i, m] of lista.entries()) {
    if (!esObjeto(m) || m.clase !== "vuelo") { posiciones.push(null); continue; }
    const id = typeof m.hotelRef === "string" ? m.hotelRef : "";
    const pos = id ? items.findIndex((it) => esObjeto(it) && it.itemId === id) : -1;
    if (pos < 0) return { ok: false, error: `Servicio manual ${i + 1}: elige el hotel del carrito al que pertenece el vuelo.` };
    posiciones.push(pos);
  }
  return { ok: true, posiciones };
}

/**
 * Vuelos de una COMPARATIVA: solo vuelos, y cada uno afecta a TODOS los hoteles de su GRUPO (mismo destino IATA y mismas fechas). `selector` del vuelo = clave de grupo
 * (`grupo:CTG|ida|regreso`) o «comun» (válido solo si hay un único grupo). Con varios grupos cada vuelo debe nombrar el suyo; un grupo sin vuelos es válido. Cada hotel del grupo
 * debe aceptar el vuelo (ciudad y fechas de su estadía). Los pasajeros del vuelo no superan los de ninguna opción del grupo (las alternativas NO se suman).
 */
export function vuelosComunesCompatibles(
  manuales: readonly ServicioManual[], hoteles: readonly (HotelDeVuelo & { pax?: number })[],
): { ok: true; grupoDe: (string | null)[] } | { ok: false; error: string } {
  const { grupos, sinDato } = agruparHotelesPorViaje(hoteles);
  if (manuales.length && sinDato.length) {
    const h = sinDato[0];
    return { ok: false, error: !esCodigoIata(h.destinoIata)
      ? `El destino «${h.destino ?? "—"}» de «${h.nombre}» no tiene un código IATA confiable en el catálogo. Corrígelo en Producto → Destinos (no se infiere del nombre).`
      : `El hotel «${h.nombre}» no tiene fechas confirmadas: no se pueden asociar vuelos.` };
  }
  const grupoDe: (string | null)[] = [];
  for (const m of manuales) {
    const que = m.clase === "vuelo" ? "vuelo" : "servicio";
    let g = grupos.find((x) => x.clave === m.hotelRef);
    if (!g && m.hotelRef === "comun") {
      if (grupos.length !== 1) return { ok: false, error: `Hay varios destinos o fechas en la comparativa: elige a qué grupo pertenece el ${que}.` };
      g = grupos[0];
    }
    if (!g) return { ok: false, error: `El ${que} «${m.nombre}» no pertenece a ningún grupo de la comparativa (destino y fechas).` };
    for (const h of g.hoteles) {
      if (m.clase === "vuelo") {
        const r = validarVueloContraHotel(m, h);
        if (!r.ok) return { ok: false, error: `El vuelo «${m.nombre}» no es compatible con la opción «${h.nombre}»: ${r.error}` };
      }
      if (h.pax != null && m.pax > h.pax) return { ok: false, error: `El ${que} «${m.nombre}» tiene ${m.pax} pasajeros y la opción «${h.nombre}» solo ${h.pax}.` };
    }
    grupoDe.push(g.clave);
  }
  // Los vuelos de un grupo no pueden duplicar un tramo ni superar los pasajeros de ninguna de sus opciones (la misma regla que aplica el servidor al liquidar cada opción).
  const cob = validarCoberturaVuelos(manuales, (_m, i) => grupoDe[i], (clave) => {
    const g = grupos.find((x) => x.clave === clave);
    const paxs = (g?.hoteles ?? []).map((h) => h.pax).filter((n): n is number => typeof n === "number" && n > 0);
    return paxs.length ? Math.min(...paxs) : null;
  });
  if (!cob.ok) return cob;
  return { ok: true, grupoDe };
}

/** Pasajeros cubiertos por tramo en un destino de vuelos (un hotel, o un GRUPO de una comparativa). Un vuelo «ida y regreso» cubre los dos tramos. */
export type CoberturaTramos = { ida: number; regreso: number };

/**
 * Cobertura acumulada de los vuelos por objetivo. `objetivoDe` devuelve el hotel/grupo al que pertenece cada manual (null = no cuenta). `excluir` omite un manual
 * (el que se está editando: su propio grupo debe seguir disponible).
 */
export function coberturaVuelos(manuales: readonly ServicioManual[], objetivoDe: (m: ServicioManual, i: number) => string | null, excluir: number | null = null): Map<string, CoberturaTramos> {
  const out = new Map<string, CoberturaTramos>();
  manuales.forEach((m, i) => {
    if (i === excluir || m.clase !== "vuelo" || !m.tramo) return;
    const o = objetivoDe(m, i);
    if (!o) return;
    const c = out.get(o) ?? { ida: 0, regreso: 0 };
    if (m.tramo !== "regreso") c.ida += m.pax;
    if (m.tramo !== "ida") c.regreso += m.pax;
    out.set(o, c);
  });
  return out;
}

/** ¿Ida y regreso ya están cubiertos para TODOS los pasajeros? Un vuelo que cubre solo a una parte (o solo la ida) deja el objetivo disponible. */
export const objetivoCubierto = (c: CoberturaTramos | undefined, pax: number): boolean => !!c && pax > 0 && c.ida >= pax && c.regreso >= pax;

/**
 * Impide, también en una llamada directa, duplicar un tramo o superar los pasajeros: por objetivo, la suma de pasajeros de los vuelos que cubren la ida (y la de los que
 * cubren el regreso) no puede exceder los pasajeros de ese objetivo. `paxDe` = pasajeros del objetivo (null = no se puede comprobar: no se rechaza).
 */
export function validarCoberturaVuelos(
  manuales: readonly ServicioManual[], objetivoDe: (m: ServicioManual, i: number) => string | null, paxDe: (objetivo: string) => number | null,
): { ok: true } | { ok: false; error: string } {
  const acumulado = new Map<string, CoberturaTramos>();
  for (const [i, m] of manuales.entries()) {
    if (m.clase !== "vuelo" || !m.tramo) continue;
    const o = objetivoDe(m, i);
    const pax = o ? paxDe(o) : null;
    if (!o || pax == null) continue;
    const c = acumulado.get(o) ?? { ida: 0, regreso: 0 };
    for (const t of ["ida", "regreso"] as const) {
      if (m.tramo === (t === "ida" ? "regreso" : "ida")) continue;
      if (c[t] + m.pax > pax) {
        return { ok: false, error: c[t] >= pax
          ? `Vuelo «${m.nombre}»: el tramo de ${t} ya está cubierto para los ${pax} pasajeros; no se puede agregar otro vuelo que lo repita.`
          : `Vuelo «${m.nombre}»: el tramo de ${t} cubriría ${c[t] + m.pax} pasajeros y solo viajan ${pax} (ya hay ${c[t]} cubiertos; faltan ${pax - c[t]}).` };
      }
      c[t] += m.pax;
    }
    acumulado.set(o, c);
  }
  return { ok: true };
}

const lugar = (t: string | null): { codigo: string | null; ciudad: string | null } => {
  const x = (t ?? "").trim();
  const c = /^[A-Za-z]{3}$/.test(x) ? x.toUpperCase() : null;
  return { codigo: c, ciudad: (c ? ciudadIata(c) : null) ?? (x || null) };
};
const AVISO_COTIZACION = "sujeto a confirmación de disponibilidad y tarifa";

/** Las filas del cuadro de vuelos para un vuelo manual: sin record, aerolínea ni sillas, y con los pasajeros REALES de este vuelo. */
export function tramosVueloManual(m: ServicioManual, cotizado: boolean): Record<string, unknown>[] {
  if (m.clase !== "vuelo" || !m.tramo) return [];
  const o = lugar(m.origen), d = lugar(m.destino);
  const servicios = `Vuelo manual · pasajeros en este vuelo: ${m.pax} · ${cotizado ? AVISO_COTIZACION : "precio y proveedor declarados por el asesor; sin reserva ni sillas en el sistema"}`;
  // `hora_salida` = hora LOCAL de salida del aeropuerto de origen de ESE tramo (null si no está confirmada). No existe hora de llegada ni número de vuelo en un vuelo manual.
  const fila = (direccion: "ida" | "regreso", de: typeof o, a: typeof d, fecha: string | null, hora: string | null | undefined) => ({
    aerolinea: null, record: null, direccion, numero_vuelo: null, hora_salida: hora ?? null,
    origen_codigo: de.codigo, origen_ciudad: de.ciudad, destino_codigo: a.codigo, destino_ciudad: a.ciudad, servicios, fecha_salida: fecha,
  });
  if (m.tramo === "ida") return [fila("ida", o, d, m.fechaIda, m.horaIda)];
  if (m.tramo === "regreso") return [fila("regreso", o, d, m.fechaRegreso, m.horaRegreso)];
  return [fila("ida", o, d, m.fechaIda, m.horaIda), fila("regreso", d, o, m.fechaRegreso, m.horaRegreso)];
}

/** ¿Esta fila del cuadro de vuelos es de un vuelo manual? (la nota empieza por «Vuelo manual») */
export function esTramoVueloManual(v: { servicios?: unknown } | null | undefined): boolean {
  return typeof v?.servicios === "string" && v.servicios.startsWith("Vuelo manual");
}

/**
 * Lo que se MUESTRA de la nota guardada de un tramo manual (`servicios`): los pasajeros y el aviso, sin la marca interna «Vuelo manual», que se conserva
 * intacta en el dato (la usan `esTramoVueloManual` y las verificaciones). null si la nota no tiene la forma de un vuelo manual.
 */
export function notaVueloManual(servicios: unknown): { pax: number | null; aviso: string | null } | null {
  if (typeof servicios !== "string" || !servicios.startsWith("Vuelo manual")) return null;
  const m = /^Vuelo manual · pasajeros en este vuelo: (\d+)(?: · (.+))?$/.exec(servicios.trim());
  if (!m) return { pax: null, aviso: null };
  return { pax: Number(m[1]), aviso: m[2]?.trim() || null };
}

/** La línea suelta de un vuelo manual en la tabla de valores: se oculta porque el vuelo ya sale en el cuadro de vuelos (su precio sigue en el total, una sola vez). */
export function esLineaVueloManual(descripcion: string | null | undefined): boolean {
  return typeof descripcion === "string" && descripcion.startsWith("Vuelo · ");
}

/** Lee `manuales` de la entrada cruda de la solicitud (ausente = ninguno). */
export function leerManualesEntrada(inputRaw: unknown, monedaCotizacion: string | null = null): { ok: true; manuales: ServicioManual[] } | { ok: false; error: string } {
  const crudo = esObjeto(inputRaw) ? inputRaw.manuales : undefined;
  if (crudo === undefined || crudo === null) return { ok: true, manuales: [] };
  if (!Array.isArray(crudo)) return { ok: false, error: "Los servicios manuales no son válidos." };
  if (crudo.length > MAX_MANUALES) return { ok: false, error: `Máximo ${MAX_MANUALES} servicios manuales por cotización.` };
  const manuales: ServicioManual[] = [];
  for (let i = 0; i < crudo.length; i++) {
    const r = validarServicioManual(crudo[i], monedaCotizacion);
    if (!r.ok) return { ok: false, error: `Servicio manual ${i + 1}: ${r.error}` };
    manuales.push(r.valor);
  }
  return { ok: true, manuales };
}

/** Línea que ve el cliente en la cotización: nunca afirma proveedor ni reserva. */
export function descripcionCotizacionManual(m: ServicioManual): string {
  if (m.clase === "vuelo" && m.tramo) {
    const fechas = m.tramo === "ida" ? m.fechaIda : m.tramo === "regreso" ? m.fechaRegreso : `${m.fechaIda} → ${m.fechaRegreso}`;
    return `Vuelo · ${m.nombre} ${m.origen} → ${m.destino} (${ETIQUETA_TRAMO[m.tramo]}) · ${fechas} · ${m.pax} pax — sujeto a confirmación de disponibilidad y tarifa`;
  }
  const fechas = m.fechaIda ? ` · ${m.fechaIda}${m.fechaRegreso ? ` → ${m.fechaRegreso}` : ""}` : "";
  return `Servicio · ${m.nombre}${fechas} · ${m.pax} pax — sujeto a confirmación de disponibilidad y tarifa`;
}

type ConId = { id: string; tipo: string };

/** Reemplaza SOLO el servicio manual `id`; cualquier otro ítem queda idéntico (misma referencia). */
export function reemplazarManual<T extends ConId>(items: readonly T[], id: string, cambio: Record<string, unknown>): T[] {
  return items.map((i) => (i.id === id && i.tipo === "manual" ? ({ ...i, ...cambio, id: i.id, tipo: "manual" } as T) : i));
}

/** Línea del contrato ya convertido: igual que la de la cotización, sin la salvedad (costo y proveedor ya quedaron registrados). */
export function descripcionContratoManual(m: ServicioManual): string {
  return descripcionCotizacionManual(m).replace(/ — sujeto a confirmación de disponibilidad y tarifa$/, "");
}

/** Costo NETO y proveedor que el personal captura al CONVERTIR (la cotización no los guarda). */
export type CostoManual = { costo: number; proveedor: string };

export function validarCostoManual(raw: unknown, moneda: MonedaManual): { ok: true; valor: CostoManual } | { ok: false; error: string } {
  if (!esObjeto(raw)) return { ok: false, error: "Falta el costo y el proveedor." };
  const proveedor = texto(raw.proveedor, 120);
  if (!proveedor || proveedor.length < 2) return { ok: false, error: "El proveedor es obligatorio (2 a 120 caracteres)." };
  const costo = raw.costo;
  if (typeof costo !== "number" || !Number.isFinite(costo) || costo <= 0 || costo > MAX_PRECIO) return { ok: false, error: "El costo debe ser mayor que cero." };
  if (moneda === "COP" && !Number.isInteger(costo)) return { ok: false, error: "En COP el costo va en pesos enteros." };
  if (moneda === "USD" && Math.abs(costo * 100 - Math.round(costo * 100)) > 1e-6) return { ok: false, error: "En USD el costo admite máximo 2 decimales." };
  return { ok: true, valor: { costo, proveedor } };
}

/** Línea del plan B2B de #102 para el manual `i` (misma estructura que hoteles y tours: la comisión sale de PVP − impuesto). */
export function lineaB2BManual(m: ServicioManual, i: number): { clave: string; pvp: number; impuesto: number } {
  return { clave: `manual-${i}`, pvp: m.precio, impuesto: m.impuestoNoComisionable };
}

/** ¿El primer contrato (el que lleva los manuales) sigue sin crearse? Solo entonces se piden costo y proveedor. Misma clave de grupo que la conversión. */
export function primerGrupoPendiente(contratosPorGrupo: Record<string, string> | null | undefined, destinoPrimerGrupo: string | null): boolean {
  return !(contratosPorGrupo ?? {})[destinoPrimerGrupo ?? "__sin_destino__"];
}

const SUFIJO_COTIZACION = " — sujeto a confirmación de disponibilidad y tarifa";

/**
 * Los servicios manuales que la cotización DECLARÓ, comprobados contra tres fuentes independientes: `payload.manuales`, las líneas del documento
 * (`detalle.items`, que llevan la salvedad «sujeto a confirmación») y las líneas `manual-N` del plan B2B. Si cualquiera dice que hay manuales,
 * el bloque debe existir, estar bien formado y coincidir con las otras fuentes: nunca se convierte en [] en silencio.
 */
export function verificarManualesCotizados(a: {
  payload: unknown; detalleItems: unknown; plan: { lineas: readonly { clave: string }[] } | null; moneda: string | null;
  /** `detalle.vuelos` del documento: ahí se pinta cada vuelo manual (cuadro de vuelos). */
  detalleVuelos?: unknown;
  /** `ref` de los hoteles de la cotización (`payload.items[].ref`): el hotel de cada vuelo debe ser uno de ellos. */
  refsHoteles?: readonly string[] | null;
}): { ok: true; manuales: ServicioManual[] } | { ok: false; error: string } {
  const malo = (e: string) => ({ ok: false as const, error: `Los servicios manuales de la cotización no son consistentes (${e}). No se creó ningún contrato.` });
  const payload = esObjeto(a.payload) ? a.payload : {};
  const lineasDoc = (Array.isArray(a.detalleItems) ? a.detalleItems : []).filter(
    (x): x is { descripcion: string; valor_total?: unknown } => esObjeto(x) && typeof x.descripcion === "string" && x.descripcion.endsWith(SUFIJO_COTIZACION));
  const lineasPlan = (a.plan?.lineas ?? []).filter((l) => l.clave.startsWith("manual-"));
  const tramosDoc = (Array.isArray(a.detalleVuelos) ? a.detalleVuelos : []).filter((x): x is Record<string, unknown> => esObjeto(x) && esTramoVueloManual(x));
  if (!Object.hasOwn(payload, "manuales") && !lineasDoc.length && !lineasPlan.length && !tramosDoc.length) return { ok: true, manuales: [] };

  const crudo = payload.manuales;
  if (!Array.isArray(crudo) || crudo.length < 1 || crudo.length > MAX_MANUALES) return malo("el bloque falta o está mal formado");
  const manuales: ServicioManual[] = [];
  for (const [i, c] of crudo.entries()) {
    const r = validarServicioManual(c, a.moneda);
    if (!r.ok) return { ok: false, error: `Servicio manual ${i + 1} de la cotización: ${r.error}` };
    manuales.push(r.valor);
  }
  if (lineasDoc.length !== manuales.length) return malo("el documento cotizado trae otra cantidad");
  for (const [i, m] of manuales.entries()) {
    if (lineasDoc[i].descripcion !== descripcionCotizacionManual(m) || Number(lineasDoc[i].valor_total) !== m.precio) return malo(`el servicio ${i + 1} no coincide con lo cotizado`);
  }
  if (a.plan && lineasPlan.length !== manuales.length) return malo("las líneas del plan B2B no coinciden");

  // Cuadro de vuelos: las filas pintadas deben ser EXACTAMENTE las que salen de los vuelos del bloque (ruta, tramo, fecha, pasajeros, aviso), en el mismo orden.
  const esperadas = manuales.flatMap((m) => tramosVueloManual(m, true));
  if (tramosDoc.length !== esperadas.length) return malo("el cuadro de vuelos cotizado trae otra cantidad de tramos");
  const CAMPOS = ["aerolinea", "record", "direccion", "hora_salida", "origen_codigo", "origen_ciudad", "destino_codigo", "destino_ciudad", "fecha_salida", "servicios"] as const;
  for (const [i, e] of esperadas.entries()) {
    for (const c of CAMPOS) if ((tramosDoc[i][c] ?? null) !== (e[c] ?? null)) return malo(`el tramo ${i + 1} del cuadro de vuelos no coincide con lo cotizado (${c})`);
  }
  // Cada vuelo pertenece a un hotel de la cotización.
  if (a.refsHoteles) {
    for (const [i, m] of manuales.entries()) {
      if (m.clase === "vuelo" && (!m.hotelRef || !a.refsHoteles.includes(m.hotelRef))) return malo(`el vuelo ${i + 1} no pertenece a ningún hotel de la cotización`);
    }
  }
  return { ok: true, manuales };
}
