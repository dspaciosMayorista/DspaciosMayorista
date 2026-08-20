// ─────────────────────────────────────────────────────────────────────────
// Origen del VUELO de una reserva — discriminante único y validado en
// servidor. Antes de esto, `ReservaInput` traía `bloqueoId`/`empaquetadoId`/
// `salidaId` como tres campos sueltos, opcionales, sin ninguna regla que
// impidiera mandar más de uno a la vez. Consecuencia real (revisión de PR
// #268, defecto 1): con `bloqueoId` Y `empaquetadoId` presentes a la vez,
// `computarReserva` priorizaba `empaquetadoId` para el PVP, pero
// `reservar/actions.ts` tenía DOS bloques `if` independientes (no
// `if/else`) — uno para sillas+CxP del bloqueo, otro para CxP del
// empaquetado — que corrían LOS DOS: PVP calculado desde un Empaquetado,
// tramo del contrato copiado del OTRO vuelo (el bloqueo, por ser el primer
// `if` en la sección 7), sillas reales consumidas de un bloqueo negociado
// que nunca se cobró, y DOS cuentas por pagar aéreas.
//
// `resolverOrigenVuelo` es el ÚNICO punto que decide "cuál de los tres
// campos manda" — se llama UNA vez (dentro de `computarReserva`, el primer
// paso de todo flujo de reserva/cotización) y su resultado (`OrigenVuelo`,
// un solo tipo discriminado) es lo que el resto del código debe leer de ahí
// en adelante. Nadie más vuelve a mirar `input.bloqueoId`/`empaquetadoId`/
// `salidaId` directamente — así una rama de código nueva que olvide pasar
// por aquí no puede reintroducir el defecto silenciosamente.
// ─────────────────────────────────────────────────────────────────────────

export type OrigenVuelo =
  | { tipo: "bloqueo"; id: number }
  | { tipo: "empaquetado"; id: number }
  | { tipo: "salida"; id: number }
  | { tipo: "ninguno" };

export type ModuloReserva = "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";

export type EntradaOrigenVuelo = {
  modulo: ModuloReserva;
  bloqueoId?: number | null;
  empaquetadoId?: number | null;
  salidaId?: number | null;
};

function esEnteroPositivo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * Valida y resuelve el origen de vuelo de una reserva. Nunca confía en que
 * el cliente haya mandado una combinación coherente — la regla se aplica
 * aquí, una sola vez, para TODOS los módulos:
 *
 *   modulo=bloqueo       → exactamente uno entre bloqueoId/empaquetadoId; salidaId ausente.
 *   modulo=dinamico      → exactamente salidaId; bloqueoId/empaquetadoId ausentes.
 *   otros módulos        → ninguno de los tres.
 *
 * Los ids presentes deben ser enteros positivos (nunca 0, negativos, ni
 * decimales) — un id inválido podría cruzar por casualidad con una fila
 * "sin origen" (`bloqueo_id is null`) en la consulta de tarifario.
 */
export function resolverOrigenVuelo(
  input: EntradaOrigenVuelo
): { ok: true; origen: OrigenVuelo } | { ok: false; error: string } {
  const validarForma = (nombre: string, v: number | null | undefined): { ok: true; v: number | null } | { ok: false; error: string } => {
    if (v == null) return { ok: true, v: null };
    if (!esEnteroPositivo(v)) return { ok: false, error: `${nombre} inválido.` };
    return { ok: true, v };
  };

  const rb = validarForma("bloqueoId", input.bloqueoId);
  if (!rb.ok) return rb;
  const re = validarForma("empaquetadoId", input.empaquetadoId);
  if (!re.ok) return re;
  const rs = validarForma("salidaId", input.salidaId);
  if (!rs.ok) return rs;
  const bloqueoId = rb.v, empaquetadoId = re.v, salidaId = rs.v;

  if (input.modulo === "bloqueo") {
    if (salidaId !== null) return { ok: false, error: "Un paquete tipo bloqueo no usa salida dinámica." };
    const presentes = [bloqueoId, empaquetadoId].filter((v) => v !== null);
    if (presentes.length === 0) return { ok: false, error: "Selecciona un vuelo negociado o un empaquetado." };
    if (presentes.length > 1) return { ok: false, error: "No se puede reservar con un vuelo negociado y un empaquetado a la vez." };
    return { ok: true, origen: bloqueoId !== null ? { tipo: "bloqueo", id: bloqueoId } : { tipo: "empaquetado", id: empaquetadoId! } };
  }

  if (input.modulo === "dinamico") {
    if (bloqueoId !== null || empaquetadoId !== null) return { ok: false, error: "Un paquete dinámico no usa vuelo negociado ni empaquetado." };
    if (salidaId === null) return { ok: false, error: "Elige una salida." };
    return { ok: true, origen: { tipo: "salida", id: salidaId } };
  }

  // porcion_terrestre / servicios: ningún origen de vuelo.
  if (bloqueoId !== null || empaquetadoId !== null || salidaId !== null)
    return { ok: false, error: "Este tipo de paquete no lleva vuelo." };
  return { ok: true, origen: { tipo: "ninguno" } };
}

// ─────────────────────────────────────────────────────────────────────────
// Vigencia de compra de un Empaquetado — fechas INCLUSIVAS, zona
// America/Bogota. `compra_inicio`/`compra_fin` son columnas `date` (sin
// hora): se comparan como strings "YYYY-MM-DD", el mismo formato en que
// Postgres/supabase-js las entrega y en que Intl con locale 'en-CA' formatea
// una fecha — comparación lexicográfica == comparación cronológica para ISO.
// ─────────────────────────────────────────────────────────────────────────

export function hoyBogota(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(ahora);
}

export function empaquetadoVigente(
  compraInicio: string | null,
  compraFin: string | null,
  hoyISO: string
): boolean {
  if (compraInicio && hoyISO < compraInicio) return false;
  if (compraFin && hoyISO > compraFin) return false;
  return true;
}
