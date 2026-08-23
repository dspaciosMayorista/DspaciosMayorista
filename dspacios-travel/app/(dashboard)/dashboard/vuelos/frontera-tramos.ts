// ─────────────────────────────────────────────────────────────────────────
// FRONTERA — parsing/validación en RUNTIME de los argumentos PÚBLICOS del
// editor de vuelos del contrato (revisión adicional del PR #270). Los tipos
// de TypeScript de las Server Actions (`numeroContrato: string`, `tramos:
// TramoInput[]`) solo existen en tiempo de compilación: Next.js invoca una
// Server Action con lo que sea que haya llegado en el cuerpo de la petición
// HTTP ya deserializado — una llamada manipulada (curl/fetch directo al
// endpoint, no el cliente TS de esta app) puede mandar `null`, un objeto, un
// número donde se esperaba texto, etc. Sin esta capa, código que asumía esos
// tipos ya correctos (`.length`, `.trim()`, `.map()` sin comprobar `typeof`
// primero) puede lanzar un TypeError real y devolver un 500 — lo que además
// le quita a Postgres la oportunidad de dar su propio error de negocio
// controlado. Postgres SIGUE siendo la autoridad final (toda esta
// validación se re-hace allá, más estricta); esta capa solo protege la
// frontera HTTP/Server Action — nunca lanza, siempre devuelve un resultado
// explícito.
//
// Módulo PURO a propósito: sin "use server", sin imports de Supabase/next,
// para poder probarse importándolo DIRECTO desde `node --test` sin la
// cadena de imports server-only que rompe la resolución de módulos fuera
// de Next.js (mismo motivo por el que otras pruebas de este repo leen
// archivos como texto en vez de importarlos — ver pruebas/
// fronteraTramos.test.ts, que sí puede importar este archivo real).
// `app/(dashboard)/dashboard/vuelos/contrato-vuelos-actions.ts` ("use
// server") importa TODO de aquí; ese archivo solo agrega la llamada real
// al RPC de Postgres sobre datos ya saneados por estas funciones.
// ─────────────────────────────────────────────────────────────────────────

export type TramoInput = {
  id: number | null;
  aerolinea: string;
  record: string;
  direccion: "" | "ida" | "regreso";
  origenCodigo: string;
  origenCiudad: string;
  destinoCodigo: string;
  destinoCiudad: string;
  numeroVuelo: string;
  fecha: string;
  horaSalida: string;
  horaLlegada: string;
  servicios: string;
};

export const MAX_TRAMOS = 20;
export const MAX_NUMERO_CONTRATO = 30;
export const MAX_NOTA = 500;

const RE_IATA = /^[A-Z]{3}$/;
const RE_HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Espejo del dominio de ESTADOS_EMISION/esEstadoEmision en
// lib/vuelos/control.ts. Deliberadamente NO se importa desde acá (este
// módulo se mantiene SIN dependencias para poder probarse importándolo
// directo) — pruebas/fronteraTramos.test.ts blinda que este arreglo siga
// coincidiendo con el texto real de lib/vuelos/control.ts, así que un
// cambio de dominio allá que no se replique aquí rompe la prueba, no pasa
// desapercibido.
export const ESTADOS_EMISION_VALIDOS = ["pendiente", "emitido"] as const;
export type EstadoEmisionValido = (typeof ESTADOS_EMISION_VALIDOS)[number];

export const oNull = (s: string): string | null => (s && s.trim() !== "" ? s.trim() : null);

export function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parsearNumeroContrato(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > MAX_NUMERO_CONTRATO) return null;
  return v;
}

export function parsearNota(v: unknown): { ok: true; nota: string } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, nota: "" };
  if (typeof v !== "string" || v.length > MAX_NOTA) return { ok: false };
  return { ok: true, nota: v };
}

export function parsearEstadoEmisionInput(v: unknown): { ok: true; valor: EstadoEmisionValido | "" } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, valor: "" };
  if (typeof v !== "string") return { ok: false };
  if (!(ESTADOS_EMISION_VALIDOS as readonly string[]).includes(v)) return { ok: false };
  return { ok: true, valor: v as EstadoEmisionValido };
}

export function parsearIdTramo(v: unknown): { ok: true; id: number | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, id: null };
  // `Number.isSafeInteger` ya excluye decimales, NaN, Infinity y enteros
  // fuera del rango seguro — no hace falta combinarlo con Number.isInteger.
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) return { ok: false };
  return { ok: true, id: v };
}

export function parsearDireccionTramo(v: unknown): { ok: true; direccion: "" | "ida" | "regreso" } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, direccion: "" };
  if (v === "ida" || v === "regreso") return { ok: true, direccion: v };
  return { ok: false };
}

export function parsearTextoTramo(v: unknown): { ok: true; valor: string } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, valor: "" };
  if (typeof v !== "string") return { ok: false };
  return { ok: true, valor: v };
}

export const CAMPOS_TEXTO_TRAMO = [
  "aerolinea", "record", "origenCodigo", "origenCiudad", "destinoCodigo",
  "destinoCiudad", "numeroVuelo", "fecha", "horaSalida", "horaLlegada", "servicios",
] as const;

