// ─────────────────────────────────────────────────────────────────────────
// #57 — REGLA ÚNICA del precio de un programa al reservar.
//
// Antes, `reservarProgramaInterno` calculaba el PVP por su cuenta
// (`pvpPrograma(neto, …)` con los días de asistencia `noches ?? dias − 1` y SIN
// la regla de tarifa comisionable de la migración 161), mientras la ficha
// pública y el editor lo calculaban con `calcularPvpAcomodacionSalida` y los días
// `noches ?? dias`. Con los mismos datos, la ficha mostraba un precio y la
// reserva cobraba otro (p. ej. salida sin noches: 1.252 vs 1.247 USD; modalidad
// nueva con tarifa de proveedor: 1.129 vs 1.135 USD).
//
// Este módulo es PURO (sin Supabase, sin alias `@/`): lo usan la Server Action
// de reserva, el formulario y la prueba de paridad contra `getProgramaDetalle`
// (la ficha). La fórmula NO se reescribe aquí: se compone con las funciones
// de `lib/calc/programaPrecio.ts` que ya usan la ficha y el editor.
//
// Reglas (Q1 de #57, cerradas por el Coordinador):
//   · días de asistencia: las `noches` de la salida si vienen; si son NULL, los
//     `dias` del programa (como la ficha) — nunca `dias − 1`.
//   · regla 161 (tarifa de proveedor + modalidad de MK): la decide
//     `calcularPvpAcomodacionSalida`, la misma de la ficha.
//   · el fee bancario es parte del PVP (lo suma `pvpPrograma`); no es impuesto.
//   · en modalidad nueva el PVP sale del neto RECALCULADO desde la tarifa y la
//     regla 161, pero la CxP al proveedor sale del neto PERSISTIDO. Si no
//     coinciden (centavos), la reserva se rechaza: no se elige uno en silencio;
//     hay que actualizar la salida del programa y recotizar.
//   · el precio exigible debe cubrir el costo del programa y la asistencia de
//     los pasajeros a quienes se les cobra (adultos y niños; no los infantes).
//     El fee bancario NO cuenta como costo.
//   · `ventas.impuesto` (base comisionable B2B) solo se alimenta con un
//     importe FISCAL verificable: modo `impuesto`, con tarifa de proveedor
//     cargada para esa acomodación y el monto configurado. En modo `pct` la
//     reducción de base no es impuesto; en `ninguno` la regla no informa
//     impuesto. `montoNoComisionable` NO se usa en ningún modo.
// ─────────────────────────────────────────────────────────────────────────
import {
  calcularNetoProgramaConModalidad,
  calcularPvpAcomodacionSalida,
  pvpPrograma,
  resolverValorReglaAcomodacion,
  type ModalidadMk,
  type ModoBaseComisionable,
  type PvpOpciones,
} from "../calc/programaPrecio.ts";
import { paxDeAcomodacion } from "../acomodaciones.ts";
import {
  CLAVES_TARIFA,
  liquidarNochesAdicionales,
  nocheTarifaConPvp,
  resolverVigencia,
  sinNeto,
  validarOcupacionHotel,
  type BaseHotelFila,
  type HotelEstancia,
  type ModalidadServicios,
  type Noche88,
  type NocheTarifaFila,
  type NocheTarifaPvp,
  type PorAcom,
} from "./estanciaHotel88.ts";

/** Columnas de `programas` que intervienen en el precio (las mismas que lee la ficha). */
export type ProgramaPrecioCabecera = {
  moneda: string;
  pct_mk: number;
  pct_fee_tarjeta: number;
  asistencia_medica_dia: number;
  dias: number | null;
  regla_comisionable?: boolean | null;
  regla_comisionable_modalidad_mk?: string | null;
  regla_comisionable_modo?: string | null;
  regla_comisionable_valor?: number | null;
  regla_comisionable_pct_comision?: number | null;
  regla_comisionable_impuesto_por_acomodacion?: boolean | null;
};

type N = number | null | undefined;

/** Columnas de `programa_salidas` que intervienen en el precio. */
export type SalidaPrecio = {
  noches: N;
  bajo_solicitud: boolean | null | undefined;
  neto_sencilla?: N; neto_doble?: N; neto_triple?: N; neto_multiple?: N; neto_nino?: N;
  tarifa_sencilla?: N; tarifa_doble?: N; tarifa_triple?: N; tarifa_multiple?: N;
  impuesto_sencilla?: N; impuesto_doble?: N; impuesto_triple?: N; impuesto_multiple?: N;
};

/** Fila de `programa_precios` (modo categoría). */
export type NetoCategoria = { acomodacion: string; neto: N; bajo_solicitud: boolean | null | undefined };

