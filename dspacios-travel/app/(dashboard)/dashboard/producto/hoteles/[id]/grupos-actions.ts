"use server";

// #43/#60 incremento 3 — Acciones del editor de grupos de días (preparación INACTIVA).
// Cada acción hace EXACTAMENTE una llamada RPC (migración 295). No se llama `revalidatePath` ni se
// regenera el tarifario: nada de esto cambia precios ni lo que hoy se vende; el panel actualiza su
// estado con la configuración que devuelve la propia RPC. Sin reintentos: una confirmación obsoleta
// (SQLSTATE PT409) se devuelve como `desactualizada` y el usuario recarga a mano.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { esDesactualizada, mensajeErrorBase, payloadFilas, type ConfigGrupos, type FilaPropuesta, type GrupoEditado, type ModoPropuesta } from "@/lib/hoteles/alcanceGrupos";
import type { AlcanceGrupos } from "@/lib/hoteles/activacionGrupos";
import type { ResultadoRegeneracionHotel } from "@/lib/tarifario/regeneracionHotel";
import { regenerarTarifariosDeHotelAcotado } from "../../../paquetes/actions";

export type ResultadoGrupos<T = object> =
  | ({ ok: true; config: ConfigGrupos } & T)
  | { ok: false; error: string; desactualizada?: true };

type ErrorRpc = { code?: string | null; message?: string | null } | null;
function fallo(error: ErrorRpc): { ok: false; error: string; desactualizada?: true } {
  if (esDesactualizada(error)) {
    return { ok: false, desactualizada: true, error: "La configuración de esta vigencia cambió desde que la abriste. Recarga y revisa de nuevo antes de confirmar." };
  }
  return { ok: false, error: error?.message ? mensajeErrorBase(sinPrefijo(error.message)) : "No se pudo completar la operación." };
}
// Las RPC marcan algunos rechazos con un prefijo técnico (EMPATE_PRIORIDAD:, HABILITACIONES_SIN_CONFIRMAR:, …): no se muestra.
const sinPrefijo = (m: string) => m.replace(/^[A-Z][A-Z_]{5,}:\s*/, "");
const idValido = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
// Obsoleta (PT409): la RPC dice QUÉ cambió (la vigencia, la calculadora o las bases); se muestra sin el prefijo técnico.
function falloConMotivo(error: ErrorRpc): { ok: false; error: string; desactualizada?: true } {
  if (esDesactualizada(error)) {
    return { ok: false, desactualizada: true, error: sinPrefijo(error?.message ?? "") || "La configuración cambió. Recarga y revisa de nuevo." };
  }
  return fallo(error);
}

export async function leerConfigGrupos(temporadaId: number): Promise<ResultadoGrupos> {
  if (!idValido(temporadaId)) return { ok: false, error: "Vigencia no válida." };
  const sb = await createClient();
  // 297: la configuración de la 295 + las bases de calculadora de cada grupo, en la MISMA lectura.
  const { data, error } = await sb.rpc("grupos_dias_config_bases", { p_temporada_id: temporadaId });
  if (error || !data) return fallo(error);
  return { ok: true, config: data as unknown as ConfigGrupos };
}

export async function guardarGruposVigencia(temporadaId: number, huella: string, grupos: GrupoEditado[]): Promise<ResultadoGrupos<{ altas: number; cambios: number }>> {
  if (!idValido(temporadaId) || typeof huella !== "string" || !Array.isArray(grupos)) return { ok: false, error: "Datos no válidos." };
  const payload = grupos.map((g) => ({ ...(g.id ? { id: g.id } : {}), nombre: String(g.nombre ?? "").trim(), dias: (g.dias ?? []).map(Number) }));
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_guardar", { p_temporada_id: temporadaId, p_huella: huella, p_grupos: payload });
  if (error || !data) return fallo(error);
  const r = data as unknown as { altas: number; cambios: number; config: ConfigGrupos };
  return { ok: true, altas: r.altas, cambios: r.cambios, config: r.config };
}

export async function guardarPropuestaGrupos(
  temporadaId: number, huella: string, modo: ModoPropuesta, grupoId: string | null, filas: FilaPropuesta[],
): Promise<ResultadoGrupos<{ nuevas: number; actualizadas: number; eliminadas: number }>> {
  if (!idValido(temporadaId) || typeof huella !== "string" || !Array.isArray(filas)) return { ok: false, error: "Datos no válidos." };
  if (!["actualizar", "reemplazar_grupo", "reemplazar_vigencia"].includes(modo)) return { ok: false, error: "Modo no válido." };
  // El MISMO payload que describe la vista previa (lib/hoteles/alcanceGrupos.ts › payloadFilas).
  const payload = payloadFilas(filas);
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_guardar_propuesta", {
    p_temporada_id: temporadaId, p_huella: huella, p_modo: modo, p_grupo_id: modo === "reemplazar_grupo" ? grupoId : null, p_filas: payload as unknown as Json,
  });
  if (error || !data) return fallo(error);
  const r = data as unknown as { nuevas: number; actualizadas: number; eliminadas: number; config: ConfigGrupos };
  return { ok: true, nuevas: r.nuevas, actualizadas: r.actualizadas, eliminadas: r.eliminadas, config: r.config };
}

