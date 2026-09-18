// ─────────────────────────────────────────────────────────────────────────
// Calculadoras de tarifa por hotel (estructuras especiales)
// ─────────────────────────────────────────────────────────────────────────
// Cada hotel especial guarda un TIPO de calculadora + sus PARÁMETROS. Aquí
// viven las funciones PURAS que, a partir de esos parámetros, producen las
// filas normales de `tarifa_hotel`. Así "montamos el resultado" solos y el
// resto del sistema (tarifario, reservar, contrato) no cambia.
//
// Para sumar un hotel con OTRA estructura: se agrega un nuevo tipo + su función
// `generar...` y se registra en `generarTarifas()`. El marco (guardar params,
// botón Generar, escribir tarifa_hotel) se reutiliza.
//
// ── Ronda "Dubai — fase principal" ──────────────────────────────────────────
// Cierra el diseño aprobado (informe previo, "alternativa B: columnas
// explícitas en tarifa_hotel"): cada fila generada por Dubai puede llevar su
// propia regla de edad (infante/niño) además de su propio suplemento de
// régimen — por BASE (`bases[]`) y por PROMOCIÓN (`promos[]`), con la
// promoción ganando sobre su base cuando ambas configuran edades propias.
//
//   · `edad_infante_min/max`, `edad_nino_min/max` en `TarifaGenerada` (nuevo,
//     opcional): NULL salvo que la base/promo que generó la fila tenga
//     `usarEdadesPropias`. Requiere la migración 177 (`tarifa_hotel`,
//     PROPUESTA, NO aplicada — ver supabase/migrations/20260601000177_*) para
//     persistir; mientras no se aplique, `generarTarifasCalculadora`
//     (hoteles/actions.ts) seguiría fallando al insertar si alguien activa
//     el checkbox ANTES de correr la migración — comportamiento fail-closed
//     deliberado (la columna no existe, Postgres rechaza el insert), nunca
//     un dato inventado.
//   · `DubaiBase.usarEdadesPropias/edadesPropias` y
//     `DubaiPromo.usarEdadesPropias/edadesPropias` (nuevo): mismas 4
//     columnas y mismas reglas de rango que el CHECK SQL de la migración
//     177 (`lib/calc/reglaEdadTarifa.ts::validarRangoReglaEdad` — fuente
//     ÚNICA, no se reimplementa acá). Herencia: la fila que genera una promo
//     usa (1) el override de la PROMO si lo activó, si no (2) el override de
//     SU base (misma temporadaBase+categoría) si esa base lo activó, si no
//     (3) `null` (fallback general — regla de `hoteles`, resuelta en
//     `lib/reservar/computo.ts`/`cotizar.ts`, NO acá: este archivo solo
//     persiste el override crudo, nunca resuelve el fallback).
//   · `DubaiBase.usarSuplementosPropios/suplementosPropios` (nuevo): cada
//     BASE puede reemplazar el `suplementos[]` general para los regímenes
//     que ella genera (base régimen siempre en 0, igual que el general —
//     una base no tiene contexto de "promoción" para justificar un cargo
//     sobre su propio régimen base). Desactivado/ausente → fallback a
//     `suplementos[]` general, exactamente el histórico.
//   · `DubaiPromo.usarSuplementoPropio/suplementoPropioMonto` (REDISEÑADO
//     esta ronda: antes era un arreglo `suplementosPropios[]` con un campo
//     por CADA régimen del hotel, pero una promoción solo genera filas para
//     `promo.regimen` — el resto de esos campos nunca se usaban. Ahora es
//     un único `number | null`, atado siempre a `promo.regimen` (incluido
//     el régimen base, si la promo aplica sobre él — a diferencia de una
//     base, una promoción SÍ puede justificar un cargo propio incluso sobre
//     el régimen base). `null`/ausente = vacío/incompleto (si
//     `usarSuplementoPropio` está activo, falla la validación); `0` = cero
//     explícito, válido.
//   · `condicionesPropias` (sin cambios de la ronda anterior): sigue
//     escribiéndose en `tarifa_hotel.notas`. El cableado hacia el documento
//     de cotización/contrato queda para una ronda aparte — ver el informe.
//   · `validarDubaiParams` (reescrito): detecta bases duplicadas por
//     categoría+temporada, valida edades/suplementos propios de cada base Y
//     de cada promo, y corrige el falso positivo de la ronda anterior — dos
//     promos con el mismo `temporadaPromo+regimen` YA NO se marcan
//     "solapadas" si sus categorías reales (derivadas de `bases[]` por
//     `temporadaBase`) no se intersectan.
//
// nino_pct/nino2_pct se CONFIRMAN generales (decisión del dueño, informe
// previo): no ganan override por promoción en esta ronda — una promoción
// Dubai siempre deriva Niño 1/Niño 2 con el MISMO % que la tarifa regular,
// solo sobre una base distinta (la descontada). Niño 1/Niño 2 POR
// HABITACIÓN sigue siendo `lib/reservar/distribucionHabitaciones.ts`
// (motor existente, sin tocar) — Dubai únicamente le da a esa habitación
// una tarifa de Niño 2 real cuando `nino2_pct` está configurado.
// ─────────────────────────────────────────────────────────────────────────