export function parsearTramo(v: unknown): { ok: true; tramo: TramoInput } | { ok: false; error: string } {
  if (!esObjetoPlano(v)) return { ok: false, error: "Cada tramo debe ser un objeto." };

  const idR = parsearIdTramo(v.id);
  if (!idR.ok) return { ok: false, error: "El id de un tramo debe ser null o un entero positivo." };

  const dirR = parsearDireccionTramo(v.direccion);
  if (!dirR.ok) return { ok: false, error: "La dirección de un tramo debe ser ida, regreso o ninguna." };

  const textos: Record<string, string> = {};
  for (const clave of CAMPOS_TEXTO_TRAMO) {
    const r = parsearTextoTramo(v[clave]);
    if (!r.ok) return { ok: false, error: `El campo ${clave} de un tramo debe ser texto.` };
    textos[clave] = r.valor;
  }

  return {
    ok: true,
    tramo: {
      id: idR.id,
      direccion: dirR.direccion,
      aerolinea: textos.aerolinea,
      record: textos.record,
      origenCodigo: textos.origenCodigo,
      origenCiudad: textos.origenCiudad,
      destinoCodigo: textos.destinoCodigo,
      destinoCiudad: textos.destinoCiudad,
      numeroVuelo: textos.numeroVuelo,
      fecha: textos.fecha,
      horaSalida: textos.horaSalida,
      horaLlegada: textos.horaLlegada,
      servicios: textos.servicios,
    },
  };
}

export function parsearTramos(v: unknown): { ok: true; tramos: TramoInput[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "El listado de tramos debe ser un arreglo." };
  const tramos: TramoInput[] = [];
  for (const el of v) {
    const r = parsearTramo(el);
    if (!r.ok) return { ok: false, error: r.error };
    tramos.push(r.tramo);
  }
  return { ok: true, tramos };
}

// Espejo LIVIANO (solo UX, feedback inmediato) de la validación de NEGOCIO
// real, que vive en Postgres dentro de guardar_tramos_contrato() — esa es
// la única autoridad (el RPC es SECURITY DEFINER, nunca confía en lo que
// valide el cliente). Mismos límites/reglas que el lado servidor. A
// diferencia de las funciones de arriba (que garantizan los TIPOS), esta
// ya recibe `tramos: TramoInput[]` genuinamente bien tipado —
// parsearTramos() se encarga de eso antes de llamarla.
export function validarTramos(tramos: TramoInput[]): string | null {
  if (!tramos.length) return "Debe haber al menos un tramo.";
  if (tramos.length > MAX_TRAMOS) return `No se pueden guardar más de ${MAX_TRAMOS} tramos en un solo contrato.`;

  const idsVistos = new Set<number>();
  for (const t of tramos) {
    if (t.id !== null) {
      if (!Number.isInteger(t.id) || t.id <= 0) return "El id de un tramo es inválido.";
      if (idsVistos.has(t.id)) return `Un tramo repite el id ${t.id}.`;
      idsVistos.add(t.id);
    }

    if (t.direccion && t.direccion !== "ida" && t.direccion !== "regreso") return "La dirección de un tramo es inválida.";

    const origen = oNull(t.origenCodigo);
    const destino = oNull(t.destinoCodigo);
    if (origen && !RE_IATA.test(origen.toUpperCase())) return "El código de origen debe tener exactamente 3 letras.";
    if (destino && !RE_IATA.test(destino.toUpperCase())) return "El código de destino debe tener exactamente 3 letras.";
    if (Boolean(origen) !== Boolean(destino)) return "Un tramo debe traer origen y destino juntos, o ninguno de los dos.";

    if (t.fecha && !RE_FECHA.test(t.fecha.trim())) return "La fecha de un tramo no es válida.";
    if (t.horaSalida && !RE_HORA.test(t.horaSalida.trim())) return "La hora de salida de un tramo no es válida.";
    if (t.horaLlegada && !RE_HORA.test(t.horaLlegada.trim())) return "La hora de llegada de un tramo no es válida.";

    if (t.aerolinea.length > 80) return "La aerolínea de un tramo es demasiado larga.";
    if (t.record.length > 20) return "El record (PNR) de un tramo es demasiado largo.";
    if (t.origenCiudad.length > 80 || t.destinoCiudad.length > 80) return "El nombre de una ciudad es demasiado largo.";
    if (t.numeroVuelo.length > 15) return "El número de vuelo es demasiado largo.";
    if (t.servicios.length > 500) return "El campo de servicios es demasiado largo.";

    const vacio = !oNull(t.aerolinea) && !oNull(t.record) && !t.direccion && !origen && !destino
      && !oNull(t.numeroVuelo) && !oNull(t.fecha) && !oNull(t.horaSalida) && !oNull(t.horaLlegada) && !oNull(t.servicios);
    if (vacio) return "Un tramo no puede estar completamente vacío.";
  }
  return null;
}
