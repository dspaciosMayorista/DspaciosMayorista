import "server-only";

// Lectura de servidor de la consulta de PAQUETES (#56): bloqueo y porción
// terrestre. Solo lee y solo a través de los motores vigentes de venta, sin
// editarlos: `cargarDatosTarifario`, `computarReserva`, `buscarHoteles` y
// `cotizarPorFechas`. No tiene código propio con service-role, no escribe, no
// llama RPC y no lee filas de `sillas` (los cupos llegan agregados por el
// cargador del tarifario).
//
// Falla CERRADO: un error técnico es `error_tecnico`, nunca un resultado vacío
// o un mensaje crudo del motor.
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { cargarDatosTarifario, type DatosTarifario } from "@/lib/tarifario/datos";
import { computarReserva } from "@/lib/reservar/computo";
import { buscarHoteles, cotizarPorFechas } from "@/lib/reservar/cotizar";
import { generarFlujoId, registrarErrorTecnico } from "@/lib/observabilidad/medicion";
import { resolverAccesoConsulta } from "@/lib/salesbot/acceso";
import { clavesProhibidasEn, crearSello, type CodigoError, type MotivoNoAutorizado, type Respuesta, type Sello } from "@/lib/salesbot/contrato";
import {
  clasificarMensajeMotor,
  type CotizacionPaquete,
  type CotizacionPorcionPorPersona,
  type OfertaBloqueo,
  type ResultadoBusquedaBloqueos,
  type ResultadoBusquedaPorcion,
} from "@/lib/salesbot/paquetes/contrato";
import {
  buscarEnOfertas,
  cargoFueraDeLineas,
  disponibilidadVuelo,
  entradaComputoBloqueo,
  ofertaDeSeleccion,
  ofertasBloqueo,
  resolverCotizacion,
  validarCriteriosBloqueos,
  validarSeleccionBloqueo,
} from "@/lib/salesbot/paquetes/bloqueo";
import {
  aCotizacionPorPersona,
  aResultadoBusquedaPorcion,
  destinosPorcion,
  entradaBuscarHoteles,
  entradaComputoPorcion,
  porcionPublicada,
  sugerenciasPublicas,
  validarConsultaPorcion,
  validarSeleccionPorcion,
} from "@/lib/salesbot/paquetes/porcion";

const FLUJO = "salesbot_paquetes";
const MENSAJE_ERROR_TECNICO = "No fue posible consultar en este momento. Intenta de nuevo o consulta al asesor.";

/** Mismos motivos que la consulta de Programas (`resolverAccesoConsulta`), con texto para todos los productos. */
export const MENSAJE_NO_AUTORIZADO_PAQUETES: Record<MotivoNoAutorizado, string> = {
  sin_sesion: "Inicia sesión para consultar.",
  usuario_inactivo: "Tu usuario está inactivo.",
  rol_no_permitido: "Tu rol no tiene acceso a la consulta comercial.",
  agencia_no_permitida: "La consulta comercial opera solo en Mayorista. Cambia la agencia activa.",
};

type SB = Awaited<ReturnType<typeof createClient>>;

/** Contexto de una consulta: sesión autorizada y el catálogo vigente, leído UNA vez por petición. */
export type ContextoPaquetes = { sb: SB; datos: DatosTarifario; flujoId: string };

type Entrada = Record<string, string | undefined>;

function fallo<T>(fuente: Sello["fuente"], codigo: CodigoError, motivo?: string, campos?: string[]): Respuesta<T> {
  return { ok: false, codigo, sello: crearSello(fuente), ...(motivo ? { motivo } : {}), ...(campos ? { campos } : {}) };
}

/** Defensa final: si una salida trae una clave prohibida, se responde error, nunca el dato. */
function salidaLimpia(flujoId: string, etapa: string, datos: unknown): boolean {
  const halladas = clavesProhibidasEn(datos);
  if (halladas.length) {
    registrarErrorTecnico(FLUJO, flujoId, etapa, "clave_prohibida_en_salida", new Error(halladas.join(", ")));
    return false;
  }
  return true;
}

