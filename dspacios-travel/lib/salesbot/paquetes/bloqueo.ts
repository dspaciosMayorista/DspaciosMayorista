// Transformaciones PURAS de la consulta de BLOQUEOS (#56): agrupar la oferta
// publicada del tarifario, validar la selección, armar la entrada del motor de
// venta (`computarReserva`) y reducir su resultado a la lista blanca.
//
// Fuentes (consumidas, nunca editadas):
//   · Oferta: `cargarDatosTarifario` → `filasVisibles` (módulo `bloqueo`, ya
//     filtradas por paquete publicable/activo, vigencia de compra y salida no
//     pasada) y `cuposPorBloqueo` (conteo agregado de sillas libres; jamás
//     filas de `sillas`).
//   · Precio: `computarReserva`, la MISMA función que usan la cotización y la
//     venta. Aquí no se calcula ni se suma ningún precio.
import type { FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import type { ComputoReserva, ReservaInput } from "@/lib/reservar/computo";
import { ACOM_ROOMS, type AcomRoom } from "@/lib/acomodaciones";
import { normalizarTexto } from "@/lib/salesbot/consulta";
import { LIMITE_MAXIMO_BUSQUEDA } from "@/lib/salesbot/contrato";
import {
  clasificarMensajeMotor,
  desdePorPersona,
  esRechazoBernalo,
  preciosPublicables,
  validarComposicion,
  type ComboPorPersona,
  type Composicion,
  type CotizacionPaquete,
  type DisponibilidadVuelo,
  type OfertaBloqueo,
  type ResultadoBusquedaBloqueos,
} from "@/lib/salesbot/paquetes/contrato";

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const esFecha = (v: string) => FECHA_ISO.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export type CriteriosBloqueos = { texto?: string; destino?: string; fechaDesde?: string; fechaHasta?: string; limite?: number };

export function validarCriteriosBloqueos(entrada: Record<string, string | undefined>): { ok: true; criterios: CriteriosBloqueos } | { ok: false; campos: string[] } {
  const campos: string[] = [];
  const c: CriteriosBloqueos = {};
  const texto = (entrada.texto ?? "").trim();
  if (texto) c.texto = texto.slice(0, 120);
  const destino = (entrada.destino ?? "").trim();
  if (destino) c.destino = destino.slice(0, 80);
  for (const k of ["fechaDesde", "fechaHasta"] as const) {
    const v = (entrada[k] ?? "").trim();
    if (!v) continue;
    if (esFecha(v)) c[k] = v;
    else campos.push(k);
  }
  if (c.fechaDesde && c.fechaHasta && c.fechaDesde > c.fechaHasta) campos.push("fechaHasta");
  const limite = (entrada.limite ?? "").trim();
  if (limite) {
    const n = Number(limite);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO_BUSQUEDA) campos.push("limite");
    else c.limite = n;
  }
  return campos.length ? { ok: false, campos } : { ok: true, criterios: c };
}

// Privacidad de ruta: la oferta NO publica ruta ni origen del vuelo. Las
// fuentes disponibles son texto libre que puede traer el record/PNR:
// `bloqueo_label` y `origenPorBloqueo` (`datos.ts:199-201` lo rellena desde
// `bloqueos_vuelo.ruta` cuando falta `origen`). Un PNR (`ABC-DEF`, `QWERTY`…)
// no se distingue de una ruta, así que solo se muestran destino y fechas.

/** Clave estable de una oferta: paquete + origen del vuelo + hotel. */
export function claveOferta(paqueteId: number, bloqueoId: number | null, empaquetadoId: number | null, hotelId: number): string {
  const origen = bloqueoId != null ? `b${bloqueoId}` : `e${empaquetadoId}`;
  return `${paqueteId}-${origen}-${hotelId}`;
}

/** Disponibilidad del vuelo de una oferta: conteo agregado o, sin él, "no verificada". */
export function disponibilidadVuelo(bloqueoId: number | null, cupos: Readonly<Record<number, number>>): { sillas: number | null; estado: DisponibilidadVuelo } {
  if (bloqueoId == null) return { sillas: null, estado: "sujeto_a_confirmacion" };
  const n = cupos[bloqueoId];
  if (n === undefined || !Number.isFinite(n)) return { sillas: null, estado: "no_verificada" };
  return { sillas: n, estado: n > 0 ? "sillas_libres" : "sin_sillas" };
}

