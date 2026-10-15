// Margen mínimo de un contrato manual (dinámico/empaquetado) — #30.
//
// Decisión del dueño:
//   · PVP  (venta directa o B2B que paga el total): (PVP − costo) / PVP ≥ 20 %.
//   · NETO (B2B con la comisión ya descontada):
//         (total exigible − costo) / total exigible ≥ 6 %.
// En NETO lo que entra es el total exigible (PVP − comisión del aliado), no el
// PVP: el margen se mide sobre eso. El total exigible sale del plan NETO ya
// validado (planNetoContratoManual), nunca de un número que mande el navegador.
//
// Equivale a exigir ingreso ≥ costo ÷ (1 − mínimo), con la misma tolerancia
// de medio peso que ya tenía la validación (redondeos de la UI): el límite
// exacto CUMPLE. Superadmin o administración pueden aprobar explícitamente un
// contrato que no cumpla (`forzarMargen`); el rol lo revalida el servidor.
//
// Puro: lo usan el servidor (crearContrato) y el formulario (aviso previo).

export const MARGEN_MINIMO_PVP = 0.2;
export const MARGEN_MINIMO_NETO = 0.06;
export const ROLES_EXCEPCION_MARGEN: readonly string[] = ["superadmin", "administracion"];

export type ModoMargen = "pvp" | "neto";

export type EvaluacionMargen = {
  modo: ModoMargen;
  /** Mínimo exigido (fracción 0–1). */
  minimo: number;
  /** Lo que entra: el PVP, o el total exigible en NETO. */
  ingreso: number;
  costos: number;
  /** Ingreso mínimo para cumplir: costos ÷ (1 − mínimo). */
  ingresoMinimo: number;
  /** (ingreso − costos) / ingreso; 0 si no hay ingreso. */
  margenActual: number;
  cumple: boolean;
};

export function evaluarMargenContrato(args: { modo: ModoMargen; ingreso: number; costos: number }): EvaluacionMargen {
  const minimo = args.modo === "neto" ? MARGEN_MINIMO_NETO : MARGEN_MINIMO_PVP;
  const ingreso = Number(args.ingreso) || 0;
  const costos = Math.max(0, Number(args.costos) || 0);
  const ingresoMinimo = costos / (1 - minimo);
  const margenActual = ingreso > 0 ? 1 - costos / ingreso : 0;
  // Sin costos cargados no hay margen que validar (igual que antes).
  const cumple = costos <= 0 || ingreso + 0.5 >= ingresoMinimo;
  return { modo: args.modo, minimo, ingreso, costos, ingresoMinimo, margenActual, cumple };
}

/** ¿Quien crea el contrato puede aprobarlo con el margen por debajo del mínimo? */
export function puedeAprobarMargenBajo(rol: string | null | undefined, forzarMargen: boolean | null | undefined): boolean {
  return !!forzarMargen && ROLES_EXCEPCION_MARGEN.includes(rol ?? "");
}

/** Mensaje del rechazo; `fmt` formatea en la moneda del contrato. */
export function mensajeMargenInsuficiente(e: EvaluacionMargen, fmt: (n: number) => string): string {
  const que = e.modo === "neto" ? "El total NETO" : "El PVP";
  const minimo = e.modo === "neto" ? "el total NETO mínimo" : "el PVP mínimo";
  return `${que} (${fmt(e.ingreso)}) no cubre el margen mínimo del ${Math.round(e.minimo * 100)}%. Con costos de ${fmt(e.costos)}, ${minimo} es ${fmt(Math.ceil(e.ingresoMinimo))} (margen actual: ${(e.margenActual * 100).toFixed(1)}%).`;
}
