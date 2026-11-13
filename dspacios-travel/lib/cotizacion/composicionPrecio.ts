// Composición del precio de venta de una cotización, tal como la produjo el motor al cotizar. PURO (sin I/O).
// Se guarda en `cotizacion_composicion` (tabla privada, migración 272) porque lleva netas y markup. NUNCA se recalcula al mostrarla.
// Cada componente lleva su neto y lo que aporta al precio de venta (neto con el markup global del paquete, tal como lo calculó el motor); el vuelo entra ya como precio vendible y el redondeo es una línea aparte.

import { marcar } from "../calc/paquetes.ts";
import { repartirExacto } from "../calc/promocionesGrupo.ts";

export type TipoComponente = "hotel" | "vuelo" | "servicio" | "redondeo";
/** Por persona. `neto` = costo del proveedor (null donde el motor no lo conserva: vuelo ya vendible, redondeo). `venta` = lo que ese componente aporta al precio de venta, tal como lo calculó el motor. */
export type ComponentePersona = {
  tipo: TipoComponente; nombre: string; neto: number | null; venta: number;
  /** Importe del neto en su moneda de ORIGEN cuando se convirtió con TRM (`neto` ya está en la moneda de la oferta). Ausente = sin conversión. */
  origen?: { monto: number; moneda: string };
  /** Desglose por tramos (desde, hasta, unidades, neto por persona adulta, origen) de un servicio incluido por día/noche; el `neto` del componente es su suma. */
  tramos?: { desde: string; hasta: string; unidades: number; neto: number; origen: string }[];
};

export type LineaComposicion = {
  clave: string;
  etiqueta: string;
  pax: number;
  pvpPorPersona: number;
  total: number;
  /** null = el motor dio este precio pero sus componentes no son verificables (p. ej. PVP fijo del infante): se dice, no se inventa. */
  componentes: ComponentePersona[] | null;
  nota?: string;
  /** #43/#60 entrega 4: descuento por habitación. Importes EXACTOS de la línea (sin pasar por la tarifa por persona):
   * neto de una habitación en la estadía, descuento por habitación, su reparto de presentación por ocupante tarifado
   * (suma exacta, residuo a los primeros) y el neto de hotel de la línea = habitaciones × neto por habitación. */
  habitacion?: { habitaciones: number; ocupantes: number; netoPorHabitacion: number; descuento: number; repartoDescuento: number[]; netoHotelLinea: number };
};
export type AdicionalComposicion = { tipo: "servicio_opcional" | "servicio_grupo" | "mascota" | "ajuste_redondeo"; nombre: string; total: number };

export type Composicion = {
  version: 1;
  moneda: string;
  /** TRM con la que se convirtió la oferta; null = sin conversión (hoy solo se guarda composición sin conversión). */
  trm: number | null;
  markup: { tipo: "global"; pct: number };
  /** Impuesto (BNC) por persona con silla: va DENTRO del precio, no se suma. Informativo. */
  impuestoIncluido: number;
  lineas: LineaComposicion[];
  adicionales: AdicionalComposicion[];
  total: number;
  /** Σ líneas + adicionales == total guardado. */
  cuadra: boolean;
  /** #90: regla EBB / Long Stay que usó el cálculo (solo si se aplicó descuento). Informativo: no entra en ninguna suma. Entrega 5: mixta
   *  (`porAcomodacion`, sin tipo/umbral/pct) si la precedencia decidió distinto por acomodación. */
  descuentoHotel?: { etiqueta: string; tipo?: "ebb" | "long_stay"; umbral?: number; pct?: number; porAcomodacion?: { acom: string; etiqueta: string | null }[] } | null;
};