/**
 * Agrupa las filas visibles del tarifario (módulo `bloqueo`) en ofertas
 * (paquete × origen del vuelo × hotel), con sus combos categoría × régimen y
 * el PVP por persona de cada acomodación. Una fila sin paquete, hotel u
 * origen de vuelo no forma oferta.
 */
export function ofertasBloqueo(filas: readonly FilaTarifario[], cupos: Readonly<Record<number, number>>): OfertaBloqueo[] {
  const porClave = new Map<string, OfertaBloqueo & { _combos: Map<string, ComboPorPersona> }>();
  for (const f of filas) {
    if (f.modulo !== "bloqueo") continue;
    const paqueteId = f.paquete_id;
    const hotelId = f.hotel_id;
    const bloqueoId = f.bloqueo_id ?? null;
    const empaquetadoId = f.empaquetado_id ?? null;
    if (paqueteId == null || hotelId == null) continue;
    if ((bloqueoId == null) === (empaquetadoId == null)) continue; // exactamente un origen, como exige el motor
    if (!f.categoria || !f.regimen || !f.acomodacion) continue;
    const clave = claveOferta(paqueteId, bloqueoId, empaquetadoId, hotelId);
    let o = porClave.get(clave);
    if (!o) {
      const disp = disponibilidadVuelo(bloqueoId, cupos);
      o = {
        clave,
        paquete_id: paqueteId,
        paquete_nombre: f.paquete_nombre,
        origen_vuelo: bloqueoId != null ? "bloqueo" : "sistema",
        bloqueo_id: bloqueoId,
        empaquetado_id: empaquetadoId,
        fecha_ida: f.fecha_ida,
        fecha_regreso: f.fecha_regreso,
        noches: f.noches,
        destino: f.destino_nombre,
        hotel_id: hotelId,
        hotel_nombre: f.hotel_nombre,
        moneda: (f.moneda ?? "COP").toUpperCase(),
        combos: [],
        desde_pvp_por_persona: null,
        sillas_libres: disp.sillas,
        disponibilidad_vuelo: disp.estado,
        _combos: new Map(),
      };
      porClave.set(clave, o);
    }
    const ck = `${f.categoria}|${f.regimen}`;
    let combo = o._combos.get(ck);
    if (!combo) {
      combo = { categoria: f.categoria, regimen: f.regimen, pvp_por_persona: {} };
      o._combos.set(ck, combo);
    }
    const precio = preciosPublicables({ [f.acomodacion]: f.precio_pvp })[f.acomodacion];
    if (precio !== undefined) combo.pvp_por_persona[f.acomodacion] = precio;
  }
  return [...porClave.values()].map(({ _combos, ...o }) => {
    const combos = [..._combos.values()].filter((c) => Object.keys(c.pvp_por_persona).length > 0);
    return { ...o, combos, desde_pvp_por_persona: desdePorPersona(combos) };
  });
}

/** Búsqueda sobre las ofertas: destino, texto (por palabras) y rango de la fecha de ida. */
export function buscarEnOfertas(ofertas: readonly OfertaBloqueo[], c: CriteriosBloqueos, limitePorDefecto = 10): ResultadoBusquedaBloqueos {
  const destino = normalizarTexto(c.destino);
  const tokens = normalizarTexto(c.texto).split(" ").filter(Boolean);
  const filtradas = ofertas
    .filter((o) => o.combos.length > 0)
    .filter((o) => !destino || normalizarTexto(o.destino).includes(destino))
    .filter((o) => {
      if (!tokens.length) return true;
      const pajar = normalizarTexto([o.paquete_nombre, o.hotel_nombre, o.destino].filter(Boolean).join(" "));
      return tokens.every((t) => pajar.includes(t));
    })
    .filter((o) => !c.fechaDesde || (o.fecha_ida != null && o.fecha_ida >= c.fechaDesde))
    .filter((o) => !c.fechaHasta || (o.fecha_ida != null && o.fecha_ida <= c.fechaHasta))
    .sort((a, b) => (a.fecha_ida ?? "").localeCompare(b.fecha_ida ?? "") || (a.desde_pvp_por_persona ?? Infinity) - (b.desde_pvp_por_persona ?? Infinity));
  const limite = c.limite ?? limitePorDefecto;
  const ofertasLimitadas = filtradas.slice(0, limite);
  return { ofertas: ofertasLimitadas, total_encontradas: filtradas.length, truncado: filtradas.length > ofertasLimitadas.length };
}

