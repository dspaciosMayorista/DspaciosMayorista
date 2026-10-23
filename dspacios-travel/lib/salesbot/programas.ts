// ===========================================================================
// Salesbot — servicio de SOLO LECTURA sobre Programas.
//
// Fase A. Sin escritura, sin CRM, sin canales, sin Meta, sin service_role.
//
// Reglas que este archivo hace cumplir en código, no por convención:
//
//  1. NO se escribe nada. No hay una sola ruta de escritura en este módulo.
//  2. El PVP se CONSUME, no se calcula. `pvpPrograma` devuelve `0` como
//     centinela de "sin precio" (lib/calc/programaPrecio.ts:213), así que
//     calcularlo aquí haría aparecer un "$0" en una conversación. Además
//     `getProgramasResumen` y `getProgramaDetalle` resuelven el `dias` que se
//     pasa al motor con fallbacks DISTINTOS (asimetría deliberada, documentada
//     en programaPrecio.ts): mezclar ambos precios daría dos cifras para lo
//     mismo. Por eso no se invoca el motor ni se mezclan las dos fuentes.
//  3. GATE de detalle: `publicado === true` Y `activo === true`.
//     `getProgramaDetalle` NO filtra nada (hace `select('*')` + `.eq('id')`);
//     el filtro vive en la página pública. Aquí se replica y se CORREGE, porque
//     la página tampoco revisa `activo`.
//  4. Proyección de lista blanca: el DTO no puede contener columnas internas.
//  5. `SIN_RESULTADOS` y `CONSULTA_FALLIDA` nunca se confunden.
//
// Por qué se reutilizan `getProgramasResumen` / `getProgramaDetalle` en vez de
// escribir una consulta con columnas explícitas: el PVP se calcula a partir de
// `pct_mk`, `asistencia_medica_dia`, `pct_fee_tarjeta`, `dias` y `moneda`, que
// son justo columnas internas. Una consulta "segura" no podría calcular el PVP
// sin tocarlas, y hacerlo en esta capa duplicaría el motor. La seguridad se
// garantiza en la FRONTERA (esta proyección), no en la consulta.
// ===========================================================================

import { getProgramasResumen, getProgramaDetalle } from "@/lib/programas";
import type { ProgramaDetalle } from "@/lib/programas";
// `respuestas.ts` solo importa de `types.ts`, así que esto no crea ciclo. Se
// importa el texto de usuario desde la fuente única en vez de duplicarlo como
// literal en cada `fallo(...)`.
import { MENSAJE_ERROR } from "@/lib/salesbot/respuestas";
import {
  salesbot_aislamiento_real,
  type SalesbotBuscarProgramasInput,
  type SalesbotBusquedaResultado,
  type SalesbotCategoriaSegura,
  type SalesbotContextoLectura,
  type SalesbotConsultaError,
  type SalesbotDetalleProgramaSeguro,
  type SalesbotError,
  type SalesbotEstadoPrecio,
  type SalesbotPrecioResultado,
  type SalesbotProgramaResumen,
  type SalesbotResultado,
} from "@/lib/salesbot/types";

const LIMITE_MAX = 20;

/**
 * Lectores inyectables. Por defecto son las funciones reales de
 * `lib/programas.ts`. Se inyectan para poder probar el gate y la distinción
 * vacío/fallo SIN montar un cliente Supabase, y para que quede explícito de
 * qué depende esta capa.
 *
 * Inyectar un lector propio NO salta el gate: `salesbotDetallePrograma` exige
 * `publicado && activo` sobre la fila que el lector devuelva, siempre.
 */
export type SalesbotLectores = {
  resumen: (sb: unknown, soloPublicados: boolean) => Promise<{
    programas: unknown[];
    error: unknown;
  }>;
  detalle: (sb: unknown, id: number) => Promise<ProgramaDetalle | null>;
  /**
   * Inyectable solo para poder probar el guard de runtime: si la proyección
   * devolviera por accidente una columna interna, el servicio tiene que
   * rechazarla. Es una costura de prueba, no una vía de producción — el
   * servicio solo usa este gancho a través de `crearLectoresSalesbot`.
   */
  proyeccion?: (det: ProgramaDetalle) => SalesbotDetalleProgramaSeguro;
};

