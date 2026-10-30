// Errores de la base que llegan a los formularios de Programas: mensajes claros para quien edita, nunca SQL ni PostgREST.
// Los mensajes de NEGOCIO que las funciones de la base lanzan a propósito (`raise exception`, código P0001, en español) se conservan: dicen qué corregir.
// El detalle técnico (código, nombre de la restricción) va solo al registro del servidor, sin valores del usuario.
export type ErrorDb = { code?: string | null; message?: string | null };

export const MENSAJE_HOTEL_DUPLICADO = "Ya existe un hotel con ese nombre en este programa. Usa otro nombre";

const TECNICO = /\b(constraint|violates|duplicate key|relation|column|function|syntax|SQLSTATE|PGRST|schema|policy|permission denied|jwt)\b|\bpublic\./i;

function restriccion(msg: string): string | null {
  return /(?:constraint|index) "([a-z0-9_]+)"/i.exec(msg)?.[1] ?? null;
}

export function mensajeErrorPrograma(e: ErrorDb, accion: string): string {
  const code = e.code ?? "";
  const msg = e.message ?? "";
  const r = restriccion(msg);
  console.error(`[programas] accion=${accion} codigo=${code || "desconocido"}${r ? ` restriccion=${r}` : ""}`);

  if (code === "23505") {
    return r === "uq_programa_hoteles_nombre" ? MENSAJE_HOTEL_DUPLICADO : "Ya existe un registro con esos datos. Revisa que no estés repitiendo un nombre o una fecha.";
  }
  if (code === "23503") return "Algún dato elegido ya no existe o está en uso (por ejemplo un proveedor, un hotel o una reserva). Actualiza la página, revisa la selección e inténtalo de nuevo.";
  if (code === "23502") return "Falta un dato obligatorio. Revisa el formulario e inténtalo de nuevo.";
  if (code === "23514" || code.startsWith("22")) return "Algún valor no es válido (texto demasiado largo, número o fecha fuera de rango). Revisa el formulario e inténtalo de nuevo.";
  if (code === "42501" || code === "PGRST301" || /row-level security|permission denied/i.test(msg)) return "No tienes permiso para hacer este cambio. Si crees que deberías tenerlo, avisa al administrador.";
  if (code === "P0001" && msg.trim() && !TECNICO.test(msg)) return msg.trim();
  return "No se pudo guardar el cambio. Inténtalo de nuevo; si el problema continúa, avisa a soporte.";
}
