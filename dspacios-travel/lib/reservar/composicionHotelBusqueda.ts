// ─────────────────────────────────────────────────────────────────────────
// #102 — Evalúa UNA composición de viajeros contra los combos (categoría ×
// alimentación) de UN hotel ya liquidado para una estadía. Es el cuerpo que antes
// vivía dentro del bucle de `buscarHoteles` (lib/reservar/cotizar.ts), extraído
// SIN I/O para que lo usen, con el mismo resultado, la búsqueda general de Vista
// Booking, la Vista tabla y el cálculo de la «noche adicional» (la misma
// composición evaluada con una noche más sobre los mismos datos ya cargados).
//
// Dos modos de ocupación:
//   · `numHabitaciones` (búsqueda general): el reparto lo decide cada hotel con
//     `asignarHabitacionesHotel`; los menores por encima del umbral de niño de ESE
//     hotel/combo pagan tarifa de adulto (se conserva su edad real).
//   · `habitacionesExplicitas` (revalidación del carrito y llamadores heredados):
//     tipos de habitación dados; una edad por encima del umbral se rechaza como
//     siempre — el carrito solo guarda como «menores» a quienes pagan como menor.
// ─────────────────────────────────────────────────────────────────────────

import { ACOM_ROOMS, defaultAcomConfig, type AcomConfig, type AcomRoom } from "../acomodaciones.ts";
import { REGLA_SIN_MENORES, resolverReglaEdadEstadiaSegura, type FilaTarifaHotelEdadCruda, type ReglaEdadGeneralParcial, type ReglaEdadTarifa } from "../calc/reglaEdadTarifa.ts";
import { distribuirPorHabitaciones, type AsignacionHabitacion, type HabitacionConsultada } from "./distribucionHabitaciones.ts";
import { verificarTarifasMenoresDisponibles, type ClasificacionMenores } from "./edadesMenores.ts";
import type { ResultadoHotelFechas } from "./liquidacionHotel.ts";
import { contarMenoresDeDos, esMenorDeDos, tarifarMenores } from "./menoresDeDos.ts";
import { calcularBeneficioNinoGratis, type NinoGratisConcedido } from "../hoteles/ninoGratis.ts";
import { aplicarNinoGratisADesglose, sumaDesglose } from "./ninoGratisDesglose.ts";
import { ventaNinoCondonada } from "./ninoGratisPrecio.ts";
import { descuentoMostrado, type DescuentoMostrado } from "../calc/precedenciaPromociones.ts";
import { cargoGrupoIncluido } from "./serviciosPaquete.ts";
import {
  asignarHabitacionesHotel, clasificarMenoresDeHotel, construirDesglose, edadesPorClase, resumenHabitaciones,
  type LineaDesglose, type OpcionHabitacion,
} from "./asignacionHabitacionesBusqueda.ts";

export type ComboEvaluado = {
  total: number; categoria: string; regimen: string; pax: number; menores: ClasificacionMenores;
  /** Habitaciones evaluadas por tipo (las pedidas, o las que el reparto del hotel eligió). */
  habitaciones: Record<string, number>;
  /** Etiqueta EBB / Long Stay de ESTE combo (la precedencia con una promoción puede decidir otra distinta de la de la estadía; viene de main #436/#438). */
  descuento?: DescuentoMostrado | null;
  /** Solo quienes pagan tarifa de menor (infante/niño). */
  edadesMenores: number[];
  /** Edades reales de menores que ESTE hotel cobra como adulto (no se reescribe al pasajero). */
  edadesComoAdulto: number[];
  asignacion: AsignacionHabitacion[];
  resumenHabitaciones: string;
  desglose: LineaDesglose[];
  /** #125: «un niño gratis por habitación» (solo el alojamiento promocionado; `total` ≤ 0 ya está restado de `total`). Ausente sin beneficio. */
  beneficioNinoGratis?: { total: number; descripcion: string };
};