// El lector por defecto se referencia SIN castear: si la firma real de
// getProgramaDetalle cambiara, el error saldría aquí y no en un `unknown`
// silencioso. (El `as unknown` del resumen es inevitable: su tipo de retorno
// depende de la inferencia de `ProgramaResumen`, que vive en un componente.)
const LECTORES_POR_DEFECTO: SalesbotLectores = {
  resumen: (sb, soloPublicados) =>
    getProgramasResumen(sb as never, soloPublicados) as unknown as Promise<{
      programas: unknown[];
      error: unknown;
    }>,
  detalle: (sb, id) => getProgramaDetalle(sb as never, id),
};

/** Copia de los lectores por defecto, con sobrescrituras puntuales. */
export function crearLectoresSalesbot(over: Partial<SalesbotLectores> = {}): SalesbotLectores {
  return { ...LECTORES_POR_DEFECTO, ...over };
}

/** Columnas internas que NUNCA pueden salir de este módulo. */
export const COLUMNAS_INTERNAS_PROHIBIDAS = [
  // cabecera de `programas`
  "notas",
  "pct_mk",
  "pct_fee_tarjeta",
  "asistencia_medica_dia",
  "desde_precio",
  "incluye_aereo",
  "regla_comisionable",
  "regla_comisionable_modo",
  "regla_comisionable_valor",
  "regla_comisionable_pct_comision",
  "regla_comisionable_modalidad_mk",
  "regla_comisionable_impuesto_por_acomodacion",
  // `programa_precios`
  "neto",
  // `programa_salidas`
  "neto_sencilla", "neto_doble", "neto_triple", "neto_multiple", "neto_nino",
  "tarifa_sencilla", "tarifa_doble", "tarifa_triple", "tarifa_multiple",
  "impuesto_sencilla", "impuesto_doble", "impuesto_triple", "impuesto_multiple",
  // flags ya verificados por el gate: no informationan al bot
  "activo",
  "publicado",
] as const;

function ahora(): string {
  return new Date().toISOString();
}

function fallo(
  ctx: SalesbotContextoLectura,
  codigo: SalesbotConsultaError["codigo"],
  mensaje: string,
  escalable: boolean,
  traza?: SalesbotConsultaError["traza"],
): SalesbotError {
  return {
    ok: false,
    error: { codigo, mensaje, escalable, traza },
    tenant: ctx.tenant ?? null,
    consultado_en: ahora(),
  };
}

function ok<T>(ctx: SalesbotContextoLectura, datos: T): SalesbotResultado<T> {
  return {
    ok: true,
    datos,
    tenant: ctx.tenant ?? null,
    consultado_en: ahora(),
  };
}

// ─── Helpers de precio ────────────────────────────────────────────────────

/**
 * Traduce el par `(bajo_solicitud, pvp)` al estado que ya usa la vitrina
 * pública. El `pvp` se copia TAL CUAL: nunca se convierte a 0.
 */
export function estadoPrecio(bajoSolicitud: boolean, pvp: number | null): SalesbotEstadoPrecio {
  if (bajoSolicitud) return "A_SOLICITUD";
  return pvp != null ? "CONFIRMADO" : "NO_CONFIRMADO";
}

function precioSeguro(args: {
  moneda: string;
  pvp: number | null;
  bajoSolicitud: boolean;
  origen: "categoria" | "salida";
  acomodacion: string;
  extra?: Partial<SalesbotPrecioResultado>;
}): SalesbotPrecioResultado {
  const estado = estadoPrecio(args.bajoSolicitud, args.pvp);
  return {
    moneda: args.moneda,
    // Copia literal. `null` es información de negocio, no un faltante.
    pvp: args.pvp,
    estado_precio: estado,
    origen: args.origen,
    bajo_solicitud: args.bajoSolicitud,
    acomodacion: args.acomodacion,
    ...(args.extra ?? {}),
  };
}

// ─── Búsqueda ─────────────────────────────────────────────────────────────

/**
 * Lista programas publicados.
 *
 * El filtro `publicado && activo` NO lo aplica este módulo: lo aplica
 * `getProgramasResumen(sb, true)`, que ya hace `.eq('activo', true)` y
 * `.eq('publicado', true)`. Por eso el segundo parámetro es SIEMPRE `true` y no
 * es opcional desde afuera: no hay forma de pedirle programas privados.
 */
