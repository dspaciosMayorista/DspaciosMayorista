// Transformaciones PURAS de la consulta interna de programas (#56): validar
// criterios, filtrar el resumen del tarifario, decidir visibilidad, marcar los
// precios en revisión (#57) y reducir el detalle a la lista blanca del
// contrato. Sin I/O: todo lo que necesita llega por parámetro.
import type { ProgramaResumen } from "@/app/tarifario/TarifarioPublic";
import type { ProgramaDetalle } from "@/lib/programas";
import { programaVisibleEnPublico } from "@/lib/programas/destinoFijo";
import {
  LIMITE_MAXIMO_BUSQUEDA,
  LIMITE_POR_DEFECTO_BUSQUEDA,
  type AgenciaResumen,
  type CriteriosBusqueda,
  type DetalleConsulta,
  type PorcentajeAgencia,
  type PrecioPorPersona,
  type ProgramaEncontrado,
  type ResultadoBusqueda,
  type TipoTransporte,
} from "@/lib/salesbot/contrato";

const TIPOS_TRANSPORTE: readonly TipoTransporte[] = ["ninguno", "aereo", "terrestre"];
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Sin tildes, minúsculas y espacios simples: la misma comparación para texto, destino y ciudades. */
export function normalizarTexto(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function esFechaValida(v: string): boolean {
  if (!FECHA_ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type ValidacionCriterios = { ok: true; criterios: CriteriosBusqueda } | { ok: false; campos: string[] };

/**
 * Valida y normaliza los criterios que llegan del formulario (todo texto). Un
 * campo vacío se ignora; uno mal formado se rechaza con su nombre, nunca se
 * corrige en silencio.
 */
export function validarCriterios(entrada: Record<string, string | undefined>): ValidacionCriterios {
  const campos: string[] = [];
  const criterios: CriteriosBusqueda = {};

  const texto = (entrada.texto ?? "").trim();
  if (texto) criterios.texto = texto.slice(0, 120);
  const destino = (entrada.destino ?? "").trim();
  if (destino) criterios.destino = destino.slice(0, 80);

  const tipo = (entrada.tipoTransporte ?? "").trim();
  if (tipo) {
    if ((TIPOS_TRANSPORTE as readonly string[]).includes(tipo)) criterios.tipoTransporte = tipo as TipoTransporte;
    else campos.push("tipoTransporte");
  }

  const fecha = (entrada.fechaSalida ?? "").trim();
  if (fecha) {
    if (esFechaValida(fecha)) criterios.fechaSalida = fecha;
    else campos.push("fechaSalida");
  }

  const monto = (entrada.presupuesto ?? "").trim();
  const moneda = (entrada.monedaPresupuesto ?? "").trim().toUpperCase();
  if (monto) {
    const n = Number(monto.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) campos.push("presupuesto");
    else if (moneda !== "COP" && moneda !== "USD") campos.push("monedaPresupuesto");
    else criterios.presupuestoMaxPorPersona = { monto: n, moneda };
  }

  const limite = (entrada.limite ?? "").trim();
  if (limite) {
    const n = Number(limite);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO_BUSQUEDA) campos.push("limite");
    else criterios.limite = n;
  }

  return campos.length ? { ok: false, campos } : { ok: true, criterios };
}

/** Datos internos de un programa que la búsqueda necesita y que NUNCA salen en la respuesta. */
export type DatosInternosPrograma = {
  vigencia_desde: string | null;
  vigencia_hasta: string | null;
  blackouts: { fecha_inicio: string | null; fecha_fin: string | null }[];
  precio_en_revision: boolean;
};

/**
 * ¿Se puede salir en esa fecha? Las mismas dos reglas que `reservarPrograma`
 * aplica a la fecha de ida: dentro de la vigencia y fuera de todo blackout.
 * No mira las salidas puntuales: su significado (fecha de salida o rango) lo
 * resuelve el detalle, no la búsqueda.
 */
export function puedeSalirEnFecha(d: Pick<DatosInternosPrograma, "vigencia_desde" | "vigencia_hasta" | "blackouts">, fecha: string): boolean {
  if (d.vigencia_desde && fecha < d.vigencia_desde) return false;
  if (d.vigencia_hasta && fecha > d.vigencia_hasta) return false;
  for (const b of d.blackouts) {
    if (b.fecha_inicio && b.fecha_fin && fecha >= b.fecha_inicio && fecha <= b.fecha_fin) return false;
  }
  return true;
}

/** Fila mínima de salida para decidir si el precio de un programa está en revisión. */
export type SalidaParaRevision = {
  noches: number | null;
  tarifa_sencilla: number | null;
  tarifa_doble: number | null;
  tarifa_triple: number | null;
  tarifa_multiple: number | null;
};

export type ProgramaParaRevision = {
  modo_precio: string | null;
  regla_comisionable: boolean | null;
  regla_comisionable_modalidad_mk: string | null;
  asistencia_medica_dia: number | null;
};

const conTarifa = (s: SalidaParaRevision) =>
  [s.tarifa_sencilla, s.tarifa_doble, s.tarifa_triple, s.tarifa_multiple].some((t) => t != null && Number.isFinite(Number(t)) && Number(t) > 0);

/**
 * Marca de precio en revisión mientras #57 siga abierto: los dos casos en que
 * el precio mostrado y el cobrado divergen hoy (bitácora de #56, hallazgo #57).
 * Solo en modo salida:
 *   1) regla comisionable activa en modalidad `base_neta_impuestos_al_final`
 *      con tarifa de proveedor cargada en alguna salida;
 *   2) alguna salida sin noches cuando el programa cobra asistencia médica.
 */
export function precioEnRevision(p: ProgramaParaRevision, salidas: readonly SalidaParaRevision[]): boolean {
  if (p.modo_precio !== "salida") return false;
  const modalidadNueva = p.regla_comisionable === true && p.regla_comisionable_modalidad_mk === "base_neta_impuestos_al_final";
  if (modalidadNueva && salidas.some(conTarifa)) return true;
  const conAsistencia = (Number(p.asistencia_medica_dia) || 0) > 0;
  return conAsistencia && salidas.some((s) => s.noches == null);
}

export const urlVitrina = (id: number) => `/tarifario/programa/${id}`;

/**
 * Búsqueda sobre el resumen del tarifario PÚBLICO (`getProgramasResumen(sb,
 * true)`: activos, publicados y con destino fijo). Devuelve solo los campos
 * del contrato; el "Desde" se omite si la lectura vino parcial.
 */
export function filtrarProgramas(
  programas: readonly ProgramaResumen[],
  criterios: CriteriosBusqueda,
  internos: ReadonlyMap<number, DatosInternosPrograma>,
  parcial: boolean
): ResultadoBusqueda {
  const tokens = normalizarTexto(criterios.texto).split(" ").filter(Boolean);
  const destino = normalizarTexto(criterios.destino);
  const presupuesto = criterios.presupuestoMaxPorPersona;
  let omitidosPorPresupuesto = 0;

  const encontrados = programas.filter((p) => {
    if (criterios.tipoTransporte && p.tipo_transporte !== criterios.tipoTransporte) return false;
    if (destino && !normalizarTexto(p.destino?.nombre).includes(destino)) return false;
    if (tokens.length) {
      const pajar = normalizarTexto([p.nombre, p.subtitulo, p.destino?.nombre, ...p.ciudades].filter(Boolean).join(" "));
      if (!tokens.every((t) => pajar.includes(t))) return false;
    }
    if (criterios.fechaSalida) {
      const d = internos.get(p.id);
      // Sin datos internos no se puede afirmar que sale en esa fecha: se excluye.
      if (!d || !puedeSalirEnFecha(d, criterios.fechaSalida)) return false;
    }
    if (presupuesto) {
      const comparable = !parcial && p.desde_pvp != null && (p.moneda ?? "").toUpperCase() === presupuesto.moneda;
      if (!comparable) {
        omitidosPorPresupuesto++;
        return false;
      }
      if ((p.desde_pvp as number) > presupuesto.monto) return false;
    }
    return true;
  });

  const limite = criterios.limite ?? LIMITE_POR_DEFECTO_BUSQUEDA;
  const resultados: ProgramaEncontrado[] = encontrados.slice(0, limite).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    subtitulo: p.subtitulo,
    destino: p.destino?.nombre ?? null,
    ciudades: [...p.ciudades],
    dias: p.dias,
    noches: p.noches,
    moneda: p.moneda,
    desde_pvp_por_persona: parcial ? null : p.desde_pvp,
    tipo_transporte: p.tipo_transporte,
    precio_en_revision: internos.get(p.id)?.precio_en_revision ?? false,
    url_vitrina: urlVitrina(p.id),
  }));

  return {
    resultados,
    total_encontrados: encontrados.length,
    truncado: encontrados.length > resultados.length,
    parcial,
    omitidos_por_presupuesto: omitidosPorPresupuesto,
  };
}

