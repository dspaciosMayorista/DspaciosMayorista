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

import { ciudadIata } from "../iata.ts";

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
};

export const MAX_MANUALES = 10;
const MAX_PRECIO = 1_000_000_000_000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

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
    return { ok: true, valor: { ...comunes, origen: null, destino, fechaIda, fechaRegreso, tramo: null, hotelRef: null, hotelEtiqueta: null } };
  }

  // Vuelo: tramo, hotel al que pertenece y ruta completa; cada tramo lleva SOLO sus fechas.
  const tramo = raw.tramo;
  if (typeof tramo !== "string" || !TRAMOS.includes(tramo as TramoVueloManual)) return { ok: false, error: "Elige si el vuelo es de ida, de regreso o de ida y regreso." };
  const hotelRef = texto(raw.hotelRef, 80);
  if (!hotelRef) return { ok: false, error: "Elige el hotel o destino del carrito al que pertenece el vuelo." };
  const hotelEtiqueta = raw.hotelEtiqueta == null || raw.hotelEtiqueta === "" ? null : texto(raw.hotelEtiqueta, 160);
  if (!origen || !destino) return { ok: false, error: "Un vuelo necesita origen y destino." };
  if (normalizarCiudad(origen) === normalizarCiudad(destino)) return { ok: false, error: "El origen y el destino del vuelo no pueden ser el mismo." };
  if (tramo === "ida" && (!fechaIda || fechaRegreso)) return { ok: false, error: "Un vuelo de solo ida lleva la fecha de ida y ninguna de regreso." };
  if (tramo === "regreso" && (!fechaRegreso || fechaIda)) return { ok: false, error: "Un vuelo de solo regreso lleva la fecha de regreso y ninguna de ida." };
  if (tramo === "ida_regreso") {
    if (!fechaIda || !fechaRegreso) return { ok: false, error: "Un vuelo de ida y regreso necesita las dos fechas." };
    if (fechaRegreso < fechaIda) return { ok: false, error: "El regreso no puede ser anterior a la ida." };
  }
  return { ok: true, valor: { ...comunes, origen, destino, fechaIda, fechaRegreso, tramo: tramo as TramoVueloManual, hotelRef, hotelEtiqueta } };
}

/** Compara ciudades sin mayúsculas, tildes ni espacios repetidos («Cartagena» = «CARTAGENA»). */
export function normalizarCiudad(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Hotel del carrito tal como lo resolvió el SERVIDOR (o el carrito, en cliente): ciudad y fechas de su estadía. */
export type HotelDeVuelo = { ref: string; nombre: string; destino: string | null; fechaIda: string | null; fechaRegreso: string | null };

/**
 * El vuelo contra SU hotel: la ciudad del hotel sale del hotel (se compara con lo que llegó y se rechaza si no coincide), la ida no puede ser anterior a la
 * entrada ni el regreso posterior a la salida, y ninguna fecha cae fuera de la estadía. Devuelve el manual con `hotelRef`/`hotelEtiqueta` y el lado del hotel
 * fijados desde el hotel.
 */
export function validarVueloContraHotel(m: ServicioManual, hotel: HotelDeVuelo): ResultadoManual {
  if (m.clase !== "vuelo" || !m.tramo) return { ok: false, error: "El servicio no es un vuelo." };
  if (!hotel.destino || !hotel.fechaIda || !hotel.fechaRegreso) return { ok: false, error: `El hotel «${hotel.nombre}» no tiene destino y fechas confirmados: no se puede asociar un vuelo.` };
  const ladoHotel = m.tramo === "regreso" ? m.origen : m.destino;
  if (normalizarCiudad(ladoHotel) !== normalizarCiudad(hotel.destino)) {
    return { ok: false, error: `El vuelo ${m.tramo === "regreso" ? "sale de" : "llega a"} «${ladoHotel}» pero el hotel «${hotel.nombre}» está en ${hotel.destino}.` };
  }
  if (m.fechaIda && m.fechaIda < hotel.fechaIda) return { ok: false, error: `El vuelo de ida no puede ser anterior a la entrada al hotel (${hotel.fechaIda}).` };
  if (m.fechaRegreso && m.fechaRegreso > hotel.fechaRegreso) return { ok: false, error: `El vuelo de regreso no puede ser posterior a la salida del hotel (${hotel.fechaRegreso}).` };
  for (const f of [m.fechaIda, m.fechaRegreso]) {
    if (f && (f < hotel.fechaIda || f > hotel.fechaRegreso)) {
      return { ok: false, error: `La fecha del vuelo (${f}) debe estar dentro de la estadía en «${hotel.nombre}» (${hotel.fechaIda} → ${hotel.fechaRegreso}).` };
    }
  }
  const ciudad = hotel.destino;
  return { ok: true, valor: { ...m, hotelRef: hotel.ref, hotelEtiqueta: hotel.nombre, ...(m.tramo === "regreso" ? { origen: ciudad } : { destino: ciudad }) } };
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
 * Vuelos COMUNES de una comparativa: solo vuelos, y compatibles con TODAS las opciones (mismo destino y fechas dentro de la estadía de cada hotel).
 * Si alguna opción no los admite no se ofrece la comparativa.
 */
export function vuelosComunesCompatibles(manuales: readonly ServicioManual[], hoteles: readonly HotelDeVuelo[]): { ok: true } | { ok: false; error: string } {
  for (const m of manuales) {
    if (m.clase !== "vuelo") return { ok: false, error: "En una comparativa solo se pueden agregar vuelos manuales comunes a todas las opciones." };
    for (const h of hoteles) {
      const r = validarVueloContraHotel(m, h);
      if (!r.ok) return { ok: false, error: `El vuelo «${m.nombre}» no es compatible con la opción «${h.nombre}»: ${r.error}` };
    }
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
  const fila = (direccion: "ida" | "regreso", de: typeof o, a: typeof d, fecha: string | null) => ({
    aerolinea: null, record: null, direccion, numero_vuelo: null,
    origen_codigo: de.codigo, origen_ciudad: de.ciudad, destino_codigo: a.codigo, destino_ciudad: a.ciudad, servicios, fecha_salida: fecha,
  });
  if (m.tramo === "ida") return [fila("ida", o, d, m.fechaIda)];
  if (m.tramo === "regreso") return [fila("regreso", o, d, m.fechaRegreso)];
  return [fila("ida", o, d, m.fechaIda), fila("regreso", d, o, m.fechaRegreso)];
}

/** ¿Esta fila del cuadro de vuelos es de un vuelo manual? (la nota empieza por «Vuelo manual») */
export function esTramoVueloManual(v: { servicios?: unknown } | null | undefined): boolean {
  return typeof v?.servicios === "string" && v.servicios.startsWith("Vuelo manual");
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
  const CAMPOS = ["aerolinea", "record", "direccion", "origen_codigo", "origen_ciudad", "destino_codigo", "destino_ciudad", "fecha_salida", "servicios"] as const;
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