/** Lo que produce el motor de liquidación por fechas (se pasa tal cual, sin recalcular precios). */
export type BaseMotor = {
  pctMk: number;
  impuesto: number;
  /** Aporte del vuelo al precio de venta (ya vendible: marcado o costo + TA). */
  vuelo: number;
  /** Costo del tiquete por persona cuando la fuente lo conserva; null = no se conoce (no se deduce del aporte). */
  vueloNeto: number | null;
  feeInfante: number;
  /** PVP fijo del infante aplicado a esa ruta: el precio no se compone, es el fijo. */
  fijo?: { mayor2: boolean; menor2: boolean };
  /** Precios que el motor publicó/calculó para cada acomodación/clase. Si viene, una línea solo se descompone cuando su precio es EXACTAMENTE ese. */
  pvps?: Record<string, { pvp: number; pvpMenor2: number | null }>;
  /** TRM (COP por USD) con la que se convirtieron los netos de origen; null/ausente = sin conversión. */
  trm?: number | null;
  /** Neto de hotel en su moneda de origen por acomodación/clase, solo donde hubo conversión. */
  netosOrigen?: Record<string, { monto: number; moneda: string }>;
  /** Neto por persona de cada servicio incluido (ya multiplicado por su factor de liquidación); `origen` solo si hubo conversión. */
  servicios: { nombre: string; neto: number; netoMenor: number; /** Desglose por tramos de un incluido por día/noche (desde, hasta, unidades, neto por persona, origen). */ tramos?: { desde: string; hasta: string; unidades: number; neto: number; origen: string }[]; origen?: { monto: number; montoMenor: number; moneda: string } }[];
  /** Neto de hotel por persona y por acomodación/clase (sencilla…multiple, nino, nino2, infante). */
  netos: Record<string, number>;
  /** #43/#60 entrega 4: neto exacto de UNA habitación (y su descuento) donde hubo descuento por habitación. */
  netosHabitacion?: Record<string, { ocupantes: number; total: number; descuento: number }>;
  /** #43/#60 entrega 5: promociones que aplicaron a la estadía publicada (por acomodación/clase) y el neto por persona SIN ellas, en la
   * moneda de la oferta (null = sin tarifa base). Con él, la reserva decide la precedencia con EBB / Long Stay en la fecha real de compra. */
  promociones?: Record<string, { nombres: string[]; netoSinPromocion: number | null }>;
};

export type LineaHab = { acom: string; habitaciones: number; pax: number; pvp: number };
export type LineaMenorMotor = { clase: string; cantidad: number; tarifa: number; menorDeDos: boolean };

const c2 = (n: number) => Math.round(n * 100) / 100;
const ROTULO_ACOM: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple" };
const ROTULO_CLASE: Record<string, string> = { nino: "Niño 1", nino2: "Niño 2", infante: "Infante" };

/** Componentes por persona de un precio dado. null si no cuadra como lo compone el motor (redondeo fuera de [0, unidad)). */
function componentes(b: BaseMotor, clave: string, pvp: number, menorDeDos: boolean, unidad: number): ComponentePersona[] | null {
  const neto = b.netos[clave];
  if (neto == null || !Number.isFinite(neto)) return null;
  if (clave === "infante" && (menorDeDos ? b.fijo?.menor2 : b.fijo?.mayor2)) return null;
  const esperado = b.pvps?.[clave];
  if (b.pvps && (!esperado || (menorDeDos ? esperado.pvpMenor2 : esperado.pvp) !== pvp)) return null;
  const hotelM = marcar(neto, b.pctMk);
  const serv = b.servicios.map((s) => ({ nombre: s.nombre, tramos: menorDeDos ? undefined : s.tramos, neto: menorDeDos ? s.netoMenor : s.neto, origen: s.origen ? { monto: menorDeDos ? s.origen.montoMenor : s.origen.monto, moneda: s.origen.moneda } : undefined }));
  const servM = serv.reduce((t, s) => t + marcar(s.neto, b.pctMk), 0);
  const vuelo = menorDeDos ? b.feeInfante : b.vuelo;
  // Menor de 2 años: el fee del vuelo se suma EXACTO después del redondeo (regla B); el resto se redondea hacia arriba.
  const redondeable = hotelM + servM + (menorDeDos ? 0 : vuelo);
  const sinRedondeo = redondeable + (menorDeDos ? vuelo : 0);
  const redondeo = pvp - sinRedondeo;
  if (redondeo < -0.005 || redondeo >= unidad + 0.005) return null;
  const oh = b.netosOrigen?.[clave];
  const out: ComponentePersona[] = [{ tipo: "hotel", nombre: "Hotel", neto: c2(neto), venta: c2(hotelM), ...(oh ? { origen: { monto: c2(oh.monto), moneda: oh.moneda } } : {}) }];
  if (vuelo > 0) out.push({ tipo: "vuelo", nombre: menorDeDos ? "Fee de infante del vuelo" : "Vuelo", neto: menorDeDos ? c2(vuelo) : b.vueloNeto == null ? null : c2(b.vueloNeto), venta: c2(vuelo) });
  for (const x of serv) out.push({ tipo: "servicio", nombre: x.nombre, neto: c2(x.neto), venta: c2(marcar(x.neto, b.pctMk)), ...(x.tramos ? { tramos: x.tramos } : {}), ...(x.origen ? { origen: { monto: c2(x.origen.monto), moneda: x.origen.moneda } } : {}) });
  const resto = out.reduce((t, x) => t + x.venta, 0);
  const red = c2(pvp - resto);
  if (Math.abs(red) > 0.004) out.push({ tipo: "redondeo", nombre: "Redondeo", neto: null, venta: red });
  return out;
}