import {
  validarRangoReglaEdad,
  type ReglaEdadTarifa,
} from "./reglaEdadTarifa.ts";

/** Fila de tarifa lista para insertar en `tarifa_hotel` (sin hotel_id). */
export type TarifaGenerada = {
  tipo_habitacion: string;   // categoría (ej. "estandar", "superior")
  alimentacion: string;      // régimen (ej. "PC", "PAM")
  temporada: string;         // nombre de la temporada del hotel
  neto_sencilla: number;
  neto_doble: number;
  neto_triple: number;
  neto_multiple: number;
  neto_nino: number;
  neto_nino2: number | null;
  neto_infante: number | null;
  nota_infante: string | null;
  notas?: string | null;     // nota general de la fila (ej. "Tarifa no incluye impuestos")
  // Edades propias de ESTA fila — migración 177 (PROPUESTA, no aplicada).
  // `undefined`/ausente en calculadoras que no las generan (Mixta/
  // Corporativa); `null` en Dubai cuando ni la base ni la promo activaron
  // "edades propias" (fallback general, resuelto en `computo.ts`/`cotizar.ts`,
  // nunca acá). Las 4 vienen juntas o ninguna — mismo criterio que el CHECK SQL.
  edad_infante_min?: number | null;
  edad_infante_max?: number | null;
  edad_nino_min?: number | null;
  edad_nino_max?: number | null;
  // Identidad de precio final — migración 179 (PROPUESTA, no aplicada). SOLO
  // `generarTarifasDubai` la enciende, y SOLO en las filas que genera para
  // `promos[]`: el neto de esa fila YA tiene el descuento, el suplemento
  // propio (o general) y los modificadores de acomodación HORNEADOS — es el
  // precio final que se debe cobrar, no una vigencia genérica que el motor
  // deba recalcular desde la base. `temporada_base` es la temporada de la
  // que se derivó (identidad para auditoría, `promos[].temporadaBase`).
  // `undefined` en filas de BASE y en Mixta/Corporativa → columnas quedan en
  // su default (`false`/`null`), comportamiento histórico sin cambios.
  precio_final_autoritativo?: boolean;
  temporada_base?: string | null;
};

// ── Calculadora "DUBAI" ────────────────────────────────────────────────────
// Una base por persona/noche (en DOBLE, con el régimen base incluido) por
// categoría y temporada, y el resto se deriva con modificadores:
//   sencilla = base × (1 + sencilla%)        (suplemento individual)
//   doble    = base
//   triple   = (base×2 + base×(1+3erPax%)) / 3
//   múltiple = (base×2 + base×(1+3erPax%) + base×(1+4toPax%)) / 4
//   niño     = base × (1 + niño%)
// Luego cada régimen suma un monto fijo por persona (el base suma 0).
// Promoción de temporada (regla comercial, corregida — antes el descuento
// se aplicaba SOLO a la base y el suplemento se sumaba después intacto):
// el % de descuento se aplica sobre la tarifa COMPLETA del régimen
// promocionado — base + suplemento efectivo (propio de la promo, si no el
// propio de la base, si no el general) — así que el suplemento SÍ queda
// descontado junto con la base. El régimen base nunca suma suplemento
// (salvo que la propia promoción fuerce uno con su override). Genera una
// temporada NUEVA (`temporadaPromo`, debe existir como vigencia de `hotel_temporadas`
// con su propia vigencia de compra/fechas) a partir de una base ya cargada
// (`temporadaBase`), y SOLO para el régimen elegido (aunque el hotel tenga
// varios) — el resto de régimen no se tocan para esa temporada promocional.
/** Suplemento de régimen — mismo shape en `suplementos[]` (general) y en
 * `suplementosPropios[]` (por base). Las promociones usan un único valor
 * (`suplementoPropioMonto`), no un arreglo — ver la cabecera del archivo. */
export type DubaiSuplementoRegimen = { regimen: string; monto: number };

/** Una fila de `bases[]` — categoría×temporada×precio, con configuración
 * OPCIONAL propia de edades y suplementos (nuevo esta ronda). */
export type DubaiBase = {
  categoria: string;
  temporada: string;
  precio: number;
  // Edades propias de ESTA base — checkbox + 4 límites (mismas reglas que
  // el CHECK SQL). Ausente/false → NULL en las filas que genera (fallback
  // general). Una promoción que parta de esta temporada+categoría hereda
  // este override SI ELLA no declara uno propio.
  usarEdadesPropias?: boolean;
  edadesPropias?: ReglaEdadTarifa;
  // Suplementos propios de ESTA base — reemplaza COMPLETO `suplementos[]`
  // general para los regímenes que esta base genera (el régimen base sigue
  // en 0 siempre, igual que en el modelo general: una base no tiene un
  // contexto de "promoción" que justifique cargo sobre su propio régimen).
  usarSuplementosPropios?: boolean;
  suplementosPropios?: DubaiSuplementoRegimen[];
  // Condición propia de ESTA base (texto libre, ej. "Tarifa temporada baja,
  // no incluye impuestos hoteleros.") — se escribe en `notas` de TODAS las
  // filas que genera esta base (todas sus filas por régimen). Independiente
  // de `DubaiPromo.condicionesPropias`: una promoción NUNCA hereda la
  // condición de su base — cada fila lleva SOLO la condición de quien la
  // generó (ver el bucle de `bases[]`/`promos[]` en `generarTarifasDubai`).
  condicionesPropias?: string;
};

