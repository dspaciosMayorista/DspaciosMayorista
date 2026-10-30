import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { evaluarFuenteVinculada63, fuenteCoincideConSalida63, type FuenteEmpaquetado63, type SalidaVinculada63 } from "../reservar/ofertaDinamica63.ts";
import { hoyBogota } from "../reservar/origen.ts";

// ─────────────────────────────────────────────────────────────────────────
// #67 — DESTINOS AÉREOS ALTERNATIVOS de un paquete de Bloqueo/Sistema.
//
// UNA sola regla, compartida por todo lo que decide si un vuelo (bloqueo
// negociado o empaquetado de Sistema) puede ir en un paquete:
//   · el editor (qué vuelos se ofrecen y se vinculan),
//   · las acciones de vinculación simple y por lote,
//   · el guardado de la configuración,
//   · el generador del tarifario,
//   · la venta (computarReserva) y los cargadores de la vitrina.
// #63 (promociones de Dinámico) consume ESTA MISMA regla y esta misma
// configuración — no define un segundo filtro de país.
//
// REGLA
//   · check APAGADO  → destino comercial EXACTO (el filtro de siempre).
//   · check ENCENDIDO → destino comercial + alternativas elegidas que sigan
//     siendo válidas: existen, están activas y tienen el MISMO país que el
//     destino comercial (país comparable: sin espacios de más, sin
//     mayúsculas ni tildes; sin alias — "RD" NO es "República Dominicana").
//   · Sin destino comercial NO hay respaldo "todos los vuelos": nada se ofrece.
//   · País ausente o no comparable NO autoriza alternativas.
//   · El IATA es solo una etiqueta: nunca prueba país ni cercanía. Los
//     destinos se identifican por ID, jamás por nombre o código.
//   · Un error de lectura es un error TÉCNICO, nunca "cero resultados".
//
// La base repite la misma regla con triggers (migración 220): esta capa da los
// mensajes claros y evita escrituras que la base rechazaría; la base es la
// garantía frente a llamadas directas y carreras.
//
// Imports relativos con extensión `.ts` (no `@/`): el módulo lo consumen
// archivos con y sin alias y debe poder ejecutarse bajo `node --test` plano.
// ─────────────────────────────────────────────────────────────────────────

export type ClienteDestinos = SupabaseClient<Database>;

export const MENSAJES = {
  sinDestinoComercial: "El paquete no tiene destino comercial: no se pueden ofrecer ni vincular vuelos hasta asignarlo.",
  noPermitido: "El vuelo no corresponde a los destinos aéreos permitidos del paquete.",
  tecnico: "No se pudo verificar el destino aéreo de los vuelos. Intenta nuevamente.",
  paqueteInexistente: "El paquete ya no existe.",
} as const;

// ─── Normalización de país (idéntica a public.pais_comparable_67) ──────────
const CON_TILDE = "ÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãåéèëêíìïîóòöôõúùüûñç";
const SIN_TILDE = "AAAAAAEEEEIIIIOOOOOUUUUNCaaaaaaeeeeiiiiooooouuuunc";

/** País comparable, o `null` si falta. Mismo resultado que la función SQL de la migración 220. */
export function normalizarPais(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  const compacto = valor.trim().replace(/\s+/g, " ");
  let salida = "";
  for (const ch of compacto) {
    const i = CON_TILDE.indexOf(ch);
    salida += i >= 0 ? SIN_TILDE[i] : ch;
  }
  // `lower()` de Postgres solo es fiable en ASCII (depende del locale): se
  // aplica DESPUÉS de quitar las tildes, igual que la función SQL.
  salida = salida.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return salida === "" ? null : salida;
}

export type DestinoCatalogo = {
  id: number;
  nombre: string | null;
  codigo_iata: string | null;
  pais: string | null;
  activo: boolean | null;
};

export type EntradaDestinosAereos = {
  destinoComercialId: number | null;
  alternativos: boolean;
  alternativaIds: number[];
};

export type MotivoAlternativa = "no_existe" | "inactivo" | "sin_pais" | "otro_pais" | "es_comercial";

const MOTIVO_TEXTO: Record<MotivoAlternativa, string> = {
  no_existe: "no existe",
  inactivo: "está inactivo",
  sin_pais: "no tiene país",
  otro_pais: "es de otro país",
  es_comercial: "es el destino comercial",
};

function catalogoMap(catalogo: DestinoCatalogo[] | Map<number, DestinoCatalogo>): Map<number, DestinoCatalogo> {
  return catalogo instanceof Map ? catalogo : new Map(catalogo.map((d) => [d.id, d]));
}