/**
 * Autoriza (mismos roles y agencia que la consulta de Programas) y carga el
 * catálogo vigente del tarifario. Sin service-role el cargador no verifica la
 * vigencia de compra ni los cupos: se falla cerrado.
 */
export async function prepararConsultaPaquetes(): Promise<{ ok: true; ctx: ContextoPaquetes } | { ok: false; codigo: "no_autorizado" | "error_tecnico"; motivo: string }> {
  const flujoId = generarFlujoId();
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, codigo: "no_autorizado", motivo: MENSAJE_NO_AUTORIZADO_PAQUETES.sin_sesion };
  const { data: perfil, error } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (error) {
    registrarErrorTecnico(FLUJO, flujoId, "contexto", "error_consulta_perfil", error);
    return { ok: false, codigo: "error_tecnico", motivo: MENSAJE_ERROR_TECNICO };
  }
  const acceso = resolverAccesoConsulta(perfil ? { rol: (perfil.rol as string | null) ?? null, activo: perfil.activo } : null, await getTenant());
  if (!acceso.ok) return { ok: false, codigo: "no_autorizado", motivo: MENSAJE_NO_AUTORIZADO_PAQUETES[acceso.motivo] };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    registrarErrorTecnico(FLUJO, flujoId, "contexto", "sin_llave_servidor_para_vigencia_y_cupos", new Error("SUPABASE_SERVICE_ROLE_KEY no configurada"));
    return { ok: false, codigo: "error_tecnico", motivo: MENSAJE_ERROR_TECNICO };
  }
  const carga = await cargarDatosTarifario(sb, FLUJO, flujoId);
  if (!carga.ok) return { ok: false, codigo: "error_tecnico", motivo: MENSAJE_ERROR_TECNICO };
  return { ok: true, ctx: { sb, datos: carga.datos, flujoId } };
}

type LecturaMarkup = { ok: true; pct: number } | { ok: false };

/**
 * Lee, con la SESIÓN, la MISMA columna que `computarReserva` usa para el
 * markup (`armado_paquetes.pct_mk`, `computo.ts:348`) y la normaliza igual
 * que el motor (`Number(...) || 0`). El motor ignora el error de esa lectura y
 * sigue con 0 (H-PQ1); aquí un error o una fila invisible es "no confiable".
 * El valor nunca sale de este módulo.
 */
async function leerMarkupSesion(ctx: ContextoPaquetes, paqueteId: number): Promise<LecturaMarkup> {
  const { data, error } = await ctx.sb.from("armado_paquetes").select("pct_mk").eq("id", paqueteId).maybeSingle();
  if (error) {
    registrarErrorTecnico(FLUJO, ctx.flujoId, "markup_sesion", "error_lectura_pct_mk", error);
    return { ok: false };
  }
  if (!data) return { ok: false };
  return { ok: true, pct: Number((data as { pct_mk: unknown }).pct_mk) || 0 };
}

/**
 * `computarReserva` entre dos lecturas del markup con la misma sesión. Solo
 * cuando el total trae un cargo fuera de las líneas por persona (servicios
 * incluidos por grupo, lo único que el bot pide que dependa de ese %) importa
 * si el motor lo leyó bien: se exige que la lectura previa y la posterior
 * funcionen y coincidan. No elimina del todo el riesgo de que falle SOLO la
 * lectura interna del motor; ese arreglo es del motor (frente H-PQ1).
 */
async function computarConMarkupVerificado(ctx: ContextoPaquetes, paqueteId: number, entrada: Parameters<typeof computarReserva>[1]) {
  const antes = await leerMarkupSesion(ctx, paqueteId);
  const r = await computarReserva(ctx.sb, entrada);
  const despues = r.ok && cargoFueraDeLineas(r.data) > 0 ? await leerMarkupSesion(ctx, paqueteId) : antes;
  const markupConfiable = antes.ok && despues.ok && antes.pct === despues.pct;
  return { r, markupConfiable };
}

// ── Bloqueo ──────────────────────────────────────────────────────────────