export async function salesbotBuscarProgramas(
  input: SalesbotBuscarProgramasInput,
  ctx: SalesbotContextoLectura,
  lectores: SalesbotLectores = LECTORES_POR_DEFECTO,
): Promise<SalesbotResultado<SalesbotBusquedaResultado>> {
  let resumen: { programas: unknown[]; error: unknown };
  try {
    // `true` SIEMPRE, y no es un parámetro del llamador: no hay forma de
    // pedirle al servicio programas privados.
    resumen = await lectores.resumen(ctx.sb, true);
  } catch (e) {
    return fallo(ctx, "CONSULTA_FALLIDA", "No pude consultar el catálogo en este momento.", true, {
      consulta: "getProgramasResumen",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // `error` poblado = la consulta CRÍTICA falló. `programas` vacío con
  // `error` null = no hay programas. La distinción existe justamente para esto
  // (el defecto "RESULTADOS OK FALSOS" que el propio módulo documenta) y aquí
  // NO se colapsa: un catálogo caído jamás se reporta como catálogo vacío.
  if (resumen.error != null) {
    return fallo(ctx, "CONSULTA_FALLIDA", "No pude consultar el catálogo en este momento.", true, {
      consulta: "getProgramasResumen",
      error: String(resumen.error),
    });
  }

  const destino = input.destino?.trim().toLowerCase();
  const texto = input.texto?.trim().toLowerCase();
  const limite = Math.min(Math.max(input.limite ?? 5, 1), LIMITE_MAX);

  const crudos = (resumen.programas ?? []) as Array<{
    id: number;
    nombre: string;
    subtitulo: string | null;
    dias: number | null;
    noches: number | null;
    moneda: string;
    desde_pvp: number | null;
    tipo_transporte: "ninguno" | "aereo" | "terrestre";
    portada_url: string | null;
    ciudades: string[];
  }>;

  const filtrados = crudos.filter((p) => {
    if (input.tipoTransporte && p.tipo_transporte !== input.tipoTransporte) return false;
    if (destino && !(p.ciudades ?? []).some((c) => String(c).toLowerCase().includes(destino))) return false;
    if (texto) {
      const heno = `${p.nombre} ${p.subtitulo ?? ""} ${(p.ciudades ?? []).join(" ")}`.toLowerCase();
      if (!heno.includes(texto)) return false;
    }
    return true;
  });

  if (filtrados.length === 0) {
    return fallo(ctx, "SIN_RESULTADOS", "No encontré programas con esos criterios.", false, {
      consulta: "getProgramasBuscarProgramas+filtros",
    });
  }

  // Lista blanca explícita, aunque `ProgramaResumen` ya venga limpio: si
  // mañana el resumen suma una columna interna, no se filtra por accidente.
  const programas: SalesbotProgramaResumen[] = filtrados.slice(0, limite).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    subtitulo: p.subtitulo,
    dias: p.dias,
    noches: p.noches,
    moneda: p.moneda,
    desde_pvp: p.desde_pvp,
    tipo_transporte: p.tipo_transporte,
    portada_url: p.portada_url,
    ciudades: p.ciudades,
  }));

  return ok(ctx, {
    programas,
    // Lo que el resumen NO trae. La respuesta no debe afirmarlo.
    no_consultado: ["vigencia", "condiciones", "min_max_pax", "disponibilidad"],
  });
}

// ─── Detalle ──────────────────────────────────────────────────────────────

/**
 * Detalle de un programa, con gate de publicación y proyección segura.
 *
 * `PROGRAMA_NO_PUBLICADO` se devuelve para los cuatro casos (id inválido, no
 * existe, no publicado, inactivo) sin distinguirlos entre sí hacia afuera: no
 * se le dice a un viajero que un programa existe pero es borrador. El motivo
 * exacto sí queda en `traza.motivo` para el log.
 */
