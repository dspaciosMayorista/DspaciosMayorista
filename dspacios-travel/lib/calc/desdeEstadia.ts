// #43/#60 entrega 6 (§5 «Desde» de porción; historial U): el «Desde» de una porción terrestre de un hotel CON GRUPOS es la estadía
// completa más económica realmente vendible con la salida dentro de la ventana — nunca «noche más barata × noches». Cada candidata se
// valora con el MISMO motor de una estadía real (`liquidarHotelNochesConTemporadas`: cobertura por día, disponibilidad, blackouts, compra
// vigente, régimen restringido, noches mínimas y promociones); sin EBB / Long Stay (P7: se aplican al cotizar). Empate: la entrada más
// temprana. Sin candidata vendible, o si se excede un límite: SIN «desde» (falla cerrado, nunca aproximado) y con su medición.
// Módulo aparte (función pura): los hoteles sin grupos siguen por `liquidarHotelMasBaratoConTemporada` sin coste adicional.
import { liquidarHotelNochesConTemporadas, minNochesAplicable, hoyISO, type ArgsLiquidar, type ProcedenciaNoche } from "./paquetes.ts";
import { MAX_NOCHES_VIAJE } from "../reglas/duracionViaje.ts";

/** Límites del cálculo (§9 / U.5). Candidatas = días de entrada posibles en la ventana; el presupuesto es por combinación. */
export const LIMITES_DESDE = { maxCandidatas: 400, presupuestoMs: 250 } as const;

export type JustificacionDesde = { entrada: string; salida: string; noches: number };
export type MedicionDesde = {
  candidatas: number; evaluadas: number; vendibles: number; ms: number;
  resultado: "precio" | "sin_estadia" | "excede_ventana" | "excede_presupuesto" | "noches_invalidas";
};
export type ResultadoDesde = {
  desde: { total: number; procedencia: ProcedenciaNoche[]; justificacion: JustificacionDesde } | null;
  medicion: MedicionDesde;
};

const MS_DIA = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

/**
 * `desde`/`hasta`: la ventana de viaje del paquete (la salida debe quedar dentro: entrada + noches ≤ hasta). Entradas anteriores a hoy no se
 * venden. `reloj` solo para las pruebas del presupuesto.
 */
export function desdeEstadiaReal(
  args: Omit<ArgsLiquidar, "fechaIda"> & { desde: string; hasta: string },
  opciones: { limites?: { maxCandidatas: number; presupuestoMs: number }; reloj?: () => number } = {},
): ResultadoDesde {
  const lim = opciones.limites ?? LIMITES_DESDE;
  const reloj = opciones.reloj ?? (() => performance.now());
  const t0 = reloj();
  const medir = (m: Omit<MedicionDesde, "ms">): MedicionDesde => ({ ...m, ms: Math.round((reloj() - t0) * 100) / 100 });
  const n = args.numNoches;
  if (!Number.isInteger(n) || n < 1 || n > MAX_NOCHES_VIAJE) {
    return { desde: null, medicion: medir({ candidatas: 0, evaluadas: 0, vendibles: 0, resultado: "noches_invalidas" }) };
  }
  const hoy = args.hoy ?? hoyISO();
  const inicio = Math.max(utc(args.desde), utc(hoy));
  const ultimaEntrada = utc(args.hasta) - n * MS_DIA;
  const candidatas = Number.isFinite(inicio) && Number.isFinite(ultimaEntrada) && ultimaEntrada >= inicio ? Math.round((ultimaEntrada - inicio) / MS_DIA) + 1 : 0;
  if (candidatas > lim.maxCandidatas) return { desde: null, medicion: medir({ candidatas, evaluadas: 0, vendibles: 0, resultado: "excede_ventana" }) };

  let mejor: ResultadoDesde["desde"] = null;
  let evaluadas = 0, vendibles = 0;
  for (let e = inicio; e <= ultimaEntrada; e += MS_DIA) {
    if (reloj() - t0 > lim.presupuestoMs) return { desde: null, medicion: medir({ candidatas, evaluadas, vendibles, resultado: "excede_presupuesto" }) };
    evaluadas++;
    const { desde: _d, hasta: _h, ...resto } = args;
    void _d; void _h;
    // Noches mínimas: la cotización real rechaza la estadía si es más corta que el mínimo vigente en su entrada (misma regla).
    if (n < minNochesAplicable(args.temporadas, iso(e), hoy)) continue;
    const r = liquidarHotelNochesConTemporadas({ ...resto, fechaIda: iso(e), hoy });
    if (r == null) continue;
    vendibles++;
    // Estricto: ante un empate se conserva la entrada anterior (la más temprana).
    if (mejor == null || r.total < mejor.total) {
      mejor = { total: r.total, procedencia: r.procedencia, justificacion: { entrada: iso(e), salida: iso(e + n * MS_DIA), noches: n } };
    }
  }
  return { desde: mejor, medicion: medir({ candidatas, evaluadas, vendibles, resultado: mejor ? "precio" : "sin_estadia" }) };
}