export type DubaiPromo = {
  temporadaBase: string;
  temporadaPromo: string;
  regimen: string;
  descuentoPct: number;
  // Edades propias de ESTA promoción — gana sobre el override de su base
  // (ver `edadesEfectivasDeFila` más abajo). Ausente/false → hereda el de
  // su base si la base lo activó; si tampoco, NULL (fallback general).
  usarEdadesPropias?: boolean;
  edadesPropias?: ReglaEdadTarifa;
  // ── Suplemento propio (opcional, por promoción) — REDISEÑADO esta ronda:
  // un único valor atado a `promo.regimen` (nunca un arreglo por régimen:
  // la promo solo genera filas para SU régimen). `false`/ausente (dato
  // histórico) → fallback a `suplementos[]` general, comportamiento
  // IDÉNTICO al de siempre. `true` con `suplementoPropioMonto` numérico
  // (incluido `0`, cero explícito) → ese valor exclusivo, incluso si
  // `promo.regimen` es el régimen base del hotel (a diferencia de una
  // base, una promoción SÍ puede justificar un cargo sobre el régimen
  // base). `true` con `suplementoPropioMonto: null`/ausente → vacío,
  // configuración incompleta (falla `validarPromoDubai`).
  usarSuplementoPropio?: boolean;
  suplementoPropioMonto?: number | null;
  // Condición propia de ESTA promo (texto libre, ej. "No reembolsable. No
  // endosable. Válida solo para reservas nuevas.") — se escribe tal cual en
  // `notas` de las filas que genera esta promo. Sin configurar, `notas`
  // queda `undefined` (igual que siempre: Dubai nunca usó `notas`).
  condicionesPropias?: string;
};

export type DubaiParams = {
  regimen_base: string;                 // régimen incluido en la base (ej. "PC")
  modificadores: {
    sencilla_pct: number;               // +50  → ×1.5
    pax3_pct: number;                   // -20  → ×0.8
    pax4_pct: number;                   // -20
    nino_pct: number;                   // -50  → ×0.5 (Niño 1)
    // Niño 2 (segundo menor de la MISMA habitación) — opcional, GENERAL
    // (confirmado: sin override por promoción esta ronda, ver la cabecera
    // del archivo). Ausente = comportamiento de SIEMPRE: `neto_nino2`
    // queda `null` (sin tarifa propia de Niño 2). Configurado = Niño 1 y
    // Niño 2 pueden tener descuentos DISTINTOS sobre la base.
    nino2_pct?: number;
    infante_pct?: number;                // -100 → gratis (default si no se configura)
  };
  suplementos: DubaiSuplementoRegimen[];   // PAM +45000, etc.
  bases: DubaiBase[];
  promos?: DubaiPromo[];
  infante_nota?: string;                 // nota general (ej. "comparte cama con los padres")
};

/** Edades EFECTIVAS (crudas, sin resolver fallback general — eso lo hace
 * `computo.ts`/`cotizar.ts` vía `lib/calc/reglaEdadTarifa.ts`) que le
 * corresponden a una fila generada por una BASE: su propio override, o
 * `null` si no activó "edades propias". Exportada para que la validación y
 * las pruebas no reimplementen el criterio. */
function edadesDeBase(b: DubaiBase): ReglaEdadTarifa | null {
  return b.usarEdadesPropias && b.edadesPropias ? b.edadesPropias : null;
}

/** Edades EFECTIVAS (crudas) que le corresponden a una fila generada por una
 * PROMOCIÓN: su propio override si lo activó; si no, el de SU BASE (misma
 * temporadaBase+categoría) si esa base lo activó; si tampoco, `null`. */
function edadesDePromo(promo: DubaiPromo, baseCorrespondiente: DubaiBase | undefined): ReglaEdadTarifa | null {
  if (promo.usarEdadesPropias && promo.edadesPropias) return promo.edadesPropias;
  return baseCorrespondiente ? edadesDeBase(baseCorrespondiente) : null;
}