export type SeleccionBloqueo = {
  clave: string;
  categoria: string;
  regimen: string;
  composicion: Composicion;
};

/** Valida la selección del formulario: oferta, combo "categoria|regimen" y composición. */
export function validarSeleccionBloqueo(entrada: Record<string, string | undefined>): { ok: true; seleccion: SeleccionBloqueo } | { ok: false; campos: string[] } {
  const campos: string[] = [];
  const clave = (entrada.oferta ?? "").trim();
  if (!/^\d+-(b|e)\d+-\d+$/.test(clave)) campos.push("oferta");
  const combo = (entrada.combo ?? "").trim();
  const sep = combo.indexOf("|");
  const categoria = sep > 0 ? combo.slice(0, sep).trim() : "";
  const regimen = sep > 0 ? combo.slice(sep + 1).trim() : "";
  if (!categoria || !regimen) campos.push("combo");
  const comp = validarComposicion(entrada);
  if (!comp.ok) campos.push(...comp.campos);
  if (campos.length || !comp.ok) return { ok: false, campos: [...new Set(campos)] };
  return { ok: true, seleccion: { clave, categoria, regimen, composicion: comp.composicion } };
}

/** La oferta VISIBLE que corresponde a la selección, con ese combo publicado; si no, null (falla cerrado). */
export function ofertaDeSeleccion(ofertas: readonly OfertaBloqueo[], s: SeleccionBloqueo): OfertaBloqueo | null {
  const o = ofertas.find((x) => x.clave === s.clave);
  if (!o) return null;
  return o.combos.some((c) => c.categoria === s.categoria && c.regimen === s.regimen) ? o : null;
}

/**
 * Entrada de `computarReserva` para cotizar un bloqueo: la MISMA forma que
 * arma el checkout de Vista Booking para un hotel por persona
 * (`app/tarifario/checkout/actions.ts`), con el origen del vuelo explícito
 * (bloqueo o empaquetado, como el Reservar interno). Sin datos personales,
 * sin pasajeros, sin servicios add-on y sin mascotas.
 */
export function entradaComputoBloqueo(o: OfertaBloqueo, s: SeleccionBloqueo): ReservaInput {
  return {
    paqueteId: o.paquete_id,
    bloqueoId: o.bloqueo_id,
    empaquetadoId: o.empaquetado_id,
    modulo: "bloqueo",
    hotelId: o.hotel_id,
    fechaIda: undefined,
    fechaRegreso: undefined,
    categoria: s.categoria,
    regimen: s.regimen,
    habitaciones: { ...s.composicion.habitaciones },
    ninos: 0,
    ninos2: 0,
    infantes: 0,
    edadesMenores: [...s.composicion.edadesMenores],
    cantidadMenores: s.composicion.edadesMenores.length,
    cliente: { nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "" },
    tipoAsesor: "interno",
    asesorInterno: "",
    agenciaNombre: "",
    agenciaAsesor: "",
    freelanceNombre: "",
    aliadoId: null,
    plazo: "",
    pasajeros: [],
    servicios: [],
  };
}

export type ResultadoComputo = { ok: true; data: ComputoReserva } | { ok: false; error: string };

export type CotizacionResuelta =
  | { ok: true; cotizacion: CotizacionPaquete }
  | { ok: false; codigo: "no_cotizable" | "error_tecnico"; motivo?: string };

/**
 * Parte del total del motor que NO sale de las líneas por persona: lo que
 * `computarReserva` suma aparte (servicios incluidos cobrados por grupo; las
 * mascotas y los add-on nunca se piden desde aquí). Misma suma que el motor:
 * habitaciones × pax × PVP + menores con PVP definido.
 */
export function cargoFueraDeLineas(d: ComputoReserva): number {
  let lineas = 0;
  for (const l of d.lineasHab) lineas += l.pax * l.pvp;
  const menor = (n: number, k: string) => (n > 0 && typeof d.pvpPorAcom[k] === "number" ? n * d.pvpPorAcom[k] : 0);
  lineas += menor(d.numNinos, "nino") + menor(d.numNinos2, "nino2") + menor(d.numInfantes, "infante");
  return d.precioVenta - lineas;
}

