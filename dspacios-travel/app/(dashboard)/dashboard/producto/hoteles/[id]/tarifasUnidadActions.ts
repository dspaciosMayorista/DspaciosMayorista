"use server";

// ─────────────────────────────────────────────────────────────────────────
// Server Actions del editor de "Tarifas por unidad" (fase 2 Bernalo,
// `public.hotel_tarifas_unidad`, migración 173). Capa delgada: NO decide
// ninguna regla de negocio propia — construye con
// `lib/calc/tarifaAlojamientoEditor.ts` (que a su vez delega TODA la
// validación al motor `validarTarifaAlojamiento` y al adaptador
// `adaptarTarifaAlojamientoPersistida`) y solo hace la lectura/escritura en
// Supabase con el cliente de SESIÓN (RLS real — nunca `createAdminClient`).
//
// Fail-closed: cada acción construye y valida el objeto completo ANTES de
// tocar la base; si la validación falla, no se ejecuta ningún insert/update/
// delete. Cada escritura es una única sentencia sobre una única fila — no
// hay pasos intermedios que puedan dejar una escritura a medias.
//
// Reglas de estado (nunca se editan/eliminan tarifas fuera de "borrador";
// una "publicada" solo pasa a "inactiva", nunca al revés; ver `lib/calc/
// tarifaAlojamientoEditor.ts`): se verifican DOS veces — con la fila recién
// leída (mensaje claro al usuario) y otra vez dentro del propio `update`/
// `delete` con un `.eq("estado", …)` exacto (nunca `.neq(...)`: cada
// transición exige el estado de ORIGEN exacto, no "cualquier cosa que no
// sea el destino") — así una carrera entre dos pestañas (alguien publica
// mientras otra persona edita el mismo borrador) no termina escribiendo
// sobre un estado que ya cambió.
//
// Sin integración: no importa nada de reservar, tarifario, cotizaciones,
// contratos, costos ni CxP. No crea/edita `hotel_temporadas` (el calendario
// autoritativo) — `hotel_tarifas_unidad` ni siquiera tiene columnas de
// fecha propias (migración 173).
//
// Clasificación ajena al hotel: el formulario recibe listas de
// temporadas/categorías/regímenes YA filtradas por hotel, pero nada impide
// que un cliente manipulado (o un bug de la UI) mande un valor que no
// pertenece a este hotel. `validarClasificacionHotel` re-verifica contra la
// base, con el cliente de SESIÓN, antes de crear/actualizar un borrador y
// otra vez antes de publicar (el catálogo del hotel pudo cambiar entre que
// se creó el borrador y se publicó) — fail-closed: cualquier error de
// Supabase o valor inexistente/ajeno bloquea la escritura completa.
//
// Reglas de edad sin configurar (ronda 10): una tarifa sin reglas explícitas
// bloqueaba a CUALQUIER menor real (`edad_fuera_de_regla`). `resolverReglas-
// EdadTarifa` (con el cliente de SESIÓN) las deriva de la configuración
// general del hotel (`edad_infante_max`/`edad_nino_max`/`adults_only`) antes
// de crear, actualizar, publicar o duplicar — el SERVIDOR es la autoridad,
// nunca depende de que el formulario las haya precargado. Reglas explícitas
// nunca se tocan. Ver `lib/calc/tarifaAlojamientoEditor.ts` para la fórmula.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Json } from "@/types/database";
import {
  aplicarFallbackReglasEdad,
  construirDuplicado,
  construirFilaCandidata,
  construirTarifaDesdeFormulario,
  generarTarifaId,
  puedeEditarPayload,
  puedeEliminar,
  puedeInactivar,
  puedePublicar,
  type EntradaFormularioTarifaUnidad,
} from "@/lib/calc/tarifaAlojamientoEditor";
import {
  adaptarTarifaAlojamientoPersistida,
  type TarifaUnidadAdaptada,
} from "@/lib/calc/tarifaAlojamientoPersistida";
import type { FilaCandidataTarifaUnidad } from "@/lib/calc/tarifaAlojamientoEditor";
import type { TarifaAlojamiento } from "@/lib/calc/unidadAlojamiento";