type ColNeto = "neto_sencilla" | "neto_doble" | "neto_triple" | "neto_multiple" | "neto_nino";
type ColTarifa = "tarifa_sencilla" | "tarifa_doble" | "tarifa_triple" | "tarifa_multiple";
type ColImpuesto = "impuesto_sencilla" | "impuesto_doble" | "impuesto_triple" | "impuesto_multiple";

/** Mismo mapa que usa la ficha (`ACOM_SALIDA` de lib/programas.ts). */
export const ACOMODACIONES_SALIDA: readonly { acomodacion: string; neto: ColNeto; tarifa: ColTarifa | null; impuesto: ColImpuesto | null }[] = [
  { acomodacion: "sencilla", neto: "neto_sencilla", tarifa: "tarifa_sencilla", impuesto: "impuesto_sencilla" },
  { acomodacion: "doble", neto: "neto_doble", tarifa: "tarifa_doble", impuesto: "impuesto_doble" },
  { acomodacion: "triple", neto: "neto_triple", tarifa: "tarifa_triple", impuesto: "impuesto_triple" },
  { acomodacion: "multiple", neto: "neto_multiple", tarifa: "tarifa_multiple", impuesto: "impuesto_multiple" },
  { acomodacion: "nino", neto: "neto_nino", tarifa: null, impuesto: null },
];

/** Regla 161 del programa con los mismos valores por defecto que la ficha. */
function reglaDe(p: ProgramaPrecioCabecera) {
  return {
    activa: p.regla_comisionable === true,
    modalidad: (p.regla_comisionable_modalidad_mk === "base_neta_impuestos_al_final" ? "base_neta_impuestos_al_final" : "historica") as ModalidadMk,
    modo: ((p.regla_comisionable_modo as ModoBaseComisionable) || "pct") as ModoBaseComisionable,
    valor: Number(p.regla_comisionable_valor) || 0,
    pctComision: Number(p.regla_comisionable_pct_comision) || 0,
    impuestoPorAcomodacion: p.regla_comisionable_impuesto_por_acomodacion === true,
  };
}

/**
 * Días de asistencia: las noches de la salida si vienen; si son NULL, los días
 * del programa (cabecera). Es la regla de la ficha (`s.noches ?? programa.dias`).
 */
export function diasAsistencia(programa: Pick<ProgramaPrecioCabecera, "dias">, nochesSalida?: N): number | null {
  return nochesSalida != null ? nochesSalida : programa.dias;
}

function opcionesPvp(p: ProgramaPrecioCabecera, dias: number | null): PvpOpciones {
  return { pctMk: p.pct_mk, asistenciaDia: p.asistencia_medica_dia, dias, pctFee: p.pct_fee_tarjeta, moneda: p.moneda };
}

export type UnidadPrecio = {
  acomodacion: string;
  /** PVP por persona, redondeado como lo hace `pvpPrograma` (COP al millar, USD al dólar). */
  pvp: number;
  /** Neto del proveedor por persona (persistido): base de la CxP, como siempre. */
  neto: number;
  /** Camino de la regla 161 que decidió el PVP. */
  via: "historica" | "modalidad_nueva";
  /**
   * Solo en modalidad nueva con tarifa de proveedor: el neto recalculado desde
   * la tarifa y la regla (el que usa el PVP) y si coincide, al centavo, con el
   * neto persistido (el que usa la CxP). `null` fuera de ese camino.
   */
  netoRecalculado: number | null;
  netoVigente: boolean | null;
  /**
   * Importe FISCAL del proveedor por persona, solo si es verificable: regla
   * activa en modo `impuesto`, tarifa de proveedor cargada para esta
   * acomodación y monto configurado válido. `null` en cualquier otro caso
   * (modo `pct`, `ninguno`, sin tarifa, categoría, niño).
   */
  impuestoFiscal: number | null;
};

/** Modo categoría: PVP de una fila de `programa_precios` (null = sin precio). */
export function precioUnitarioCategoria(programa: ProgramaPrecioCabecera, fila: NetoCategoria): UnidadPrecio | null {
  const neto = fila.neto;
  if (fila.bajo_solicitud || neto == null || !(Number(neto) > 0)) return null;
  const pvp = pvpPrograma(Number(neto), opcionesPvp(programa, programa.dias));
  if (!(pvp > 0)) return null;
  return { acomodacion: fila.acomodacion, pvp, neto: Number(neto), via: "historica", netoRecalculado: null, netoVigente: null, impuestoFiscal: null };
}

