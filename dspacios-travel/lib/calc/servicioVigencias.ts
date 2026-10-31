// ─────────────────────────────────────────────────────────────────────────
// Vigencias de un servicio vistas desde la PUBLICACIÓN y las rutas que cotizan por fecha — módulo PURO, sin «GENERAL».
//
// Regla única (la misma de la venta y el costo, ver `servicioTarifa.ts`): un servicio se vende con una vigencia que cubra la fecha del viaje y, por grupo,
// con un rango de pasajeros de ESA vigencia. Aquí viven las dos preguntas que se hacen ANTES de vender:
//   · `cubrirVentana`: ¿cada día de la ventana del paquete cae en alguna vigencia? (la compra se ignora: es una puerta comercial que abre y cierra).
//   · `referenciaPublicacion`: el precio NETO que se publica ("desde") y contra el que otras rutas escalan: el MÍNIMO entre las vigencias aplicables. Si las
//     vigencias aplicables tienen rangos de pasajeros distintos (modo grupo) o falta un dato, devuelve un error legible: NO se publica un precio que luego
//     no se pueda cotizar.
// Los mensajes están pensados para quien monta el paquete (nombre del servicio y fecha concreta).
// ─────────────────────────────────────────────────────────────────────────
import { temporadaVigenteParaFecha, toTemporadaRango } from "./paquetes.ts";
import { rangosIdaRegresoEfectivos } from "./servicioAlcance.ts";
import type { GrupoServicioFila, TemporadaServicioFila } from "./servicioTarifa.ts";

export type VigenciaServicioFila = TemporadaServicioFila & { precio_infante?: number | null };
export type VigenciasServicio = {
  servicioId: number;
  nombre: string;
  temporadas: VigenciaServicioFila[];
  grupos: GrupoServicioFila[];
  /** Nombres de las vigencias que tienen al menos una franja horaria de traslado. */
  conFranjas: ReadonlySet<string>;
  /**
   * 262: el servicio está clasificado como traslado y se vende por ALCANCE. Su referencia de PUBLICACIÓN ("desde") sale de lo que se puede OFRECER en cada vigencia: el precio
   * propio de «un trayecto» (`gruposAlcance` por rango, `personaAlcance` por persona) y el de «ida y regreso», que es el propio (`gruposIdaRegreso`, `personaIdaRegreso`) o, si la
   * vigencia no define uno, su tarifa de siempre (`precio_persona` / `grupos`). Un trayecto NO es requisito para ofrecer el servicio. Ausente = comportamiento anterior. El precio
   * que se COBRA se resuelve siempre en vivo por el alcance elegido (liquidacionServicio); esto solo decide si el servicio se puede ofrecer.
   */
  usaAlcance?: boolean;
  gruposAlcance?: GrupoServicioFila[];
  personaAlcance?: ReadonlyMap<string, number>;
  gruposIdaRegreso?: GrupoServicioFila[];
  personaIdaRegreso?: ReadonlyMap<string, number>;
};

const MS_DIA = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const fechaLegible = (f: string) => f.split("-").reverse().join("/");
const sinCompra = (t: VigenciaServicioFila): VigenciaServicioFila => ({ ...t, compra_inicio: null, compra_fin: null });

const MAX_DIAS_VENTANA = 3660;
const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;
// Ida y vuelta por iso(): `new Date('2026-02-30')` se normaliza a 2026-03-02, así que una fecha inexistente no sobrevive la comparación.
const tiempoDia = (f: string) => {
  const t = ISO_DIA.test(f) ? new Date(`${f}T00:00:00Z`).getTime() : NaN;
  return Number.isFinite(t) && iso(t) === f ? t : NaN;
};

/** Motivo por el que la ventana [desde, hasta] no se puede recorrer completa, o null si es válida. */
export function ventanaInvalida(desde: string, hasta: string): string | null {
  const a = tiempoDia(desde);
  const b = tiempoDia(hasta);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return `fechas inválidas (${desde} / ${hasta})`;
  if (b < a) return `el regreso (${fechaLegible(hasta)}) es anterior a la ida (${fechaLegible(desde)})`;
  if ((b - a) / MS_DIA + 1 > MAX_DIAS_VENTANA) return `la ventana supera ${MAX_DIAS_VENTANA} días`;
  return null;
}

