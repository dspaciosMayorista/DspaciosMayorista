// #94 — Lectura del resumen de precios del cliente congelado en un contrato (`contrato_resumen_precios`, migración 304). Solo servidor.
//
// Tres resultados que NO se confunden:
//   · fila encontrada                 ⇒ el resumen (JSON tal como se guardó; el documento lo valida contra el acuerdo con `resumenAplicable`);
//   · sin fila                        ⇒ null: contrato HISTÓRICO (o de un tipo que no genera resumen); el documento se presenta como siempre;
//   · error de lectura (red, permiso) ⇒ se LANZA: un fallo no se disfraza de «contrato histórico», sería mostrar el formato anterior sin avisar.
// Única excepción: la tabla aún no existe (código de «relación no encontrada») porque el código se desplegó antes de aplicar la 304; se registra y se trata como sin fila
// para no tumbar todos los contratos por un orden de despliegue. El orden correcto sigue siendo migración primero.
import { registrarErrorTecnico } from "@/lib/observabilidad/medicion";

type Lectura = { data: { resumen: unknown } | null; error: { code?: string; message: string } | null };
// El cliente tipado de Supabase hace la inferencia infinita con un parámetro estructural: se tipa solo lo que se usa.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = { from: (t: "contrato_resumen_precios") => any };

/**
 * Códigos que significan «la tabla no existe todavía»: PGRST205 (no está en el caché de esquema de PostgREST) y 42P01 (undefined_table de Postgres).
 * PGRST200 NO está aquí: es «no se halló la relación (join) entre tablas», un error real de la consulta, no una tabla ausente.
 */
const TABLA_AUSENTE = new Set(["PGRST205", "42P01"]);

export function clasificarLecturaResumen(l: Lectura, numero: string): { tipo: "resumen"; resumen: unknown } | { tipo: "sin_snapshot" } | { tipo: "error"; mensaje: string } {
  if (l.error) {
    if (l.error.code && TABLA_AUSENTE.has(l.error.code)) {
      registrarErrorTecnico("contrato_documento", numero, "resumen_precios", "tabla_ausente", l.error);
      return { tipo: "sin_snapshot" };
    }
    return { tipo: "error", mensaje: l.error.message };
  }
  return l.data ? { tipo: "resumen", resumen: l.data.resumen } : { tipo: "sin_snapshot" };
}

export async function leerResumenContrato(sb: Cliente, numero: string): Promise<unknown | null> {
  const l = (await sb.from("contrato_resumen_precios").select("resumen").eq("numero_contrato", numero).maybeSingle()) as Lectura;
  const c = clasificarLecturaResumen(l, numero);
  if (c.tipo === "error") {
    registrarErrorTecnico("contrato_documento", numero, "resumen_precios", "lectura", l.error);
    throw new Error(`No se pudo leer el resumen de precios del contrato ${numero}: ${c.mensaje}`);
  }
  return c.tipo === "resumen" ? c.resumen : null;
}