/** Etiqueta para mostrar: "Punta Cana (PUJ)" o solo el nombre si no hay IATA. Nunca inventa un aeropuerto. */
export function etiquetaDestino(d: { nombre: string | null; codigo_iata: string | null } | null | undefined): string {
  if (!d) return "Destino desconocido";
  const nombre = (d.nombre ?? "").trim() || "Destino sin nombre";
  const iata = (d.codigo_iata ?? "").trim();
  return iata ? `${nombre} (${iata})` : nombre;
}

function motivoAlternativa(alt: DestinoCatalogo | undefined, paisComercial: string | null, comercialId: number, id: number): MotivoAlternativa | null {
  if (id === comercialId) return "es_comercial";
  if (!alt) return "no_existe";
  if (alt.activo !== true) return "inactivo";
  const p = normalizarPais(alt.pais);
  if (p === null) return "sin_pais";
  if (p !== paisComercial) return "otro_pais";
  return null;
}

// ─── Destinos efectivos (modo de EJECUCIÓN: indulgente con alternativas rotas) ─
export type Efectivos =
  | {
      ok: true;
      comercialId: number;
      /** IDs de destino aceptados, comercial primero. */
      ids: number[];
      alternativasValidas: number[];
      alternativasExcluidas: { id: number; motivo: MotivoAlternativa }[];
    }
  | { ok: false; codigo: "sin_destino_comercial" | "paquete_inexistente"; error: string };

/**
 * Destinos de llegada aceptados HOY para un paquete. En ejecución (vitrina,
 * generador, venta) una alternativa que dejó de ser válida (inactiva, país
 * cambiado…) simplemente deja de contar — sus vuelos se ocultan — sin romper
 * el resto del paquete. La validación ESTRICTA para guardar es
 * `validarConfigDestinosAereos`.
 */
export function calcularDestinosEfectivos(
  entrada: EntradaDestinosAereos,
  catalogo: DestinoCatalogo[] | Map<number, DestinoCatalogo>
): Efectivos {
  const comercialId = entrada.destinoComercialId;
  if (comercialId == null) {
    return { ok: false, codigo: "sin_destino_comercial", error: MENSAJES.sinDestinoComercial };
  }
  if (!entrada.alternativos) {
    return { ok: true, comercialId, ids: [comercialId], alternativasValidas: [], alternativasExcluidas: [] };
  }
  const cat = catalogoMap(catalogo);
  const paisComercial = normalizarPais(cat.get(comercialId)?.pais);
  const validas: number[] = [];
  const excluidas: { id: number; motivo: MotivoAlternativa }[] = [];
  for (const id of [...new Set(entrada.alternativaIds)]) {
    // Sin país comparable en el comercial, NINGUNA alternativa se autoriza.
    const motivo = paisComercial === null ? ("sin_pais" as const) : motivoAlternativa(cat.get(id), paisComercial, comercialId, id);
    if (motivo) excluidas.push({ id, motivo });
    else validas.push(id);
  }
  return { ok: true, comercialId, ids: [comercialId, ...validas], alternativasValidas: validas, alternativasExcluidas: excluidas };
}

// ─── Validación ESTRICTA de la configuración (al guardar) ───────────────────
export type ConfigValida =
  | { ok: true; alternativaIds: number[] }
  | { ok: false; codigo: "sin_destino_comercial" | "comercial_sin_pais" | "sin_alternativas" | "alternativas_invalidas"; error: string; invalidas?: { id: number; motivo: MotivoAlternativa }[] };

