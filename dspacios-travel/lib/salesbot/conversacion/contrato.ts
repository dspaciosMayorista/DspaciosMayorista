// Contrato de la CONVERSACIÓN GUIADA de SalesBot (#56, MVP). Tipos y funciones
// PURAS (sin I/O). Sin LLM: un flujo determinista sobre las consultas ya
// saneadas (Programas, Bloqueos y Porción terrestre).
//
// La conversación vive SOLO en la memoria de la página abierta: el navegador
// devuelve el estado en cada turno y el servidor NO confía en él —
// `sanearEstado` lo reduce a una forma válida y toda selección se revalida
// contra una búsqueda nueva (ver flujo.ts). Nada se guarda en base de datos,
// URL, localStorage ni logs.
import { ACOM_ROOMS, type AcomRoom } from "@/lib/acomodaciones";

export type ProductoConversacion = "programa" | "bloqueo" | "porcion";

/** Lo que el bot preguntó en el turno anterior: la respuesta del usuario se interpreta para ese dato. */
export type Pregunta =
  | "producto"
  | "destino"
  | "fechas"
  | "adultos"
  | "habitaciones"
  | "menores"
  | "seleccion"
  | "combo"
  | "agencia";

export const PREGUNTAS: readonly Pregunta[] = ["producto", "destino", "fechas", "adultos", "habitaciones", "menores", "seleccion", "combo", "agencia"];

export type EstadoConversacion = {
  v: 1;
  producto: ProductoConversacion | null;
  /** Texto de destino (Programas, Bloqueos) o un destino publicado exacto (Porción). */
  destino: string | null;
  /** true = el usuario dijo "cualquiera" (solo Programas y Bloqueos). */
  cualquierDestino: boolean;
  fechaIda: string | null;
  fechaRegreso: string | null;
  adultos: number | null;
  habitaciones: Partial<Record<AcomRoom, number>> | null;
  edadesMenores: number[] | null;
  /** Programa id, clave de oferta de bloqueo o "paquete-hotel" de porción. Se revalida siempre. */
  seleccion: string | null;
  /** "categoria|regimen" (Bloqueo y Porción). */
  combo: string | null;
  agenciaId: number | null;
  pendiente: Pregunta | null;
  /** Valores de la última lista mostrada, para "la 2" o "el primero". Se revalidan como cualquier selección. */
  ultimaLista: string[];
};

export function estadoInicial(): EstadoConversacion {
  return {
    v: 1,
    producto: null,
    destino: null,
    cualquierDestino: false,
    fechaIda: null,
    fechaRegreso: null,
    adultos: null,
    habitaciones: null,
    edadesMenores: null,
    seleccion: null,
    combo: null,
    agenciaId: null,
    pendiente: "producto",
    ultimaLista: [],
  };
}

/** Opción seleccionable: `valor` es un comando del flujo, nunca un dato que el servidor acepte sin revalidar. */
export type Opcion = { etiqueta: string; valor: string };

export type MensajeBot = {
  texto: string;
  lineas?: string[];
  opciones?: Opcion[];
  /** Enlace interno (vitrina del programa), siempre una ruta relativa del sitio. */
  enlace?: { etiqueta: string; href: string };
  aviso?: boolean;
};

export type EntradaConversacion = { tipo: "inicio" } | { tipo: "texto"; texto: string } | { tipo: "opcion"; valor: string };

export type RespuestaConversacion = { ok: boolean; estado: EstadoConversacion; mensajes: MensajeBot[] };

export const MAX_TEXTO_ENTRADA = 300;
export const MAX_VALOR_OPCION = 160;
const MAX_LISTA = 10;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function esFechaReal(v: unknown): v is string {
  if (typeof v !== "string" || !FECHA_ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const entero = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

const textoCorto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};

/**
 * Reduce un estado recibido del navegador a una forma válida. Cualquier campo
 * mal formado queda vacío (se volverá a preguntar); un objeto que no es un
 * estado da el estado inicial. No decide si una selección sigue vigente: eso
 * lo revalida el flujo contra el servidor.
 */
export function sanearEstado(v: unknown): EstadoConversacion {
  if (!v || typeof v !== "object" || Array.isArray(v) || (v as { v?: unknown }).v !== 1) return estadoInicial();
  const e = v as Record<string, unknown>;
  const producto = e.producto === "programa" || e.producto === "bloqueo" || e.producto === "porcion" ? e.producto : null;
  let habitaciones: Partial<Record<AcomRoom, number>> | null = null;
  if (e.habitaciones && typeof e.habitaciones === "object" && !Array.isArray(e.habitaciones)) {
    const h: Partial<Record<AcomRoom, number>> = {};
    for (const a of ACOM_ROOMS) {
      const n = entero((e.habitaciones as Record<string, unknown>)[a], 1, 10);
      if (n != null) h[a] = n;
    }
    habitaciones = Object.keys(h).length ? h : null;
  }
  let edadesMenores: number[] | null = null;
  if (Array.isArray(e.edadesMenores) && e.edadesMenores.length <= 12) {
    const edades = e.edadesMenores.map((x) => entero(x, 0, 17));
    edadesMenores = edades.every((x) => x != null) ? (edades as number[]) : null;
  }
  const fechaIda = esFechaReal(e.fechaIda) ? e.fechaIda : null;
  const fechaRegreso = esFechaReal(e.fechaRegreso) && fechaIda && e.fechaRegreso > fechaIda ? e.fechaRegreso : null;
  const pendiente = typeof e.pendiente === "string" && (PREGUNTAS as readonly string[]).includes(e.pendiente) ? (e.pendiente as Pregunta) : null;
  const ultimaLista = Array.isArray(e.ultimaLista)
    ? e.ultimaLista.filter((x): x is string => typeof x === "string" && x.length <= MAX_VALOR_OPCION).slice(0, MAX_LISTA)
    : [];
  return {
    v: 1,
    producto,
    destino: textoCorto(e.destino, 80),
    cualquierDestino: e.cualquierDestino === true,
    fechaIda,
    fechaRegreso,
    adultos: entero(e.adultos, 1, 40),
    habitaciones,
    edadesMenores,
    seleccion: textoCorto(e.seleccion, MAX_VALOR_OPCION),
    combo: textoCorto(e.combo, 120),
    agenciaId: entero(e.agenciaId, 1, Number.MAX_SAFE_INTEGER),
    pendiente,
    ultimaLista,
  };
}

/** Sanea la entrada del navegador: forma, tipos y longitud. */
export function sanearEntrada(v: unknown): EntradaConversacion | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  if (e.tipo === "inicio") return { tipo: "inicio" };
  if (e.tipo === "texto" && typeof e.texto === "string") {
    const t = e.texto.trim();
    return t && t.length <= MAX_TEXTO_ENTRADA ? { tipo: "texto", texto: t } : null;
  }
  if (e.tipo === "opcion" && typeof e.valor === "string") {
    const t = e.valor.trim();
    return t && t.length <= MAX_VALOR_OPCION ? { tipo: "opcion", valor: t } : null;
  }
  return null;
}
