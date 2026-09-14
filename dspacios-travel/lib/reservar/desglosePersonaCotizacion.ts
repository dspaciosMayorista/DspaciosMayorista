// ─────────────────────────────────────────────────────────────────────────
// Hallazgo confirmado durante la validación del fix de "Adultos 1" en la
// cotización pública (`crearCotizacionCarrito`, app/tarifario/checkout/actions.ts):
// las filas per-cápita que se reconstruyen ahí (habitaciones + Niño 1/2 +
// Infante) NO son necesariamente todo `comp.data.precioVenta` — un servicio
// INCLUIDO del paquete con cobro por GRUPO (`cargoGrupoIncluido`, ver
// `lib/reservar/computo.ts` línea ~755) se suma a `precioVenta` sin pasar por
// `lineasHab` ni `pvpPorAcom`, porque su costo depende del tamaño real del
// grupo (no se puede hornear por acomodación como el modo "persona").
//
// Este módulo es la ÚNICA fuente que decide cuánto de `precioVenta` NO está
// cubierto por las filas per-cápita — PURO (sin Supabase/Next), para poder
// probarlo con `node --test` real en vez de inspección de código fuente.
//
// Regla de negocio (fail-closed, sin tolerancias):
//   - diferencia > 0 → hay un cargo agregado real (servicios incluidos por
//     grupo, en el único flujo que llama a esto — ver el comentario en
//     `crearCotizacionCarrito`) que debe representarse como línea AGREGADA
//     separada, nunca repartido entre adultos/menores.
//   - diferencia === 0 → las filas per-cápita ya cubren el 100% de
//     `precioVenta`, no se agrega nada.
//   - diferencia < 0 → inconsistencia interna (las filas visibles sumarían
//     MÁS que lo que se le cobra al cliente) — nunca se guarda una
//     cotización así, se corta con error.
// ─────────────────────────────────────────────────────────────────────────

export type LineaHabitacionVisible = { pax: number; pvp: number };

export type ResidualServiciosIncluidosPorGrupo =
  | { ok: true; residual: number }
  | { ok: false; error: string };

export function calcularResidualServiciosIncluidosPorGrupo(params: {
  precioVenta: number;
  lineasHab: readonly LineaHabitacionVisible[];
  numNinos: number;
  tarifaNino: number | null | undefined;
  numNinos2: number;
  tarifaNino2: number | null | undefined;
  numInfantes: number;
  tarifaInfante: number | null | undefined;
}): ResidualServiciosIncluidosPorGrupo {
  let subtotalVisible = 0;
  for (const l of params.lineasHab) subtotalVisible += l.pax * l.pvp;
  if (params.numNinos > 0 && params.tarifaNino != null) subtotalVisible += params.numNinos * params.tarifaNino;
  if (params.numNinos2 > 0 && params.tarifaNino2 != null) subtotalVisible += params.numNinos2 * params.tarifaNino2;
  if (params.numInfantes > 0 && params.tarifaInfante != null) subtotalVisible += params.numInfantes * params.tarifaInfante;

  const residual = params.precioVenta - subtotalVisible;
  if (residual < 0) {
    return {
      ok: false,
      error: `Inconsistencia interna: las filas visibles del hotel suman ${subtotalVisible}, más que el precio de venta cotizado (${params.precioVenta}).`,
    };
  }
  return { ok: true, residual };
}