/** Modo salida: PVP de una acomodación de una salida (null = sin precio). Igual que `pvpDeSalida` de la ficha. */
export function precioUnitarioSalida(programa: ProgramaPrecioCabecera, salida: SalidaPrecio, acomodacion: string): UnidadPrecio | null {
  const def = ACOMODACIONES_SALIDA.find((a) => a.acomodacion === acomodacion);
  if (!def) return null;
  const neto = salida[def.neto];
  if (salida.bajo_solicitud || neto == null || !(Number(neto) > 0)) return null;
  const tarifa = def.tarifa ? salida[def.tarifa] ?? null : null;
  const usaTarifaProveedor = tarifa != null && Number.isFinite(Number(tarifa)) && Number(tarifa) > 0;
  const r = reglaDe(programa);
  const valorRegla = usaTarifaProveedor
    ? resolverValorReglaAcomodacion({
        modo: r.modo,
        valorGeneral: r.valor,
        impuestoPorAcomodacion: r.impuestoPorAcomodacion,
        impuestoAcomodacion: def.impuesto ? salida[def.impuesto] ?? null : null,
      })
    : r.valor;
  if (valorRegla == null) return null;
  const pvp = calcularPvpAcomodacionSalida({
    neto: Number(neto),
    tarifa: tarifa == null ? null : Number(tarifa),
    reglaActiva: r.activa,
    reglaModo: r.modo,
    reglaValor: valorRegla,
    reglaPctComision: r.pctComision,
    modalidadMk: r.modalidad,
    opt: opcionesPvp(programa, diasAsistencia(programa, salida.noches)),
  });
  if (pvp == null || !(pvp > 0)) return null;
  const via = r.activa && r.modalidad === "base_neta_impuestos_al_final" && usaTarifaProveedor ? "modalidad_nueva" : "historica";
  // Modalidad nueva: el PVP usa el neto RECALCULADO; la CxP usa el PERSISTIDO.
  let netoRecalculado: number | null = null;
  let netoVigente: boolean | null = null;
  if (via === "modalidad_nueva") {
    netoRecalculado = calcularNetoProgramaConModalidad(
      { tarifa: Number(tarifa), modo: r.modo, valor: valorRegla, pctComision: r.pctComision },
      r.modalidad,
    ).neto;
    netoVigente = Math.round(netoRecalculado * 100) === Math.round(Number(neto) * 100);
  }
  const fiscalVerificable =
    r.activa && r.modo === "impuesto" && usaTarifaProveedor &&
    Number.isFinite(valorRegla) && valorRegla >= 0 && valorRegla <= Number(tarifa);
  return {
    acomodacion,
    pvp,
    neto: Number(neto),
    via,
    netoRecalculado,
    netoVigente,
    impuestoFiscal: fiscalVerificable ? valorRegla : null,
  };
}

export type FuentePrecio =
  | { modo: "categoria"; precios: NetoCategoria[] }
  | { modo: "salida"; salida: SalidaPrecio };

function unidad(programa: ProgramaPrecioCabecera, fuente: FuentePrecio, acomodacion: string): UnidadPrecio | null {
  if (fuente.modo === "salida") return precioUnitarioSalida(programa, fuente.salida, acomodacion);
  const fila = fuente.precios.find((p) => p.acomodacion === acomodacion);
  return fila ? precioUnitarioCategoria(programa, fila) : null;
}

/**
 * #88 — Estancia por hotel y vigencia con noches adicionales. La BASE de esta
 * modalidad entra por `fuente` (la fila de la vigencia de entrada, vista como
 * una salida: `salidaPrecioDesdeBase`) y pasa por la MISMA regla de #57; esto
 * solo agrega las noches adicionales, que nunca existen sin la base.
 */
export type EstanciaEntrada = {
  hotel: HotelEstancia;
  /** Tarifas de noche del hotel con PVP (y neto, en el servidor). */
  tarifasNoche: readonly NocheTarifaPvp[];
  fechaEntrada: string;
  nochesIncluidas: number;
  nochesAdicionales: number;
};

export type EntradaLiquidacion = {
  programa: ProgramaPrecioCabecera;
  fuente: FuentePrecio;
  /** CANTIDAD DE HABITACIONES por acomodación (pax = habitaciones × pax por habitación). */
  habitaciones: Record<string, number>;
  ninos: number;
  infantes?: number;
  /** Solo en programas por hotel y vigencia (#88). */
  estancia?: EstanciaEntrada;
};

/** Desglose de la estancia (#88) que acompaña a una liquidación exitosa. */
export type DesgloseEstancia = {
  noches: Noche88[];
  /** PVP de las noches adicionales (ya incluido en `precioVenta`). */
  precioNoches: number;
  /** Neto de las noches adicionales (ya incluido en `costoNeto`). */
  costoNetoNoches: number;
  /** Asistencia de las noches adicionales (parte de `costoAtribuible`; no va con el hotel: la asistencia de la estancia completa se registra en su propia CxP de asistencia). */
  costoAsistenciaNoches: number;
  nochesAdicionales: number;
};

