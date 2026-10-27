// PR #409 — Vista previa de SOLO LECTURA de un programa por hotel y vigencia.
//
// Módulo PURO (sin Supabase ni UI). Recibe el catálogo (guardado o borrador) y una selección, y devuelve el cálculo con
// sus pasos usando EXACTAMENTE el motor de la reserva (`liquidarSeleccion`) y la fórmula compartida
// (`pvpProgramaDesglose`): la vista previa y el contrato no pueden diferir porque son la misma cuenta.
// Calcular no crea cotización, contrato, CxP ni publicación: aquí no hay escritura posible.
//
// Los netos del proveedor (y los pasos que parten de ellos) solo salen con `verNetos`; sin él, la salida lleva únicamente PVP.
import { pvpProgramaDesglose, type DesglosePvp } from "../calc/programaPrecio.ts";
import {
  desgloseNocheUnidad,
  fechaLegible,
  itinerarioConNochesExtra,
  validarOcupacionHotel,
  type BaseHotelFila,
  type ClaveTarifa,
  type DiaConFecha,
  type DiaItinerario,
  type HotelEstancia,
  type ModalidadServicios,
  type NocheTarifaFila,
  type UnidadCobro,
} from "./estanciaHotel88.ts";
import {
  diasAsistencia,
  liquidarSeleccion,
  opcionesPvp,
  resolverBaseHotel,
  salidaPrecioDesdeBase,
  tarifasNocheConPvp,
  type ProgramaPrecioCabecera,
  type SeleccionEstancia,
} from "./precioReserva57.ts";

export type EntradaVistaPrevia = {
  programa: ProgramaPrecioCabecera;
  /** Noches de la estancia incluida (días − 1). */
  nochesIncluidas: number;
  hotel: HotelEstancia;
  base: readonly BaseHotelFila[];
  noches: readonly NocheTarifaFila[];
  seleccion: SeleccionEstancia;
  itinerario?: readonly DiaItinerario[];
  /** Quien puede ver netos del proveedor (personal autorizado). Sin esto la salida no lleva ningún neto. */
  verNetos: boolean;
};

export type LineaPrevia = {
  acomodacion: string;
  /** Habitaciones (base) o unidades cobradas (noche). */
  cantidad: number;
  unidad: UnidadCobro | "persona_base";
  pvpUnit: number;
  incluidoEnHabitacion?: boolean;
  /** Pasos de la fórmula (solo con `verNetos`). */
  desglose?: DesglosePvp;
};

export type NochePrevia = {
  fecha: string;
  vigenciaDesde: string;
  vigenciaHasta: string;
  unidad: UnidadCobro;
  lineas: LineaPrevia[];
  /** PVP de la noche, ya redondeado por separado (se suma después). */
  pvp: number;
};

export type VistaPrevia =
  | {
      ok: true;
      moneda: string;
      vigenciaBase: { desde: string; hasta: string; modalidad: ModalidadServicios };
      parametros: { mk: number; fee: number; asistenciaDia: number; redondeo: string };
      base: { lineas: LineaPrevia[]; ninos: LineaPrevia | null; pax: number; total: number };
      noches: NochePrevia[];
      totalNoches: number;
      total: number;
      asistencia: { total: number; dias: number | null; pax: number };
      itinerario: { dias: DiaConFecha[]; recogida: string | null } | null;
      /** Solo con `verNetos`. */
      netos?: { costoNeto: number; costoNetoNoches: number; costoAsistencia: number };
    }
  | { ok: false; causa: string };

const PCT = (x: number) => Math.round((Number(x) || 0) * 10000) / 100;