export const MOTIVO_CARGO_GRUPO_SIN_MARKUP =
  "Este paquete suma servicios cobrados por grupo y el total no se puede confirmar desde esta consulta con tu rol. Pide el total a administración u operaciones.";

/**
 * Reduce el resultado del motor a la lista blanca. El total es EXACTAMENTE
 * `precioVenta` del motor; las líneas, los pax y los PVP por persona salen de
 * sus mismos campos. Los netos, el impuesto y los servicios incluidos (con su
 * costo) nunca se copian.
 *
 * `markupConfiable`: el motor lee el % de markup del paquete con la SESIÓN
 * (H-PQ1). Si la sesión no alcanza esa fila, el cargo de los servicios por
 * grupo sale sin markup: entonces, si el total trae un cargo fuera de las
 * líneas, no se presenta (falla cerrado) en vez de mostrar un total bajo.
 */
export function resolverCotizacion(
  producto: CotizacionPaquete["producto"],
  base: { paqueteId: number; hotelId: number; categoria: string; regimen: string },
  r: ResultadoComputo,
  vuelo: { sillas: number | null; estado: DisponibilidadVuelo } | null,
  opciones: { markupConfiable: boolean }
): CotizacionResuelta {
  if (!r.ok) {
    if (esRechazoBernalo(r.error)) return { ok: false, codigo: "no_cotizable", motivo: "Este hotel usa tarifa por unidad y todavía no se consulta aquí." };
    const c = clasificarMensajeMotor(r.error);
    return c.codigo === "error_tecnico" ? { ok: false, codigo: "error_tecnico" } : { ok: false, codigo: "no_cotizable", motivo: c.motivo };
  }
  const d = r.data;
  if (!opciones.markupConfiable && cargoFueraDeLineas(d) > 0) return { ok: false, codigo: "no_cotizable", motivo: MOTIVO_CARGO_GRUPO_SIN_MARKUP };
  const lineas = d.lineasHab
    .filter((l): l is typeof l & { acom: AcomRoom } => (ACOM_ROOMS as readonly string[]).includes(l.acom))
    .map((l) => ({ acomodacion: l.acom, habitaciones: l.habitaciones, pax: l.pax, pvp_por_persona: l.pvp }));
  const pvpMenor = (k: "nino" | "nino2" | "infante") => {
    const v = d.pvpPorAcom[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const sillasConsideradas = vuelo && vuelo.estado !== "sujeto_a_confirmacion";
  return {
    ok: true,
    cotizacion: {
      producto,
      paquete_id: base.paqueteId,
      hotel_id: base.hotelId,
      hotel_nombre: d.meta.hotel_nombre,
      destino: d.meta.destino_nombre,
      fecha_ida: d.meta.fecha_ida,
      fecha_regreso: d.meta.fecha_regreso,
      categoria: base.categoria,
      regimen: base.regimen,
      moneda: (d.monedaReserva ?? "COP").toUpperCase(),
      lineas,
      menores: { nino: d.numNinos, nino2: d.numNinos2, infante: d.numInfantes },
      pvp_menores_por_persona: {
        nino: d.numNinos > 0 ? pvpMenor("nino") : null,
        nino2: d.numNinos2 > 0 ? pvpMenor("nino2") : null,
        infante: d.numInfantes > 0 ? pvpMenor("infante") : null,
      },
      total_pax: d.totalPax,
      total_orientativo: d.precioVenta,
      condiciones_tarifa: [...new Set(d.condicionesTarifa.map((c) => c.texto).filter((t) => !!t && !!t.trim()))],
      nota_nino: d.notaNino,
      sillas_libres: sillasConsideradas ? vuelo!.sillas : null,
      alcanzan_sillas: sillasConsideradas && vuelo!.sillas != null ? vuelo!.sillas >= d.paxConSilla : null,
      disponibilidad_vuelo: vuelo ? vuelo.estado : null,
      disponibilidad_hotel: "sujeto_a_confirmacion",
      sujeto_a_confirmacion: true,
    },
  };
}
