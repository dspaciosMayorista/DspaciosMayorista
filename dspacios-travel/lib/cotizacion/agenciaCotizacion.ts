import type { Agencia } from "@/types/database";
import { camposFaltantesIdentidad } from "@/lib/agencia/identidadAgencia";

// #102 (Preview #403) — Fila de `agencias` (RNT, NIT, razón social, cuenta de pago) de la agencia DUEÑA DE LA COTIZACIÓN. El tenant sale SIEMPRE de la fila de la
// cotización (ya autorizada por sesión o por share_token), nunca de la URL. `agencias` es de lectura pública (109); la ruta pública lee con service-role.
//
// Tres casos que NO se confunden (antes todos caían a la constante de Mayorista, e imprimían su RNT en una cotización de Minorista):
//   · dato válido      → { ok: true, agencia }.
//   · fila ausente     → error en AMBAS agencias (#49): la constante `EMPRESA` es la identidad de MINORISTA y no acredita a Mayorista.
//   · error técnico    → error, sea cual sea el tenant: no se sabe qué RNT corresponde.
// Una fila sin RNT en Minorista tampoco acredita nada y es error. La ruta que recibe `ok: false` debe fallar de forma explícita (no imprimir).
type LectorAgencias = { from: (tabla: "agencias") => { select: (cols: "*") => { eq: (col: "tenant", valor: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error?: { message?: string } | null }> } } } };

export type ResultadoAgenciaCotizacion =
  | { ok: true; agencia: Agencia }
  | { ok: false; motivo: "tenant_invalido" | "error_tecnico" | "ausente" | "sin_rnt"; mensaje: string };

const NOMBRE: Record<string, string> = { mayorista: "Mayorista", minorista: "Minorista" };

export async function cargarAgenciaDeCotizacion(sb: unknown, tenant: string | null | undefined): Promise<ResultadoAgenciaCotizacion> {
  if (tenant !== "mayorista" && tenant !== "minorista") {
    return { ok: false, motivo: "tenant_invalido", mensaje: "La cotización no tiene una agencia válida; no se puede acreditar el RNT con el que se emite." };
  }
  const nombre = NOMBRE[tenant];
  const falla = (motivo: "error_tecnico" | "ausente" | "sin_rnt", causa: string): ResultadoAgenciaCotizacion => ({
    ok: false, motivo,
    mensaje: `No se pudo acreditar el RNT de ${nombre} para esta cotización (${causa}). No se genera el documento para no imprimir el RNT de otra agencia; reintenta o avisa a un administrador.`,
  });
  let respuesta: { data: unknown; error?: { message?: string } | null };
  try {
    respuesta = await (sb as LectorAgencias).from("agencias").select("*").eq("tenant", tenant).maybeSingle();
  } catch {
    return falla("error_tecnico", "falló la lectura de agencias");
  }
  if (respuesta.error) return falla("error_tecnico", "falló la lectura de agencias");
  const fila = respuesta.data as (Agencia & { rnt?: string | null }) | null;
  if (!fila) return falla("ausente", "no existe la fila de la agencia");
  const faltan = camposFaltantesIdentidad(fila);
  if (faltan.length) return falla("sin_rnt", `falta ${faltan.join(", ")} en «Datos de la agencia»`);
  return { ok: true, agencia: fila };
}
