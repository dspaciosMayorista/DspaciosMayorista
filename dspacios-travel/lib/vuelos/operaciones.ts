// Operaciones de inventario de Vuelos (tareas 2 y 3, migración 194).
//
// Funciones PURAS compartidas por las Server Actions y la interfaz. La
// autoridad está en la base: cada operación es una función SECURITY DEFINER
// que valida rol, agencia, contrato, estado y cupos dentro de una transacción.
// Lo de aquí solo evita llamadas inútiles y traduce los errores; repetir la
// regla en la interfaz NUNCA reemplaza la validación del servidor.

/** Cómo recibe el record destino al pasajero que se mueve. Sin valor por defecto. */
export type ModoMover = "solo_datos" | "con_cupo";

export const MODOS_MOVER: readonly ModoMover[] = ["solo_datos", "con_cupo"];

export function esModoMover(v: unknown): v is ModoMover {
  return typeof v === "string" && (MODOS_MOVER as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identificador de la operación, generado por el formulario al abrirse y
 * reutilizado en cada reintento: si la primera llamada sí se aplicó (y solo se
 * perdió la respuesta), la base responde "repetida" en vez de aplicarla dos veces.
 */
export function esOperacionId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function esIdPositivo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export type ErrorRpc = { code?: string | null; message?: string | null } | null | undefined;

/** Mensaje para el usuario a partir del error de una RPC de las migraciones 194–197. */
export function mensajeErrorRpc(e: ErrorRpc): { error: string; tarifaDistinta: boolean } {
  const code = e?.code ?? "";
  const msg = (e?.message ?? "").trim();
  if (code === "55P03" || /lock timeout/i.test(msg))
    return {
      error: "Otra persona está modificando este record en este momento. No se aplicó nada; espera unos segundos y vuelve a intentar.",
      tarifaDistinta: false,
    };
  if (code === "40P01" || /deadlock/i.test(msg))
    return { error: "La operación coincidió con otra y no se aplicó. Vuelve a intentar.", tarifaDistinta: false };
  if (code === "PGRST202" || code === "42883" || /could not find the function/i.test(msg))
    return {
      error: "Esta operación necesita una migración de base de datos (194 a 197) que todavía no está aplicada. No se cambió nada.",
      tarifaDistinta: false,
    };
  if (msg.startsWith("TARIFA_DISTINTA:"))
    return { error: msg.replace(/^TARIFA_DISTINTA:\s*/, ""), tarifaDistinta: true };
  // Migración 201: guarda de la retención en plazo (silla sin contrato con datos).
  if (msg.startsWith("RETENCION_INCOMPLETA:"))
    return { error: msg.replace(/^RETENCION_INCOMPLETA:\s*/, "No se guardó nada: "), tarifaDistinta: false };
  return { error: msg || "No se pudo completar la operación.", tarifaDistinta: false };
}

// ── Matriz DIR-1 (aprobada): cambios MANUALES de estado ──────────────────────
// Solo para sillas sin contrato ni pasajero. `cambio_entrante` = disponible.
// Devuelta es definitiva. No vendida → Devuelta solo con devolución real.
export type EstadoManual = "disponible" | "no_vendida" | "devuelta";

export type OpcionEstado = { value: EstadoManual; label: string; requiereDevolucionReal: boolean };

const ETIQUETA: Record<EstadoManual, string> = {
  disponible: "Disponible",
  no_vendida: "No vendida",
  devuelta: "Devuelta",
};

/** Destinos manuales permitidos desde `estado` (vacío = no hay cambio manual). */
export function transicionesManuales(estado: string): OpcionEstado[] {
  const desde = estado === "cambio_entrante" ? "disponible" : estado;
  const op = (value: EstadoManual, requiereDevolucionReal = false): OpcionEstado =>
    ({ value, label: ETIQUETA[value], requiereDevolucionReal });
  if (desde === "disponible") return [op("no_vendida"), op("devuelta")];
  if (desde === "no_vendida") return [op("disponible"), op("devuelta", true)];
  return [];
}

export function esEstadoManual(v: unknown): v is EstadoManual {
  return v === "disponible" || v === "no_vendida" || v === "devuelta";
}

/** Nuevo identificador de operación (uno por apertura de formulario). */
export function nuevaOperacionId(): string {
  return globalThis.crypto.randomUUID();
}
