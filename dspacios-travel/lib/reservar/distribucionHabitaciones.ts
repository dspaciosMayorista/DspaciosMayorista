// ─────────────────────────────────────────────────────────────────────────
// Distribución de adultos/niños/infantes ENTRE LAS HABITACIONES consultadas.
//
// Corrige un defecto real de la primera versión de este módulo: Niño 1 y
// Niño 2 NO son un límite de 2 por TODA la reserva — son un límite de 2
// POR HABITACIÓN (confirmado por el negocio): cada habitación admite como
// máximo un pasajero a tarifa Niño 1 y uno a tarifa Niño 2. Con 2
// habitaciones caben hasta 4 niños (2+2); con 3, hasta 6; etc. Un niño de
// más solo se rechaza si NINGUNA habitación consultada tiene cupo para él.
//
// Reglas de ocupación reales, tomadas de `lib/acomodaciones.ts` y del motor
// existente (`lib/reservar/computo.ts`/`EditorPax`), NO inventadas aquí:
// - `pax_tarifa` es la cantidad de adultos que la tarifa por persona de ESA
//   acomodación asume por habitación (Doble=2, Triple=3, …) — es lo que ya
//   fija `precioVenta = habitaciones × pax_tarifa × pvp`, fórmula que este
//   módulo NO toca. Por eso los "adultos por habitación" de la distribución
//   son siempre `pax_tarifa`, nunca un valor que el usuario reparta a mano
//   por habitación.
// - `adt_min`/`adt_max` son el rango real de adultos que la acomodación
//   admite — se usan para validar que la cantidad de habitaciones elegida
//   tenga sentido para la cantidad de adultos declarada, no para cambiar el
//   precio.
// - `chd_max` es cuántos niños admite la habitación — pero el límite de
//   TARIFAS es 2 (Niño 1 y Niño 2), así que la capacidad real de niño de
//   una habitación para este reparto es `min(chd_max, 2)`.
// - Los infantes usan `inf_max` como su propio cupo, independiente de
//   `pax_max`: en todo el motor existente el infante "no ocupa silla"
//   (mismo comentario textual en computo.ts) — así que, a diferencia de
//   niño, no se descuenta del `pax_max` de la habitación.
// - `pax_max` sigue limitando adultos+niños (el infante queda afuera, ver
//   punto anterior) — una habitación no puede recibir un niño si ya está
//   llena de adultos+niños hasta `pax_max`.
//
// Algoritmo: determinista, por ORDEN DE CAPTURA — recorre las habitaciones
// consultadas en el orden en que llegaron (mismo orden en que el usuario las
// armó) y les va asignando niños/infantes de a uno, respetando el cupo real
// de cada una. Nunca clasifica por nombre/texto/posición accidental: cada
// habitación es un objeto con su acomodación y su config ya resuelta.
//
// Módulo PURO (sin "use client"/"use server", sin imports de Supabase/next)
// — se importa directo desde `node --test` (pruebas/distribucionHabitaciones.test.ts)
// y desde el cliente (preview) y el servidor (autoritativo).
// ─────────────────────────────────────────────────────────────────────────

import type { AcomRoom } from "../acomodaciones.ts";

// Tope de tarifas de niño por habitación — Niño 1 y Niño 2, nunca una 3ª.
const MAX_NINO_TARIFAS_POR_HABITACION = 2;

export type ConfigCapacidadHabitacion = {
  pax_tarifa: number;
  pax_max: number;
  adt_min: number;
  adt_max: number;
  chd_min: number;
  chd_max: number;
  inf_min: number;
  inf_max: number;
};

export type HabitacionConsultada = {
  acom: AcomRoom;
  config: ConfigCapacidadHabitacion;
};

export type AsignacionHabitacion = {
  indice: number; // posición en el arreglo de habitaciones consultadas (orden de captura)
  acom: AcomRoom;
  adultos: number; // = config.pax_tarifa de esa habitación — la fórmula de precio no cambia
  nino: 0 | 1;
  nino2: 0 | 1;
  infantes: number;
};

export type TotalesDistribucion = { adultos: number; nino: number; nino2: number; infantes: number };

export type ResultadoDistribucion =
  | { ok: true; habitaciones: AsignacionHabitacion[]; totales: TotalesDistribucion }
  | { ok: false; error: string };