export function validarConfigDestinosAereos(
  entrada: EntradaDestinosAereos,
  catalogo: DestinoCatalogo[] | Map<number, DestinoCatalogo>
): ConfigValida {
  const cat = catalogoMap(catalogo);
  const comercialId = entrada.destinoComercialId;
  // Deduplicado, conservando orden; el comercial nunca es "alternativa".
  const ids = [...new Set(entrada.alternativaIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  // Orden ascendente: el guardado es determinista (mismo conjunto = mismo argumento).
  const alternativaIds = ids.filter((id) => id !== comercialId).sort((x, y) => x - y);

  if (comercialId == null) {
    if (entrada.alternativos || alternativaIds.length) {
      return { ok: false, codigo: "sin_destino_comercial", error: "Asigna primero el destino comercial del paquete para elegir destinos aéreos alternativos." };
    }
    return { ok: true, alternativaIds: [] };
  }

  const paisComercial = normalizarPais(cat.get(comercialId)?.pais);
  if ((entrada.alternativos || alternativaIds.length) && paisComercial === null) {
    return {
      ok: false, codigo: "comercial_sin_pais",
      error: `El destino comercial (${etiquetaDestino(cat.get(comercialId))}) no tiene país registrado: sin país comparable no se pueden habilitar destinos alternativos. Corrige el país en el catálogo de destinos.`,
    };
  }

  const invalidas: { id: number; motivo: MotivoAlternativa }[] = [];
  for (const id of alternativaIds) {
    const m = motivoAlternativa(cat.get(id), paisComercial, comercialId, id);
    if (m) invalidas.push({ id, motivo: m });
  }
  if (invalidas.length) {
    const lista = invalidas.map((i) => `${etiquetaDestino(cat.get(i.id))} ${MOTIVO_TEXTO[i.motivo]}`).join("; ");
    return { ok: false, codigo: "alternativas_invalidas", invalidas, error: `Destinos aéreos alternativos no válidos: ${lista}. Solo se admiten destinos activos del mismo país que el destino comercial.` };
  }
  if (entrada.alternativos && alternativaIds.length === 0) {
    return { ok: false, codigo: "sin_alternativas", error: "Para activar los destinos aéreos alternativos elige al menos un destino distinto del comercial." };
  }
  return { ok: true, alternativaIds };
}

// ─── Fuentes aéreas ───────────────────────────────────────────────────────
export type FuenteAerea = { tipo: "bloqueo" | "empaquetado"; id: number };
const claveFuente = (f: FuenteAerea) => `${f.tipo}:${f.id}`;

export type InfoFuente = { id: number; destino_id: number | null; ruta: string | null; record: string | null };

export type MotivoRechazoFuente = "fuente_inexistente" | "fuente_sin_destino" | "destino_no_permitido";
export type RechazoFuente = { fuente: FuenteAerea; motivo: MotivoRechazoFuente; ruta: string | null; record: string | null };

/** Decisión PURA: ¿esta fuente cumple los destinos efectivos? `info` null = no existe. */
export function motivoRechazoFuente(efectivos: number[], info: InfoFuente | null | undefined): MotivoRechazoFuente | null {
  if (!info) return "fuente_inexistente";
  if (info.destino_id == null) return "fuente_sin_destino";
  return efectivos.includes(info.destino_id) ? null : "destino_no_permitido";
}

const SELECT_FUENTE = "id, destino_id, ruta, record";

type ErrorTecnico = { ok: false; tecnico: true; error: string };
const errorTecnico = (): ErrorTecnico => ({ ok: false, tecnico: true, error: MENSAJES.tecnico });

type PaqueteDestinos = { id: number; destino_id: number | null; destinos_aereos_alternativos: boolean | null };

/**
 * Destinos efectivos de UNO o varios paquetes, con las lecturas mínimas: los
 * paquetes con el check apagado no leen nada más. Un error de lectura devuelve
 * `tecnico: true` — jamás se interpreta como "sin alternativas".
 */
export async function resolverEfectivosPorPaquetes(
  sb: ClienteDestinos,
  paqueteIds: number[]
): Promise<{ ok: true; porPaquete: Map<number, Efectivos> } | ErrorTecnico> {
  const ids = [...new Set(paqueteIds)];
  const porPaquete = new Map<number, Efectivos>();
  if (!ids.length) return { ok: true, porPaquete };

  const { data: pqs, error: ePq } = await sb
    .from("armado_paquetes")
    .select("id, destino_id, destinos_aereos_alternativos")
    .in("id", ids);
  if (ePq) return errorTecnico();
  const paquetes = new Map<number, PaqueteDestinos>(((pqs ?? []) as PaqueteDestinos[]).map((p) => [p.id, p]));

  const encendidos = [...paquetes.values()].filter((p) => p.destinos_aereos_alternativos === true && p.destino_id != null);
  const altsPor = new Map<number, number[]>();
  let catalogo = new Map<number, DestinoCatalogo>();
  if (encendidos.length) {
    const { data: alts, error: eAlt } = await sb
      .from("armado_paquete_destinos_aereos")
      .select("paquete_id, destino_id")
      .in("paquete_id", encendidos.map((p) => p.id));
    if (eAlt) return errorTecnico();
    for (const a of (alts ?? []) as { paquete_id: number; destino_id: number }[]) {
      altsPor.set(a.paquete_id, [...(altsPor.get(a.paquete_id) ?? []), a.destino_id]);
    }
    const idsDestino = new Set<number>();
    for (const p of encendidos) { idsDestino.add(p.destino_id as number); for (const d of altsPor.get(p.id) ?? []) idsDestino.add(d); }
    const { data: dests, error: eDest } = await sb
      .from("destinos")
      .select("id, nombre, codigo_iata, pais, activo")
      .in("id", [...idsDestino]);
    if (eDest) return errorTecnico();
    catalogo = new Map(((dests ?? []) as DestinoCatalogo[]).map((d) => [d.id, d]));
  }

  for (const id of ids) {
    const p = paquetes.get(id);
    if (!p) { porPaquete.set(id, { ok: false, codigo: "paquete_inexistente", error: MENSAJES.paqueteInexistente }); continue; }
    porPaquete.set(id, calcularDestinosEfectivos(
      { destinoComercialId: p.destino_id, alternativos: p.destinos_aereos_alternativos === true, alternativaIds: altsPor.get(id) ?? [] },
      catalogo
    ));
  }
  return { ok: true, porPaquete };
}

export async function resolverDestinosAereosPaquete(
  sb: ClienteDestinos,
  paqueteId: number
): Promise<{ ok: true; efectivos: Efectivos } | ErrorTecnico> {
  const r = await resolverEfectivosPorPaquetes(sb, [paqueteId]);
  if (!r.ok) return r;
  return { ok: true, efectivos: r.porPaquete.get(paqueteId) as Efectivos };
}

/** Lee destino/ruta/record de las fuentes pedidas. Las que no existen no aparecen en el mapa. */
export async function leerInfoFuentes(
  sb: ClienteDestinos,
  fuentes: FuenteAerea[]
): Promise<{ ok: true; info: Map<string, InfoFuente> } | ErrorTecnico> {
  const bloqueos = [...new Set(fuentes.filter((f) => f.tipo === "bloqueo").map((f) => f.id))];
  const empaquetados = [...new Set(fuentes.filter((f) => f.tipo === "empaquetado").map((f) => f.id))];
  const [rb, re] = await Promise.all([
    bloqueos.length ? sb.from("bloqueos_vuelo").select(SELECT_FUENTE).in("id", bloqueos) : Promise.resolve({ data: [], error: null }),
    empaquetados.length ? sb.from("empaquetados").select(SELECT_FUENTE).in("id", empaquetados) : Promise.resolve({ data: [], error: null }),
  ]);
  if (rb.error || re.error) return errorTecnico();
  const info = new Map<string, InfoFuente>();
  for (const f of (rb.data ?? []) as InfoFuente[]) info.set(claveFuente({ tipo: "bloqueo", id: f.id }), f);
  for (const f of (re.data ?? []) as InfoFuente[]) info.set(claveFuente({ tipo: "empaquetado", id: f.id }), f);
  return { ok: true, info };
}

export type ResultadoLote =
  | { ok: true; fuentes: FuenteAerea[] }
  | { ok: false; tecnico: boolean; error: string; rechazadas: RechazoFuente[] };

const nombreFuente = (r: { fuente: FuenteAerea; ruta: string | null; record: string | null }) =>
  `${r.fuente.tipo === "bloqueo" ? "vuelo" : "vuelo Sistema"} ${r.record ?? "sin record"}${r.ruta ? ` ${r.ruta}` : ""} (#${r.fuente.id})`;

/**
 * Valida un LOTE de fuentes contra los destinos efectivos del paquete: TODO o
 * NADA. Deduplica; si CUALQUIERA no cumple (o no existe, o no tiene destino)
 * se rechaza el lote completo. Se llama ANTES de escribir.
 */
export async function validarLoteOrigenesAereos(
  sb: ClienteDestinos,
  paqueteId: number,
  fuentes: FuenteAerea[]
): Promise<ResultadoLote> {
  const vistos = new Set<string>();
  const unicas: FuenteAerea[] = [];
  for (const f of fuentes) {
    if (!Number.isInteger(f.id) || f.id <= 0) {
      return { ok: false, tecnico: false, error: MENSAJES.noPermitido, rechazadas: [{ fuente: f, motivo: "fuente_inexistente", ruta: null, record: null }] };
    }
    const k = claveFuente(f);
    if (!vistos.has(k)) { vistos.add(k); unicas.push(f); }
  }
  if (!unicas.length) return { ok: true, fuentes: [] };

  const [ef, inf] = await Promise.all([resolverDestinosAereosPaquete(sb, paqueteId), leerInfoFuentes(sb, unicas)]);
  if (!ef.ok) return { ok: false, tecnico: true, error: ef.error, rechazadas: [] };
  if (!inf.ok) return { ok: false, tecnico: true, error: inf.error, rechazadas: [] };
  if (!ef.efectivos.ok) return { ok: false, tecnico: false, error: ef.efectivos.error, rechazadas: [] };

  const ids = ef.efectivos.ids;
  const rechazadas: RechazoFuente[] = [];
  for (const f of unicas) {
    const info = inf.info.get(claveFuente(f)) ?? null;
    const motivo = motivoRechazoFuente(ids, info);
    if (motivo) rechazadas.push({ fuente: f, motivo, ruta: info?.ruta ?? null, record: info?.record ?? null });
  }
  if (rechazadas.length) {
    const error = unicas.length === 1
      ? MENSAJES.noPermitido
      : `No se vinculó ningún vuelo: ${rechazadas.length} de ${unicas.length} no corresponde(n) a los destinos aéreos permitidos del paquete (${rechazadas.slice(0, 5).map(nombreFuente).join("; ")}${rechazadas.length > 5 ? "…" : ""}).`;
    return { ok: false, tecnico: false, error, rechazadas };
  }
  return { ok: true, fuentes: unicas };
}

export async function validarOrigenAereoPaquete(
  sb: ClienteDestinos,
  paqueteId: number,
  fuente: FuenteAerea
): Promise<{ ok: true } | { ok: false; tecnico: boolean; error: string }> {
  const r = await validarLoteOrigenesAereos(sb, paqueteId, [fuente]);
  return r.ok ? { ok: true } : { ok: false, tecnico: r.tecnico, error: r.error };
}

// ─── Cargadores de la vitrina ───────────────────────────────────────────────
type FilaConOrigen = {
  modulo: string;
  paquete_id?: number | null;
  bloqueo_id?: number | null;
  empaquetado_id?: number | null;
  salida_id?: number | null;
};

/**
 * #63 — oculta, de las filas YA publicadas de un paquete Dinámico, las de una
 * salida VINCULADA a un vuelo de Empaquetados cuya fuente ya no es elegible
 * (desactivada, fuera de compra, con record, viaje pasado, moneda), cuya copia
 * ya no coincide con la fuente o cuyo destino aéreo ya no está permitido. Las
 * salidas manuales y los demás módulos no se tocan. La fila publicada es una
 * caché: aquí se decide con la fuente VIVA. Sin cliente de servicio no hay
 * evidencia (queda como hoy y `computarReserva` la rechaza igual); con error de
 * lectura se ocultan TODAS las filas dinámicas con salida y se informa el error.
 */
async function filtrarSalidasVinculadas63<T extends FilaConOrigen>(
  admin: ClienteDestinos | null,
  filas: T[]
): Promise<{ filas: T[]; errorOrigenAereo: unknown }> {
  const dinamicas = filas.filter((f) => f.modulo === "dinamico" && f.salida_id != null);
  if (!dinamicas.length || !admin) return { filas, errorOrigenAereo: null };
  const sinDinamicas = filas.filter((f) => !(f.modulo === "dinamico" && f.salida_id != null));
  const salidaIds = [...new Set(dinamicas.map((f) => f.salida_id as number))];
  const { data: salidas, error: eSal } = await admin
    .from("salidas_dinamicas")
    .select("id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante")
    .in("id", salidaIds);
  if (eSal) return { filas: sinDinamicas, errorOrigenAereo: new Error(MENSAJES.tecnico) };
  const salidaPorId = new Map(((salidas ?? []) as unknown as (SalidaVinculada63 & { id: number })[]).map((x) => [x.id, x]));
  const vinculadas = dinamicas.filter((f) => salidaPorId.get(f.salida_id as number)?.empaquetado_id != null);
  if (!vinculadas.length) return { filas, errorOrigenAereo: null };

  const idsFuente = [...new Set(vinculadas.map((f) => salidaPorId.get(f.salida_id as number)?.empaquetado_id as number))];
  const paqueteIds = [...new Set(vinculadas.map((f) => f.paquete_id).filter((x): x is number => x != null))];
  const [ef, inf, fuentesRes] = await Promise.all([
    resolverEfectivosPorPaquetes(admin, paqueteIds),
    leerInfoFuentes(admin, idsFuente.map((id) => ({ tipo: "empaquetado" as const, id }))),
    admin
      .from("empaquetados")
      .select("id, activo, record, compra_inicio, compra_fin, fecha_ida, fecha_regreso, ruta, aerolinea, destino_id, moneda, tarifa_para_empaquetar, fee_infante")
      .in("id", idsFuente),
  ]);
  if (!ef.ok || !inf.ok || fuentesRes.error) {
    return { filas: filas.filter((f) => !vinculadas.includes(f)), errorOrigenAereo: new Error(MENSAJES.tecnico) };
  }
  const fuentePorId = new Map(((fuentesRes.data ?? []) as unknown as (FuenteEmpaquetado63 & { id: number })[]).map((x) => [x.id, x]));
  const hoy = hoyBogota(new Date());
  const ocultas = new Set<T>();
  for (const fila of vinculadas) {
    const salida = salidaPorId.get(fila.salida_id as number) as SalidaVinculada63;
    const empId = salida.empaquetado_id as number;
    const fuente = fuentePorId.get(empId) ?? null;
    const efectivos = fila.paquete_id != null ? ef.porPaquete.get(fila.paquete_id) : undefined;
    const destinoOk = !efectivos || !efectivos.ok || motivoRechazoFuente(efectivos.ids, inf.info.get(claveFuente({ tipo: "empaquetado", id: empId })) ?? null) === null;
    const elegible = evaluarFuenteVinculada63(fuente, hoy).ok;
    const coincide = fuente ? fuenteCoincideConSalida63(salida, fuente).ok : false;
    if (!destinoOk || !elegible || !coincide) ocultas.add(fila);
  }
  return { filas: filas.filter((f) => !ocultas.has(f)), errorOrigenAereo: null };
}

/**
 * Oculta, de las filas YA publicadas, las de Bloqueo cuya fuente aérea ya no
 * cumple los destinos efectivos de su paquete (país o destino cambiado después
 * de generar el tarifario: la fila publicada es una caché). Las demás filas no
 * se tocan. FALLA CERRADA: sin cliente de servicio o con error de lectura se
 * ocultan TODAS las filas de Bloqueo con fuente y se devuelve `errorOrigenAereo`
 * (error técnico, distinto de "no hay disponibilidad").
 */
export async function filtrarFilasPorOrigenAereo<T extends FilaConOrigen>(
  admin: ClienteDestinos | null,
  filas: T[]
): Promise<{ filas: T[]; errorOrigenAereo: unknown }> {
  const vinculadas = await filtrarSalidasVinculadas63(admin, filas);
  const bloqueoSistema = await filtrarBloqueoSistema67(admin, vinculadas.filas);
  return { filas: bloqueoSistema.filas, errorOrigenAereo: vinculadas.errorOrigenAereo ?? bloqueoSistema.errorOrigenAereo };
}

async function filtrarBloqueoSistema67<T extends FilaConOrigen>(
  admin: ClienteDestinos | null,
  filas: T[]
): Promise<{ filas: T[]; errorOrigenAereo: unknown }> {
  const fuenteDe = (f: T): FuenteAerea | null => {
    if (f.modulo !== "bloqueo") return null;
    if (f.bloqueo_id != null) return { tipo: "bloqueo", id: f.bloqueo_id };
    if (f.empaquetado_id != null) return { tipo: "empaquetado", id: f.empaquetado_id };
    return null;
  };
  const candidatas = filas.filter((f) => fuenteDe(f) !== null);
  if (!candidatas.length) return { filas, errorOrigenAereo: null };
  const sinFuente = filas.filter((f) => fuenteDe(f) === null);

  if (!admin) {
    return { filas: sinFuente, errorOrigenAereo: new Error("Sin cliente de servicio: no se puede verificar el destino aéreo de los vuelos.") };
  }
  const paqueteIds = [...new Set(candidatas.map((f) => f.paquete_id).filter((x): x is number => x != null))];
  const fuentes = candidatas.map((f) => fuenteDe(f) as FuenteAerea);
  const [ef, inf] = await Promise.all([resolverEfectivosPorPaquetes(admin, paqueteIds), leerInfoFuentes(admin, fuentes)]);
  if (!ef.ok || !inf.ok) {
    return { filas: sinFuente, errorOrigenAereo: new Error(!ef.ok ? ef.error : (inf as ErrorTecnico).error) };
  }
  const conservadas = new Set<T>();
  for (const f of candidatas) {
    const efectivos = f.paquete_id != null ? ef.porPaquete.get(f.paquete_id) : undefined;
    // La vitrina oculta SOLO con evidencia positiva de que la fuente no está
    // permitida. Sin paquete verificable no hay evidencia (queda como hoy y la
    // venta —computarReserva— la rechaza igual con la regla estricta).
    // Un paquete sin destino comercial tampoco da evidencia aquí: la migración 181
    // ya bloquea su snapshot al quitarle el destino (la vista publicable lo oculta)
    // y la venta lo rechaza. Lo que NUNCA ocurre es ofrecer "todos los vuelos".
    if (!efectivos || !efectivos.ok) { conservadas.add(f); continue; }
    const info = inf.info.get(claveFuente(fuenteDe(f) as FuenteAerea)) ?? null;
    // Fuente borrada: la vitrina no la oculta (comportamiento de siempre para
    // bloqueos); computarReserva la rechaza como "fuente inexistente".
    if (!info) { conservadas.add(f); continue; }
    if (motivoRechazoFuente(efectivos.ids, info) === null) conservadas.add(f);
  }
  return { filas: filas.filter((f) => fuenteDe(f) === null || conservadas.has(f)), errorOrigenAereo: null };
}

// ─── Guardado de configuración: vuelos que quedarían incompatibles ──────────
export type VinculoAfectado = { fuente: FuenteAerea; ruta: string | null; record: string | null; destino_id: number | null };

type EnlaceConFuente = { ruta: string | null; record: string | null; destino_id: number | null; id: number };

/**
 * Vuelos YA vinculados al paquete que dejarían de cumplir con la configuración
 * propuesta. Un error de lectura devuelve `tecnico: true`: nunca se toma como
 * "cero vínculos".
 */
export async function vinculosIncompatibles(
  sb: ClienteDestinos,
  paqueteId: number,
  efectivosIds: number[]
): Promise<{ ok: true; afectados: VinculoAfectado[] } | ErrorTecnico> {
  const [rv, re, rs] = await Promise.all([
    sb.from("armado_vuelos").select("bloqueo_id, bloqueos_vuelo(id, record, ruta, destino_id)").eq("paquete_id", paqueteId),
    sb.from("armado_empaquetados").select("empaquetado_id, empaquetados(id, record, ruta, destino_id)").eq("paquete_id", paqueteId),
    // #63: las salidas de Dinámico vinculadas a un vuelo de Empaquetados cuentan igual que un vínculo de Sistema.
    sb.from("salidas_dinamicas").select("empaquetado_id, empaquetados(id, record, ruta, destino_id)").eq("paquete_id", paqueteId).not("empaquetado_id", "is", null),
  ]);
  if (rv.error || re.error || rs.error) return errorTecnico();
  const afectados: VinculoAfectado[] = [];
  for (const v of (rv.data ?? []) as unknown as { bloqueo_id: number; bloqueos_vuelo: EnlaceConFuente | null }[]) {
    const f = v.bloqueos_vuelo;
    if (motivoRechazoFuente(efectivosIds, f ? { id: f.id, destino_id: f.destino_id, ruta: f.ruta, record: f.record } : null)) {
      afectados.push({ fuente: { tipo: "bloqueo", id: v.bloqueo_id }, ruta: f?.ruta ?? null, record: f?.record ?? null, destino_id: f?.destino_id ?? null });
    }
  }
  for (const v of (re.data ?? []) as unknown as { empaquetado_id: number; empaquetados: EnlaceConFuente | null }[]) {
    const f = v.empaquetados;
    if (motivoRechazoFuente(efectivosIds, f ? { id: f.id, destino_id: f.destino_id, ruta: f.ruta, record: f.record } : null)) {
      afectados.push({ fuente: { tipo: "empaquetado", id: v.empaquetado_id }, ruta: f?.ruta ?? null, record: f?.record ?? null, destino_id: f?.destino_id ?? null });
    }
  }
  for (const v of (rs.data ?? []) as unknown as { empaquetado_id: number; empaquetados: EnlaceConFuente | null }[]) {
    const f = v.empaquetados;
    if (motivoRechazoFuente(efectivosIds, f ? { id: f.id, destino_id: f.destino_id, ruta: f.ruta, record: f.record } : null)) {
      afectados.push({ fuente: { tipo: "empaquetado", id: v.empaquetado_id }, ruta: f?.ruta ?? null, record: f?.record ?? null, destino_id: f?.destino_id ?? null });
    }
  }
  return { ok: true, afectados };
}

export async function leerCatalogoDestinos(
  sb: ClienteDestinos,
  ids: number[]
): Promise<{ ok: true; catalogo: Map<number, DestinoCatalogo> } | ErrorTecnico> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return { ok: true, catalogo: new Map() };
  const { data, error } = await sb.from("destinos").select("id, nombre, codigo_iata, pais, activo").in("id", unicos);
  if (error) return errorTecnico();
  return { ok: true, catalogo: new Map(((data ?? []) as DestinoCatalogo[]).map((d) => [d.id, d])) };
}

export type PreparacionGuardado =
  | { ok: true; destinosIds: number[] }
  | { ok: false; tecnico: boolean; error: string };

/**
 * Prepara el guardado de la configuración aérea de un paquete ANTES de tocar la
 * base: valida estrictamente la configuración y rechaza si algún vuelo ya
 * vinculado quedaría incompatible (hay que desvincularlo explícitamente; nunca
 * se borra en silencio). `paqueteId` null = paquete que aún no existe (sin vínculos).
 */
export async function prepararGuardadoDestinosAereos(
  sb: ClienteDestinos,
  paqueteId: number | null,
  entrada: EntradaDestinosAereos
): Promise<PreparacionGuardado> {
  const ids = [...(entrada.destinoComercialId != null ? [entrada.destinoComercialId] : []), ...entrada.alternativaIds];
  const cat = await leerCatalogoDestinos(sb, ids);
  if (!cat.ok) return { ok: false, tecnico: true, error: cat.error };
  const v = validarConfigDestinosAereos(entrada, cat.catalogo);
  if (!v.ok) return { ok: false, tecnico: false, error: v.error };

  if (paqueteId != null) {
    const ef = calcularDestinosEfectivos({ ...entrada, alternativaIds: v.alternativaIds }, cat.catalogo);
    if (!ef.ok) {
      // Sin destino comercial no hay destinos efectivos: todo vínculo actual quedaría fuera.
      const lig = await vinculosIncompatibles(sb, paqueteId, []);
      if (!lig.ok) return { ok: false, tecnico: true, error: lig.error };
      if (lig.afectados.length) return { ok: false, tecnico: false, error: mensajeVinculos(lig.afectados) };
    } else {
      const lig = await vinculosIncompatibles(sb, paqueteId, ef.ids);
      if (!lig.ok) return { ok: false, tecnico: true, error: lig.error };
      if (lig.afectados.length) return { ok: false, tecnico: false, error: mensajeVinculos(lig.afectados) };
    }
  }
  return { ok: true, destinosIds: v.alternativaIds };
}

export function mensajeVinculos(afectados: VinculoAfectado[]): string {
  const lista = afectados.slice(0, 8).map(nombreFuente2).join("; ");
  return `Hay ${afectados.length} vuelo(s) vinculado(s) que dejarían de cumplir los destinos aéreos del paquete: ${lista}${afectados.length > 8 ? "…" : ""}. Desvincúlalos explícitamente en la sección de vuelos y vuelve a guardar; no se borra ningún vuelo en automático.`;
}
const nombreFuente2 = (a: VinculoAfectado) => nombreFuente({ fuente: a.fuente, ruta: a.ruta, record: a.record });

/** Traduce el error de la base (triggers de la migración 220) a un mensaje para el usuario. Nunca devuelve texto crudo desconocido. */
export function mensajeErrorBase(mensaje: string | null | undefined): string {
  const m = mensaje ?? "";
  if (/destino_aereo_vinculos/i.test(m)) {
    return `Hay vuelos vinculados que dejarían de cumplir los destinos aéreos del paquete. Desvincúlalos explícitamente en la sección de vuelos y vuelve a guardar. ${m.replace(/^.*destino_aereo_vinculos:?\s*/i, "").slice(0, 300)}`.trim();
  }
  if (/destino_aereo_no_permitido/i.test(m)) return MENSAJES.noPermitido;
  if (/destino_aereo_config/i.test(m)) return `La configuración de destinos aéreos no es válida: ${m.replace(/^.*destino_aereo_config:?\s*/i, "").slice(0, 300)}`.trim();
  return MENSAJES.tecnico;
}

/** Para el selector del editor: destinos activos del mismo país que el comercial (sin el comercial). */
export function filtrarCandidatos(
  comercialId: number,
  todos: DestinoCatalogo[]
): { candidatos: DestinoCatalogo[]; paisComercial: string | null; motivo: string | null } {
  const cat = catalogoMap(todos);
  const comercial = cat.get(comercialId);
  if (!comercial) return { candidatos: [], paisComercial: null, motivo: "El destino comercial no existe." };
  const pais = normalizarPais(comercial.pais);
  if (pais === null) {
    return { candidatos: [], paisComercial: null, motivo: "El destino comercial no tiene país registrado: sin país comparable no se pueden habilitar alternativas." };
  }
  const candidatos = todos
    .filter((d) => d.id !== comercialId && d.activo === true && normalizarPais(d.pais) === pais)
    .sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? "", "es"));
  return { candidatos, paisComercial: pais, motivo: candidatos.length ? null : "No hay otros destinos activos del mismo país." };
}