type Result = { ok: true; id?: number } | { ok: false; error: string };

// Traduce `FilaCandidataTarifaUnidad` (validada por `construirFilaCandidata`)
// a lo que espera el cliente de Supabase — no reintroduce ninguna regla,
// solo re-declara los mismos campos (uno por uno, nunca por spread, para
// que el overload `insert`/`update` de Supabase resuelva un único tipo sin
// ambigüedad al reasignar `payload` de `TarifaAlojamiento` a `Json`). No hay
// `fecha_desde`/`fecha_hasta` que traducir: esas columnas no existen en
// `hotel_tarifas_unidad` (migración 173) — el calendario vive en
// `hotel_temporadas`.
function filaParaSupabase(fila: FilaCandidataTarifaUnidad) {
  return {
    hotel_id: fila.hotel_id,
    tarifa_id: fila.tarifa_id,
    version_tarifario: fila.version_tarifario,
    temporada: fila.temporada,
    categoria: fila.categoria,
    alimentacion: fila.alimentacion,
    estado: fila.estado,
    fuente_documento: fila.fuente_documento,
    fuente_pagina: fila.fuente_pagina,
    comision_pct: fila.comision_pct,
    payload: fila.payload as unknown as Json,
  };
}

// ── Validación de clasificación contra el catálogo del hotel ───────────
// El formulario recibe temporadas/categorías/regímenes YA filtrados por
// hotel (ver `page.tsx`), pero eso es solo una lista para el `<select>` —
// nada impide que la Server Action reciba un valor que no está en esa
// lista (bug de UI, réplica manual del `fetch`, etc.). Estas tres
// funciones son la única fuente de verdad de "¿este valor pertenece
// realmente a este hotel?", con el cliente de SESIÓN (RLS real, nunca
// `createAdminClient`): un `error` de Supabase o una fila ausente en
// cualquiera de los dos pasos (existe en el catálogo / está enlazada al
// hotel) se traduce en un mensaje y NUNCA en "seguir de largo".
// `hotel_temporadas` permite varias filas con el mismo (hotel_id, nombre)
// — p. ej. importaciones sucesivas con rangos de fecha distintos pero el
// mismo nombre de temporada — así que esto es una comprobación de
// EXISTENCIA (¿hay al menos una fila?), no de unicidad: `.limit(1)` en vez
// de `.maybeSingle()` (que lanzaría error si hay más de una coincidencia).
// No se deduce ni se usa ninguna fecha aquí, solo el nombre.
async function verificarTemporada(
  sb: Awaited<ReturnType<typeof createClient>>,
  hotelId: number,
  nombre: string
): Promise<string | null> {
  const { data, error } = await sb
    .from("hotel_temporadas")
    .select("id")
    .eq("hotel_id", hotelId)
    .eq("nombre", nombre)
    .limit(1);
  if (error) return "No se pudo validar la temporada.";
  if (!data || data.length === 0) return `La temporada "${nombre}" no existe para este hotel.`;
  return null;
}

async function verificarCategoria(
  sb: Awaited<ReturnType<typeof createClient>>,
  hotelId: number,
  nombre: string
): Promise<string | null> {
  const { data: catalogo, error: errorCatalogo } = await sb
    .from("categorias_habitacion")
    .select("id")
    .eq("nombre", nombre)
    .maybeSingle();
  if (errorCatalogo) return "No se pudo validar la categoría.";
  if (!catalogo) return `La categoría "${nombre}" no existe en el catálogo.`;

  const { data: enlace, error: errorEnlace } = await sb
    .from("hotel_categorias")
    .select("hotel_id")
    .eq("hotel_id", hotelId)
    .eq("categoria_id", catalogo.id)
    .maybeSingle();
  if (errorEnlace) return "No se pudo validar la categoría.";
  if (!enlace) return `La categoría "${nombre}" no está asignada a este hotel.`;
  return null;
}