export type LineaLiquidada = {
  acomodacion: string;
  habitaciones: number;
  paxPorHabitacion: number;
  pax: number;
  pvpUnit: number;
  netoUnit: number;
  via: UnidadPrecio["via"];
  impuestoUnit: number | null;
};

export type LiquidacionPrograma =
  | {
      ok: true;
      lineas: LineaLiquidada[];
      nino: { cantidad: number; pvpUnit: number; netoUnit: number } | null;
      /** Adultos por habitación + niños + infantes. */
      totalPax: number;
      /** Total a cobrar en la moneda del programa (suma exacta en centavos). */
      precioVenta: number;
      /** Σ neto del proveedor × pax (base de la CxP). Con #88 incluye el neto de las noches adicionales. */
      costoNeto: number;
      /** Parte de `costoNeto` de la estancia incluida (sin noches adicionales). */
      costoNetoBase: number;
      /** PVP de la estancia incluida (sin noches adicionales). */
      precioBase: number;
      /** #88: null en las modalidades de siempre. */
      estancia: DesgloseEstancia | null;
      /**
       * Costo que el precio exigible debe cubrir: neto del proveedor + asistencia
       * (por día) de los pasajeros a quienes se les cobra. Sin fee bancario.
       */
      costoAtribuible: number;
      /** Parte de `costoAtribuible` que es asistencia. */
      costoAsistencia: number;
      diasAsistencia: number | null;
      impuesto: {
        /** Σ importe fiscal verificable × pax (0 si ninguna línea tiene fuente). */
        verificado: number;
        paxCubiertos: number;
        paxSinFuente: number;
        reglaActiva: boolean;
        modo: ModoBaseComisionable | null;
      };
    }
  | {
      ok: false;
      /** Mensaje para el usuario: SIN cifras de costo (el rol `venta` también reserva). */
      error: string;
      codigo?: "neto_obsoleto" | "precio_bajo_costo" | "ocupacion_invalida" | "noches_adicionales";
      /** Diagnóstico con cifras, solo en memoria (pruebas): la acción NO lo envía al navegador ni lo loguea. */
      detalle?: string;
    };

const mostrar = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/**
 * ¿El precio exigible cubre el costo del programa y la asistencia de los
 * pasajeros a quienes se les cobra (adultos por habitación y niños; los
 * infantes no pagan y no cuentan)? El fee bancario NO es costo. Se compara en
 * centavos: el borde exacto cubre; un centavo menos no.
 */
export function evaluarCoberturaCosto(a: {
  precioCentavos: number;
  lineas: Pick<LineaLiquidada, "netoUnit" | "pax">[];
  nino: { cantidad: number; netoUnit: number } | null;
  asistenciaDia: number | null | undefined;
  dias: number | null | undefined;
  moneda: string;
  /** #88: neto y asistencia (centavos) de las noches adicionales, ya incluidos en el precio. */
  extra?: { netoCentavos: number; asistenciaCentavos: number };
}): { ok: true; costoAtribuible: number; costoAsistencia: number } | { ok: false; error: string; detalle: string } {
  const asistenciaUnit = Math.round((Number(a.asistenciaDia) || 0) * Math.max(0, Number(a.dias) || 0) * 100);
  const paxCobrados = a.lineas.reduce((s, l) => s + l.pax, 0) + (a.nino?.cantidad ?? 0);
  const neto = a.lineas.reduce((s, l) => s + Math.round(l.netoUnit * 100) * l.pax, 0) + (a.nino ? Math.round(a.nino.netoUnit * 100) * a.nino.cantidad : 0);
  const asistencia = asistenciaUnit * paxCobrados + (a.extra?.asistenciaCentavos ?? 0);
  const costo = neto + (a.extra?.netoCentavos ?? 0) + asistencia;
  if (a.precioCentavos < costo) {
    return {
      ok: false,
      error:
        `El precio de la reserva no cubre el costo del programa y la asistencia de los pasajeros cobrados. ` +
        `Revisa la configuración del programa y vuelve a cotizar; no se creó ningún contrato.`,
      detalle: `precio=${mostrar(a.precioCentavos / 100)} costo_atribuible=${mostrar(costo / 100)} (neto=${mostrar(neto / 100)} asistencia=${mostrar(asistencia / 100)}) moneda=${a.moneda}`,
    };
  }
  return { ok: true, costoAtribuible: costo / 100, costoAsistencia: asistencia / 100 };
}