/** Fechas ISO de la ventana [desde, hasta] (ambas incluidas), completa. Lanza RangeError si es inválida: nunca recorta ni inventa un día. */
export function diasVentana(desde: string, hasta: string): string[] {
  const motivo = ventanaInvalida(desde, hasta);
  if (motivo) throw new RangeError(`Ventana de fechas no válida: ${motivo}.`);
  const dias: string[] = [];
  for (let t = tiempoDia(desde); t <= tiempoDia(hasta); t += MS_DIA) dias.push(iso(t));
  return dias;
}

/** Nombre de la vigencia que cubre la fecha (ignorando la ventana de compra), o null. */
export function vigenciaEnFecha(sv: VigenciasServicio, fecha: string): string | null {
  const rangos = sv.temporadas.map((t) => toTemporadaRango(sinCompra(t)));
  return rangos.length ? temporadaVigenteParaFecha(new Date(`${fecha}T00:00:00`), rangos, "2000-01-01") : null;
}

/** Cobertura día a día de la ventana: vigencias que la tocan, tramos [desde, hasta] cubiertos y primer día sin vigencia. Lanza RangeError si la ventana es inválida. */
export function coberturaVentana(sv: VigenciasServicio, desde: string, hasta: string): {
  nombres: string[]; primerSinCobertura: string | null; rangos: { desde: string; hasta: string }[]; dias: number; cubiertos: number;
} {
  const nombres = new Set<string>();
  const rangos: { desde: string; hasta: string }[] = [];
  let primerSinCobertura: string | null = null;
  let abierto: { desde: string; hasta: string } | null = null;
  const dias = diasVentana(desde, hasta);
  let cubiertos = 0;
  for (const d of dias) {
    const n = vigenciaEnFecha(sv, d);
    if (n) {
      nombres.add(n); cubiertos++;
      if (abierto) abierto.hasta = d; else { abierto = { desde: d, hasta: d }; rangos.push(abierto); }
    } else {
      abierto = null;
      if (!primerSinCobertura) primerSinCobertura = d;
    }
  }
  return { nombres: [...nombres], primerSinCobertura, rangos, dias: dias.length, cubiertos };
}

/** Vigencias distintas que cubren los días de la ventana y primer día sin cobertura (si lo hay). */
export function cubrirVentana(sv: VigenciasServicio, desde: string, hasta: string): { nombres: string[]; primerSinCobertura: string | null } {
  const nombres = new Set<string>();
  let primerSinCobertura: string | null = null;
  for (const d of diasVentana(desde, hasta)) {
    const n = vigenciaEnFecha(sv, d);
    if (n) nombres.add(n); else if (!primerSinCobertura) primerSinCobertura = d;
  }
  return { nombres: [...nombres], primerSinCobertura };
}

export type ReferenciaPublicacion =
  | {
      ok: true;
      vigencias: string[];
      /** Neto por persona de referencia (mínimo). null en modo grupo. */
      netoPersona: number | null;
      /** Neto por infante de referencia: mínimo de (precio_infante ?? precio_persona). null si el servicio no se cobra por persona. */
      netoInfante: number | null;
      /** True si algún infante tiene precio propio en alguna vigencia (si no, publicar NULL = paga como adulto). */
      infantePropio: boolean;
      recargoIndividual: number;
      /** Rangos de grupo de referencia (mismo rango en todas las vigencias aplicables, precio mínimo). Vacío en modo persona. */
      rangos: { pax_desde: number; pax_hasta: number; precio: number }[];
      /** Alguna vigencia aplicable tiene franjas horarias: el precio publicado es BASE, falta el suplemento según la hora. */
      conFranjas: boolean;
      /**
       * Disponibilidad por fecha dentro de la ventana del paquete (null si no hay ventana). Un hueco ya NO invalida el servicio: se ofrece solo en los tramos
       * cubiertos. `parcial` = hay días de la ventana sin vigencia. La cotización de cada fecha se resuelve siempre contra la vigencia de ESA fecha.
       */
      cobertura: { rangos: { desde: string; hasta: string }[]; dias: number; cubiertos: number; primerSinCobertura: string | null; parcial: boolean } | null;
    }
  | { ok: false; error: string };

/**
 * Referencia de publicación de un servicio para una ventana de viaje [desde, hasta] (si no hay ventana: las vigencias que aún no vencieron a `hoy`).
 * Error legible si: ningún día de la ventana tiene vigencia (el servicio no se ofrece), una vigencia aplicable no tiene precio (persona) o rangos (grupo), o las
 * vigencias aplicables tienen rangos de pasajeros distintos. Un hueco PARCIAL no es error: devuelve `cobertura` con los tramos donde sí se puede vender.
 */
