/**
 * #25 (ADL-039) — Corrección de la ficha de un aliado por superadmin/gerencia: reglas puras (validación y diferencia contra lo que la persona vio).
 * Sin datos ni I/O. Campos corregibles: nombre, teléfono, correo, tipo y número de documento. Todo lo demás (% comisión, retención, banco, activo…)
 * conserva su pantalla propia. Mismos validadores que la edición del portal, para que ambos caminos acepten exactamente lo mismo.
 */
import { validarNombre, validarCampoFicha } from "@/lib/portal/perfilEdicion";

export type CampoCorreccion = "nombre" | "telefono" | "email" | "tipo_documento" | "nit";
export const ETIQUETA_CAMPO: Record<CampoCorreccion, string> = { nombre: "Nombre", telefono: "Teléfono", email: "Correo", tipo_documento: "Tipo de documento", nit: "Número de documento" };
const CAMPOS: CampoCorreccion[] = ["nombre", "telefono", "email", "tipo_documento", "nit"];

/** Entrada del formulario: solo estas llaves se leen. `esperado` = los valores con los que se abrió el formulario (solo para detectar una edición desfasada). */
export type EntradaCorreccion = {
  nombre?: unknown; telefono?: unknown; email?: unknown; tipoDocumento?: unknown; nit?: unknown; esperado?: unknown; confirmaImpacto?: unknown;
};

export const MSG_RECARGA_CORRECCION = "No se pudo comprobar qué datos estabas corrigiendo. Recarga la página e inténtalo de nuevo.";
export const MSG_CONFIRMA_IMPACTO = "Confirma que entiendes el alcance del cambio de nombre o documento.";

type Original = string | null;
type Res<T> = { ok: true; valor: T } | { ok: false; error: string };
const limpio = (x: unknown) => (typeof x === "string" ? x : "").replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim();

/** Compara documentos sin puntos, guiones ni espacios (900.123.456-7 = 9001234567). */
export const normalizarDocumento = (s: string | null | undefined) => String(s ?? "").replace(/[^0-9A-Za-z]/g, "").toLowerCase();

function validarDocumento(x: unknown): Res<string> {
  const v = limpio(x);
  if (!/^[0-9A-Za-z][0-9A-Za-z .-]{2,24}$/.test(v) || normalizarDocumento(v).length < 4) return { ok: false, error: "El número de documento debe tener entre 4 y 25 caracteres (letras, números, punto o guion)." };
  return { ok: true, valor: v };
}

function original(esperado: unknown, campo: string): Res<Original> {
  if (!esperado || typeof esperado !== "object" || Array.isArray(esperado) || !(campo in (esperado as object))) return { ok: false, error: MSG_RECARGA_CORRECCION };
  const v = (esperado as Record<string, unknown>)[campo];
  if (v !== null && (typeof v !== "string" || v.length > 400)) return { ok: false, error: MSG_RECARGA_CORRECCION };
  return { ok: true, valor: v as Original };
}

export type CambiosCorreccion = { cambios: Partial<Record<CampoCorreccion, string | null>>; esperado: Partial<Record<CampoCorreccion, Original>> };

/** Qué campos corrigió la persona: los que difieren de lo que VIO. Devuelve los valores nuevos validados y, por campo, el original que la base comparará al escribir. */
export function cambiosCorreccion(entrada: EntradaCorreccion): Res<CambiosCorreccion> {
  const cambios: CambiosCorreccion["cambios"] = {};
  const esperado: CambiosCorreccion["esperado"] = {};
  const crudo: Record<CampoCorreccion, unknown> = { nombre: entrada.nombre, telefono: entrada.telefono, email: entrada.email, tipo_documento: entrada.tipoDocumento, nit: entrada.nit };
  for (const campo of CAMPOS) {
    const nuevoCrudo = crudo[campo];
    if (nuevoCrudo === undefined) continue;
    const orig = original(entrada.esperado, campo);
    if (!orig.ok) return orig;
    if (limpio(nuevoCrudo) === limpio(orig.valor)) continue; // no tocó este campo
    let nuevo: Res<string | null>;
    if (campo === "nombre") nuevo = validarNombre(nuevoCrudo);
    else if (campo === "telefono" || campo === "email") nuevo = validarCampoFicha(campo, nuevoCrudo);
    else if (campo === "tipo_documento") { const t = limpio(nuevoCrudo); nuevo = t === "NIT" || t === "CC" ? { ok: true, valor: t } : { ok: false, error: "El tipo de documento debe ser NIT o Cédula." }; }
    else nuevo = validarDocumento(nuevoCrudo);
    if (!nuevo.ok) return nuevo;
    cambios[campo] = nuevo.valor;
    esperado[campo] = orig.valor;
  }
  if (("nombre" in cambios || "nit" in cambios || "tipo_documento" in cambios) && entrada.confirmaImpacto !== true) return { ok: false, error: MSG_CONFIRMA_IMPACTO };
  return { ok: true, valor: { cambios, esperado } };
}