export function construirComposicion(a: {
  base: BaseMotor;
  moneda: string;
  trm: number | null;
  lineasHab: readonly LineaHab[];
  lineasMenores: readonly LineaMenorMotor[];
  adicionales: readonly AdicionalComposicion[];
  total: number;
}): Composicion {
  const unidad = a.moneda === "USD" ? 1 : 1000;
  const lineas: LineaComposicion[] = [];
  for (const l of a.lineasHab) {
    const comp = componentes(a.base, l.acom, l.pvp, false, unidad);
    const nh = a.base.netosHabitacion?.[l.acom];
    const dec = a.moneda === "USD" ? 2 : 0;
    const red = (n: number) => Math.round(n * 10 ** dec) / 10 ** dec;
    lineas.push({
      clave: l.acom, etiqueta: `${l.habitaciones} hab ${ROTULO_ACOM[l.acom] ?? l.acom} (${l.pax} pax)`, pax: l.pax, pvpPorPersona: l.pvp, total: l.pax * l.pvp,
      componentes: comp, ...(comp ? {} : { nota: "El precio no se puede descomponer con lo que guardó el motor (p. ej. PVP fijo)." }),
      ...(nh ? { habitacion: {
        habitaciones: l.habitaciones, ocupantes: nh.ocupantes, netoPorHabitacion: red(nh.total), descuento: red(nh.descuento),
        repartoDescuento: repartirExacto(nh.descuento, nh.ocupantes, dec), netoHotelLinea: red(red(nh.total) * l.habitaciones),
      } } : {}),
    });
  }
  for (const m of a.lineasMenores) {
    const comp = componentes(a.base, m.clase, m.tarifa, m.menorDeDos, unidad);
    lineas.push({
      clave: `${m.clase}${m.menorDeDos ? "-menor2" : ""}`, etiqueta: `${ROTULO_CLASE[m.clase] ?? m.clase}${m.menorDeDos ? " (menor de 2 años)" : ""} (${m.cantidad})`,
      pax: m.cantidad, pvpPorPersona: m.tarifa, total: m.cantidad * m.tarifa,
      componentes: comp, ...(comp ? {} : { nota: "El precio no se puede descomponer con lo que guardó el motor (p. ej. PVP fijo o servicio opcional del infante)." }),
    });
  }
  const suma = lineas.reduce((t, l) => t + l.total, 0) + a.adicionales.reduce((t, x) => t + x.total, 0);
  return {
    version: 1, moneda: a.moneda, trm: a.trm, markup: { tipo: "global", pct: a.base.pctMk }, impuestoIncluido: a.base.impuesto,
    lineas, adicionales: [...a.adicionales], total: a.total, cuadra: Math.abs(suma - a.total) <= 0.01,
  };
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Lee lo guardado con validación estricta de forma; null si no es una composición válida (la ficha dirá que no se conservó). */
export function leerComposicion(raw: unknown): Composicion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || typeof r.moneda !== "string" || !esNum(r.total) || !Array.isArray(r.lineas) || !Array.isArray(r.adicionales)) return null;
  const mk = r.markup as { pct?: unknown } | null;
  if (!mk || !esNum(mk.pct)) return null;
  const lineas: LineaComposicion[] = [];
  for (const x of r.lineas) {
    const l = x as Record<string, unknown>;
    if (typeof l?.clave !== "string" || typeof l.etiqueta !== "string" || !esNum(l.pax) || !esNum(l.pvpPorPersona) || !esNum(l.total)) return null;
    let componentes: ComponentePersona[] | null = null;
    if (l.componentes != null) {
      if (!Array.isArray(l.componentes)) return null;
      componentes = [];
      for (const c of l.componentes) {
        const k = c as Record<string, unknown>;
        if (typeof k?.tipo !== "string" || typeof k.nombre !== "string" || !esNum(k.venta) || (k.neto != null && !esNum(k.neto))) return null;
        const o = k.origen as { monto?: unknown; moneda?: unknown } | undefined;
        if (o != null && (!esNum(o.monto) || typeof o.moneda !== "string")) return null;
        componentes.push({ tipo: k.tipo as TipoComponente, nombre: k.nombre, neto: k.neto == null ? null : (k.neto as number), venta: k.venta, ...(o ? { origen: { monto: o.monto as number, moneda: o.moneda as string } } : {}) });
      }
    }
    const h = l.habitacion as Record<string, unknown> | undefined;
    const habitacion = h && typeof h === "object" && [h.habitaciones, h.ocupantes, h.netoPorHabitacion, h.descuento, h.netoHotelLinea].every(esNum)
      && Array.isArray(h.repartoDescuento) && (h.repartoDescuento as unknown[]).every(esNum)
      ? { habitacion: { habitaciones: h.habitaciones as number, ocupantes: h.ocupantes as number, netoPorHabitacion: h.netoPorHabitacion as number,
          descuento: h.descuento as number, repartoDescuento: h.repartoDescuento as number[], netoHotelLinea: h.netoHotelLinea as number } }
      : {};
    lineas.push({ clave: l.clave, etiqueta: l.etiqueta, pax: l.pax, pvpPorPersona: l.pvpPorPersona, total: l.total, componentes, ...habitacion, ...(typeof l.nota === "string" ? { nota: l.nota } : {}) });
  }
  const adicionales: AdicionalComposicion[] = [];
  for (const x of r.adicionales) {
    const k = x as Record<string, unknown>;
    if (typeof k?.tipo !== "string" || typeof k.nombre !== "string" || !esNum(k.total)) return null;
    adicionales.push({ tipo: k.tipo as AdicionalComposicion["tipo"], nombre: k.nombre, total: k.total });
  }
  const suma = lineas.reduce((t, l) => t + l.total, 0) + adicionales.reduce((t, x) => t + x.total, 0);
  // #90: etiqueta de la regla EBB / Long Stay (opcional: las cotizaciones anteriores no la traen).
  const d = r.descuentoHotel as Record<string, unknown> | null | undefined;
  const pa = Array.isArray(d?.porAcomodacion) && (d!.porAcomodacion as unknown[]).every((x) => typeof (x as { acom?: unknown })?.acom === "string"
    && (typeof (x as { etiqueta?: unknown }).etiqueta === "string" || (x as { etiqueta?: unknown }).etiqueta === null))
    ? (d!.porAcomodacion as { acom: string; etiqueta: string | null }[]).map((x) => ({ acom: x.acom, etiqueta: x.etiqueta })) : null;
  const dh = d && typeof d.etiqueta === "string" && pa ? { etiqueta: d.etiqueta, porAcomodacion: pa }
    : d && typeof d.etiqueta === "string" && (d.tipo === "ebb" || d.tipo === "long_stay") && esNum(d.umbral) && esNum(d.pct)
    ? { etiqueta: d.etiqueta, tipo: d.tipo as "ebb" | "long_stay", umbral: d.umbral, pct: d.pct } : null;
  return {
    version: 1, moneda: r.moneda, trm: esNum(r.trm) ? r.trm : null, markup: { tipo: "global", pct: mk.pct },
    impuestoIncluido: esNum(r.impuestoIncluido) ? r.impuestoIncluido : 0, lineas, adicionales, total: r.total, cuadra: Math.abs(suma - r.total) <= 0.01,
    ...(dh ? { descuentoHotel: dh } : {}),
  };
}

/** Lo que se guarda por cotización: una composición por hotel (el carrito puede traer varios; una cotización simple, uno). */
export type ComposicionCotizacion = { version: 1; hoteles: { ref: string | null; nombre: string | null; composicion: Composicion }[] };

export function leerComposicionCotizacion(raw: unknown): ComposicionCotizacion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { version?: unknown; hoteles?: unknown };
  if (r.version !== 1 || !Array.isArray(r.hoteles) || !r.hoteles.length) return null;
  const hoteles: ComposicionCotizacion["hoteles"] = [];
  for (const h of r.hoteles) {
    const x = h as { ref?: unknown; nombre?: unknown; composicion?: unknown };
    const composicion = leerComposicion(x?.composicion);
    if (!composicion) return null;
    hoteles.push({ ref: typeof x.ref === "string" ? x.ref : null, nombre: typeof x.nombre === "string" ? x.nombre : null, composicion });
  }
  return { version: 1, hoteles };
}
