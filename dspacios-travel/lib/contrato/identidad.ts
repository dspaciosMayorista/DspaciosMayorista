// Identidad del contrato (#75): el NÚMERO es una etiqueta visible; la identidad es `ventas.contrato_uid`.
// Una pantalla (o el flujo que CREA un contrato) declara qué contrato abrió con la cabecera HTTP `x-contratos` = JSON {"<numero>": "<uid>"}; la base
// (migración 284) rechaza la escritura si el uid declarado no es el del contrato vigente, o si falta y el contrato nació de un número reutilizado.
//
// REGLAS (no negociables):
//  · El uid sale de los MISMOS datos que la pantalla leyó (misma consulta que trajo el contrato). NUNCA se resuelve después "por número" para una
//    petición que ya venía de una pantalla: eso devolvería la identidad del contrato NUEVO a un formulario que aún muestra datos del anterior.
//  · Una acción de usuario RECIBE la identidad de la pantalla y la reenvía; no la lee de la base para sustituirla.
//  · Este módulo es puro (sin red ni base): se prueba sin Supabase.

/** Mapa número → uid del contrato tal como lo abrió la pantalla. */
export type IdentidadContrato = Readonly<Record<string, string>>;

export const CABECERA_IDENTIDAD = "x-contratos";
export const IDENTIDAD_VACIA: IdentidadContrato = Object.freeze({});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Identidad de UN contrato; `uid` vacío/ inválido → identidad vacía (la base decidirá: un contrato de siempre pasa, uno de reuso se rechaza). */
export function identidadDe(numero: string | null | undefined, uid: string | null | undefined): IdentidadContrato {
  if (!numero || !esUid(uid)) return IDENTIDAD_VACIA;
  return Object.freeze({ [numero]: uid.toLowerCase() });
}

/** Entrada que viene del navegador (no confiable): conserva solo pares válidos; nunca lanza. */
export function parseIdentidad(x: unknown): IdentidadContrato {
  if (!x || typeof x !== "object" || Array.isArray(x)) return IDENTIDAD_VACIA;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (k && k.length <= 64 && esUid(v)) out[k] = v.toLowerCase();
  }
  return Object.freeze(out);
}

/** Une identidades de varios contratos (p. ej. mover información entre dos). Si un número aparece con dos uids distintos, gana el PRIMERO y se marca el conflicto. */
export function unirIdentidades(...ids: Array<IdentidadContrato | null | undefined>): IdentidadContrato {
  const out: Record<string, string> = {};
  for (const id of ids) for (const [k, v] of Object.entries(id ?? {})) if (!(k in out)) out[k] = v;
  return Object.freeze(out);
}

/** Cabeceras HTTP para el cliente de Supabase ({} si no hay identidad que declarar). */
export function cabecerasIdentidad(id: IdentidadContrato | null | undefined): Record<string, string> {
  if (!id || Object.keys(id).length === 0) return {};
  return { [CABECERA_IDENTIDAD]: JSON.stringify(id) };
}

/** ¿El uid declarado para `numero` en `id`? (solo lectura; no consulta nada) */
export function uidDeclarado(id: IdentidadContrato | null | undefined, numero: string): string | null {
  const v = id?.[numero];
  return esUid(v) ? v : null;
}

const CODIGOS = ["CONTRATO_CAMBIO", "IDENTIDAD_REQUERIDA", "SOPORTE_IDENTIDAD", "IDENTIDAD_INMUTABLE", "FINANCIERO_IDENTIDAD"];
export const MENSAJE_IDENTIDAD =
  "Este contrato cambió desde que abriste la página (otra persona lo eliminó o lo reemplazó). No se guardó nada. Vuelve al listado y ábrelo de nuevo.";

/** ¿El error de la base/acción es un rechazo por identidad? (SQLSTATE F4601/F4602/F4603/F4521 o el código en el mensaje) */
export function esErrorIdentidad(e: { message?: string | null; code?: string | null } | string | null | undefined): boolean {
  if (!e) return false;
  const msg = typeof e === "string" ? e : (e.message ?? "");
  const code = typeof e === "string" ? "" : (e.code ?? "");
  return /^F46(01|02|03)$|^F4521$/.test(code) || CODIGOS.some((c) => msg.includes(c));
}

/** Mensaje para la persona si el error es de identidad; null si es otro error (el llamador conserva su propio manejo). */
export function mensajeSiIdentidad(e: { message?: string | null; code?: string | null } | string | null | undefined): string | null {
  return esErrorIdentidad(e) ? MENSAJE_IDENTIDAD : null;
}