async function verificarAlimentacion(
  sb: Awaited<ReturnType<typeof createClient>>,
  hotelId: number,
  codigo: string
): Promise<string | null> {
  const { data: catalogo, error: errorCatalogo } = await sb
    .from("planes_alimentacion")
    .select("id")
    .eq("codigo", codigo)
    .maybeSingle();
  if (errorCatalogo) return "No se pudo validar el régimen de alimentación.";
  if (!catalogo) return `El régimen "${codigo}" no existe en el catálogo.`;

  const { data: enlace, error: errorEnlace } = await sb
    .from("hotel_regimenes")
    .select("hotel_id")
    .eq("hotel_id", hotelId)
    .eq("plan_id", catalogo.id)
    .maybeSingle();
  if (errorEnlace) return "No se pudo validar el régimen de alimentación.";
  if (!enlace) return `El régimen "${codigo}" no está asignado a este hotel.`;
  return null;
}

export type ClasificacionAValidar = {
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
};

// Centraliza la regla para no repetir consultas: se llama antes de crear,
// antes de actualizar y otra vez antes de publicar (el catálogo del hotel
// pudo cambiar entre que el borrador se creó y se publicó). Un valor
// `null` (campo no usado en esta tarifa) nunca se valida — no hay nada que
// verificar. Las tres comprobaciones corren en paralelo: son independientes
// entre sí.
async function validarClasificacionHotel(
  sb: Awaited<ReturnType<typeof createClient>>,
  hotelId: number,
  clasificacion: ClasificacionAValidar
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [errorTemporada, errorCategoria, errorAlimentacion] = await Promise.all([
    clasificacion.temporada != null ? verificarTemporada(sb, hotelId, clasificacion.temporada) : Promise.resolve(null),
    clasificacion.categoria != null ? verificarCategoria(sb, hotelId, clasificacion.categoria) : Promise.resolve(null),
    clasificacion.alimentacion != null
      ? verificarAlimentacion(sb, hotelId, clasificacion.alimentacion)
      : Promise.resolve(null),
  ]);
  const error = errorTemporada ?? errorCategoria ?? errorAlimentacion;
  if (error) return { ok: false, error };
  return { ok: true };
}

// ── Respaldo de reglas de edad desde la configuración general del hotel ──
// El SERVIDOR es la autoridad (punto 10 del encargo): aunque el formulario
// ya precarga estas reglas para conveniencia del usuario (ver
// `TarifasUnidadEditor.tsx`), esta función se llama SIEMPRE antes de crear,
// actualizar, publicar o duplicar — así un formulario manipulado, un cliente
// viejo sin la precarga, o un borrador creado antes de esta ronda, terminan
// igual de cubiertos. `aplicarFallbackReglasEdad` (dominio puro) decide si
// hace falta tocar algo: si la tarifa ya trae reglas explícitas, esta
// consulta ni siquiera importa el resultado.
async function edadesGeneralesDelHotel(
  sb: Awaited<ReturnType<typeof createClient>>,
  hotelId: number
): Promise<{ ok: true; edades: { edadInfanteMax: number; edadNinoMax: number; adultsOnly: boolean } } | { ok: false; error: string }> {
  const { data, error } = await sb
    .from("hoteles")
    .select("edad_infante_max, edad_nino_max, adults_only")
    .eq("id", hotelId)
    .maybeSingle();
  if (error) return { ok: false, error: "No se pudo leer la configuración de edades del hotel." };
  if (!data) return { ok: false, error: "El hotel no existe." };
  return {
    ok: true,
    edades: {
      edadInfanteMax: data.edad_infante_max,
      edadNinoMax: data.edad_nino_max,
      adultsOnly: data.adults_only ?? false,
    },
  };
}

async function resolverReglasEdadTarifa(
  sb: Awaited<ReturnType<typeof createClient>>,
  hotelId: number,
  tarifa: TarifaAlojamiento
): Promise<{ ok: true; tarifa: TarifaAlojamiento } | { ok: false; error: string }> {
  // Reglas explícitas: no hace falta ni consultar el hotel (punto 4).
  if (tarifa.reglaMenores.reglas.length > 0) return { ok: true, tarifa };

  const edades = await edadesGeneralesDelHotel(sb, hotelId);
  if (!edades.ok) return edades;

  return aplicarFallbackReglasEdad(tarifa, edades.edades);
}