export function referenciaPublicacion(sv: VigenciasServicio, modo: "persona" | "grupo", ventana: { desde: string; hasta: string } | null, hoy: string): ReferenciaPublicacion {
  const rotulo = `El servicio «${sv.nombre}»`;
  let aplicables: VigenciaServicioFila[];
  let cobertura: Extract<ReferenciaPublicacion, { ok: true }>["cobertura"] = null;
  if (ventana) {
    const invalida = ventanaInvalida(ventana.desde, ventana.hasta);
    if (invalida) return { ok: false, error: `${rotulo}: no se puede validar el viaje del paquete, ${invalida}.` };
    const cob = coberturaVentana(sv, ventana.desde, ventana.hasta);
    const { nombres } = cob;
    if (!nombres.length) return { ok: false, error: `${rotulo} no tiene ninguna vigencia de tarifa que cubra el viaje del paquete (${fechaLegible(ventana.desde)} al ${fechaLegible(ventana.hasta)}); no se ofrece en ninguna fecha hasta que el proveedor confirme una vigencia.` };
    cobertura = { rangos: cob.rangos, dias: cob.dias, cubiertos: cob.cubiertos, primerSinCobertura: cob.primerSinCobertura, parcial: cob.cubiertos < cob.dias };
    aplicables = sv.temporadas.filter((t) => nombres.includes(t.nombre));
  } else {
    aplicables = sv.temporadas.filter((t) => t.fecha_inicio && t.fecha_fin && t.fecha_fin >= hoy);
    if (!aplicables.length) return { ok: false, error: `${rotulo} no tiene ninguna vigencia de tarifa vigente o futura. Carga la vigencia en Producto → Servicios.` };
  }
  const vigencias = aplicables.map((t) => t.nombre);
  const conFranjas = aplicables.some((t) => sv.conFranjas.has(t.nombre));
  if (sv.usaAlcance && modo === "persona") {
    // 262: traslado por alcance en modo persona — la referencia es el menor precio por persona que se OFRECE en cada vigencia: el de un trayecto (propio) y el de ida y regreso
    // (propio o, si no lo hay, la tarifa de la vigencia). Un trayecto no es requisito: basta con poder ofrecer ida y regreso.
    const valido = (n: number | null | undefined): n is number => n != null && Number.isFinite(Number(n)) && Number(n) >= 0; // 0 es una tarifa válida; «sin tarifa» = NULL/ausente/inválida (ver resolverPrecioAlcance)
    const precios = aplicables.map((t) => {
      const idaRegreso = sv.personaIdaRegreso?.get(t.nombre) ?? (valido(t.precio_persona) ? Number(t.precio_persona) : undefined);
      return { nombre: t.nombre, candidatos: [sv.personaAlcance?.get(t.nombre), idaRegreso].filter((x): x is number => x != null) };
    });
    const sinPrecio = precios.find((p) => !p.candidatos.length);
    if (sinPrecio) return { ok: false, error: `${rotulo} no tiene precio por persona (de un trayecto, de ida y regreso ni tarifa de la vigencia) en su vigencia «${sinPrecio.nombre}».` };
    return {
      ok: true, vigencias, conFranjas,
      netoPersona: Math.min(...precios.flatMap((p) => p.candidatos)),
      netoInfante: null, infantePropio: false, recargoIndividual: 0, rangos: [], cobertura,
    };
  }
  if (modo === "persona") {
    const sinPrecio = aplicables.find((t) => t.precio_persona == null || !Number.isFinite(Number(t.precio_persona)) || Number(t.precio_persona) < 0);
    if (sinPrecio) return { ok: false, error: `${rotulo} no tiene precio por persona en su vigencia «${sinPrecio.nombre}».` };
    const infantes = aplicables.map((t) => (t.precio_infante != null ? Number(t.precio_infante) : Number(t.precio_persona)));
    return {
      ok: true, vigencias, conFranjas,
      netoPersona: Math.min(...aplicables.map((t) => Number(t.precio_persona))),
      netoInfante: Math.min(...infantes),
      infantePropio: aplicables.some((t) => t.precio_infante != null),
      recargoIndividual: Math.min(...aplicables.map((t) => Math.max(Number(t.recargo_individual) || 0, 0))),
      rangos: [], cobertura,
    };
  }
  // 262: por alcance, los rangos que se publican son los de un trayecto (si la vigencia los tiene) y, si no, los de ida y regreso (propios o de la tarifa de la vigencia).
  const rangosDe = (nombre: string): GrupoServicioFila[] => {
    if (!sv.usaAlcance) return sv.grupos.filter((g) => g.temporada === nombre);
    const trayecto = (sv.gruposAlcance ?? []).filter((g) => g.temporada === nombre);
    if (trayecto.length) return trayecto;
    return rangosIdaRegresoEfectivos((sv.gruposIdaRegreso ?? []).filter((g) => g.temporada === nombre), sv.grupos.filter((g) => g.temporada === nombre && Number.isFinite(Number(g.precio)) && Number(g.precio) >= 0));
  };
  const porVigencia = aplicables.map((t) => ({ nombre: t.nombre, rangos: rangosDe(t.nombre).sort((a, b) => a.pax_desde - b.pax_desde) }));
  const sinRangos = porVigencia.find((v) => !v.rangos.length);
  if (sinRangos) return { ok: false, error: `${rotulo} no tiene rangos de pasajeros${sv.usaAlcance ? " (de un trayecto, de ida y regreso ni de la tarifa de la vigencia)" : ""} en su vigencia «${sinRangos.nombre}».` };
  const clave = (r: { pax_desde: number; pax_hasta: number }) => `${r.pax_desde}-${r.pax_hasta}`;
  const base = porVigencia[0].rangos.map(clave).join("|");
  const distinta = porVigencia.find((v) => v.rangos.map(clave).join("|") !== base);
  if (distinta) return { ok: false, error: `${rotulo} tiene rangos de pasajeros distintos entre sus vigencias «${porVigencia[0].nombre}» y «${distinta.nombre}»; deben coincidir para publicar un precio que se pueda cotizar en cualquier fecha del viaje.` };
  const rangos = porVigencia[0].rangos.map((r, i) => ({ pax_desde: r.pax_desde, pax_hasta: r.pax_hasta, precio: Math.min(...porVigencia.map((v) => Number(v.rangos[i].precio))) }));
  return { ok: true, vigencias, conFranjas, netoPersona: null, netoInfante: null, infantePropio: false, recargoIndividual: 0, rangos, cobertura };
}