export type EntradaComposicion = {
  res: Pick<ResultadoHotelFechas, "combos" | "serviciosGrupoIncluidos" | "descuentoHotel" | "composicionBase"> & Partial<Pick<ResultadoHotelFechas, "moneda">>;
  /** Solo se pregunta si la composición CABE (sugerencias de fechas): no se calcula precio, así que tampoco el «niño gratis» (#125). */
  soloFactibilidad?: boolean;
  filasTarifa: readonly FilaTarifaHotelEdadCruda[];
  pctMk: number;
  numNoches: number;
  adultos: number;
  edades: readonly number[];
  reglasAcom: readonly AcomConfig[];
  generalEdad: ReglaEdadGeneralParcial;
  numHabitaciones?: number;
  habitacionesExplicitas?: readonly { acom: AcomRoom }[];
};

export type ResultadoComposicion = {
  combos: ComboEvaluado[];
  rechazos: string[];
  /** Algún combo no pudo evaluarse porque su regla de edad es ambigua o incompleta (revisión del catálogo). */
  falloReglaEdad: boolean;
  /** O3: la CONFIGURACIÓN DE EDADES DEL HOTEL (obligatoria si acepta menores) falta o es inválida y la consulta trae menores: no se inventa, se informa el motivo accionable. */
  edadesHotelIncompletas?: { error: string; faltantes: string[]; invalidos: string[] };
};

const claveRegla = (r: ReglaEdadTarifa) => `${r.infanteMin}|${r.infanteMax}|${r.ninoMin}|${r.ninoMax}`;

