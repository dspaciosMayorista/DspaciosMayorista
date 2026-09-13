"use server";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3D Bernalo — re-validación SERVER-SIDE de la asociación habitación↔
// edades capturada en la UI (`EditorPax`, `app/tarifario/VistaBooking.tsx`).
//
// Regla 8 del encargo: "El servidor vuelve a validar; la UI no es
// autoridad." Esta Server Action recibe el payload TAL CUAL lo mandó el
// cliente (tratado como `unknown` — nunca se confía en el tipo declarado en
// el navegador) y corre la MISMA validación pura que ya corrió del lado del
// cliente para el preview (`validarHabitacionesOcupacion`,
// `lib/reservar/ocupacionPorHabitacion.ts`) — así que un cliente
// manipulado no puede colar una habitación sin validar. Reutiliza además el
// adaptador de Fase 3A (`adaptarOcupacionDesdeReservar`, Caso C) para
// devolver directamente el contrato canónico `HabitacionOcupacion[]`.
//
// Fuera de alcance de este archivo (ver el informe de la tarea):
//   - NO llama a `computarReserva` ni al orquestador de Fase 3C
//     (`orquestarCotizacionAlojamientoBernalo`/`resolverYCotizarAlojamientoBernalo`).
//   - NO cotiza (no llama `cotizarHabitaciones`) — solo valida y adapta.
//   - NO levanta ninguna guardia existente de `computo.ts`/`generarTarifario`.
//   - NO toca Supabase: esta validación es puramente de FORMA (enteros,
//     rangos, consistencia conteo↔edades) — no necesita ninguna consulta a
//     la base de datos. Ser una Server Action (y no una función pura
//     invocada directo) es justamente lo que prueba que el servidor la
//     re-ejecuta de verdad: un cliente no puede saltarse este paso.
// ─────────────────────────────────────────────────────────────────────────

import {
  validarHabitacionesOcupacion,
  type HabitacionOcupacionEntrada,
} from "@/lib/reservar/ocupacionPorHabitacion";
import {
  adaptarOcupacionDesdeReservar,
  type HabitacionOcupacion,
} from "@/lib/calc/ocupacionHabitacion";

export type ErrorValidacionOcupacionBernalo = { habitacionId: string | null; mensaje: string };

export type ResultadoValidarOcupacionBernalo =
  | { ok: true; habitaciones: HabitacionOcupacion[] }
  | { ok: false; errores: ErrorValidacionOcupacionBernalo[] };

/**
 * Re-valida (autoritativo, nunca confía en el cliente) la asociación
 * habitación↔edades capturada en la UI para un hotel Bernalo, y la adapta
 * hasta el contrato canónico de Fase 3A. No cotiza ni llama al orquestador
 * de Fase 3C — el resultado es el `HabitacionOcupacion[]` validado, listo
 * para que una fase posterior lo cotice.
 */
export async function validarOcupacionHabitacionesBernalo(input: {
  habitaciones: HabitacionOcupacionEntrada[];
  categoria: string | null;
  alimentacion: string | null;
  noches: number;
}): Promise<ResultadoValidarOcupacionBernalo> {
  const validacion = validarHabitacionesOcupacion(input.habitaciones);
  if (!validacion.ok) return validacion;

  const adaptado = adaptarOcupacionDesdeReservar({
    habitacionesPorTipo: {},
    paxTarifaPorTipo: {},
    distribucionMenores: null,
    edadesMenoresUsadas: null,
    totalMenoresDeclarados: 0,
    categoria: input.categoria,
    alimentacion: input.alimentacion,
    noches: input.noches,
    habitacionesExplicitas: validacion.habitaciones.map((h) => ({
      id: h.id,
      adultos: h.adultos,
      edadesMenores: h.edadesMenores,
    })),
  });

  if (!adaptado.ok) {
    return { ok: false, errores: [{ habitacionId: null, mensaje: adaptado.mensaje }] };
  }

  return { ok: true, habitaciones: adaptado.habitaciones };
}