export function distribuirPorHabitaciones(input: {
  adultosDeclarados: number;
  ninos: number; // cantidad ya clasificada como "niño" por edad (sin repartir aún)
  infantes: number; // cantidad ya clasificada como infante
  habitaciones: HabitacionConsultada[];
}): ResultadoDistribucion {
  const { adultosDeclarados, ninos, infantes, habitaciones } = input;
  if (!habitaciones.length) return { ok: false, error: "Indica al menos una habitación." };

  // ── Adultos: la fórmula de precio (habitaciones × pax_tarifa) ya fija
  // cuántos adultos "caben" en la selección de habitaciones — el campo
  // Adultos declarado por el usuario debe coincidir con eso; si no, la
  // selección de habitaciones no corresponde a la cantidad de viajeros.
  const adultosImplicitos = habitaciones.reduce((s, h) => s + h.config.pax_tarifa, 0);
  const adtMinTotal = habitaciones.reduce((s, h) => s + h.config.adt_min, 0);
  const adtMaxTotal = habitaciones.reduce((s, h) => s + h.config.adt_max, 0);
  if (adultosDeclarados !== adultosImplicitos) {
    return {
      ok: false,
      error: `Las habitaciones elegidas son para ${adultosImplicitos} adulto(s); declaraste ${adultosDeclarados}. Ajusta la cantidad de habitaciones o de adultos.`,
    };
  }
  if (adultosDeclarados < adtMinTotal || adultosDeclarados > adtMaxTotal) {
    return {
      ok: false,
      error: `La distribución seleccionada no admite ${adultosDeclarados} adulto(s) (las habitaciones elegidas admiten entre ${adtMinTotal} y ${adtMaxTotal}).`,
    };
  }

  const asign: AsignacionHabitacion[] = habitaciones.map((h, i) => ({
    indice: i, acom: h.acom, adultos: h.config.pax_tarifa, nino: 0, nino2: 0, infantes: 0,
  }));

  // ── Niños: primer niño de CADA habitación → Niño 1; segundo → Niño 2.
  // Nunca más de 2 por habitación, y respeta pax_max (adultos+niños).
  let ninosRestantes = ninos;
  for (const a of asign) {
    if (ninosRestantes <= 0) break;
    const cfg = habitaciones[a.indice].config;
    const capNinoRoom = Math.min(cfg.chd_max, MAX_NINO_TARIFAS_POR_HABITACION, Math.max(0, cfg.pax_max - a.adultos));
    if (capNinoRoom >= 1 && ninosRestantes > 0) { a.nino = 1; ninosRestantes--; }
    if (capNinoRoom >= 2 && ninosRestantes > 0) { a.nino2 = 1; ninosRestantes--; }
  }
  if (ninosRestantes > 0) {
    const capTotalNino = habitaciones.reduce(
      (s, h) => s + Math.min(h.config.chd_max, MAX_NINO_TARIFAS_POR_HABITACION, Math.max(0, h.config.pax_max - h.config.pax_tarifa)),
      0
    );
    const sujeto = habitaciones.length === 1 ? "La habitación seleccionada admite" : `Las ${habitaciones.length} habitaciones seleccionadas admiten`;
    return { ok: false, error: `${sujeto} máximo ${capTotalNino} niño(s); hay ${ninos}.` };
  }

  // ── Infantes: cupo propio (`inf_max`), independiente de pax_max — el
  // infante no ocupa silla/habitación (misma regla ya documentada en
  // computo.ts). Se reparten por orden de habitación, sin tope de "1 por
  // habitación" (a diferencia de niño, no hay dos tarifas distintas de
  // infante).
  let infantesRestantes = infantes;
  for (const a of asign) {
    if (infantesRestantes <= 0) break;
    const cfg = habitaciones[a.indice].config;
    const tomar = Math.min(cfg.inf_max, infantesRestantes);
    a.infantes = tomar;
    infantesRestantes -= tomar;
  }
  if (infantesRestantes > 0) {
    const capTotalInf = habitaciones.reduce((s, h) => s + h.config.inf_max, 0);
    const sujeto = habitaciones.length === 1 ? "La habitación seleccionada admite" : `Las ${habitaciones.length} habitaciones seleccionadas admiten`;
    return { ok: false, error: `${sujeto} máximo ${capTotalInf} infante(s); hay ${infantes}.` };
  }

  const totales = asign.reduce(
    (t, a) => ({ adultos: t.adultos + a.adultos, nino: t.nino + a.nino, nino2: t.nino2 + a.nino2, infantes: t.infantes + a.infantes }),
    { adultos: 0, nino: 0, nino2: 0, infantes: 0 } as TotalesDistribucion
  );
  return { ok: true, habitaciones: asign, totales };
}