async function leerFilaPropia(
  sb: Awaited<ReturnType<typeof createClient>>,
  id: number,
  hotelId: number
): Promise<{ ok: true; adaptada: TarifaUnidadAdaptada } | { ok: false; error: string }> {
  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .select("*")
    .eq("id", id)
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "La tarifa no existe o no pertenece a este hotel." };
  const adaptada = adaptarTarifaAlojamientoPersistida(data);
  if (!adaptada.ok) {
    // No debería pasar nunca (todo lo que este módulo escribe ya pasó por el
    // mismo adaptador) — pero si pasara, fail-closed: no se opera sobre una
    // fila que el propio adaptador no reconoce como coherente.
    return { ok: false, error: `La tarifa guardada quedó en un estado incoherente: ${adaptada.mensaje}` };
  }
  return { ok: true, adaptada };
}

function revalidar(hotelId: number) {
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
}

function clasificacionDeTarifa(tarifa: { temporada?: string | null; categoria?: string | null; alimentacion?: string | null }): ClasificacionAValidar {
  return {
    temporada: tarifa.temporada ?? null,
    categoria: tarifa.categoria ?? null,
    alimentacion: tarifa.alimentacion ?? null,
  };
}

export async function crearTarifaUnidadBorrador(
  hotelId: number,
  input: EntradaFormularioTarifaUnidad
): Promise<Result> {
  const construccion = construirTarifaDesdeFormulario(generarTarifaId(), input);
  if (!construccion.ok) return { ok: false, error: construccion.error };

  const sb = await createClient();
  const clasificacion = await validarClasificacionHotel(sb, hotelId, clasificacionDeTarifa(construccion.tarifa));
  if (!clasificacion.ok) return clasificacion;

  const reglasEdad = await resolverReglasEdadTarifa(sb, hotelId, construccion.tarifa);
  if (!reglasEdad.ok) return reglasEdad;

  const candidata = construirFilaCandidata(hotelId, reglasEdad.tarifa, "borrador");
  if (!candidata.ok) return { ok: false, error: candidata.error };

  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .insert(filaParaSupabase(candidata.fila))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidar(hotelId);
  return { ok: true, id: data.id };
}

export async function actualizarTarifaUnidadBorrador(
  id: number,
  hotelId: number,
  input: EntradaFormularioTarifaUnidad
): Promise<Result> {
  const sb = await createClient();
  const actual = await leerFilaPropia(sb, id, hotelId);
  if (!actual.ok) return actual;
  if (!puedeEditarPayload(actual.adaptada.estado)) {
    return {
      ok: false,
      error: "Solo se pueden editar tarifas en borrador. Para cambiar una publicada, duplícala como una nueva versión.",
    };
  }

  const construccion = construirTarifaDesdeFormulario(actual.adaptada.tarifa.id, input);
  if (!construccion.ok) return { ok: false, error: construccion.error };

  const clasificacion = await validarClasificacionHotel(sb, hotelId, clasificacionDeTarifa(construccion.tarifa));
  if (!clasificacion.ok) return clasificacion;

  const reglasEdad = await resolverReglasEdadTarifa(sb, hotelId, construccion.tarifa);
  if (!reglasEdad.ok) return reglasEdad;

  const candidata = construirFilaCandidata(hotelId, reglasEdad.tarifa, "borrador");
  if (!candidata.ok) return { ok: false, error: candidata.error };

  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .update({ ...filaParaSupabase(candidata.fila), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("hotel_id", hotelId)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "La tarifa dejó de estar en borrador (la cambió otra persona); recarga e inténtalo de nuevo." };
  }

  revalidar(hotelId);
  return { ok: true };
}

