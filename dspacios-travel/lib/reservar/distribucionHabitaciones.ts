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
// - `adt_min`/`adt_max` son el rango real de adultos que ESA habitación (una
//   fila de `hotel_acomodaciones`) admite — migración 027, ej. "Doble: máx 4
//   | adt 2–2 | chd 0–2 | inf 0–2". Como los adultos de una habitación son
//   siempre `pax_tarifa` (fijo, ver arriba), el chequeo real es POR
//   HABITACIÓN: `pax_tarifa` de esa fila debe caer en `[adt_min, adt_max]`
//   de esa MISMA fila — nunca una suma agregada entre habitaciones de
//   distinto tipo (una Sencilla mal configurada no se "compensa" con una
//   Doble bien configurada). El total declarado por el usuario (`Adultos`)
//   se compara aparte, contra la suma de `pax_tarifa` (ver más abajo).
// - `chd_max`/`chd_min` son el rango de niños que admite ESA habitación —
//   pero el límite de TARIFAS es 2 (Niño 1 y Niño 2), así que la capacidad
//   MÁXIMA real de niño de una habitación para este reparto es
//   `min(chd_max, 2)`. `chd_min` (auditado: capturado desde la migración 027
//   y expuesto en el editor de acomodaciones — "Niño mín." — pero nunca
//   antes leído por ningún validador, ni el de producción
//   `validarReservaHabitaciones` ni este módulo) se aplica igual que
//   `adt_min`/`adt_max`: es un mínimo POR HABITACIÓN, no una suma — una
//   habitación con `chd_min > 0` exige que se le asignen al menos esa
//   cantidad de niños si se usa, sin importar si otra habitación de la
//   misma búsqueda ya tiene niños de sobra. Por defecto es `0` (ninguna
//   restricción) para todo hotel que no lo haya configurado explícitamente.
// - Los infantes usan `inf_max`/`inf_min` como su propio cupo/mínimo,
//   independiente de `pax_max`: en todo el motor existente el infante "no
//   ocupa silla" (mismo comentario textual en computo.ts) — así que, a
//   diferencia de niño, no se descuenta del `pax_max` de la habitación.
//   `inf_min` se exige igual que `chd_min`: por habitación, no por suma.
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

import { ACOM_ROOM_LABEL, type AcomRoom } from "../acomodaciones.ts";

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
  if (adultosDeclarados !== adultosImplicitos) {
    return {
      ok: false,
      error: `Las habitaciones elegidas son para ${adultosImplicitos} adulto(s); declaraste ${adultosDeclarados}. Ajusta la cantidad de habitaciones o de adultos.`,
    };
  }
  // Sanidad POR HABITACIÓN (no una suma agregada): los adultos de CADA
  // habitación son siempre su `pax_tarifa` fijo — ese valor debe caer dentro
  // del rango `adt_min..adt_max` configurado para ESA fila. Detecta una
  // habitación mal configurada en el hotel (ej. pax_tarifa=2 pero adt_min=3)
  // sin que otra habitación de la búsqueda la "compense" en la suma.
  for (const h of habitaciones) {
    if (h.config.pax_tarifa < h.config.adt_min || h.config.pax_tarifa > h.config.adt_max) {
      return {
        ok: false,
        error: `La habitación ${ACOM_ROOM_LABEL[h.acom]} admite entre ${h.config.adt_min} y ${h.config.adt_max} adulto(s); está configurada para ${h.config.pax_tarifa}.`,
      };
    }
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
  // Mínimo de niños POR HABITACIÓN (`chd_min`, default 0 = sin restricción).
  // Simétrico con `adt_min`/`adt_max`: si el hotel exige un mínimo de niños
  // en esa acomodación (ej. una habitación "familiar"), la distribución debe
  // cumplirlo — no basta con que el TOTAL de niños de la búsqueda alcance,
  // cada habitación que lo exige debe recibir su propio mínimo.
  for (const a of asign) {
    const cfg = habitaciones[a.indice].config;
    if (cfg.chd_min > 0 && a.nino + a.nino2 < cfg.chd_min) {
      return {
        ok: false,
        error: `La habitación ${ACOM_ROOM_LABEL[a.acom]} exige mínimo ${cfg.chd_min} niño(s); esta distribución le asigna ${a.nino + a.nino2}.`,
      };
    }
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
  // Mínimo de infantes POR HABITACIÓN (`inf_min`, default 0), mismo criterio
  // que `chd_min` arriba.
  for (const a of asign) {
    const cfg = habitaciones[a.indice].config;
    if (cfg.inf_min > 0 && a.infantes < cfg.inf_min) {
      return {
        ok: false,
        error: `La habitación ${ACOM_ROOM_LABEL[a.acom]} exige mínimo ${cfg.inf_min} infante(s); esta distribución le asigna ${a.infantes}.`,
      };
    }
  }

  const totales = asign.reduce(
    (t, a) => ({ adultos: t.adultos + a.adultos, nino: t.nino + a.nino, nino2: t.nino2 + a.nino2, infantes: t.infantes + a.infantes }),
    { adultos: 0, nino: 0, nino2: 0, infantes: 0 } as TotalesDistribucion
  );
  return { ok: true, habitaciones: asign, totales };
}