// Borra el grupo, sus propuestas y sus bases de calculadora (297). `bases` = las que mostró la vista previa:
// si hoy son otras (alguien guardó bases después de revisar), la base rechaza y no se borra nada.
export async function borrarGrupoDias(
  grupoId: string, huella: string, bases: { tipo: string; version: number }[],
): Promise<ResultadoGrupos<{ propuestasEliminadas: number; basesEliminadas: number; regeneracion?: ResultadoRegeneracionHotel }>> {
  if (typeof grupoId !== "string" || !grupoId || typeof huella !== "string" || !Array.isArray(bases)
      || bases.some((b) => typeof b?.tipo !== "string" || !Number.isInteger(b.version))) return { ok: false, error: "Datos no válidos." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_borrar_con_bases", {
    p_grupo_id: grupoId, p_huella: huella, p_bases: bases.map((b) => ({ tipo: b.tipo, version: b.version })) as unknown as Json,
  });
  if (error || !data) return falloConMotivo(error);
  const r = data as unknown as { propuestas_eliminadas: number; bases_eliminadas: number; tarifas_eliminadas?: number; config: ConfigGrupos };
  // 299: si el grupo se vendía, sus tarifas salieron de la venta: el tarifario y la ficha se actualizan una vez.
  const regeneracion = (r.tarifas_eliminadas ?? 0) > 0 ? await despuesDeCambiarLaVenta(r.config) : undefined;
  return { ok: true, propuestasEliminadas: r.propuestas_eliminadas, basesEliminadas: r.bases_eliminadas, config: r.config, regeneracion };
}

// ── 299 · Venta por grupos ─────────────────────────────────────────────────────────────────────────────
// Cambiar lo que se vende (aplicar, volver a «todos los días», borrar un grupo activo) regenera el tarifario de los
// paquetes del hotel y revalida la ficha UNA vez, igual que cualquier otra escritura de tarifas. Descartar el borrador
// no cambia precios: ni regenera ni revalida.
async function despuesDeCambiarLaVenta(config: ConfigGrupos): Promise<ResultadoRegeneracionHotel> {
  const hotelId = config?.vigencia?.hotel_id;
  if (!Number.isInteger(hotelId)) return { paquetes: null, actualizados: 0, enCurso: 0, fallidos: [] };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  // Acotada (2 paquetes a la vez) y con resultado: la pantalla dice exactamente qué quedó publicado.
  return regenerarTarifariosDeHotelAcotado(hotelId);
}

/** Alcance para revisar «Aplicar a la venta» o «Volver a todos los días»: UNA lectura; todo lo que la base exige
 *  (habilitaciones, empates, reglas de edad, sugerencias obsoletas, compra cerrada) viene calculado por ella. */
export async function leerAlcanceGrupos(temporadaId: number): Promise<{ ok: true; alcance: AlcanceGrupos } | { ok: false; error: string }> {
  if (!idValido(temporadaId)) return { ok: false, error: "Vigencia no válida." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_alcance", { p_temporada_id: temporadaId });
  if (error || !data) return fallo(error);
  return { ok: true, alcance: data as unknown as AlcanceGrupos };
}

const habilitacionValida = (h: unknown) => {
  const x = h as Record<string, unknown> | null;
  return !!x && typeof x.grupo_id === "string" && UUID.test(x.grupo_id) && typeof x.tipo_habitacion === "string"
    && typeof x.alimentacion === "string" && typeof x.acomodacion === "string";
};

export async function aplicarGruposVenta(
  temporadaId: number, huella: string, habilitaciones: { grupo_id: string; tipo_habitacion: string; alimentacion: string; acomodacion: string }[],
): Promise<ResultadoGrupos<{ resumen: Record<string, number>; regeneracion: ResultadoRegeneracionHotel }>> {
  if (!idValido(temporadaId) || typeof huella !== "string" || !Array.isArray(habilitaciones) || !habilitaciones.every(habilitacionValida)) {
    return { ok: false, error: "Datos no válidos." };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_activar", {
    p_temporada_id: temporadaId, p_huella: huella, p_habilitaciones: habilitaciones as unknown as Json,
  });
  if (error || !data) return falloConMotivo(error);
  const { config, ...resumen } = data as unknown as { config: ConfigGrupos } & Record<string, number>;
  const regeneracion = await despuesDeCambiarLaVenta(config);
  return { ok: true, config, resumen, regeneracion };
}

