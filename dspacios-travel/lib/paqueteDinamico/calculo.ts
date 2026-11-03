// ─────────────────────────────────────────────────────────────────────────
// Paquete 100 % dinámico (#82) — cálculo PURO. Sin I/O.
//
// Producto reutilizable de Paquetes, DISTINTO del tipo `armado_paquetes.tipo =
// 'dinamico'` (vuelo de sistema + hotel del catálogo) y de la cotización manual.
// Reutiliza las reglas de `lib/calc/paquetes.ts` (`marcar`, `redondearVenta`) y
// los pax por habitación de `lib/acomodaciones.ts`; NO pasa por `generarTarifario`.
//
// Convenciones:
//  · Todos los precios son POR PERSONA por la estadía completa definida en el
//    paquete (no por noche). Los servicios incluidos son por persona.
//  · Esquema `neta_markup`: el PVP de cada componente = redondearVenta(neto/(1-mk)).
//  · Esquema `solo_pvp`: se carga el PVP. Con `pvpModo='general'` hay un precio
//    por acomodación para todo el paquete; con `'por_componente'`, un PVP por
//    vuelo / hotel / servicio.
//  · Cada línea se redondea ANTES de sumar: el total es siempre Σ líneas, así que
//    el desglose cuadra por construcción; `verificarCuadre` lo comprueba igual.
//  · Nunca se inventa un costo a partir del PVP: en `solo_pvp` el costo de cada
//    componente queda pendiente (`exigeCosto`) hasta que se registre el real.
// ─────────────────────────────────────────────────────────────────────────
import { marcar, redondearVenta } from "@/lib/calc/paquetes";
import { PAX_TARIFA_DEFAULT, type AcomRoom } from "@/lib/acomodaciones";

export type AcomDin = AcomRoom | "nino" | "nino2" | "infante";
export const ACOMS_DIN: readonly AcomDin[] = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"];
const ROOMS: readonly AcomRoom[] = ["sencilla", "doble", "triple", "multiple"];

export type Esquema = "neta_markup" | "solo_pvp";
export type PvpModo = "general" | "por_componente";
/** Precio por acomodación; `null`/ausente = no cargado (distinto de 0 = gratis). */
export type PrecioAcom = Partial<Record<AcomDin, number | null>>;
export type PrecioVuelo = { adulto: number | null; nino: number | null; infante: number | null };

export type ServicioDin = { id: string; nombre: string; proveedor?: string; neto: number | null; pvp: number | null };

export type PaqueteDin = {
  esquema: Esquema;
  pvpModo: PvpModo | null;       // solo si esquema = solo_pvp
  moneda: string;
  pctMk: number;                 // fracción (0.2 = 20 %); solo neta_markup
  usaVuelo: boolean;
  usaHotel: boolean;
  usaServicios: boolean;
  vuelo?: { proveedor?: string; neto: PrecioVuelo; pvp: PrecioVuelo };
  hotel?: { nombre: string; proveedor?: string; neto: PrecioAcom; pvp: PrecioAcom };
  servicios: ServicioDin[];
  pvpGeneral?: PrecioAcom;       // solo_pvp + general
  /** Total por acomodación declarado a mano para contrastar con el desglose (solo_pvp por componente). */
  totalDeclarado?: PrecioAcom;
};

export type Composicion = {
  habitaciones: Partial<Record<AcomRoom, number>>;
  ninos: number;   // niño 1
  ninos2: number;  // niño 2
  infantes: number;
  /** Ids de servicios elegidos; undefined = todos los del paquete. */
  servicios?: string[];
};