export function evaluarComposicionHotel(e: EntradaComposicion): ResultadoComposicion {
  const out: ResultadoComposicion = { combos: [], rechazos: [], falloReglaEdad: false };
  const configDe = (a: AcomRoom): AcomConfig => e.reglasAcom.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);
  const modoExplicito = !!e.habitacionesExplicitas?.length;
  const permitirComoAdulto = !modoExplicito;

  for (const combo of e.res.combos) {
    const temporadasDe = (acoms: readonly AcomRoom[]) => {
      const t = new Set<string>();
      for (const a of acoms) for (const x of combo.temporadasTarifaPorAcom?.[a] ?? []) t.add(x);
      return t;
    };
    // O3: sin menores la regla de edad es irrelevante (no clasifica a nadie): una consulta de solo adultos NO depende de que el hotel tenga las edades configuradas.
    const hayMenores = e.edades.length > 0;
    const reglaDe = (acoms: readonly AcomRoom[]) => hayMenores
      ? resolverReglaEdadEstadiaSegura({
        filas: e.filasTarifa as FilaTarifaHotelEdadCruda[], categoria: combo.categoria, regimen: combo.regimen,
        temporadasUsadas: temporadasDe(acoms), general: e.generalEdad,
      })
      : { ok: true as const, regla: REGLA_SIN_MENORES };
    const registrarFalloRegla = (r: Extract<ReturnType<typeof reglaDe>, { ok: false }>) => {
      if (r.codigo === "edades_hotel_incompletas") out.edadesHotelIncompletas ??= { error: r.error, faltantes: r.faltantes ?? [], invalidos: r.invalidos ?? [] };
      else out.falloReglaEdad = true;
    };

    // Cada «candidato» es una regla de edad + los tipos de habitación a los que aplica.
    type Candidato = { regla: ReglaEdadTarifa; acoms: AcomRoom[] };
    const candidatos: Candidato[] = [];
    if (modoExplicito) {
      const acoms = [...new Set(e.habitacionesExplicitas!.map((h) => h.acom))];
      const r = reglaDe(acoms);
      if (!r.ok) { registrarFalloRegla(r); continue; }
      candidatos.push({ regla: r.regla, acoms });
    } else {
      const porRegla = new Map<string, Candidato>();
      for (const a of ACOM_ROOMS) {
        if (combo.precios[a] == null) continue;
        // La regla de edad se resuelve por tipo de habitación: una temporada con otra regla solo afecta a ese tipo.
        const r = reglaDe([a]);
        if (!r.ok) { registrarFalloRegla(r); continue; }
        const k = claveRegla(r.regla);
        const c = porRegla.get(k) ?? { regla: r.regla, acoms: [] };
        c.acoms.push(a);
        porRegla.set(k, c);
      }
      candidatos.push(...porRegla.values());
    }
    if (!candidatos.length) continue;

    let mejor: ComboEvaluado | null = null;
    let motivoPrimero: string | null = null;
    for (const cand of candidatos) {
      const cl = clasificarMenoresDeHotel(e.edades, cand.regla.infanteMax, cand.regla.ninoMax, permitirComoAdulto);
      if (!cl.ok) { motivoPrimero ??= cl.error; continue; }
      const adultosTarifa = e.adultos + cl.comoAdulto.length;

      let habitaciones: AsignacionHabitacion[];
      let porAcom: Partial<Record<AcomRoom, number>>;
      let totales: { infantes: number; nino: number; nino2: number };
      if (modoExplicito) {
        const consultadas: HabitacionConsultada[] = e.habitacionesExplicitas!.map((h) => ({ acom: h.acom, config: configDe(h.acom) }));
        const d = distribuirPorHabitaciones({ adultosDeclarados: adultosTarifa, ninos: cl.ninos.length, infantes: cl.infantes.length, habitaciones: consultadas });
        if (!d.ok) { motivoPrimero ??= d.error; continue; }
        habitaciones = d.habitaciones; totales = d.totales;
        porAcom = {};
        for (const h of e.habitacionesExplicitas!) porAcom[h.acom] = (porAcom[h.acom] ?? 0) + 1;
      } else {
        const opciones: OpcionHabitacion[] = cand.acoms.map((a) => ({ acom: a, config: configDe(a) }));
        const a = asignarHabitacionesHotel({
          numHabitaciones: e.numHabitaciones!, adultosTarifa, ninos: cl.ninos.length, infantes: cl.infantes.length, opciones,
        });
        if (!a.ok) { motivoPrimero ??= a.error; continue; }
        habitaciones = a.habitaciones; totales = a.totales; porAcom = a.porAcom;
      }
      const menores: ClasificacionMenores = { infantes: totales.infantes, nino: totales.nino, nino2: totales.nino2 };
      if (verificarTarifasMenoresDisponibles(menores, { nino: combo.precios["nino"] != null, nino2: combo.precios["nino2"] != null })) continue;

      let total = 0; let pax = 0; let completo = true;
      for (const a of ACOM_ROOMS) {
        const rooms = porAcom[a] ?? 0;
        if (rooms <= 0) continue;
        const pvp = combo.precios[a];
        if (pvp == null) { completo = false; break; }
        const adultos = rooms * configDe(a).pax_tarifa;
        total += adultos * pvp; pax += adultos;
      }
      if (!completo) continue;
      const tm = tarifarMenores({
        totales: { infante: menores.infantes, nino: menores.nino, nino2: menores.nino2 },
        menoresDeDos: contarMenoresDeDos(cl.menores, cand.regla.infanteMax, { infante: menores.infantes, nino: menores.nino, nino2: menores.nino2 }),
        pvp: combo.precios, pvpMenor2: combo.preciosMenor2 ?? {},
      });
      if (!tm.ok) continue;
      total += tm.total; pax += tm.paxConSilla;
      let cargoGrupo = 0;
      if (e.res.serviciosGrupoIncluidos.length) {
        const cargo = cargoGrupoIncluido(e.res.serviciosGrupoIncluidos, pax, e.pctMk, e.numNoches);
        if (!cargo.ok) continue;
        cargoGrupo = cargo.pvp;
        total += cargo.pvp;
      }
      // #125: «un niño gratis por habitación» — SOLO el alojamiento del hotel (neto de las noches que ganó la promoción con el markup del paquete), nunca el PVP del niño
      // (que en un paquete trae vuelo/servicios). Habitación por habitación con el reparto real; los niños son los que pagan tarifa de niño en ESTE hotel.
      let beneficioNG: { total: number; descripcion: string } | undefined;
      let ninosGratis: readonly NinoGratisConcedido[] = [];
      if (!e.soloFactibilidad && combo.ninoGratisNoches && menores.nino + menores.nino2 > 0) {
        // Lo condonado sale del MISMO compositor del precio (PVP del niño − PVP sin su alojamiento pagadero): el redondeo se rehace y vuelo/servicios se conservan.
        let faltaDesglose = false;
        const b = calcularBeneficioNinoGratis({
          habitaciones: habitaciones.map((d) => ({ indice: d.indice, adultos: d.adultos, nino: d.nino, nino2: d.nino2, infantes: d.infantes })),
          edades: cl.ninos,
          nochesNino: combo.ninoGratisNoches.nino, nochesNino2: combo.ninoGratisNoches.nino2, pctMk: e.pctMk,
          ventaCondonada: (clase, neto) => {
            const base = e.res.composicionBase;
            if (!base || !e.res.moneda || combo.precios[clase] == null || combo.netos?.[clase] == null) { faltaDesglose = true; return 0; }
            return ventaNinoCondonada({ pvpCobrado: combo.precios[clase], netoPagadero: combo.netos[clase], netoCondonado: neto, base, moneda: e.res.moneda });
          },
        });
        // Sin omisiones silenciosas: lo que no se puede resolver se explica y este combo no se ofrece como si el niño gratis no existiera.
        if (b?.bloqueo) { motivoPrimero ??= b.bloqueo; continue; }
        if (faltaDesglose) { motivoPrimero ??= "Este hotel tiene una promoción con un niño gratis por habitación, pero no se pudo aislar el precio de su alojamiento para aplicarla."; continue; }
        if (b?.ninos.some((n) => n.edad != null && esMenorDeDos(n.edad))) { motivoPrimero ??= "El niño gratis de la promoción corresponde a un menor de 2 años con tarifa de Niño; ese caso todavía no se calcula."; continue; }
        if (b && b.total !== 0) { total += b.total; beneficioNG = { total: b.total, descripcion: b.descripcion }; ninosGratis = b.ninos; }
      }
      // I1: las líneas por pasajero muestran lo que SE PAGA (el niño gratis sale de su línea con su explicación) y deben sumar EXACTAMENTE el total; si no cuadra no se ofrece el combo.
      let desglose = construirDesglose({
        porAcom, paxTarifaDe: (a) => configDe(a).pax_tarifa, pvp: combo.precios, lineasMenores: tm.lineas,
        edades: edadesPorClase(habitaciones, cl.infantes, cl.ninos), cargoGrupo,
      });
      if (ninosGratis.length) {
        const ap = aplicarNinoGratisADesglose(desglose, ninosGratis);
        if (!ap.ok) { motivoPrimero ??= ap.motivo; continue; }
        desglose = ap.desglose;
        if (Math.abs(sumaDesglose(desglose) - total) > 0.015) { motivoPrimero ??= "El desglose por pasajero con el niño gratis no cuadra con el total de la reserva; no se ofrece este combo."; continue; }
      }
      const cand2: ComboEvaluado = {
        total, categoria: combo.categoria, regimen: combo.regimen, pax, menores,
        descuento: descuentoMostrado(e.res.descuentoHotel, combo.descuentoPorAcom, [
          ...Object.entries(porAcom).filter(([, n]) => (n ?? 0) > 0).map(([a]) => a),
          ...(menores.nino ? ["nino"] : []), ...(menores.nino2 ? ["nino2"] : []), ...(menores.infantes ? ["infante"] : []),
        ]),
        habitaciones: Object.fromEntries(Object.entries(porAcom).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>,
        ...(beneficioNG ? { beneficioNinoGratis: beneficioNG } : {}),
        edadesMenores: cl.menores, edadesComoAdulto: cl.comoAdulto, asignacion: habitaciones,
        resumenHabitaciones: resumenHabitaciones(porAcom),
        desglose,
      };
      // Entre reglas de edad distintas del mismo combo gana el total más bajo (mismo criterio «más barato primero»).
      if (!mejor || cand2.total < mejor.total) mejor = cand2;
    }
    if (mejor) out.combos.push(mejor);
    else if (motivoPrimero) out.rechazos.push(motivoPrimero);
  }
  return out;
}


