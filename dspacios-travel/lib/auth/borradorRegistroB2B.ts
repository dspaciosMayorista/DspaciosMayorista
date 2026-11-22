// O-4 — «Olvidé mi contraseña» desde «Continúa tu registro». Al salir a recuperar la contraseña el formulario del registro se perdería; este borrador conserva SOLO los datos
// del formulario (nunca contraseña, confirmación ni código) en el navegador de la misma persona, con vencimiento, para retomar el paso «Continúa tu registro» después de cambiar la clave.
// No concede ni salta nada: continuar sigue exigiendo correo + contraseña NUEVA comprobada contra Auth en el servidor (`continuarRegistroB2B`).

export const CLAVE_BORRADOR_REGISTRO = "dspacios.registroB2B.borrador";
export const VIGENCIA_BORRADOR_MS = 60 * 60 * 1000;

/** Campos del formulario que se pueden conservar. Lista cerrada: cualquier otra clave (password, passwordConfirm, codigo…) se descarta. */
const CAMPOS = ["tipo", "tipoDocumento", "nombre", "nit", "contacto", "email", "telefono", "ciudad", "notas"] as const;

export type DatosBorradorRegistro = Partial<Record<(typeof CAMPOS)[number], string>> & { aceptaNotificaciones?: boolean };
type AlmacenTexto = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function limpiar(d: Record<string, unknown>): DatosBorradorRegistro {
  const out: DatosBorradorRegistro = {};
  for (const c of CAMPOS) if (typeof d[c] === "string") out[c] = (d[c] as string).slice(0, 300);
  if (typeof d.aceptaNotificaciones === "boolean") out.aceptaNotificaciones = d.aceptaNotificaciones;
  return out;
}

/** Guarda el borrador (sin secretos). Devuelve false si el navegador no permite guardar: el flujo sigue funcionando, solo hay que volver a escribir los datos. */
export function guardarBorradorRegistro(almacen: AlmacenTexto | null | undefined, datos: Record<string, unknown>, ahora = Date.now()): boolean {
  try {
    if (!almacen) return false;
    const limpio = limpiar(datos);
    if (!limpio.email?.trim()) return false;
    almacen.setItem(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: ahora, datos: limpio }));
    return true;
  } catch { return false; }
}

/** Lee el borrador vigente (≤ 60 min). Uno vencido, ilegible o sin correo se borra y se trata como inexistente. */
export function leerBorradorRegistro(almacen: AlmacenTexto | null | undefined, ahora = Date.now()): DatosBorradorRegistro | null {
  try {
    if (!almacen) return null;
    const bruto = almacen.getItem(CLAVE_BORRADOR_REGISTRO);
    if (!bruto) return null;
    const p = JSON.parse(bruto) as { guardado?: unknown; datos?: unknown };
    if (typeof p.guardado !== "number" || ahora - p.guardado > VIGENCIA_BORRADOR_MS || ahora < p.guardado - 60_000 || !p.datos || typeof p.datos !== "object") { borrarBorradorRegistro(almacen); return null; }
    const d = limpiar(p.datos as Record<string, unknown>);
    if (!d.email?.trim()) { borrarBorradorRegistro(almacen); return null; }
    return d;
  } catch { return null; }
}

export function borrarBorradorRegistro(almacen: AlmacenTexto | null | undefined): void {
  try { almacen?.removeItem(CLAVE_BORRADOR_REGISTRO); } catch { /* sin almacenamiento: nada que borrar */ }
}

/** Almacén del navegador si existe (puede lanzar en ventanas privadas o con datos bloqueados). */
export function almacenNavegador(): AlmacenTexto | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}