export type LineaDin = {
  componente: "vuelo" | "hotel" | "servicio" | "paquete";
  ref: string;           // 'vuelo' | 'hotel' | 'servicio:<id>' | 'paquete'
  descripcion: string;
  cantidad: number;      // personas (o habitaciones×pax) que cubre la línea
  valor: number;         // PVP ya redondeado de la línea
  costoNeto: number;     // costo conocido (0 si pendiente)
  exigeCosto: boolean;   // true = el costo real debe registrarse antes de convertir
  proveedor: string;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

/** PVP de un neto según el esquema; NaN si falta el dato. */
export function pvpDeNeto(neto: number | null | undefined, pctMk: number, moneda: string): number {
  const n = num(neto);
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (n === 0) return 0; // 0 = gratis explícito (niño/infante)
  if (!(pctMk >= 0 && pctMk < 1)) return NaN;
  return redondearVenta(marcar(n, pctMk), moneda);
}

function precioComp(p: PaqueteDin, neto: number | null | undefined, pvp: number | null | undefined): number {
  return p.esquema === "neta_markup" ? pvpDeNeto(neto, p.pctMk, p.moneda) : num(pvp);
}

/** Valida la configuración del paquete. Devuelve mensajes en español (vacío = válido). */
export function validarPaquete(p: PaqueteDin): string[] {
  const e: string[] = [];
  if (!p.usaVuelo && !p.usaHotel && !p.usaServicios) e.push("Marca al menos un componente: vuelo, hotel o servicios.");
  if (p.esquema === "neta_markup" && !(p.pctMk >= 0 && p.pctMk < 1)) e.push("El markup debe estar entre 0 % y 99,99 %.");
  if (p.esquema === "solo_pvp" && !p.pvpModo) e.push("En solo PVP elige precio general o PVP por componente.");
  const general = p.esquema === "solo_pvp" && p.pvpModo === "general";

  if (general) {
    for (const a of ACOMS_DIN) {
      if (!Number.isFinite(num(p.pvpGeneral?.[a])) || (num(p.pvpGeneral?.[a]) < 0))
        e.push(`Falta el precio general de «${a}» (usa 0 si es gratis).`);
    }
    return e;
  }
  if (p.usaHotel) {
    if (!p.hotel?.nombre?.trim()) e.push("El hotel necesita nombre.");
    for (const a of ACOMS_DIN) {
      const v = precioComp(p, p.hotel?.neto[a], p.hotel?.pvp[a]);
      if (!Number.isFinite(v) || v < 0) e.push(`Falta el precio del hotel para «${a}» (usa 0 si es gratis).`);
      else if (ROOMS.includes(a as AcomRoom) && v === 0) e.push(`El precio del hotel para «${a}» no puede ser 0.`);
    }
  }
  if (p.usaVuelo) {
    for (const k of ["adulto", "nino", "infante"] as const) {
      const v = precioComp(p, p.vuelo?.neto[k], p.vuelo?.pvp[k]);
      if (!Number.isFinite(v) || v < 0) e.push(`Falta el precio del vuelo para «${k}».`);
      else if (k === "adulto" && v === 0) e.push("El precio del vuelo para adulto no puede ser 0.");
    }
  }
  if (p.usaServicios) {
    if (p.servicios.length === 0) e.push("Agrega al menos un servicio o desmarca «Servicios».");
    for (const s of p.servicios) {
      const v = precioComp(p, s.neto, s.pvp);
      if (!s.nombre.trim()) e.push("Hay un servicio sin nombre.");
      if (!Number.isFinite(v) || v <= 0) e.push(`El servicio «${s.nombre || "sin nombre"}» necesita un precio mayor que 0.`);
    }
  }
  // Total declarado vs desglose (solo PVP por componente).
  if (p.esquema === "solo_pvp" && p.pvpModo === "por_componente" && p.totalDeclarado) {
    for (const a of ACOMS_DIN) {
      const dec = p.totalDeclarado[a];
      if (dec == null) continue;
      const d = totalPorPersona(p, a);
      if (Number.isFinite(d) && Math.abs(d - dec) > 0.5) e.push(`El total declarado de «${a}» (${dec}) no cuadra con el desglose (${d}).`);
    }
  }
  return e;
}

/** Cuánto paga UNA persona en la acomodación `a` con todos los servicios del paquete. */
export function totalPorPersona(p: PaqueteDin, a: AcomDin): number {
  if (p.esquema === "solo_pvp" && p.pvpModo === "general") return num(p.pvpGeneral?.[a]);
  let t = 0;
  if (p.usaHotel) t += precioComp(p, p.hotel?.neto[a], p.hotel?.pvp[a]);
  if (p.usaVuelo) {
    const k = a === "infante" ? "infante" : a === "nino" || a === "nino2" ? "nino" : "adulto";
    t += precioComp(p, p.vuelo?.neto[k], p.vuelo?.pvp[k]);
  }
  if (p.usaServicios && a !== "infante") for (const s of p.servicios) t += precioComp(p, s.neto, s.pvp);
  return t;
}

export const adultosDe = (c: Composicion): number =>
  ROOMS.reduce((s, r) => s + Math.max(Math.trunc(c.habitaciones[r] ?? 0), 0) * PAX_TARIFA_DEFAULT[r], 0);

/**
 * Liquida la composición en líneas. Lanza si la configuración o la composición son inválidas
 * (el llamador valida antes con `validarPaquete`).
 */
export function liquidarPaquete(p: PaqueteDin, c: Composicion): { lineas: LineaDin[]; total: number; adultos: number; ninos: number; infantes: number } {
  const errs = validarPaquete(p);
  if (errs.length) throw new Error(errs[0]);
  const n1 = Math.max(Math.trunc(c.ninos || 0), 0), n2 = Math.max(Math.trunc(c.ninos2 || 0), 0), inf = Math.max(Math.trunc(c.infantes || 0), 0);
  const adultos = adultosDe(c);
  if (adultos < 1) throw new Error("Debe haber al menos una habitación con adultos.");
  const ninos = n1 + n2;
  const lineas: LineaDin[] = [];
  const general = p.esquema === "solo_pvp" && p.pvpModo === "general";
  const pendiente = p.esquema === "solo_pvp";

  // Cantidades por acomodación (personas que pagan esa tarifa).
  const porAcom: [AcomDin, number][] = [
    ...ROOMS.map((r) => [r, Math.max(Math.trunc(c.habitaciones[r] ?? 0), 0) * PAX_TARIFA_DEFAULT[r]] as [AcomDin, number]),
    ["nino", n1], ["nino2", n2], ["infante", inf],
  ];

  if (general) {
    for (const [a, q] of porAcom) {
      if (q <= 0) continue;
      lineas.push({ componente: "paquete", ref: "paquete", descripcion: `Paquete · ${a}`, cantidad: q, valor: Math.round(q * num(p.pvpGeneral?.[a])), costoNeto: 0, exigeCosto: false, proveedor: "" });
    }
  } else {
    if (p.usaHotel) {
      for (const [a, q] of porAcom) {
        if (q <= 0) continue;
        lineas.push({ componente: "hotel", ref: "hotel", descripcion: `${p.hotel!.nombre} · ${a}`, cantidad: q, valor: Math.round(q * precioComp(p, p.hotel!.neto[a], p.hotel!.pvp[a])), costoNeto: p.esquema === "neta_markup" ? Math.round(q * num(p.hotel!.neto[a])) : 0, exigeCosto: pendiente, proveedor: p.hotel!.proveedor ?? "" });
      }
    }
    if (p.usaVuelo) {
      for (const [k, q] of [["adulto", adultos], ["nino", ninos], ["infante", inf]] as const) {
        if (q <= 0) continue;
        lineas.push({ componente: "vuelo", ref: "vuelo", descripcion: `Vuelo · ${k}`, cantidad: q, valor: Math.round(q * precioComp(p, p.vuelo!.neto[k], p.vuelo!.pvp[k])), costoNeto: p.esquema === "neta_markup" ? Math.round(q * num(p.vuelo!.neto[k])) : 0, exigeCosto: pendiente, proveedor: p.vuelo!.proveedor ?? "" });
      }
    }
    if (p.usaServicios) {
      const elegidos = c.servicios ? p.servicios.filter((s) => c.servicios!.includes(s.id)) : p.servicios;
      for (const s of elegidos) {
        const q = adultos + ninos; // los infantes no pagan servicios
        lineas.push({ componente: "servicio", ref: `servicio:${s.id}`, descripcion: s.nombre, cantidad: q, valor: Math.round(q * precioComp(p, s.neto, s.pvp)), costoNeto: p.esquema === "neta_markup" ? Math.round(q * num(s.neto)) : 0, exigeCosto: pendiente, proveedor: s.proveedor ?? "" });
      }
    }
  }
  // En «general» los componentes no llevan PVP propio pero su costo real sí se exige al convertir.
  if (general) {
    const comps: Omit<LineaDin, "valor" | "costoNeto" | "exigeCosto">[] = [];
    if (p.usaVuelo) comps.push({ componente: "vuelo", ref: "vuelo", descripcion: "Vuelo", cantidad: adultos + ninos + inf, proveedor: p.vuelo?.proveedor ?? "" });
    if (p.usaHotel) comps.push({ componente: "hotel", ref: "hotel", descripcion: p.hotel?.nombre ?? "Hotel", cantidad: adultos + ninos + inf, proveedor: p.hotel?.proveedor ?? "" });
    if (p.usaServicios) for (const s of p.servicios) comps.push({ componente: "servicio", ref: `servicio:${s.id}`, descripcion: s.nombre, cantidad: adultos + ninos, proveedor: s.proveedor ?? "" });
    for (const k of comps) lineas.push({ ...k, valor: 0, costoNeto: 0, exigeCosto: true });
  }
  const total = lineas.reduce((s, l) => s + l.valor, 0);
  return { lineas, total, adultos, ninos, infantes: inf };
}

/** El desglose debe sumar exactamente el total (tolerancia 0,5 igual que la RPC). */
export function verificarCuadre(lineas: Pick<LineaDin, "valor">[], total: number): boolean {
  return Math.abs(lineas.reduce((s, l) => s + l.valor, 0) - total) <= 0.5;
}

/** ¿Faltan costos reales? Una línea que exige costo debe traer costo > 0 y proveedor. */
export function costosFaltantes(lineas: Pick<LineaDin, "descripcion" | "costoNeto" | "exigeCosto" | "proveedor">[]): string[] {
  return lineas
    .filter((l) => l.exigeCosto && (!(l.costoNeto > 0) || !l.proveedor.trim()))
    .map((l) => l.descripcion);
}

/**
 * Una fila por COMPONENTE (lo que se guarda en `cotizacion_servicios`): el costo real de un
 * hotel/vuelo/servicio se registra una sola vez, no por acomodación.
 */
export function agruparPorComponente(lineas: LineaDin[]): LineaDin[] {
  const m = new Map<string, LineaDin>();
  for (const l of lineas) {
    const x = m.get(l.ref);
    if (!x) { m.set(l.ref, { ...l, descripcion: l.componente === "hotel" ? l.descripcion.split(" · ")[0] : l.componente === "vuelo" ? "Vuelo" : l.componente === "paquete" ? "Precio general del paquete" : l.descripcion }); continue; }
    x.valor += l.valor; x.costoNeto += l.costoNeto; x.cantidad = Math.max(x.cantidad, l.cantidad);
  }
  return [...m.values()];
}

/** Forma de la composición que llega del navegador: enteros ≥ 0 con tope, al menos un adulto. */
export function composicionValida(c: unknown): c is Composicion {
  if (!c || typeof c !== "object") return false;
  const x = c as Composicion;
  const ent = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
  if (!x.habitaciones || typeof x.habitaciones !== "object") return false;
  for (const [k, v] of Object.entries(x.habitaciones)) if (!(ROOMS as readonly string[]).includes(k) || !ent(v, 20)) return false;
  if (!ent(x.ninos, 20) || !ent(x.ninos2, 20) || !ent(x.infantes, 20)) return false;
  if (x.servicios !== undefined && !(Array.isArray(x.servicios) && x.servicios.every((s) => typeof s === "string"))) return false;
  return adultosDe(x) >= 1;
}