/**
 * Liquida una selección con la regla única. Mismos mensajes y mismo orden de
 * validación que tenía `reservarProgramaInterno`; la diferencia es que el PVP
 * de cada acomodación sale de las funciones que usa la ficha.
 */
export function liquidarSeleccion(e: EntradaLiquidacion): LiquidacionPrograma {
  const habs = Object.entries(e.habitaciones).filter(([, n]) => (Number(n) || 0) > 0);
  const nNinos = Number(e.ninos) || 0;
  if (!habs.length && nNinos <= 0) return { ok: false, error: "Indica cuántas habitaciones reservas en cada acomodación." };
  if (habs.some(([, n]) => !Number.isInteger(Number(n))) || !Number.isInteger(nNinos) || nNinos < 0) {
    return { ok: false, error: "Las habitaciones y los niños deben ser cantidades enteras." };
  }

  const lineas: LineaLiquidada[] = [];
  let centavos = 0;
  let costoNeto = 0;
  let totalPax = 0;
  let impuestoCentavos = 0;
  let paxCubiertos = 0;
  let paxSinFuente = 0;

  for (const [acom, habRaw] of habs) {
    const nHab = Number(habRaw) || 0;
    const u = unidad(e.programa, e.fuente, acom);
    if (!u) return { ok: false, error: `La acomodación ${acom} no tiene precio (o es "a solicitud") en esta categoría.` };
    if (u.netoVigente === false) {
      return {
        ok: false,
        codigo: "neto_obsoleto",
        error:
          `El neto guardado de la acomodación ${acom} no coincide con el recalculado desde la tarifa del proveedor y la regla comisionable. ` +
          `Actualiza las tarifas de la salida del programa y vuelve a cotizar; no se creó ningún contrato.`,
        detalle: `acomodacion=${acom} neto_persistido=${mostrar(u.neto)} neto_recalculado=${mostrar(u.netoRecalculado ?? 0)} moneda=${e.programa.moneda}`,
      };
    }
    const paxHab = paxDeAcomodacion(acom);
    const nPax = nHab * paxHab;
    centavos += Math.round(u.pvp * 100) * nPax;
    costoNeto += u.neto * nPax;
    totalPax += nPax;
    if (u.impuestoFiscal != null) {
      impuestoCentavos += Math.round(u.impuestoFiscal * 100) * nPax;
      paxCubiertos += nPax;
    } else {
      paxSinFuente += nPax;
    }
    lineas.push({ acomodacion: acom, habitaciones: nHab, paxPorHabitacion: paxHab, pax: nPax, pvpUnit: u.pvp, netoUnit: u.neto, via: u.via, impuestoUnit: u.impuestoFiscal });
  }

  let nino: { cantidad: number; pvpUnit: number; netoUnit: number } | null = null;
  if (nNinos > 0) {
    const u = unidad(e.programa, e.fuente, "nino");
    if (!u) return { ok: false, error: `Esta categoría no tiene precio de niño (o es "a solicitud").` };
    centavos += Math.round(u.pvp * 100) * nNinos;
    costoNeto += u.neto * nNinos;
    totalPax += nNinos;
    paxSinFuente += nNinos; // el niño no tiene tarifa de proveedor: sin fuente fiscal
    nino = { cantidad: nNinos, pvpUnit: u.pvp, netoUnit: u.neto };
  }

  // Los infantes son pasajeros adicionales (sin silla ni precio).
  const nInfantes = Math.max(0, Math.trunc(Number(e.infantes) || 0));
  totalPax += nInfantes;
  if (totalPax <= 0) return { ok: false, error: "Debe haber al menos un pasajero." };

  const dias = e.fuente.modo === "salida" ? diasAsistencia(e.programa, e.fuente.salida.noches) : e.programa.dias;

  // #88 — ocupación del hotel y noches adicionales. La BASE ya quedó liquidada
  // arriba por la regla de siempre; aquí solo se SUMA lo adicional. Con 0 noches
  // no se exige ninguna tarifa de noche (el programa se puede vender sin ellas).
  const precioBaseCentavos = centavos;
  const costoNetoBase = costoNeto;
  let estancia: DesgloseEstancia | null = null;
  let extraCosto: { netoCentavos: number; asistenciaCentavos: number } | undefined;
  if (e.estancia) {
    const ocupacion = validarOcupacionHotel(e.estancia.hotel, e.habitaciones, nNinos, nInfantes);
    if (ocupacion) return { ok: false, codigo: "ocupacion_invalida", error: ocupacion };
    const n = liquidarNochesAdicionales({
      tarifas: e.estancia.tarifasNoche,
      hotelNombre: e.estancia.hotel.nombre,
      fechaEntrada: e.estancia.fechaEntrada,
      nochesIncluidas: e.estancia.nochesIncluidas,
      nochesAdicionales: e.estancia.nochesAdicionales,
      habitaciones: e.habitaciones,
      ninos: nNinos,
      asistenciaDia: Number(e.programa.asistencia_medica_dia) || 0,
    });
    if (!n.ok) return { ok: false, codigo: "noches_adicionales", error: n.error };
    if (n.netoCentavos == null) {
      return { ok: false, codigo: "noches_adicionales", error: "La tarifa de noche adicional no tiene el neto del proveedor cargado; no se puede registrar su costo." };
    }
    centavos += n.pvpCentavos;
    costoNeto = (Math.round(costoNeto * 100) + n.netoCentavos) / 100; // suma exacta en centavos: sin ruido de coma flotante
    extraCosto = { netoCentavos: n.netoCentavos, asistenciaCentavos: n.asistenciaCentavos };
    estancia = {
      noches: n.noches,
      precioNoches: n.pvpCentavos / 100,
      costoNetoNoches: n.netoCentavos / 100,
      costoAsistenciaNoches: n.asistenciaCentavos / 100,
      nochesAdicionales: e.estancia.nochesAdicionales,
    };
  }

  // El precio exigible debe cubrir el costo del programa y la asistencia de quienes PAGAN.
  const cobertura = evaluarCoberturaCosto({
    precioCentavos: centavos,
    lineas,
    nino,
    asistenciaDia: e.programa.asistencia_medica_dia,
    dias,
    moneda: e.programa.moneda,
    extra: extraCosto,
  });
  if (!cobertura.ok) return { ok: false, codigo: "precio_bajo_costo", error: cobertura.error, detalle: cobertura.detalle };

  const r = reglaDe(e.programa);
  return {
    ok: true,
    lineas,
    nino,
    totalPax,
    precioVenta: centavos / 100,
    precioBase: precioBaseCentavos / 100,
    costoNetoBase,
    estancia,
    costoNeto,
    costoAtribuible: cobertura.costoAtribuible,
    costoAsistencia: cobertura.costoAsistencia,
    diasAsistencia: dias,
    impuesto: {
      verificado: impuestoCentavos / 100,
      paxCubiertos,
      paxSinFuente,
      reglaActiva: r.activa,
      modo: r.activa ? r.modo : null,
    },
  };
}

