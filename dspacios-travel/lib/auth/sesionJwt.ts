// Puro (sin I/O): extrae el `session_id` del payload de un access token de
// Supabase Auth. NO verifica la firma: el llamador solo debe usarlo sobre un
// token que el servidor ya validó (`auth.getUser()`), y la base vuelve a
// comprobar la sesión contra `auth.sessions` antes de confiar en ella.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionIdDeAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const sid = (JSON.parse(json) as { session_id?: unknown }).session_id;
    return typeof sid === "string" && UUID.test(sid) ? sid.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Códigos con los que las RPC de la 237 informan por `message` (ver migración).
export type CodigoContexto =
  | "ok"
  | "ya_iniciada"
  | "sin_sesion"
  | "sin_servicio"
  | "sesion_inexistente"
  | "usuario_inactivo"
  | "agencia_no_permitida"
  | "agencia_invalida"
  | "fuera_de_ventana"
  | "sin_contexto"
  | "error";

const CONOCIDOS: readonly CodigoContexto[] = [
  "ya_iniciada", "sesion_inexistente", "usuario_inactivo", "agencia_no_permitida",
  "agencia_invalida", "fuera_de_ventana", "sin_contexto",
];

export function codigoDeErrorContexto(error: { message?: string } | null | undefined): CodigoContexto {
  if (!error) return "ok";
  const m = (error.message ?? "").trim();
  return CONOCIDOS.find((c) => c === m) ?? "error";
}

/** Mensaje para el usuario cuando una escritura de catálogo global fue denegada. */
export function mensajeCatalogoDenegado(opts: { agenciaActivaCookie: string; sincronizado: boolean }): string {
  if (opts.agenciaActivaCookie === "minorista") {
    return "Los catálogos globales solo se editan desde la agencia Mayorista. Cambia a Mayorista y vuelve a intentarlo.";
  }
  if (!opts.sincronizado) {
    return "Tu sesión no tiene la agencia vinculada. Cierra sesión y vuelve a ingresar para editar catálogos globales.";
  }
  return "Los catálogos globales solo se editan desde la agencia Mayorista.";
}