/** buscarBloqueos: oferta publicada de bloqueos con sillas libres AL CONSULTAR. */
export function buscarBloqueos(ctx: ContextoPaquetes, entrada: Entrada): Respuesta<ResultadoBusquedaBloqueos> {
  const v = validarCriteriosBloqueos(entrada);
  if (!v.ok) return fallo("buscarBloqueos", "parametros_invalidos", "Revisa los campos marcados.", v.campos);
  const res = buscarEnOfertas(ofertasBloqueo(ctx.datos.filasVisibles, ctx.datos.cuposPorBloqueo), v.criterios);
  if (!res.total_encontradas) return fallo("buscarBloqueos", "sin_resultados", "No hay bloqueos publicados que cumplan esos criterios.");
  if (!salidaLimpia(ctx.flujoId, "buscar_bloqueos", res)) return fallo("buscarBloqueos", "error_tecnico", MENSAJE_ERROR_TECNICO);
  return { ok: true, datos: res, sello: crearSello("buscarBloqueos") };
}

/** Una oferta de bloqueo visible por su clave (ya en lista blanca), para el formulario de cotización. */
export function ofertaBloqueoPorClave(ctx: ContextoPaquetes, clave: string): OfertaBloqueo | null {
  const o = ofertasBloqueo(ctx.datos.filasVisibles, ctx.datos.cuposPorBloqueo).find((x) => x.clave === clave) ?? null;
  return o && o.combos.length && salidaLimpia(ctx.flujoId, "oferta_bloqueo", o) ? o : null;
}

/** cotizarBloqueo: total orientativo del motor de venta y si las sillas libres alcanzan. */
export async function cotizarBloqueo(ctx: ContextoPaquetes, entrada: Entrada): Promise<Respuesta<CotizacionPaquete>> {
  const v = validarSeleccionBloqueo(entrada);
  if (!v.ok) return fallo("cotizarBloqueo", "parametros_invalidos", "Revisa los campos marcados.", v.campos);
  const oferta = ofertaDeSeleccion(ofertasBloqueo(ctx.datos.filasVisibles, ctx.datos.cuposPorBloqueo), v.seleccion);
  if (!oferta) return fallo("cotizarBloqueo", "no_encontrado", "Esa oferta ya no está publicada o vigente.");

  const { r, markupConfiable } = await computarConMarkupVerificado(ctx, oferta.paquete_id, entradaComputoBloqueo(oferta, v.seleccion));
  if (!r.ok) registrarErrorTecnico(FLUJO, ctx.flujoId, "cotizar_bloqueo", "computarReserva_rechazo", new Error(r.error));
  const res = resolverCotizacion(
    "bloqueo",
    { paqueteId: oferta.paquete_id, hotelId: oferta.hotel_id, categoria: v.seleccion.categoria, regimen: v.seleccion.regimen },
    r,
    disponibilidadVuelo(oferta.bloqueo_id, ctx.datos.cuposPorBloqueo),
    { markupConfiable }
  );
  if (!res.ok) return fallo("cotizarBloqueo", res.codigo, res.codigo === "error_tecnico" ? MENSAJE_ERROR_TECNICO : res.motivo);
  if (!salidaLimpia(ctx.flujoId, "cotizar_bloqueo", res.cotizacion)) return fallo("cotizarBloqueo", "error_tecnico", MENSAJE_ERROR_TECNICO);
  return { ok: true, datos: res.cotizacion, sello: crearSello("cotizarBloqueo") };
}

// ── Porción terrestre ────────────────────────────────────────────────────

/** Destinos con porción terrestre publicada (para el selector). */
export function destinosPorcionDisponibles(ctx: ContextoPaquetes): string[] {
  return destinosPorcion(ctx.datos.filasVisibles);
}