export function generarTarifasDubai(p: DubaiParams): TarifaGenerada[] {
  const m = p.modificadores ?? { sencilla_pct: 0, pax3_pct: 0, pax4_pct: 0, nino_pct: 0, infante_pct: -100 };
  const infantePct = m.infante_pct ?? -100;
  // `nino2_pct` SOLO se aplica si está configurado — `undefined`/ausente
  // preserva exactamente el resultado histórico (`neto_nino2: null`).
  const tieneNino2 = typeof m.nino2_pct === "number" && Number.isFinite(m.nino2_pct);
  const f = (pct: number) => 1 + (Number(pct) || 0) / 100;
  const notaInfante = p.infante_nota?.trim() || null;
  const out: TarifaGenerada[] = [];

  // Régimen base (suplemento 0) + los suplementos configurados — lista de
  // NOMBRES de régimen que el hotel factura (compartida por todas las
  // bases; cada base decide de DÓNDE saca el monto de cada uno).
  const regimenBase = (p.regimen_base || "PC").trim();
  const regimenesGeneral = [
    { regimen: regimenBase, monto: 0 },
    ...(p.suplementos ?? []).filter((s) => s.regimen?.trim()),
  ];
  const suplementoGeneralDe = (regimen: string) => regimenesGeneral.find((r) => r.regimen === regimen)?.monto ?? 0;

  /** Suplemento EFECTIVO de una BASE para un régimen dado: si la base activó
   * suplementos propios, usa EXCLUSIVAMENTE `suplementosPropios` (`0` si el
   * régimen no tiene fila ahí — nunca cae al general); si no, el régimen
   * base sigue en 0 y el resto cae al general — comportamiento histórico. */
  const suplementoEfectivoBase = (b: DubaiBase, regimen: string): number => {
    if (regimen === regimenBase) return 0; // el régimen base NUNCA lleva suplemento, propio ni general
    if (b.usarSuplementosPropios) {
      const propio = (b.suplementosPropios ?? []).find((s) => s.regimen?.trim() === regimen);
      return propio ? Number(propio.monto) || 0 : 0;
    }
    return suplementoGeneralDe(regimen);
  };

  /** Suplemento EFECTIVO de una PROMO para su propio régimen — prioridad
   * (regla comercial, corrección de esta ronda):
   *   1) suplemento propio de LA PROMOCIÓN, si lo activó (incluso sobre el
   *      régimen base — una promo sí puede justificarlo, a diferencia de una
   *      base);
   *   2) si no, el suplemento propio de SU BASE (`suplementoEfectivoBase`,
   *      que YA resuelve "propio de la base, si no general" — antes esta
   *      función saltaba directo al general, ignorando por completo si la
   *      base referenciada había activado `usarSuplementosPropios`);
   *   3) el régimen base nunca lleva suplemento (ni por la promo por
   *      defecto ni por la base) salvo que la PROMOCIÓN lo fuerce con su
   *      propio override (paso 1). */
  const suplementoEfectivoPromo = (promo: DubaiPromo, regimen: string, baseRef: DubaiBase): number => {
    if (promo.usarSuplementoPropio) return Number(promo.suplementoPropioMonto) || 0;
    if (regimen === regimenBase) return 0;
    return suplementoEfectivoBase(baseRef, regimen);
  };

  // Deriva sencilla/triple/múltiple/niño/niño2/infante a partir de una base +
  // su suplemento, con un `factor` multiplicativo opcional (descuento de
  // promoción). ORDEN FINANCIERO (regla comercial, corrección de esta
  // ronda): (1) se construye el valor COMPLETO del régimen —
  // modificador de acomodación/niño/niño2/infante sobre la base CRUDA (sin
  // descontar) + el suplemento efectivo, SUMADO; (2) el `factor` (1 si es
  // tarifa regular, `1 - descuentoPct/100` si es promoción) se aplica sobre
  // ese valor YA COMPLETO — el suplemento SÍ queda descontado junto con la
  // base, nunca aparte. Antes, para promociones, se descontaba solo `base`
  // (el modificador ya operaba sobre la base descontada) y el suplemento se
  // sumaba DESPUÉS, intacto — eso ignoraba que el descuento debe aplicar
  // sobre la tarifa completa del régimen, no solo sobre la porción PAE. Un
  // solo `Math.round()` por valor final, sin redondeos intermedios.
  const derivar = (base: number, sup: number, factor = 1) => ({
    sencilla: Math.round((base * f(m.sencilla_pct) + sup) * factor),
    doble: Math.round((base + sup) * factor),
    triple: Math.round(((base * 2 + base * f(m.pax3_pct)) / 3 + sup) * factor),
    multiple: Math.round(((base * 2 + base * f(m.pax3_pct) + base * f(m.pax4_pct)) / 4 + sup) * factor),
    nino: Math.round((base * f(m.nino_pct) + sup) * factor),
    nino2: tieneNino2 ? Math.round((base * f(m.nino2_pct as number) + sup) * factor) : null,
    infante: Math.max(0, Math.round((base * f(infantePct) + sup) * factor)),
  });

  for (const b of p.bases ?? []) {
    const base = Number(b.precio) || 0;
    if (base <= 0 || !b.categoria?.trim() || !b.temporada?.trim()) continue;
    const edades = edadesDeBase(b);
    // Condición propia de ESTA base — nunca la de otra base ni la de ninguna
    // promoción (esas se calculan aparte, en el bucle de `promos[]` de abajo,
    // con SU PROPIO `notasPromo` derivado únicamente de `promo.condicionesPropias`).
    const notasBase = b.condicionesPropias?.trim() || undefined;

    for (const r of regimenesGeneral) {
      const sup = suplementoEfectivoBase(b, r.regimen);
      const d = derivar(base, sup);
      out.push({
        tipo_habitacion: b.categoria.trim(),
        alimentacion: r.regimen.trim(),
        temporada: b.temporada.trim(),
        neto_sencilla: d.sencilla,
        neto_doble: d.doble,
        neto_triple: d.triple,
        neto_multiple: d.multiple,
        neto_nino: d.nino,
        neto_nino2: d.nino2,
        neto_infante: d.infante,
        nota_infante: notaInfante,
        notas: notasBase,
        edad_infante_min: edades?.infanteMin ?? null,
        edad_infante_max: edades?.infanteMax ?? null,
        edad_nino_min: edades?.ninoMin ?? null,
        edad_nino_max: edades?.ninoMax ?? null,
      });
    }
  }

  // Promociones: regla comercial (corrección de esta ronda) — el % de
  // descuento se aplica sobre la tarifa COMPLETA del régimen (base +
  // suplemento efectivo), nunca solo sobre la base. El suplemento efectivo
  // se elige por prioridad: propio de la promoción > propio de la base
  // referenciada > general del régimen (`suplementoEfectivoPromo`). El
  // régimen base (PAE/PC/lo que sea `regimen_base`) nunca suma suplemento,
  // salvo que la propia promoción lo fuerce con su override.
  for (const promo of p.promos ?? []) {
    const regimen = promo.regimen?.trim();
    const temporadaPromo = promo.temporadaPromo?.trim();
    const temporadaBase = promo.temporadaBase?.trim();
    const pct = Number(promo.descuentoPct) || 0;
    if (!regimen || !temporadaPromo || pct <= 0) continue;
    const factor = 1 - pct / 100;
    // Condición propia de ESTA promo — nunca se mezcla con la de otra
    // promo/base (cada fila generada acá lleva SOLO la de `promo`).
    const notasPromo = promo.condicionesPropias?.trim() || undefined;
    for (const b of p.bases ?? []) {
      if (b.temporada?.trim() !== temporadaBase) continue;
      const base = Number(b.precio) || 0;
      if (base <= 0 || !b.categoria?.trim()) continue;
      // El suplemento depende de LA BASE referenciada (su propio override,
      // si lo activó) — se resuelve aquí, dentro del bucle de bases, porque
      // antes de esta corrección se resolvía una sola vez ANTES del bucle
      // (sin acceso a `b`), lo que hacía imposible consultar el suplemento
      // propio de la base.
      const sup = suplementoEfectivoPromo(promo, regimen, b);
      // Valor completo del régimen (base + suplemento, por acomodación) con
      // el descuento aplicado sobre el TOTAL — el suplemento queda
      // descontado igual que la base, un solo redondeo final por valor.
      const d = derivar(base, sup, factor);
      const edades = edadesDePromo(promo, b);
      out.push({
        tipo_habitacion: b.categoria.trim(),
        alimentacion: regimen,
        temporada: temporadaPromo,
        neto_sencilla: d.sencilla,
        neto_doble: d.doble,
        neto_triple: d.triple,
        neto_multiple: d.multiple,
        neto_nino: d.nino,
        neto_nino2: d.nino2,
        neto_infante: d.infante,
        nota_infante: notaInfante,
        notas: notasPromo,
        edad_infante_min: edades?.infanteMin ?? null,
        edad_infante_max: edades?.infanteMax ?? null,
        edad_nino_min: edades?.ninoMin ?? null,
        edad_nino_max: edades?.ninoMax ?? null,
        precio_final_autoritativo: true,
        temporada_base: temporadaBase,
      });
    }
  }
  return out;
}