export function calcularVistaPrevia(e: EntradaVistaPrevia): VistaPrevia {
  const { programa, hotel, seleccion: sel } = e;
  const nNinos = Math.max(0, Math.trunc(Number(sel.ninos) || 0));
  const nInfantes = Math.max(0, Math.trunc(Number(sel.infantes) || 0));
  const ocupacion = validarOcupacionHotel(hotel, sel.habitaciones, nNinos, nInfantes);
  if (ocupacion) return { ok: false, causa: ocupacion };

  const baseHotel = e.base.filter((b) => b.hotelId === hotel.id);
  const vig = resolverBaseHotel(baseHotel, sel.modalidad, sel.fechaEntrada, hotel.nombre);
  if (!vig.ok) return { ok: false, causa: vig.error };
  if (vig.fila.bajoSolicitud) return { ok: false, causa: "Este precio es «a solicitud»: consúltalo con el proveedor." };

  const liq = liquidarSeleccion({
    programa,
    fuente: { modo: "salida", salida: salidaPrecioDesdeBase(vig.fila) },
    habitaciones: sel.habitaciones,
    ninos: nNinos,
    infantes: nInfantes,
    estancia: {
      hotel,
      tarifasNoche: tarifasNocheConPvp(programa, e.noches.filter((n) => n.hotelId === hotel.id)),
      fechaEntrada: sel.fechaEntrada,
      nochesIncluidas: e.nochesIncluidas,
      nochesAdicionales: sel.nochesAdicionales,
    },
  });
  if (!liq.ok) return { ok: false, causa: liq.error };

  const optBase = opcionesPvp(programa, diasAsistencia(programa, null));
  const conPasos = (neto: number | null | undefined, hacer: (n: number) => DesglosePvp) => (e.verNetos && neto != null ? hacer(neto) : undefined);

  const lineasBase: LineaPrevia[] = liq.lineas.map((l) => ({
    acomodacion: l.acomodacion,
    cantidad: l.habitaciones,
    unidad: "persona_base",
    pvpUnit: l.pvpUnit,
    desglose: conPasos(l.netoUnit, (n) => pvpProgramaDesglose(n, optBase)),
  }));
  const ninos: LineaPrevia | null = liq.nino
    ? { acomodacion: "nino", cantidad: liq.nino.cantidad, unidad: "persona_base", pvpUnit: liq.nino.pvpUnit, desglose: conPasos(liq.nino.netoUnit, (n) => pvpProgramaDesglose(n, optBase)) }
    : null;

  const optNoche = opcionesPvp(programa, 1);
  const noches: NochePrevia[] = (liq.estancia?.noches ?? []).map((n) => ({
    fecha: n.fecha,
    vigenciaDesde: n.vigenciaDesde,
    vigenciaHasta: n.vigenciaHasta,
    unidad: n.unidad,
    pvp: n.pvpCentavos / 100,
    lineas: n.lineas.map((l) => ({
      acomodacion: l.acomodacion,
      cantidad: l.cantidad,
      unidad: l.unidad,
      pvpUnit: l.pvpUnit,
      ...(l.incluidoEnHabitacion ? { incluidoEnHabitacion: true } : {}),
      desglose: conPasos(l.netoUnit, (neto) => desgloseNocheUnidad(neto, n.unidad, l.acomodacion as ClaveTarifa, optNoche)),
    })),
  }));

  const itinerario = e.itinerario?.length
    ? (() => {
        const dias = itinerarioConNochesExtra(e.itinerario, sel.nochesAdicionales, sel.fechaEntrada, hotel.nombre, programa.dias);
        return dias ? { dias, recogida: dias[dias.length - 1]?.fecha ?? null } : null;
      })()
    : null;

  return {
    ok: true,
    moneda: programa.moneda,
    vigenciaBase: { desde: vig.fila.desde, hasta: vig.fila.hasta, modalidad: vig.fila.modalidad },
    parametros: {
      mk: PCT(programa.pct_mk),
      fee: PCT(programa.pct_fee_tarjeta),
      asistenciaDia: Number(programa.asistencia_medica_dia) || 0,
      redondeo: String(programa.moneda).toUpperCase() === "USD" ? "hacia arriba al dólar entero" : "hacia arriba al millar",
    },
    base: { lineas: lineasBase, ninos, pax: liq.totalPax, total: liq.precioBase },
    noches,
    totalNoches: liq.estancia?.precioNoches ?? 0,
    total: liq.precioVenta,
    asistencia: { total: liq.costoAsistencia, dias: liq.diasAsistencia, pax: liq.totalPax - nInfantes },
    itinerario,
    ...(e.verNetos ? { netos: { costoNeto: liq.costoNeto, costoNetoNoches: liq.estancia?.costoNetoNoches ?? 0, costoAsistencia: liq.costoAsistencia } } : {}),
  };
}

/** Texto corto de una vigencia, para etiquetas. */
export const etiquetaVigencia = (v: { desde: string; hasta: string }) => `${fechaLegible(v.desde)}–${fechaLegible(v.hasta)}`;