/** buscarPorcion: hoteles reliquidados en vivo para fechas y composición reales. */
export async function buscarPorcion(ctx: ContextoPaquetes, entrada: Entrada): Promise<Respuesta<ResultadoBusquedaPorcion>> {
  const v = validarConsultaPorcion(entrada, destinosPorcion(ctx.datos.filasVisibles));
  if (!v.ok) return fallo("buscarPorcion", "parametros_invalidos", "Revisa los campos marcados.", v.campos);
  const r = await buscarHoteles(entradaBuscarHoteles(v.consulta));
  if (!r.ok) {
    registrarErrorTecnico(FLUJO, ctx.flujoId, "buscar_porcion", "buscarHoteles_rechazo", new Error(r.error));
    const c = clasificarMensajeMotor(r.error);
    return c.codigo === "error_tecnico" ? fallo("buscarPorcion", "error_tecnico", MENSAJE_ERROR_TECNICO) : fallo("buscarPorcion", "no_cotizable", c.motivo);
  }
  const res = aResultadoBusquedaPorcion(r.resultados, r.sugerenciasFecha, v.consulta.limite);
  if (!res.total_encontrados && !res.sugerencias_fecha.length) return fallo("buscarPorcion", "sin_resultados", "Ningún hotel publicado cotiza para esas fechas y esa composición.");
  if (!salidaLimpia(ctx.flujoId, "buscar_porcion", res)) return fallo("buscarPorcion", "error_tecnico", MENSAJE_ERROR_TECNICO);
  return { ok: true, datos: res, sello: crearSello("buscarPorcion") };
}

export type RespuestaCotizacionPorcion =
  | Respuesta<CotizacionPorcionPorPersona>
  | { ok: false; codigo: "no_cotizable"; motivo: string; sugerencias_fecha: ReturnType<typeof sugerenciasPublicas>; sello: Sello };

/** cotizarPorcion: PVP por persona por combo y, con combo y composición, el total orientativo. */
export async function cotizarPorcion(ctx: ContextoPaquetes, entrada: Entrada): Promise<RespuestaCotizacionPorcion> {
  const v = validarSeleccionPorcion(entrada);
  if (!v.ok) return fallo("cotizarPorcion", "parametros_invalidos", "Revisa los campos marcados.", v.campos);
  const s = v.seleccion;
  if (!porcionPublicada(ctx.datos.filasVisibles, s.paqueteId, s.hotelId)) return fallo("cotizarPorcion", "no_encontrado", "Ese hotel ya no está publicado en porción terrestre.");

  const r = await cotizarPorFechas({ paqueteId: s.paqueteId, hotelId: s.hotelId, fechaIda: s.fechaIda, fechaRegreso: s.fechaRegreso });
  if (!r.ok) {
    registrarErrorTecnico(FLUJO, ctx.flujoId, "cotizar_porcion", "cotizarPorFechas_rechazo", new Error(r.error));
    const c = clasificarMensajeMotor(r.error);
    if (c.codigo === "error_tecnico") return fallo("cotizarPorcion", "error_tecnico", MENSAJE_ERROR_TECNICO);
    return { ok: false, codigo: "no_cotizable", motivo: c.motivo, sugerencias_fecha: sugerenciasPublicas(r.sugerencias), sello: crearSello("cotizarPorcion") };
  }

  let cotizacion: CotizacionPaquete | null = null;
  if (s.categoria && s.regimen && s.composicion) {
    const { r: comp, markupConfiable } = await computarConMarkupVerificado(
      ctx,
      s.paqueteId,
      entradaComputoPorcion({ ...s, categoria: s.categoria, regimen: s.regimen, composicion: s.composicion })
    );
    if (!comp.ok) registrarErrorTecnico(FLUJO, ctx.flujoId, "cotizar_porcion_total", "computarReserva_rechazo", new Error(comp.error));
    const res = resolverCotizacion("porcion_terrestre", { paqueteId: s.paqueteId, hotelId: s.hotelId, categoria: s.categoria, regimen: s.regimen }, comp, null, { markupConfiable });
    if (!res.ok) return fallo("cotizarPorcion", res.codigo, res.codigo === "error_tecnico" ? MENSAJE_ERROR_TECNICO : res.motivo);
    cotizacion = res.cotizacion;
  }

  const datos = aCotizacionPorPersona(s, r, cotizacion);
  if (!salidaLimpia(ctx.flujoId, "cotizar_porcion", datos)) return fallo("cotizarPorcion", "error_tecnico", MENSAJE_ERROR_TECNICO);
  return { ok: true, datos, sello: crearSello("cotizarPorcion") };
}
