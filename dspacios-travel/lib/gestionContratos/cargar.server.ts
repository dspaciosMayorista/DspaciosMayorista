// #106 · Carga de Gestión de contratos: UNA llamada a `fn_gestion_contratos` (página + conteo exacto + resumen). Solo superadmin: la página comprueba el rol
// antes de pedir nada y la base lo vuelve a exigir (42501). No usa tenantContext/getTenant ni el cliente service-role: la agencia es un FILTRO de la
// pantalla, nunca la cookie de agencia activa, y la RLS sigue siendo la segunda red.
import { createClient } from "@/lib/supabase/server";
import { esSuperadminActivo } from "./acceso.server";
import { aFiltrosRpc, parsearFiltros, POR_PAGINA, type EntradaUrl, type FiltrosGestion } from "./filtros";
import { parsearRespuesta, type RespuestaGestion } from "./tipos";

export type CargaGestion =
  | { estado: "sin_permiso" }
  | { estado: "error"; mensaje: string }
  | { estado: "ok"; filtros: FiltrosGestion; pagina: number; avisos: string[]; datos: RespuestaGestion };

export async function cargarGestionContratos(entrada: EntradaUrl): Promise<CargaGestion> {
  const sb = await createClient();
  if (!(await esSuperadminActivo(sb))) return { estado: "sin_permiso" };
  const { filtros, pagina, avisos } = parsearFiltros(entrada);
  const { data, error } = await sb.rpc("fn_gestion_contratos", {
    p_filtros: aFiltrosRpc(filtros),
    p_orden: filtros.orden,
    p_limite: POR_PAGINA,
    p_desplazamiento: (pagina - 1) * POR_PAGINA,
  });
  if (error) {
    if (error.code === "42501") return { estado: "sin_permiso" };
    // El detalle técnico no se muestra al usuario; no se reintenta (un fallo persistente se corrige, no se repite en bucle).
    return { estado: "error", mensaje: "No se pudo cargar la lista de contratos. Recarga la página; si persiste, avisa a soporte." };
  }
  try {
    return { estado: "ok", filtros, pagina, avisos, datos: parsearRespuesta(data) };
  } catch {
    return { estado: "error", mensaje: "La respuesta de la base no tiene la forma esperada; no se muestra para no presentar datos incorrectos." };
  }
}
