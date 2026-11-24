import "server-only";

// Lectura de servidor de la consulta interna de programas (#56). Solo lee:
// nunca inserta, actualiza, borra ni llama RPC. Usa la sesión del usuario (no
// `service_role`); la decisión de acceso, los filtros y la lista blanca son
// funciones puras de `acceso.ts` / `consulta.ts`.
//
// Falla CERRADO: cualquier error técnico devuelve `error_tecnico`, nunca un
// resultado vacío o incompleto presentado como bueno.
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { getProgramasResumen, getProgramaDetalleSeguro } from "@/lib/programas";
import { generarFlujoId, registrarErrorTecnico } from "@/lib/observabilidad/medicion";
import { MENSAJE_NO_AUTORIZADO, resolverAccesoConsulta } from "@/lib/salesbot/acceso";
import {
  clavesProhibidasEn,
  crearSello,
  type AgenciaResumen,
  type DetalleConsulta,
  type PorcentajeAgencia,
  type Respuesta,
  type ResultadoBusqueda,
  type Sello,
} from "@/lib/salesbot/contrato";
import {
  aDetalleConsulta,
  detalleConsultable,
  filtrarProgramas,
  precioEnRevision,
  resolverPorcentajeAgencia,
  validarCriterios,
  type DatosInternosPrograma,
  type SalidaParaRevision,
} from "@/lib/salesbot/consulta";

const FLUJO = "salesbot_consulta";
const MENSAJE_ERROR_TECNICO = "No fue posible consultar los programas en este momento. Intenta de nuevo o consulta al asesor.";

type SB = Awaited<ReturnType<typeof createClient>>;

function fallo<T>(sello: Sello, codigo: "no_autorizado" | "parametros_invalidos" | "sin_resultados" | "no_encontrado" | "error_tecnico", motivo?: string, campos?: string[]): Respuesta<T> {
  return { ok: false, codigo, sello, ...(motivo ? { motivo } : {}), ...(campos ? { campos } : {}) };
}

async function contexto(flujoId: string): Promise<{ ok: true; sb: SB } | { ok: false; codigo: "no_autorizado" | "error_tecnico"; motivo: string }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, codigo: "no_autorizado", motivo: MENSAJE_NO_AUTORIZADO.sin_sesion };
  const { data: perfil, error } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (error) {
    registrarErrorTecnico(FLUJO, flujoId, "contexto", "error_consulta_perfil", error);
    return { ok: false, codigo: "error_tecnico", motivo: MENSAJE_ERROR_TECNICO };
  }
  const tenant = await getTenant();
  const acceso = resolverAccesoConsulta(perfil ? { rol: (perfil.rol as string | null) ?? null, activo: perfil.activo } : null, tenant);
  if (!acceso.ok) return { ok: false, codigo: "no_autorizado", motivo: MENSAJE_NO_AUTORIZADO[acceso.motivo] };
  return { ok: true, sb };
}

/** Lee TODAS las filas de una consulta por páginas, avanzando por las filas recibidas. */
async function leerPaginado<T>(
  consultar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ ok: true; filas: T[] } | { ok: false; error: unknown }> {
  const TAMANO = 500;
  const filas: T[] = [];
  let desde = 0;
  for (let vuelta = 0; vuelta < 200; vuelta++) {
    const { data, error } = await consultar(desde, desde + TAMANO - 1);
    if (error) return { ok: false, error };
    const n = data?.length ?? 0;
    if (n === 0) return { ok: true, filas };
    filas.push(...(data as T[]));
    desde += n;
  }
  return { ok: false, error: new Error("paginacion_sin_fin") };
}

/**
 * Datos internos por programa (vigencia, blackouts y marca de revisión de #57).
 * Se leen con la sesión del usuario y nunca salen en la respuesta.
 */