// ── Validación fail-closed de la configuración Dubai (antes de guardar) ────
// Nunca reimplementa la generación: solo decide si `params` es coherente
// ANTES de que `guardarCalculadora` lo escriba en `hotel_calculadora`. Un
// dato histórico ya guardado (sin ninguno de los campos nuevos) sigue
// siendo válido — todos son opcionales, nunca se exigen si están ausentes.
export type ErrorValidacionDubai = { origen: "base" | "promo"; indice: number; mensaje: string };

/** Valida la config de edades/suplementos propios de UNA base — reutilizado
 * por `validarDubaiParams`. `indice` es la posición dentro de `bases[]`. */
function validarBaseDubai(b: DubaiBase, indice: number): ErrorValidacionDubai[] {
  const errores: ErrorValidacionDubai[] = [];
  const push = (mensaje: string) => errores.push({ origen: "base", indice, mensaje });
  const etiqueta = `${b.categoria || "(sin categoría)"} / ${b.temporada || "(sin temporada)"}`;

  if (b.usarEdadesPropias) {
    if (!b.edadesPropias) {
      push(`Base ${etiqueta}: "Usar edades propias" está activo pero no se configuraron los 4 límites.`);
    } else {
      const err = validarRangoReglaEdad(b.edadesPropias);
      if (err) push(`Base ${etiqueta}: ${err}`);
    }
  }

  if (b.usarSuplementosPropios) {
    const propios = b.suplementosPropios ?? [];
    if (propios.length === 0) {
      push(`Base ${etiqueta}: "Usar suplementos propios" está activo pero no se configuró ningún suplemento.`);
    }
    const vistos = new Set<string>();
    for (const s of propios) {
      const r = s.regimen?.trim();
      if (!r) { push(`Base ${etiqueta}: un suplemento propio tiene el régimen vacío.`); continue; }
      if (vistos.has(r)) { push(`Base ${etiqueta}: el régimen "${r}" está repetido entre sus suplementos propios.`); continue; }
      vistos.add(r);
      if (!Number.isFinite(Number(s.monto)) || Number(s.monto) < 0) {
        push(`Base ${etiqueta}: el suplemento propio de "${r}" debe ser un número mayor o igual a 0 (recibido: ${s.monto}).`);
      }
    }
  }

  return errores;
}