/**
 * Total de una selección a partir de los PVP ya mostrados por la ficha. Es la
 * MISMA aritmética de `liquidarSeleccion` (suma en centavos), así el total que
 * ve el formulario y el que cobra el servidor no pueden diferir por redondeo.
 */
export function totalDesdePrecios(args: {
  adultos: { acomodacion: string; pvp: number | null }[];
  precioNino: number | null;
  habitaciones: Record<string, number>;
  ninos: number;
}): number {
  let centavos = 0;
  for (const a of args.adultos) {
    if (a.pvp == null) continue;
    const nHab = Number(args.habitaciones[a.acomodacion]) || 0;
    centavos += Math.round(a.pvp * 100) * nHab * paxDeAcomodacion(a.acomodacion);
  }
  if (args.precioNino != null) centavos += Math.round(args.precioNino * 100) * (Number(args.ninos) || 0);
  return centavos / 100;
}

// ── Base comisionable B2B ────────────────────────────────────────────────

/**
 * Valor para `ventas.impuesto`: solo en ventas B2B (agencia/freelance) y solo
 * si hay un importe fiscal verificable. Nunca se infiere de `montoNoComisionable`
 * ni de la reducción por % de la regla. `undefined` = no escribir la columna.
 */
export function impuestoParaVenta(liq: Extract<LiquidacionPrograma, { ok: true }>, tipoAsesor: string): number | undefined {
  if (tipoAsesor === "interno") return undefined;
  const v = Math.round(liq.impuesto.verificado * 100) / 100;
  if (!(v > 0) || v > liq.precioVenta) return undefined;
  return v;
}

/**
 * Residual a reportar (no corrige nada): hay regla de impuesto activa, pero hay
 * pasajeros sin fuente fiscal verificable; su base comisionable sigue siendo el
 * PVP completo. `null` si no aplica.
 */
export function avisoResidualBaseB2B(liq: Extract<LiquidacionPrograma, { ok: true }>, tipoAsesor: string): string | null {
  if (tipoAsesor === "interno") return null;
  if (!liq.impuesto.reglaActiva || liq.impuesto.modo !== "impuesto") return null;
  if (liq.impuesto.paxSinFuente <= 0) return null;
  return `Base comisionable B2B: ${liq.impuesto.paxSinFuente} pasajero(s) sin impuesto del proveedor verificable (niños o acomodaciones sin tarifa de proveedor) cuentan con su PVP completo. Revisa la comisión del aliado.`;
}

