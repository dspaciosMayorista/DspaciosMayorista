// ─────────────────────────────────────────────────────────────────────────
// Horas locales del recorrido de un hotel con vuelo — fuente de los suplementos de traslado por franja horaria.
//
// Dónde viven hoy las horas (inventario):
//   · bloqueos_vuelo:      hora_llegada_ida (llegada del vuelo de ida) y hora_salida_reg (salida del vuelo de regreso) — tipo `time`.
//   · salidas_dinamicas:   mismas columnas, tipo `text` (paquetes dinámicos).
//   · contrato_vuelos:     hora_salida / hora_llegada POR TRAMO (texto libre del contrato; ya contratado, no se usa para cotizar).
//   · porción terrestre, empaquetados y salidas vinculadas a empaquetado: NO guardan horas -> hay que capturar la hora prevista del traslado.
// Traslado de llegada = hora local de LLEGADA del vuelo de ida; traslado de salida = hora local de SALIDA del vuelo de regreso.
// Si la fuente no tiene la hora (o no es interpretable) el tramo queda sin hora y la liquidación pide capturarla: no se supone ninguna.
//
// Servidor únicamente (recibe el cliente admin ya creado).
// ─────────────────────────────────────────────────────────────────────────
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatearHora, parseHora, type HorasTramos } from "@/lib/calc/trasladoFranjas";

type Fuente = { modulo: "bloqueo" | "porcion_terrestre" | "dinamico"; bloqueoId: number | null; salidaId?: number | null };

const normalizar = (t: unknown): string | undefined => {
  const m = parseHora(t);
  return m == null ? undefined : formatearHora(m);
};

/** Horas del vuelo de este ítem. `{}` = la fuente no guarda horas (terrestre) o están vacías. Un error de lectura se devuelve, no se traga. */
export async function horasDelRecorrido(
  admin: ReturnType<typeof createAdminClient>, f: Fuente,
): Promise<{ ok: true; horas: HorasTramos } | { ok: false; error: string }> {
  if (f.modulo === "bloqueo" && f.bloqueoId) {
    const { data, error } = await admin.from("bloqueos_vuelo").select("hora_llegada_ida, hora_salida_reg").eq("id", f.bloqueoId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, horas: compactar(data?.hora_llegada_ida, data?.hora_salida_reg) };
  }
  if (f.modulo === "dinamico" && f.salidaId) {
    const { data, error } = await admin.from("salidas_dinamicas").select("hora_llegada_ida, hora_salida_reg").eq("id", f.salidaId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, horas: compactar(data?.hora_llegada_ida, data?.hora_salida_reg) };
  }
  return { ok: true, horas: {} };
}

function compactar(llegada: unknown, salida: unknown): HorasTramos {
  const l = normalizar(llegada);
  const s = normalizar(salida);
  return { ...(l ? { llegada: l } : {}), ...(s ? { salida: s } : {}) };
}

/** Horas efectivas: las del vuelo (servidor, autoritativas) mandan sobre las capturadas por el navegador, que solo completan los tramos sin hora. */
export function combinarHoras(capturadas: HorasTramos | undefined, delVuelo: HorasTramos): HorasTramos {
  return { ...(capturadas ?? {}), ...delVuelo };
}

/** ¿Cambió el horario desde la cotización? Compara tramo a tramo lo cotizado contra lo vigente (sin hora vigente = no se puede confirmar = cambió). */
export function horarioCambio(cotizadas: HorasTramos | undefined, vigentes: HorasTramos, tramosCotizados: ("llegada" | "salida")[]): ("llegada" | "salida")[] {
  return tramosCotizados.filter((t) => (cotizadas?.[t] ?? null) !== (vigentes[t] ?? null));
}