/** Valida UNA promoción — reutilizado por `validarDubaiParams` y por el
 * editor (preview de errores antes de intentar guardar). `indice` es la
 * posición de la promo dentro de `promos[]` (para señalar CUÁL en la UI). */
export function validarPromoDubai(promo: DubaiPromo, indice: number): ErrorValidacionDubai[] {
  const errores: ErrorValidacionDubai[] = [];
  const push = (mensaje: string) => errores.push({ origen: "promo", indice, mensaje });

  const temporadaBase = promo.temporadaBase?.trim();
  const temporadaPromo = promo.temporadaPromo?.trim();
  const regimen = promo.regimen?.trim();

  if (!temporadaBase) push("La promoción necesita una temporada base.");
  if (!temporadaPromo) push("La promoción necesita una temporada promo (destino).");
  if (temporadaBase && temporadaPromo && temporadaBase === temporadaPromo) {
    push("La temporada promo no puede ser la misma que la temporada base (rango imposible: se promocionaría sobre sí misma).");
  }
  if (!regimen) push("La promoción necesita un régimen.");

  const pct = Number(promo.descuentoPct);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    push(`El descuento debe ser un número mayor a 0 y menor a 100 (recibido: ${promo.descuentoPct}).`);
  }

  if (promo.usarEdadesPropias) {
    if (!promo.edadesPropias) {
      push('"Usar edades propias" está activo pero no se configuraron los 4 límites.');
    } else {
      const err = validarRangoReglaEdad(promo.edadesPropias);
      if (err) push(err);
    }
  }

  // Suplemento propio: UN solo valor, atado a `promo.regimen`. `null`/
  // ausente con el checkbox activo = vacío/incompleto (fail-closed); `0`
  // explícito = válido — la distinción vive en el TIPO (`number | null`,
  // nunca `Number(x) || 0` en la validación, que colapsaría los dos casos).
  if (promo.usarSuplementoPropio && (promo.suplementoPropioMonto === null || promo.suplementoPropioMonto === undefined)) {
    push('"Usar suplemento propio" está activo pero el monto quedó vacío — indica un valor (puede ser 0).');
  }
  if (promo.usarSuplementoPropio && promo.suplementoPropioMonto != null) {
    if (!Number.isFinite(promo.suplementoPropioMonto) || promo.suplementoPropioMonto < 0) {
      push(`El suplemento propio debe ser un número mayor o igual a 0 (recibido: ${promo.suplementoPropioMonto}).`);
    }
  }

  return errores;
}

/** Categorías REALES que una base×temporada genera — solo las que tienen
 * precio > 0 (una fila con precio 0/ausente no llega a `generarTarifasDubai`,
 * así que tampoco debe contar para detectar solapamientos). */
function categoriasDeBasePorTemporada(bases: DubaiBase[], temporada: string): Set<string> {
  const set = new Set<string>();
  for (const b of bases) {
    if (b.temporada?.trim() !== temporada) continue;
    if ((Number(b.precio) || 0) <= 0) continue;
    if (b.categoria?.trim()) set.add(b.categoria.trim());
  }
  return set;
}

/** Valida el `DubaiParams` completo:
 *   1) `bases[]` duplicadas por categoría+temporada (fila ambigua: dos
 *      precios para la MISMA combinación, `generarTarifasDubai` generaría
 *      dos filas con la MISMA clave categoria+régimen+temporada);
 *   2) cada base, su config de edades/suplementos propios;
 *   3) cada promo (`validarPromoDubai`);
 *   4) dos promos SOLO se marcan solapadas si generan la MISMA
 *      temporadaPromo+régimen Y sus categorías REALES (derivadas de
 *      `bases[]` por `temporadaBase`) se intersectan — nunca por
 *      temporadaPromo+régimen a secas (eso rechazaba configuraciones
 *      válidas cuando las bases de origen no comparten ninguna categoría). */