async function leerDatosInternos(sb: SB, ids: number[]): Promise<{ ok: true; mapa: Map<number, DatosInternosPrograma> } | { ok: false; consulta: string; error: unknown }> {
  const mapa = new Map<number, DatosInternosPrograma>();
  if (!ids.length) return { ok: true, mapa };

  const [rProgramas, rSalidas, rBlackouts] = await Promise.all([
    leerPaginado((d, h) =>
      sb
        .from("programas")
        .select("id, vigencia_desde, vigencia_hasta, modo_precio, regla_comisionable, regla_comisionable_modalidad_mk, asistencia_medica_dia")
        .in("id", ids)
        .order("id")
        .range(d, h)
    ),
    leerPaginado((d, h) =>
      sb
        .from("programa_salidas")
        .select("id, programa_id, noches, tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple")
        .in("programa_id", ids)
        .order("id")
        .range(d, h)
    ),
    leerPaginado((d, h) => sb.from("programa_blackouts").select("id, programa_id, fecha_inicio, fecha_fin").in("programa_id", ids).order("id").range(d, h)),
  ]);
  if (!rProgramas.ok) return { ok: false, consulta: "programas", error: rProgramas.error };
  if (!rSalidas.ok) return { ok: false, consulta: "programa_salidas", error: rSalidas.error };
  if (!rBlackouts.ok) return { ok: false, consulta: "programa_blackouts", error: rBlackouts.error };

  const salidasPor = new Map<number, SalidaParaRevision[]>();
  for (const s of rSalidas.filas) {
    const arr = salidasPor.get(s.programa_id) ?? [];
    arr.push(s);
    salidasPor.set(s.programa_id, arr);
  }
  const blackoutsPor = new Map<number, { fecha_inicio: string | null; fecha_fin: string | null }[]>();
  for (const b of rBlackouts.filas) {
    const arr = blackoutsPor.get(b.programa_id) ?? [];
    arr.push({ fecha_inicio: b.fecha_inicio, fecha_fin: b.fecha_fin });
    blackoutsPor.set(b.programa_id, arr);
  }
  for (const p of rProgramas.filas) {
    mapa.set(p.id, {
      vigencia_desde: p.vigencia_desde,
      vigencia_hasta: p.vigencia_hasta,
      blackouts: blackoutsPor.get(p.id) ?? [],
      precio_en_revision: precioEnRevision(p, salidasPor.get(p.id) ?? []),
    });
  }
  return { ok: true, mapa };
}

/** Defensa final: si una salida trae una clave prohibida, se responde error, nunca el dato. */
function sinClavesProhibidas(flujoId: string, etapa: string, datos: unknown): boolean {
  const halladas = clavesProhibidasEn(datos);
  if (halladas.length) {
    registrarErrorTecnico(FLUJO, flujoId, etapa, "clave_prohibida_en_salida", new Error(halladas.join(", ")));
    return false;
  }
  return true;
}

/** Operación 1: búsqueda de programas publicados. */
export async function buscarProgramas(entrada: Record<string, string | undefined>): Promise<Respuesta<ResultadoBusqueda>> {
  const flujoId = generarFlujoId();
  const ctx = await contexto(flujoId);
  if (!ctx.ok) return fallo(crearSello("buscarProgramas"), ctx.codigo, ctx.motivo);

  const validacion = validarCriterios(entrada);
  if (!validacion.ok) return fallo(crearSello("buscarProgramas"), "parametros_invalidos", "Revisa los campos marcados.", validacion.campos);

  const resumen = await getProgramasResumen(ctx.sb, true);
  if (resumen.error) registrarErrorTecnico(FLUJO, flujoId, "resumen", "error_getProgramasResumen", resumen.error);
  if (resumen.error && !resumen.programas.length) return fallo(crearSello("buscarProgramas"), "error_tecnico", MENSAJE_ERROR_TECNICO);

  const internos = await leerDatosInternos(
    ctx.sb,
    resumen.programas.map((p) => p.id)
  );
  if (!internos.ok) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_internos", `error_${internos.consulta}`, internos.error);
    return fallo(crearSello("buscarProgramas"), "error_tecnico", MENSAJE_ERROR_TECNICO);
  }

  const resultado = filtrarProgramas(resumen.programas, validacion.criterios, internos.mapa, !!resumen.error);
  const sello = crearSello("buscarProgramas");
  if (!resultado.total_encontrados) return fallo(sello, "sin_resultados", "No hay programas publicados que cumplan esos criterios.");
  if (!sinClavesProhibidas(flujoId, "busqueda", resultado)) return fallo(sello, "error_tecnico", MENSAJE_ERROR_TECNICO);
  return { ok: true, datos: resultado, sello };
}