/**
 * Por qué un incluido no se puede cobrar en una estadía. `sin_tarifa` (sin vigencia que cubra la estadía, o sin precio / rangos en la vigencia) = «no tiene tarifa vigente»:
 * el servicio se OMITE de la oferta de esa fecha (ni se cobra ni se lista) y el hotel/paquete se ofrece igual. El resto son errores de configuración que no se omiten.
 */
export type MotivoIncluidoNoCobrable = "sin_tarifa" | "ambiguo" | "franjas" | "ventana" | "dato_invalido";
export type IncluidoEnEstadia =
  | { ok: true; vigencia: string; netoPersona: number | null; netoInfante: number | null; rangos: { pax_desde: number; pax_hasta: number; precio: number }[] }
  | { ok: false; error: string; motivo: MotivoIncluidoNoCobrable };

/** ¿Este fallo significa «sin tarifa vigente» (se omite el servicio) y no un error de configuración? */
export const incluidoSeOmite = (r: IncluidoEnEstadia): boolean => !r.ok && r.motivo === "sin_tarifa";

/**
 * Servicio INCLUIDO en el precio del hotel para una estadía [desde, hasta] (misma fecha de ida y de regreso para una fecha fija): debe haber UNA sola
 * vigencia para todos los días (si la estadía abarca dos, el precio horneado sería ambiguo), con precio por persona o rangos de grupo, y sin franjas
 * horarias (un traslado con suplemento por hora no puede ir incluido: hay que ofrecerlo como opcional para pedir la hora).
 */