// ── Confirmación del precio ──────────────────────────────────────────────

export type CambioPrecioPrograma = {
  /** Importe que el usuario había confirmado; `null` si no envió ninguno válido. */
  anterior: number | null;
  /** Importe recalculado por el servidor. */
  nuevo: number;
  moneda: string;
};

/** Igualdad en la unidad menor de la moneda (centavos): sin ruido de coma flotante. */
export function precioCoincide(confirmado: unknown, calculado: number): boolean {
  const c = Number(confirmado);
  if (confirmado == null || !Number.isFinite(c) || !Number.isFinite(calculado)) return false;
  return Math.round(c * 100) === Math.round(calculado * 100);
}

export function evaluarPrecioConfirmado(
  confirmado: unknown,
  calculado: number,
  moneda: string,
): { ok: true } | { ok: false; error: string; cambioPrecio: CambioPrecioPrograma } {
  if (precioCoincide(confirmado, calculado)) return { ok: true };
  const c = Number(confirmado);
  const anterior = confirmado != null && Number.isFinite(c) && c >= 0 ? c : null;
  return {
    ok: false,
    error: anterior == null
      ? "Confirma el importe de la reserva antes de generarla."
      : "El precio de la reserva cambió. Revisa el nuevo importe y acéptalo para continuar; no se creó ningún contrato.",
    cambioPrecio: { anterior, nuevo: calculado, moneda },
  };
}

// ── #88 — Programas por hotel y vigencia ─────────────────────────────────

/**
 * La fila de la vigencia de entrada vista como una "salida" para la regla única:
 * sin `noches` propias (la asistencia usa los días del programa, regla de #57) y
 * sin tarifa de proveedor (esta modalidad no usa la regla 161: camino histórico).
 */
export function salidaPrecioDesdeBase(fila: Pick<BaseHotelFila, "bajoSolicitud" | "neto">): SalidaPrecio {
  return {
    noches: null,
    bajo_solicitud: fila.bajoSolicitud,
    neto_sencilla: fila.neto.sencilla,
    neto_doble: fila.neto.doble,
    neto_triple: fila.neto.triple,
    neto_multiple: fila.neto.multiple,
    neto_nino: fila.neto.nino,
  };
}

/**
 * Fila base que aplica: hotel + modalidad de servicios + fecha de ENTRADA al
 * hotel (la vigencia se decide por la entrada aunque las noches incluidas
 * terminen en otra). Ninguna o varias → error, nunca una cercana.
 */
export function resolverBaseHotel<T extends { desde: string; hasta: string; modalidad: ModalidadServicios }>(
  /** Filas YA filtradas al hotel elegido. */
  filasDelHotel: readonly T[],
  modalidad: ModalidadServicios,
  fechaEntrada: string,
  hotelNombre: string,
) {
  const delModo = filasDelHotel.filter((f) => f.modalidad === modalidad);
  return resolverVigencia(delModo, fechaEntrada, `precio base de ${hotelNombre} con ${modalidad === "privado" ? "servicios privados" : "servicios regulares"}`);
}

/** PVP de las tarifas de noche de un hotel con las opciones de PRECIO del programa (sin días: la noche es 1). */
export function tarifasNocheConPvp(programa: ProgramaPrecioCabecera, filas: readonly NocheTarifaFila[]): NocheTarifaPvp[] {
  const opt = opcionesPvp(programa, null);
  return filas.map((f) => nocheTarifaConPvp(f, opt));
}

export type FilaBasePvp = {
  id: number;
  desde: string;
  hasta: string;
  modalidad: ModalidadServicios;
  bajoSolicitud: boolean;
  pvp: PorAcom;
};

/** Lo que viaja al navegador (ficha y formulario): PVP y vigencias, JAMÁS un neto. */
export type TablaHotelPvp = {
  hotel: HotelEstancia;
  base: FilaBasePvp[];
  noches: NocheTarifaPvp[];
};

/** PVP por persona de la estancia incluida, por la regla única (`precioUnitarioSalida`). */
function pvpBase(programa: ProgramaPrecioCabecera, fila: BaseHotelFila): PorAcom {
  const salida = salidaPrecioDesdeBase(fila);
  const pvp: PorAcom = { sencilla: null, doble: null, triple: null, multiple: null, nino: null };
  for (const k of CLAVES_TARIFA) pvp[k] = precioUnitarioSalida(programa, salida, k)?.pvp ?? null;
  return pvp;
}