/** Operación 2: detalle de un programa publicado. */
export async function detallePrograma(idTexto: string): Promise<Respuesta<DetalleConsulta>> {
  const flujoId = generarFlujoId();
  const ctx = await contexto(flujoId);
  if (!ctx.ok) return fallo(crearSello("detallePrograma"), ctx.codigo, ctx.motivo);

  const id = Number(idTexto);
  if (!Number.isInteger(id) || id <= 0) return fallo(crearSello("detallePrograma"), "parametros_invalidos", "El programa no es válido.", ["programa"]);

  const r = await getProgramaDetalleSeguro(ctx.sb, id);
  if (!r.ok && r.motivo === "error_tecnico") {
    registrarErrorTecnico(FLUJO, flujoId, "detalle", `error_${r.consulta}`, r.error);
    return fallo(crearSello("detallePrograma"), "error_tecnico", MENSAJE_ERROR_TECNICO);
  }
  // Misma respuesta para inexistente, borrador, sin destino o inactivo: no se revela cuál.
  if (!r.ok || !detalleConsultable(r.detalle.programa)) return fallo(crearSello("detallePrograma"), "no_encontrado", "El programa no está disponible para consulta.");

  const internos = await leerDatosInternos(ctx.sb, [id]);
  if (!internos.ok) {
    registrarErrorTecnico(FLUJO, flujoId, "datos_internos", `error_${internos.consulta}`, internos.error);
    return fallo(crearSello("detallePrograma"), "error_tecnico", MENSAJE_ERROR_TECNICO);
  }

  const datos = aDetalleConsulta(r.detalle, internos.mapa.get(id)?.precio_en_revision ?? false);
  const sello = crearSello("detallePrograma");
  if (!sinClavesProhibidas(flujoId, "detalle", datos)) return fallo(sello, "error_tecnico", MENSAJE_ERROR_TECNICO);
  return { ok: true, datos, sello };
}

/** Agencias del catálogo para elegir la audiencia B2B (solo id, nombre y tipo). */
export async function listarAgencias(): Promise<Respuesta<AgenciaResumen[]>> {
  const flujoId = generarFlujoId();
  const ctx = await contexto(flujoId);
  if (!ctx.ok) return fallo(crearSello("porcentajeAgencia"), ctx.codigo, ctx.motivo);
  const r = await leerPaginado((d, h) => ctx.sb.from("aliados").select("id, nombre, tipo").order("nombre").order("id").range(d, h));
  if (!r.ok) {
    registrarErrorTecnico(FLUJO, flujoId, "agencias", "error_aliados", r.error);
    return fallo(crearSello("porcentajeAgencia"), "error_tecnico", MENSAJE_ERROR_TECNICO);
  }
  return { ok: true, datos: r.filas.map((a) => ({ id: a.id, nombre: a.nombre, tipo: a.tipo })), sello: crearSello("porcentajeAgencia") };
}

/** Audiencia B2B: % PROPIO de la agencia elegida, sin base ni monto. */
export async function porcentajeAgencia(idTexto: string): Promise<Respuesta<PorcentajeAgencia>> {
  const flujoId = generarFlujoId();
  const ctx = await contexto(flujoId);
  if (!ctx.ok) return fallo(crearSello("porcentajeAgencia"), ctx.codigo, ctx.motivo);
  const id = Number(idTexto);
  if (!Number.isInteger(id) || id <= 0) return fallo(crearSello("porcentajeAgencia"), "parametros_invalidos", "La agencia no es válida.", ["agencia"]);
  const { data, error } = await ctx.sb.from("aliados").select("id, nombre, tipo, pct_comision").eq("id", id).maybeSingle();
  if (error) {
    registrarErrorTecnico(FLUJO, flujoId, "agencia", "error_aliados", error);
    return fallo(crearSello("porcentajeAgencia"), "error_tecnico", MENSAJE_ERROR_TECNICO);
  }
  return { ok: true, datos: resolverPorcentajeAgencia(data ?? null), sello: crearSello("porcentajeAgencia") };
}