/** ¿El hotel vende por grupos de días? (misma condición que el motor: grupos de las vigencias «tarifa»). Solo esos usan el «desde» real. */
export const hotelConGrupos = (temporadas: readonly { tipo?: string | null; grupos?: readonly unknown[] | null }[]): boolean =>
  temporadas.some((t) => (t.tipo ?? "tarifa") === "tarifa" && (t.grupos?.length ?? 0) > 0);

/**
 * Presupuesto de UNA generación (todas las combinaciones de todos los hoteles del paquete): el límite por combinación no acota el total.
 * Topes: candidatas evaluadas y milisegundos acumulados. Agotado ⇒ las combinaciones restantes quedan SIN «desde» (falla cerrado) y se cuentan.
 */
// Medido en local (2026-11-12): ≈ 19 µs por candidata ⇒ 72 combinaciones × ventana de 90 días ≈ 6.200 evaluaciones en ≈ 120 ms. El tope de
// evaluaciones (≈ 3 s medidos) es una red; manda el de tiempo, que deja margen dentro de la función de generación.
export const LIMITES_DESDE_GENERACION = { maxEvaluadas: 200_000, maxMs: 4_000 } as const;
export type ResumenDesdeGeneracion = {
  combinaciones: number; conPrecio: number; sinEstadia: number; excedidas: number; candidatas: number; evaluadas: number; ms: number;
};
export function crearPresupuestoDesde(limites: { maxEvaluadas: number; maxMs: number } = LIMITES_DESDE_GENERACION, reloj?: () => number) {
  const r: ResumenDesdeGeneracion = { combinaciones: 0, conPrecio: 0, sinEstadia: 0, excedidas: 0, candidatas: 0, evaluadas: 0, ms: 0 };
  return {
    calcular(args: Parameters<typeof desdeEstadiaReal>[0]): ResultadoDesde {
      r.combinaciones++;
      const restantes = { maxCandidatas: Math.min(LIMITES_DESDE.maxCandidatas, limites.maxEvaluadas - r.evaluadas), presupuestoMs: Math.min(LIMITES_DESDE.presupuestoMs, limites.maxMs - r.ms) };
      const res: ResultadoDesde = restantes.maxCandidatas <= 0 || restantes.presupuestoMs <= 0
        ? { desde: null, medicion: { candidatas: 0, evaluadas: 0, vendibles: 0, ms: 0, resultado: "excede_presupuesto" } }
        : desdeEstadiaReal(args, { limites: restantes, ...(reloj ? { reloj } : {}) });
      const m = res.medicion;
      r.candidatas += m.candidatas; r.evaluadas += m.evaluadas; r.ms = Math.round((r.ms + m.ms) * 100) / 100;
      if (m.resultado === "precio") r.conPrecio++;
      else if (m.resultado === "sin_estadia") r.sinEstadia++;
      else r.excedidas++;
      return res;
    },
    resumen: (): ResumenDesdeGeneracion => ({ ...r }),
  };
}