export function construirTablaHotelPvp(programa: ProgramaPrecioCabecera, hotel: HotelEstancia, base: readonly BaseHotelFila[], noches: readonly NocheTarifaFila[]): TablaHotelPvp {
  return {
    // El proveedor del hotel es interno (la CxP lo resuelve el servidor): no viaja al navegador.
    hotel: { ...hotel, proveedorId: null },
    base: base
      .filter((f) => f.hotelId === hotel.id)
      .map((f) => ({ id: f.id, desde: f.desde, hasta: f.hasta, modalidad: f.modalidad, bajoSolicitud: f.bajoSolicitud, pvp: pvpBase(programa, f) })),
    noches: tarifasNocheConPvp(programa, noches.filter((f) => f.hotelId === hotel.id)).map(sinNeto),
  };
}

/**
 * «Desde» de un programa por hotel y vigencia (#92): el menor PVP de la acomodación DOBLE entre
 * todos sus hoteles, vigencias y modalidades de servicios que no sean «a solicitud». Sin DOBLE
 * publicable → null («Consultar»): nunca se inventa un importe ni se usa otra acomodación.
 */
export function desdeDobleHoteles(tablas: readonly TablaHotelPvp[]): number | null {
  const v = tablas
    .flatMap((t) => t.base.filter((f) => !f.bajoSolicitud).map((f) => f.pvp.doble))
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
  return v.length ? Math.min(...v) : null;
}

export type SeleccionEstancia = {
  modalidad: ModalidadServicios;
  fechaEntrada: string;
  nochesAdicionales: number;
  habitaciones: Record<string, number>;
  ninos: number;
  infantes?: number;
};

export type CotizacionEstanciaPvp =
  | {
      ok: true;
      filaBase: FilaBasePvp;
      totalBase: number;
      totalNoches: number;
      total: number;
      noches: Noche88[];
    }
  | { ok: false; error: string };

/**
 * Total que ve el navegador, SOLO con PVP: la misma aritmética en centavos que
 * `liquidarSeleccion` (base con `totalDesdePrecios` y noches con la misma
 * `liquidarNochesAdicionales`), así lo mostrado y lo cobrado no pueden diferir.
 */
export function cotizarEstanciaDesdePvp(tabla: TablaHotelPvp, nochesIncluidas: number, sel: SeleccionEstancia): CotizacionEstanciaPvp {
  const hotel = tabla.hotel;
  const nNinos = Math.max(0, Math.trunc(Number(sel.ninos) || 0));
  const ocupacion = validarOcupacionHotel(hotel, sel.habitaciones, nNinos, Math.max(0, Math.trunc(Number(sel.infantes) || 0)));
  if (ocupacion) return { ok: false, error: ocupacion };

  const base = resolverBaseHotel(tabla.base, sel.modalidad, sel.fechaEntrada, hotel.nombre);
  if (!base.ok) return { ok: false, error: base.error };
  const fila = base.fila;
  if (fila.bajoSolicitud) return { ok: false, error: "Este precio es «a solicitud»: consúltalo con el proveedor." };

  const habs = Object.entries(sel.habitaciones).filter(([, n]) => (Number(n) || 0) > 0);
  const adultos: { acomodacion: string; pvp: number | null }[] = [];
  for (const [acom] of habs) {
    const pvp = (CLAVES_TARIFA as readonly string[]).includes(acom) && acom !== "nino" ? fila.pvp[acom as keyof PorAcom] : null;
    if (pvp == null) return { ok: false, error: `La acomodación ${acom} no tiene precio (o es "a solicitud") en esta categoría.` };
    adultos.push({ acomodacion: acom, pvp });
  }
  if (nNinos > 0 && fila.pvp.nino == null) return { ok: false, error: `Esta categoría no tiene precio de niño (o es "a solicitud").` };

  const totalBase = totalDesdePrecios({ adultos, precioNino: fila.pvp.nino, habitaciones: sel.habitaciones, ninos: nNinos });
  const n = liquidarNochesAdicionales({
    tarifas: tabla.noches,
    hotelNombre: hotel.nombre,
    fechaEntrada: sel.fechaEntrada,
    nochesIncluidas,
    nochesAdicionales: sel.nochesAdicionales,
    habitaciones: sel.habitaciones,
    ninos: nNinos,
    asistenciaDia: 0,
  });
  if (!n.ok) return { ok: false, error: n.error };
  const totalNoches = n.pvpCentavos / 100;
  return { ok: true, filaBase: fila, totalBase, totalNoches, total: (Math.round(totalBase * 100) + n.pvpCentavos) / 100, noches: n.noches };
}