export function validarDubaiParams(p: DubaiParams): ErrorValidacionDubai[] {
  const errores: ErrorValidacionDubai[] = [];
  const bases = p.bases ?? [];
  const promos = p.promos ?? [];

  const vistasBases = new Map<string, number>();
  bases.forEach((b, i) => {
    const cat = b.categoria?.trim();
    const temp = b.temporada?.trim();
    if (!cat || !temp) return;
    const clave = `${cat}|${temp}`;
    const anterior = vistasBases.get(clave);
    if (anterior !== undefined) {
      errores.push({
        origen: "base", indice: i,
        mensaje: `Hay dos filas base para "${cat}" / "${temp}" (posiciones ${anterior + 1} y ${i + 1}) — quedarían ambiguas (misma categoría+temporada, dos precios).`,
      });
    } else {
      vistasBases.set(clave, i);
    }
  });

  bases.forEach((b, i) => errores.push(...validarBaseDubai(b, i)));
  promos.forEach((promo, i) => errores.push(...validarPromoDubai(promo, i)));

  for (let i = 0; i < promos.length; i++) {
    for (let j = i + 1; j < promos.length; j++) {
      const a = promos[i];
      const b2 = promos[j];
      const regA = a.regimen?.trim();
      const regB = b2.regimen?.trim();
      const tpA = a.temporadaPromo?.trim();
      const tpB = b2.temporadaPromo?.trim();
      if (!regA || !regB || !tpA || !tpB) continue; // ya reportado (regimen/temporadaPromo vacíos)
      if (regA !== regB || tpA !== tpB) continue;
      const catsA = categoriasDeBasePorTemporada(bases, a.temporadaBase?.trim() ?? "");
      const catsB = categoriasDeBasePorTemporada(bases, b2.temporadaBase?.trim() ?? "");
      const interseccion = [...catsA].filter((c) => catsB.has(c)).sort();
      if (interseccion.length > 0) {
        errores.push({
          origen: "promo", indice: j,
          mensaje: `Esta promoción genera la misma temporada+régimen+categoría que la promoción #${i + 1} para: ${interseccion.join(", ")} ("${tpA}" / "${regA}") — quedarían solapadas.`,
        });
      }
    }
  }

  return errores;
}

// ── Calculadora "MIXTA" ────────────────────────────────────────────────────
// El hotel mezcla tarifas POR HABITACIÓN y POR PERSONA, con IVA opcional por
// acomodación. Por cada acomodación se elige modo (hab/pax) y si lleva IVA (19%).
// Como el resto del sistema trabaja POR PERSONA:
//   - modo 'hab': valor / pax de la habitación  → por persona
//   - modo 'pax': el valor ya es por persona
//   - si IVA: × (1 + iva%)
// Los valores se cargan por categoría × temporada (uno por acomodación).
export type MixtaAcom = "sencilla" | "doble" | "triple" | "multiple";
export const MIXTA_ACOMS: MixtaAcom[] = ["sencilla", "doble", "triple", "multiple"];

export type MixtaParams = {
  regimen: string;
  iva_pct: number;                                    // 19
  acom: Record<MixtaAcom, { modo: "hab" | "pax"; iva: boolean }>;
  nino: { iva: boolean };
  pax: Record<MixtaAcom, number>;                     // pax por habitación (1/2/3/4)
  bases: {
    categoria: string; temporada: string;
    sencilla: number; doble: number; triple: number; multiple: number;
    nino: number; nino2: number | null; infante?: number | null;
  }[];
  infante_nota?: string;                               // nota general (ej. "comparte cama con los padres")
};

export function generarTarifasMixta(p: MixtaParams): TarifaGenerada[] {
  const ivaPct = Number(p.iva_pct) || 19;
  const conIva = (v: number, iva: boolean) => (iva ? v * (1 + ivaPct / 100) : v);
  const notaInfante = p.infante_nota?.trim() || null;
  // Por persona, según modo de la acomodación.
  const pp = (valor: number, acom: MixtaAcom) => {
    const v = Number(valor) || 0;
    if (v <= 0) return 0;
    const cfg = p.acom?.[acom] ?? { modo: "pax" as const, iva: false };
    const paxRoom = Math.max(1, Number(p.pax?.[acom]) || 1);
    const base = cfg.modo === "hab" ? v / paxRoom : v;
    return Math.round(conIva(base, cfg.iva));
  };
  // Niño 1/2 e Infante siempre son por persona; comparten el mismo IVA.
  const ppNino = (valor: number) => {
    const v = Number(valor) || 0;
    if (v <= 0) return 0;
    return Math.round(conIva(v, p.nino?.iva ?? false));
  };

  const out: TarifaGenerada[] = [];
  for (const b of p.bases ?? []) {
    if (!b.categoria?.trim() || !b.temporada?.trim()) continue;
    const sencilla = pp(b.sencilla, "sencilla");
    const doble = pp(b.doble, "doble");
    const triple = pp(b.triple, "triple");
    const multiple = pp(b.multiple, "multiple");
    if (sencilla + doble + triple + multiple <= 0) continue; // fila sin valores
    out.push({
      tipo_habitacion: b.categoria.trim(),
      alimentacion: (p.regimen || "").trim(),
      temporada: b.temporada.trim(),
      neto_sencilla: sencilla,
      neto_doble: doble,
      neto_triple: triple,
      neto_multiple: multiple,
      neto_nino: ppNino(b.nino),
      neto_nino2: b.nino2 != null ? ppNino(b.nino2) : null,
      neto_infante: b.infante != null ? ppNino(b.infante) : null,
      nota_infante: notaInfante,
    });
  }
  return out;
}