export function incluidoEnEstadia(sv: VigenciasServicio, modo: "persona" | "grupo", desde: string, hasta: string): IncluidoEnEstadia {
  const rotulo = `El servicio incluido «${sv.nombre}»`;
  // 262: un traslado por alcance no tiene un precio único para hornear en el hotel (depende del trayecto vendido): se ofrece como opcional.
  if (sv.usaAlcance) return { ok: false, error: `${rotulo} es un traslado que se vende por trayecto (llegada, salida o ida y regreso): no puede ir incluido en el hotel. Márcalo como opcional.`, motivo: "dato_invalido" };
  const invalida = ventanaInvalida(desde, hasta);
  if (invalida) return { ok: false, error: `${rotulo}: no se puede validar la estadía, ${invalida}.`, motivo: "ventana" };
  const { nombres, primerSinCobertura } = cubrirVentana(sv, desde, hasta);
  if (primerSinCobertura) return { ok: false, error: `${rotulo} no tiene vigencia de tarifa para el ${fechaLegible(primerSinCobertura)} (estadía ${fechaLegible(desde)} al ${fechaLegible(hasta)}).`, motivo: "sin_tarifa" };
  if (nombres.length !== 1) return { ok: false, error: `${rotulo} cambia de vigencia dentro de la estadía ${fechaLegible(desde)} al ${fechaLegible(hasta)} (${nombres.join(", ")}); su precio incluido sería ambiguo. Alinea las vigencias con las temporadas del hotel.`, motivo: "ambiguo" };
  const nombre = nombres[0];
  if (sv.conFranjas.has(nombre)) return { ok: false, error: `${rotulo} tiene suplementos por horario en la vigencia «${nombre}»: no puede ir incluido en el hotel. Márcalo como opcional para pedir la hora del traslado.`, motivo: "franjas" };
  const fila = sv.temporadas.find((t) => t.nombre === nombre)!;
  if (modo === "persona") {
    if (fila.precio_persona == null || !Number.isFinite(Number(fila.precio_persona)) || Number(fila.precio_persona) < 0) return { ok: false, error: `${rotulo} no tiene precio por persona en su vigencia «${nombre}».`, motivo: "sin_tarifa" };
    // Un precio de infante PRESENTE pero no numérico (p. ej. numeric 'NaN') o negativo es un dato corrupto, no «sin tarifa»: no se omite el servicio ni se calcula con él (el costo
    // saldría NaN y se registraría como $0). NULL sí es válido (el infante paga como adulto) y 0 también (gratis).
    if (fila.precio_infante != null && (!Number.isFinite(Number(fila.precio_infante)) || Number(fila.precio_infante) < 0)) {
      return { ok: false, error: `${rotulo} tiene un precio de infante no válido en su vigencia «${nombre}»; corrígelo en Producto → Servicios antes de cotizar o publicar.`, motivo: "dato_invalido" };
    }
    return { ok: true, vigencia: nombre, netoPersona: Number(fila.precio_persona), netoInfante: fila.precio_infante != null ? Number(fila.precio_infante) : null, rangos: [] };
  }
  const rangos = sv.grupos.filter((g) => g.temporada === nombre).map((g) => ({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: Number(g.precio) }));
  if (!rangos.length) return { ok: false, error: `${rotulo} no tiene rangos de pasajeros en su vigencia «${nombre}».`, motivo: "sin_tarifa" };
  if (rangos.some((r) => !Number.isFinite(r.precio) || r.precio < 0)) return { ok: false, error: `${rotulo} tiene un precio no válido en un rango de pasajeros de su vigencia «${nombre}»; corrígelo en Producto → Servicios antes de cotizar o publicar.`, motivo: "dato_invalido" };
  return { ok: true, vigencia: nombre, netoPersona: null, netoInfante: null, rangos };
}

/**
 * Servicios por PERSONA cuyas vigencias aplicables al viaje tienen precio de adulto pero NO de infante (el infante paga como adulto): se avisa al generar.
 * Sale de las vigencias, nunca del precio base GENERAL. Sin vigencias o sin cobertura de la ventana: sin aviso (la publicación ya falla por su cuenta).
 */
export function serviciosSinPrecioInfanteVigencias(
  servicios: readonly { nombre: string | null; modo: "persona" | "grupo"; vigencias: VigenciasServicio | undefined }[],
  ventana: { desde: string; hasta: string } | null,
  hoy: string,
): string[] {
  const nombres: string[] = [];
  for (const s of servicios) {
    if (s.modo !== "persona" || !s.vigencias) continue;
    const ref = referenciaPublicacion(s.vigencias, "persona", ventana, hoy);
    if (!ref.ok) continue;
    const sinInfante = s.vigencias.temporadas.some((t) => ref.vigencias.includes(t.nombre) && t.precio_persona != null && t.precio_infante == null);
    const n = s.nombre ?? "Servicio";
    if (sinInfante && !nombres.includes(n)) nombres.push(n);
  }
  return nombres;
}