export async function descartarBorradorGrupos(temporadaId: number, huella: string): Promise<ResultadoGrupos> {
  if (!idValido(temporadaId) || typeof huella !== "string") return { ok: false, error: "Datos no válidos." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_descartar", { p_temporada_id: temporadaId, p_huella: huella });
  if (error || !data) return falloConMotivo(error);
  return { ok: true, config: (data as unknown as { config: ConfigGrupos }).config };
}

export async function volverATodosLosDias(
  temporadaId: number, huella: string, elecciones: { tipo_habitacion: string; alimentacion: string; grupo_id: string | null }[],
): Promise<ResultadoGrupos<{ nuevas: number; quitadas: number; regeneracion: ResultadoRegeneracionHotel }>> {
  if (!idValido(temporadaId) || typeof huella !== "string" || !Array.isArray(elecciones) || elecciones.length === 0
      || elecciones.some((e) => typeof e?.tipo_habitacion !== "string" || typeof e.alimentacion !== "string"
        || !(e.grupo_id === null || (typeof e.grupo_id === "string" && UUID.test(e.grupo_id))))) {
    return { ok: false, error: "Elige, para cada combinación, de qué grupo se conserva la tarifa (o ninguno)." };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_volver_todos", {
    p_temporada_id: temporadaId, p_huella: huella, p_elecciones: elecciones as unknown as Json,
  });
  if (error || !data) return falloConMotivo(error);
  const r = data as unknown as { por_grupo_quitadas: number; todos_los_dias_nuevas: number; config: ConfigGrupos };
  const regeneracion = await despuesDeCambiarLaVenta(r.config);
  return { ok: true, config: r.config, nuevas: r.todos_los_dias_nuevas, quitadas: r.por_grupo_quitadas, regeneracion };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const versionValida = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
// Los parámetros del grupo son solo de la FÓRMULA: una promoción o unas bases nunca viajan por aquí.
const CLAVES_PROHIBIDAS = ["promos", "bases", "bases_por_regimen"];

// #43/#60 entrega 3b — Calculadora por grupo: propuesta del grupo + sus bases + sus parámetros de la fórmula
// (null = los generales del hotel) en UNA RPC atómica (297 + 298).
// Las filas deben ser EXCLUSIVAMENTE del grupo y nunca «sugerencia aceptada»; la base lo vuelve a exigir.
// Versión de la calculadora y de las bases: si cambiaron desde que se abrió, nada se guarda (sin reintento).
export async function guardarCalculoGrupo(
  temporadaId: number, huella: string, grupoId: string, tipo: "dubai" | "mixta" | "corporativa",
  calcVersion: number, basesVersion: number | null, bases: unknown, generales: Record<string, unknown> | null, filas: FilaPropuesta[],
): Promise<ResultadoGrupos<{ nuevas: number; actualizadas: number; basesVersion: number }>> {
  if (!idValido(temporadaId) || typeof huella !== "string" || typeof grupoId !== "string" || !UUID.test(grupoId)
      || !["dubai", "mixta", "corporativa"].includes(tipo) || !versionValida(calcVersion)
      || !(basesVersion === null || versionValida(basesVersion))
      || bases === null || typeof bases !== "object" || Array.isArray(bases) !== (tipo !== "mixta")
      || !(generales === null || (typeof generales === "object" && !Array.isArray(generales) && !CLAVES_PROHIBIDAS.some((k) => k in generales)))
      || !Array.isArray(filas) || filas.some((f) => f?.grupo_id !== grupoId || f.origen_tarifa_id != null)) {
    return { ok: false, error: "Datos no válidos." };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_guardar_calculadora_grupo", {
    p_temporada_id: temporadaId, p_huella: huella, p_grupo_id: grupoId, p_tipo: tipo,
    p_calc_version: calcVersion, p_bases_version: basesVersion, p_bases: bases as Json, p_generales: generales as Json | null,
    p_filas: payloadFilas(filas) as unknown as Json,
  });
  if (error || !data) return falloConMotivo(error);
  const r = data as unknown as { nuevas: number; actualizadas: number; bases_version: number; config: ConfigGrupos };
  return { ok: true, nuevas: r.nuevas, actualizadas: r.actualizadas, basesVersion: r.bases_version, config: r.config };
}