// ── Calculadora "CORPORATIVA" ──────────────────────────────────────────────
// Tarifa NEGOCIADA por HABITACIÓN (no por persona): un mismo precio para
// sencilla y doble ("SGL/DBL"), como traen las tarifas corporativas de cadena
// (ej. anexos de Faranda/Marriott). El régimen base va incluido en esa
// tarifa; subir a otro régimen suma un suplemento POR PERSONA/NOCHE (adulto
// y niño, aparte de la habitación). Un 3er/4to pax no cambia el precio de la
// habitación — se le suma un cargo FIJO de "persona/niño adicional" (igual
// para todas las categorías) y, para guardarlo por persona (como el resto
// del sistema), se reparte entre los pax de la habitación (mismo patrón que
// Mixta con modo "hab"). Infante siempre cortesía ($0), como en la tarifa de
// origen. El % de impuesto (opcional) infla TODA la tarifa de habitación +
// persona/niño adicional — los suplementos de régimen quedan tal cual se
// cargan (no se gravan de nuevo). El % de descuento (tarifa "Dinámica")
// SOLO se aplica sobre la tarifa de habitación (rack): nunca sobre
// suplementos de régimen ni persona/niño adicional. Si no se configura
// impuesto, la fila queda marcada con una nota ("no incluye impuestos").
export type CorporativaSuplementoRegimen = { regimen: string; adulto: number; nino: number };

export type CorporativaParams = {
  regimen_base: string;
  persona_adicional: number;             // valor fijo/noche, igual para todas las categorías
  nino_adicional: number;                // valor fijo/noche, igual para todas las categorías
  impuesto_pct?: number;                 // opcional — sin configurar, la tarifa queda neta (nota "no incluye impuestos")
  descuento_pct?: number;                // opcional (tarifa "Dinámica") — descuenta SOLO la tarifa de habitación (rack)
  suplementos_regimen: CorporativaSuplementoRegimen[];   // por persona/noche, aparte del régimen base
  bases: { categoria: string; temporada: string; precio: number }[];   // tarifa SGL/DBL (por habitación)
  infante_nota?: string;
};

export function generarTarifasCorporativa(p: CorporativaParams): TarifaGenerada[] {
  const impuestoPct = Number(p.impuesto_pct) || 0;
  const descuentoPct = Number(p.descuento_pct) || 0;
  const personaAdicional = Number(p.persona_adicional) || 0;
  const ninoAdicional = Number(p.nino_adicional) || 0;
  const notaInfante = p.infante_nota?.trim() || null;
  const notaImpuesto = impuestoPct > 0 ? null : "Tarifa no incluye impuestos.";

  const regimenBase = (p.regimen_base || "").trim();
  const regimenes = [
    { regimen: regimenBase, adulto: 0, nino: 0 },
    ...(p.suplementos_regimen ?? []).filter((s) => s.regimen?.trim()),
  ];

  const out: TarifaGenerada[] = [];
  for (const b of p.bases ?? []) {
    const rack = Number(b.precio) || 0;
    if (rack <= 0 || !b.categoria?.trim() || !b.temporada?.trim()) continue;

    // Descuento (Dinámica) SOLO sobre el rack; el impuesto (si aplica) se
    // suma después, ya sobre la tarifa descontada.
    const habConImpuesto = rack * (1 - descuentoPct / 100) * (1 + impuestoPct / 100);
    const personaConImpuesto = personaAdicional * (1 + impuestoPct / 100);
    const ninoConImpuesto = ninoAdicional * (1 + impuestoPct / 100);

    for (const r of regimenes) {
      const supAdulto = Number(r.adulto) || 0;
      const supNino = Number(r.nino) || 0;
      out.push({
        tipo_habitacion: b.categoria.trim(),
        alimentacion: (r.regimen || regimenBase).trim(),
        temporada: b.temporada.trim(),
        neto_sencilla: Math.round(habConImpuesto + supAdulto),
        neto_doble: Math.round(habConImpuesto / 2 + supAdulto),
        neto_triple: Math.round((habConImpuesto + personaConImpuesto) / 3 + supAdulto),
        neto_multiple: Math.round((habConImpuesto + personaConImpuesto * 2) / 4 + supAdulto),
        neto_nino: Math.round(ninoConImpuesto + supNino),
        neto_nino2: null,
        neto_infante: 0,
        nota_infante: notaInfante,
        notas: notaImpuesto,
      });
    }
  }
  return out;
}

// ── Registro de calculadoras ───────────────────────────────────────────────
export type CalcTipo = "dubai" | "mixta" | "corporativa";

export function generarTarifas(tipo: string, params: unknown): TarifaGenerada[] {
  switch (tipo) {
    case "dubai":
      return generarTarifasDubai(params as DubaiParams);
    case "mixta":
      return generarTarifasMixta(params as MixtaParams);
    case "corporativa":
      return generarTarifasCorporativa(params as CorporativaParams);
    default:
      return [];
  }
}