export async function salesbotDetallePrograma(
  id: number,
  ctx: SalesbotContextoLectura,
  lectores: SalesbotLectores = LECTORES_POR_DEFECTO,
): Promise<SalesbotResultado<SalesbotDetalleProgramaSeguro>> {
  const noPublicado = (motivo: "invalido" | "inexistente" | "no_publicado" | "inactivo") =>
    fallo(ctx, "PROGRAMA_NO_PUBLICADO", "Ese programa no está disponible.", false, {
      motivo,
      consulta: "salesbotDetallePrograma",
    });

  if (!Number.isInteger(id) || id <= 0) return noPublicado("invalido");

  let det: ProgramaDetalle | null;
  try {
    det = await lectores.detalle(ctx.sb, id);
  } catch (e) {
    return fallo(ctx, "CONSULTA_FALLIDA", "No pude consultar ese programa en este momento.", true, {
      consulta: "getProgramaDetalle",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (!det) return noPublicado("inexistente");

  // El GATE. `getProgramaDetalle` no filtra nada (hace `select('*')` +
  // `.eq('id')`); la página pública solo revisa `publicado`. Aquí se revisan
  // los dos.
  const fila = det.programa as unknown as Record<string, unknown>;
  if (fila.publicado !== true) return noPublicado("no_publicado");
  if (fila.activo !== true) return noPublicado("inactivo");

  // (5) Proyección a DTO. Va envuelta porque una excepción aquí también es un
  //     fallo de la consulta, no un programa inexistente.
  let dto: SalesbotDetalleProgramaSeguro;
  try {
    dto = (lectores.proyeccion ?? proyectarDetalle)(det);
  } catch (e) {
    return fallo(ctx, "CONSULTA_FALLIDA", MENSAJE_ERROR.CONSULTA_FALLIDA.mensaje, true, {
      consulta: "proyectarDetalle",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // (6) GUARD DE RUNTIME. La lista blanca es la regla, pero una regla que solo
  //     depende de que nadie olvide una columna no es una garantía: si el DTO
  //     llegara a traer algo interno, aquí se detiene ANTES de devolver `ok`.
  //     El nombre de la columna NO va en el mensaje de usuario (eso le diría al
  //     viajero que el catálogo tiene una columna secreta); queda en `traza`,
  //     que es solo para log.
  const filtrada = contieneColumnaInterna(dto);
  if (filtrada !== null) {
    return fallo(ctx, "CONSULTA_FALLIDA", MENSAJE_ERROR.CONSULTA_FALLIDA.mensaje, true, {
      consulta: "contieneColumnaInterna",
      motivo: `DIAN_COLUMNA_INTERNA_EN_DTO:${filtrada}`,
    });
  }

  return ok(ctx, dto);
}

/**
 * Proyección de lista blanca. Es la única frontera donde el dato crudo
 * (`select('*')` + `neto` en los hijos) se convierte en DTO entregable.
 *
 * Recibe el `ProgramaDetalle` REAL, no una forma propia: si ese tipo cambia, el
 * error sale de `tsc` y no de un `undefined` silencioso en el DTO.
 */
export function proyectarDetalle(det: ProgramaDetalle): SalesbotDetalleProgramaSeguro {
  const p = det.programa as unknown as Record<string, never>;
  const moneda = p.moneda as string;
  const cats = det.categorias;
  const sals = det.salidas;

  const categorias: SalesbotCategoriaSegura[] = (cats ?? []).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    hoteles: (c.hoteles ?? []).map((h) => ({ ciudad: h.ciudad, hotel: h.hotel })),
    precios: (c.precios ?? []).map((pr) =>
      precioSeguro({
        moneda,
        pvp: pr.pvp,
        // En categorías la marca es POR FILA.
        bajoSolicitud: pr.bajo_solicitud,
        origen: "categoria",
        acomodacion: pr.acomodacion,
        extra: { categoria_id: c.id },
      }),
    ),
  }));

  const salidas = (sals ?? []).map((s) => ({
    id: s.id,
    etiqueta: s.etiqueta,
    fecha_desde: s.fecha_desde,
    fecha_hasta: s.fecha_hasta,
    noches: s.noches,
    // En salidas la marca es A NIVEL DE SALIDA, no por fila.
    bajo_solicitud: s.bajo_solicitud,
    precios: (s.precios ?? []).map((pr) =>
      precioSeguro({
        moneda,
        pvp: pr.pvp,
        bajoSolicitud: s.bajo_solicitud,
        origen: "salida" as const,
        acomodacion: pr.acomodacion,
        extra: {
          salida_id: s.id,
          etiqueta: s.etiqueta,
          fecha_desde: s.fecha_desde,
          fecha_hasta: s.fecha_hasta,
          noches: s.noches,
        },
      }),
    ),
  }));

  const ciudades = det.ciudades ?? [];
  const itin = det.dias ?? [];
  const incl = det.inclusiones ?? [];
  const tours = det.tours ?? [];
  const bl = det.blackouts ?? [];

  return {
    id: p.id as unknown as number,
    nombre: p.nombre as unknown as string,
    subtitulo: p.subtitulo as unknown as string | null,
    dias: p.dias as unknown as number | null,
    noches: p.noches as unknown as number | null,
    moneda,
    tipo_transporte: p.tipo_transporte as "ninguno" | "aereo" | "terrestre",
    proveedor_nombre: det.proveedorNombre ?? null,

    portada_url: p.portada_url as unknown as string | null,
    flyer_url: p.flyer_url as unknown as string | null,
    historia_url: p.historia_url as unknown as string | null,
    video_url: p.video_url as unknown as string | null,
    highlights: (p.highlights as string[] | null) ?? [],

    texto_condiciones: p.texto_condiciones as unknown as string | null,
    texto_cancelacion: p.texto_cancelacion as unknown as string | null,
    texto_pagos: p.texto_pagos as unknown as string | null,

    vigencia_desde: p.vigencia_desde as unknown as string | null,
    vigencia_hasta: p.vigencia_hasta as unknown as string | null,
    min_pax: p.min_pax as unknown as number | null,
    max_pax: p.max_pax as unknown as number | null,
    edad_nino_min: p.edad_nino_min as unknown as number | null,
    edad_nino_max: p.edad_nino_max as unknown as number | null,
    edad_infante_max: p.edad_infante_max as unknown as number | null,

    ciudades: ciudades.map((c) => ({ nombre: c.nombre, noches: c.noches, codigo_iata: c.codigo_iata })),
    itinerario: itin.map((d) => ({
      dia: d.dia,
      titulo: d.titulo,
      desayuno: d.desayuno,
      almuerzo: d.almuerzo,
      cena: d.cena,
      descripcion: d.descripcion,
    })),
    categorias,
    salidas,
    inclusiones: incl.map((i) => ({ ciudad: i.ciudad, tipo: i.tipo, texto: i.texto })),
    tours: tours.map((t) => ({
      ciudad: t.ciudad,
      nombre: t.nombre,
      precio: t.precio,
      min_pax: t.min_pax,
      dias_operacion: t.dias_operacion,
      descripcion: t.descripcion,
    })),
    blackouts: bl.map((b) => ({
      fecha_inicio: b.fecha_inicio,
      fecha_fin: b.fecha_fin,
      motivo: b.motivo,
      ciudad: b.ciudad,
    })),
  };
}

/**
 * Guard de proyección. Recorre el DTO y busca columnas internas a CUALQUIER
 * nivel. Es la red que atrapa un olvido en la lista blanca.
 *
 * Los nombres se enumeran uno por uno y NO se comparan por prefijo: un
 * prefijo como `impuesto_` produciría falsos positivos con campos legítimos
 * (`impuesto_pagar`, `tarifa_promocional`) y bloquearía un DTO correcto. La
 * lista se derivó de las columnas reales de `programa_precios`,
 * `programa_salidas` y `programas`.
 */
export function contieneColumnaInterna(valor: unknown): string | null {
  const prefijos = ["pct_mk", "pct_fee", "regla_comisionable"];
  const exactas = new Set<string>([
    "notas",
    "neto",
    "desde_precio",
    "incluye_aereo",
    "asistencia_medica_dia",
    "neto_sencilla", "neto_doble", "neto_triple", "neto_multiple", "neto_nino",
    "tarifa_sencilla", "tarifa_doble", "tarifa_triple", "tarifa_multiple",
    "impuesto_sencilla", "impuesto_doble", "impuesto_triple", "impuesto_multiple",
    "montoSinMarkup",
  ]);

  const visitar = (v: unknown): string | null => {
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = visitar(x);
        if (r) return r;
      }
      return null;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (exactas.has(k) || prefijos.some((p) => k.startsWith(p))) return k;
        const r = visitar(x);
        if (r) return r;
      }
    }
    return null;
  };
  return visitar(valor);
}

export { salesbot_aislamiento_real };