export async function publicarTarifaUnidad(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const actual = await leerFilaPropia(sb, id, hotelId);
  if (!actual.ok) return actual;
  if (!puedePublicar(actual.adaptada.estado)) {
    return { ok: false, error: "Solo una tarifa en borrador se puede publicar." };
  }

  // Re-valida contra el catálogo del hotel: el borrador pudo crearse con una
  // temporada/categoría/régimen que ya existía en ese momento, pero el
  // catálogo del hotel puede haber cambiado desde entonces (se desvinculó la
  // categoría, se borró la temporada, etc.) — publicar es el punto en que
  // esa tarifa empieza a "contar", así que se re-verifica justo antes.
  const clasificacion = await validarClasificacionHotel(sb, hotelId, clasificacionDeTarifa(actual.adaptada.tarifa));
  if (!clasificacion.ok) return clasificacion;

  // Respaldo de reglas de edad (punto 2 del encargo: también antes de
  // publicar). Cubre el caso de un borrador que quedó sin reglas —creado
  // antes de esta ronda, o por cualquier otra vía— para que ninguna tarifa
  // llegue a "publicada" bloqueando menores reales. Si hubo que derivarlas,
  // el payload completo (no solo `estado`) se reescribe para que queden
  // grabadas (punto 3: el snapshot debe quedar autocontenido).
  const reglasEdad = await resolverReglasEdadTarifa(sb, hotelId, actual.adaptada.tarifa);
  if (!reglasEdad.ok) return reglasEdad;

  const candidata = construirFilaCandidata(hotelId, reglasEdad.tarifa, "publicada");
  if (!candidata.ok) return { ok: false, error: candidata.error };

  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .update({ ...filaParaSupabase(candidata.fila), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("hotel_id", hotelId)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "La tarifa dejó de estar en borrador (la cambió otra persona); recarga e inténtalo de nuevo." };
  }

  revalidar(hotelId);
  return { ok: true };
}

export async function inactivarTarifaUnidad(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const actual = await leerFilaPropia(sb, id, hotelId);
  if (!actual.ok) return actual;
  if (!puedeInactivar(actual.adaptada.estado)) {
    return { ok: false, error: "Solo una tarifa publicada se puede inactivar." };
  }

  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .update({ estado: "inactiva", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("hotel_id", hotelId)
    .eq("estado", "publicada")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "La tarifa dejó de estar publicada (la cambió otra persona); recarga e inténtalo de nuevo." };
  }

  revalidar(hotelId);
  return { ok: true };
}

export async function eliminarTarifaUnidadBorrador(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const actual = await leerFilaPropia(sb, id, hotelId);
  if (!actual.ok) return actual;
  if (!puedeEliminar(actual.adaptada.estado)) {
    return { ok: false, error: "Solo se pueden eliminar tarifas en borrador." };
  }

  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .delete()
    .eq("id", id)
    .eq("hotel_id", hotelId)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "La tarifa dejó de estar en borrador; no se eliminó." };
  }

  revalidar(hotelId);
  return { ok: true };
}

export async function duplicarTarifaUnidadVersion(
  id: number,
  hotelId: number,
  nuevaVersion: string
): Promise<Result> {
  const sb = await createClient();
  const actual = await leerFilaPropia(sb, id, hotelId);
  if (!actual.ok) return actual;

  const construccion = construirDuplicado(actual.adaptada.tarifa, nuevaVersion);
  if (!construccion.ok) return { ok: false, error: construccion.error };

  // Respaldo de reglas de edad (punto 2: también antes de duplicar). El clon
  // normalmente ya trae las reglas de la tarifa origen (explícitas o
  // resueltas al crearla) — esto solo actúa si, por la razón que sea, esas
  // reglas llegaron vacías y el hotel no es Adults Only.
  const reglasEdad = await resolverReglasEdadTarifa(sb, hotelId, construccion.tarifa);
  if (!reglasEdad.ok) return reglasEdad;

  const candidata = construirFilaCandidata(hotelId, reglasEdad.tarifa, "borrador");
  if (!candidata.ok) return { ok: false, error: candidata.error };

  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .insert(filaParaSupabase(candidata.fila))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidar(hotelId);
  return { ok: true, id: data.id };
}