/** Un programa es consultable solo si está activo, publicado y con destino fijo. */
export function detalleConsultable(programa: { activo?: boolean | null; publicado?: boolean | null; destino_fijo_id?: number | null }): boolean {
  return programa.activo === true && programaVisibleEnPublico(programa);
}

function comidas(d: { desayuno: boolean; almuerzo: boolean; cena: boolean }): string[] {
  return [d.desayuno && "desayuno", d.almuerzo && "almuerzo", d.cena && "cena"].filter((x): x is string => !!x);
}

/**
 * Reduce el detalle del sistema a la lista blanca del contrato. Cada campo se
 * copia uno por uno: nada del programa ni de sus filas pasa por spread, así un
 * campo nuevo del esquema nunca se filtra sin que alguien lo agregue aquí.
 */
export function aDetalleConsulta(det: ProgramaDetalle, revision: boolean): DetalleConsulta {
  const p = det.programa;
  const tipo = (p.tipo_transporte as TipoTransporte | null) ?? (p.incluye_aereo ? "aereo" : "ninguno");
  const precioCategoria = (pr: ProgramaDetalle["categorias"][number]["precios"][number]): PrecioPorPersona =>
    pr.bajo_solicitud || pr.pvp == null ? { acomodacion: pr.acomodacion, a_solicitud: true } : { acomodacion: pr.acomodacion, pvp_por_persona: pr.pvp };

  return {
    id: p.id,
    nombre: p.nombre,
    subtitulo: p.subtitulo,
    destino: det.destinoFijo?.nombre ?? null,
    tipo_transporte: TIPOS_TRANSPORTE.includes(tipo) ? tipo : "ninguno",
    dias: p.dias,
    noches: p.noches,
    moneda: p.moneda,
    vigencia: { desde: p.vigencia_desde, hasta: p.vigencia_hasta },
    salidas_texto: p.salidas,
    highlights: [...(p.highlights ?? [])],
    ciudades: det.ciudades.map((c) => ({ nombre: c.nombre, noches: c.noches, alojamiento_previsto: c.alojamiento_previsto })),
    itinerario: det.dias.map((d) => ({ dia: d.dia, titulo: d.titulo, comidas: comidas(d), descripcion: d.descripcion })),
    modo_precio: p.modo_precio === "salida" ? "salida" : "categoria",
    categorias: det.categorias.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      hoteles: c.hoteles.map((h) => ({ ciudad: h.ciudad, hotel: h.hotel })),
      precios: c.precios.map(precioCategoria),
    })),
    salidas: det.salidas.map((s) => ({
      id: s.id,
      etiqueta: s.etiqueta,
      fecha_desde: s.fecha_desde,
      fecha_hasta: s.fecha_hasta,
      noches: s.noches,
      columna: s.columna,
      a_solicitud: s.bajo_solicitud,
      precios: s.bajo_solicitud
        ? []
        : s.precios.filter((pr) => pr.pvp != null).map((pr) => ({ acomodacion: pr.acomodacion, pvp_por_persona: pr.pvp as number })),
    })),
    incluye: det.inclusiones.filter((i) => i.tipo === "incluye").map((i) => ({ ciudad: i.ciudad, texto: i.texto })),
    no_incluye: det.inclusiones.filter((i) => i.tipo === "no_incluye").map((i) => ({ ciudad: i.ciudad, texto: i.texto })),
    tours: det.tours.map((t) => ({
      nombre: t.nombre,
      ciudad: t.ciudad,
      // `getProgramaDetalle` ya publica el tour con markup y fee (sin asistencia).
      pvp_por_persona: t.precio != null && t.precio > 0 ? t.precio : null,
      min_pax_tour: t.min_pax,
      dias_operacion: t.dias_operacion,
      descripcion: t.descripcion,
    })),
    blackouts: det.blackouts.map((b) => ({ desde: b.fecha_inicio, hasta: b.fecha_fin, motivo: b.motivo })),
    edades: { nino_min: p.edad_nino_min, nino_max: p.edad_nino_max, infante_max: p.edad_infante_max },
    condiciones: {
      pago: { tipo: p.condicion_pago_tipo, pct_inicial: p.condicion_pago_pct_inicial, dias_saldo: p.condicion_pago_dias_saldo },
      restriccion_comercial: p.restriccion_comercial,
      texto_condiciones: p.texto_condiciones,
      texto_cancelacion: p.texto_cancelacion,
      texto_pagos: p.texto_pagos,
    },
    precio_en_revision: revision,
    url_vitrina: urlVitrina(p.id),
  };
}

/** Fila mínima del catálogo de agencias (nunca datos bancarios ni documento). */
export type FilaAgencia = { id: number; nombre: string; tipo: string | null; pct_comision: number | null };

/**
 * % PROPIO de la agencia elegida. Si su ficha no tiene %, se dice así: nunca
 * se usa ni se inventa el porcentaje general.
 */
export function resolverPorcentajeAgencia(fila: FilaAgencia | null): PorcentajeAgencia {
  if (!fila) return { estado: "no_encontrada" };
  const agencia: AgenciaResumen = { id: fila.id, nombre: fila.nombre, tipo: fila.tipo };
  const pct = fila.pct_comision;
  if (pct == null) return { estado: "sin_pct_propio", agencia };
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0 || n > 1) return { estado: "pct_invalido", agencia };
  return { estado: "propio", agencia, pct: n };
}
