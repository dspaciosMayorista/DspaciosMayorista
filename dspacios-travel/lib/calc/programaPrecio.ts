// ─────────────────────────────────────────────────────────────────────────
// Calculadora de precios de PROGRAMAS (terceros que dan tarifa comisionable)
//
// Algunos proveedores no entregan el neto: dan una TARIFA y una regla para
// sacar la base comisionable. La comisión es nuestra ganancia, así que el
// NETO (lo que le pagamos al proveedor = lo que montamos) = Tarifa − comisión.
//
//   base_comisionable =
//     · 'pct'      → Tarifa × (1 − pct/100)     (ej. Tarifa − 3%)
//     · 'impuesto' → Tarifa − impuesto (monto)  (ej. Tarifa − impuestos)
//     · 'ninguno'  → Tarifa                     (no se resta nada)
//   comision = base_comisionable × (pct_comision/100)
//   neto     = Tarifa − comision   ← lo que se monta (luego: MK + asistencia + fee)
// ─────────────────────────────────────────────────────────────────────────

export type ModoBaseComisionable = "pct" | "impuesto" | "ninguno";

export type CalcProgramaInput = {
  tarifa: number;
  modo: ModoBaseComisionable;
  valor: number;          // pct (modo 'pct') o monto del impuesto (modo 'impuesto')
  pctComision: number;    // % de comisión sobre la base
};

export type CalcProgramaResult = {
  baseComisionable: number;
  comision: number;
  neto: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularNetoPrograma(input: CalcProgramaInput): CalcProgramaResult {
  const tarifa = Number(input.tarifa) || 0;
  const valor = Number(input.valor) || 0;
  const pctCom = Number(input.pctComision) || 0;

  let base = tarifa;
  if (input.modo === "pct") base = tarifa * (1 - valor / 100);
  else if (input.modo === "impuesto") base = tarifa - valor;
  // 'ninguno' → base = tarifa

  const comision = base * (pctCom / 100);
  const neto = tarifa - comision;
  return { baseComisionable: r2(base), comision: r2(comision), neto: r2(neto) };
}

// ─────────────────────────────────────────────────────────────────────────
// Recalcular los netos de UNA salida cuando cambia la regla (modo/valor/%
// comisión), no la tarifa. Usa `calcularNetoPrograma` (sin tocarla) por cada
// acomodación por separado — nunca cruza el valor de una acomodación con
// otra. Una acomodación sin tarifa del proveedor (null/vacía/<=0) no se
// toca: su neto puede venir de una carga manual y no hay nada que recalcular.
// ─────────────────────────────────────────────────────────────────────────

export type TarifasProveedorSalida = {
  sencilla: number | null;
  doble: number | null;
  triple: number | null;
  multiple: number | null;
};

export type NetosRecalculados = {
  sencilla: number | null;
  doble: number | null;
  triple: number | null;
  multiple: number | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Modalidad de MK (migración 161) — el dueño pidió una SEGUNDA forma de
// aplicar el markup del programa (`pct_mk`) sobre lo que sale de la
// calculadora de arriba:
//
//   'historica'                    (default, SIN CAMBIOS de comportamiento):
//     Venta = (base_neta + montoNoComisionable) / divisorMK
//           = neto / divisorMK               ← neto YA incluye ambos, como
//                                                siempre calculó `calcularNetoPrograma`.
//   'base_neta_impuestos_al_final' (nueva):
//     Venta = (base_neta / divisorMK) + montoNoComisionable
//           ← el MK NUNCA se aplica sobre `montoNoComisionable` (el monto que
//             la regla resta de la tarifa para llegar a la base comisionable
//             — "impuestos" en el modo 'impuesto', o el equivalente en pesos
//             del % restado en modo 'pct'; 0 en modo 'ninguno'). Se suma
//             DESPUÉS de dividir por el MK, antes del fee bancario (ver
//             `pvpPrograma`, lib/programas.ts — el fee SÍ sigue aplicando
//             sobre el total: es un costo de procesamiento de pago
//             proporcional al precio final, no al costo interno).
//
// `netoParaMarkup`/`montoSinMarkup` son los dos números que de verdad
// consume `pvpPrograma()` — separar la decisión de "qué modalidad" de "cómo
// se marca" en un solo lugar es lo que permite que el editor en vivo, la
// validación (cliente y servidor) y la generación real del tarifario usen
// SIEMPRE la misma función, nunca una fórmula reescrita en cada sitio.
// ─────────────────────────────────────────────────────────────────────────

export type ModalidadMk = "historica" | "base_neta_impuestos_al_final";

export const MODALIDADES_MK: readonly ModalidadMk[] = ["historica", "base_neta_impuestos_al_final"];

export function esModalidadMkValida(v: unknown): v is ModalidadMk {
  return v === "historica" || v === "base_neta_impuestos_al_final";
}

export type CalcProgramaConModalidadResult = CalcProgramaResult & {
  /** baseComisionable − comision. El "costo real" del proveedor después de la comisión. */
  baseNeta: number;
  /**
   * Tarifa − baseComisionable (= neto − baseNeta). El monto que la regla NO
   * considera comisionable — "impuestos" en el modo del mismo nombre,
   * generalizado a los 3 modos (siempre ≥ 0, por construcción: `valor`≥0 en
   * modo 'impuesto', `valor` en [0,100] en modo 'pct' sobre una `tarifa`≥0,
   * y 0 en modo 'ninguno' — ver `validarReglaComisionable`/los CHECK de la
   * migración 151, que ya garantizan estos rangos).
   */
  montoNoComisionable: number;
  /** Lo que `pvpPrograma` debe marcar con MK/fee (1er argumento). */
  netoParaMarkup: number;
  /** Lo que `pvpPrograma` debe sumar DESPUÉS del MK, antes del fee (3er argumento). 0 en modalidad histórica. */
  montoSinMarkup: number;
};

/**
 * Única función que decide, según la modalidad, cómo repartir el resultado
 * de `calcularNetoPrograma()` entre "lo que se marca con MK" y "lo que se
 * suma sin marcar". NUNCA duplica la fórmula de arriba — siempre parte de
 * `calcularNetoPrograma(input)` y solo reacomoda sus 3 salidas.
 */
export function calcularNetoProgramaConModalidad(
  input: CalcProgramaInput,
  modalidadMk: ModalidadMk
): CalcProgramaConModalidadResult {
  const base = calcularNetoPrograma(input);
  const baseNeta = r2(base.baseComisionable - base.comision);
  const montoNoComisionable = r2(base.neto - baseNeta);
  const esNueva = modalidadMk === "base_neta_impuestos_al_final";
  return {
    ...base,
    baseNeta,
    montoNoComisionable,
    netoParaMarkup: esNueva ? baseNeta : base.neto,
    montoSinMarkup: esNueva ? montoNoComisionable : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PVP a partir del neto — MOVIDO desde lib/programas.ts (revisión de PR #277,
// defecto 5): las pruebas numéricas necesitan ejecutar el MOTOR REAL, no una
// copia textual mantenida a mano. `lib/programas.ts` importa `@/types/
// database` (alias de tsconfig que el runner de pruebas, `node --test
// --experimental-strip-types`, no resuelve), así que la parte puramente
// matemática se traslada a ESTE archivo — que ya no tiene ningún import y ya
// se probaba directo — y `lib/programas.ts` re-exporta desde acá (ningún
// call-site del resto del código cambia: siguen importando `pvpPrograma`/
// `PvpOpciones` de "@/lib/programas" como siempre).
// ─────────────────────────────────────────────────────────────────────────

export type PvpOpciones = {
  pctMk: number;            // markup del proveedor (ej. 0.25)
  asistenciaDia?: number;   // asistencia médica por pax y por día
  dias?: number | null;     // días del programa
  pctFee?: number;          // fee bancario / TDC (ej. 0.03)
  moneda?: string | null;   // COP (default) redondea al mil por encima; USD, al dólar por encima
};

/** Redondeo del PVP hacia arriba: en COP al millar, en USD al entero. */
export function redondearPvp(valor: number, moneda: string | null | undefined): number {
  return moneda === "USD" ? Math.ceil(valor) : Math.ceil(valor / 1000) * 1000;
}

/**
 * PVP de venta de un programa por persona, a partir del neto del proveedor:
 *   1) costo total:   base = neto + asistencia_dia × días
 *   2) markup:        sub  = base / (1 - mk)
 *   3) monto sin MK:  sub += montoSinMarkup   (0 salvo modalidad nueva, migración 161)
 *   4) fee bancario:  pvp  = sub  / (1 - fee)
 *
 * La asistencia médica es un COSTO NETO más (lo que se le paga al proveedor de
 * la asistencia), así que entra ANTES del markup y se marca igual que el resto.
 *
 * ⚠️ Cambio de criterio (ago-2026, pedido del dueño). Antes la asistencia se
 * sumaba DESPUÉS del markup:
 *     sub = neto/(1-mk);  sub += asis × días;  pvp = sub/(1-fee)
 * es decir, se le trasladaba al cliente a precio de costo y no dejaba margen.
 * El PVP de los programas con asistencia SUBE con este cambio: la diferencia es
 * exactamente el margen que antes no se cobraba sobre ella.
 *
 * `montoSinMarkup` (migración 161, § modalidad de MK de la tarifa comisionable
 * del proveedor, `calcularNetoProgramaConModalidad` arriba en este archivo):
 * un monto que se suma DESPUÉS del paso 2 (nunca recibe markup) pero ANTES del
 * fee bancario (el fee SÍ sigue aplicando sobre el total — es proporcional al
 * precio final de venta, no al costo interno). Con el valor por defecto (0), el
 * paso 3 es un no-op y la fórmula queda IDÉNTICA a la de siempre — todo caller
 * que no lo pase (todos, salvo el nuevo camino de "tarifa comisionable" en
 * modalidad nueva) conserva el comportamiento histórico byte a byte.
 *
 * ⚠️ Guarda de `neto <= 0` (revisión PR #277, defecto 3). El guard original
 * devolvía 0 para CUALQUIER `neto` no positivo, sin mirar `montoSinMarkup` —
 * eso estaba bien mientras `montoSinMarkup` siempre era 0 (nada que "salvar"),
 * pero con la modalidad nueva `netoParaMarkup` puede ser EXACTAMENTE 0 con un
 * `montoSinMarkup` (impuestos) positivo — ej. modo 'pct' con valor=100%: toda
 * la tarifa es "impuesto", nada es comisionable, `baseNeta=0`. La fórmula
 * confirmada por el dueño (`Venta = baseNeta/divisorMK + impuestos`) para ese
 * caso da `Venta = impuestos` — un precio real, no cero. El guard viejo
 * devolvía 0 y SE COMÍA el impuesto en silencio. Ahora: `neto < 0` (config
 * corrupta — debió rechazarse ANTES de llegar acá, ver `validarTarifaModalidad`
 * abajo) sigue devolviendo 0 sin fabricar un precio con un componente negativo;
 * `neto === 0` con `montoSinMarkup === 0` (todo caller histórico) sigue
 * devolviendo 0 byte a byte, igual que siempre (columna fantasma sin costo ni
 * impuesto = sin precio); solo `neto === 0` CON `montoSinMarkup > 0` deja de
 * devolver 0 y calcula la fórmula completa.
 */
export function pvpPrograma(neto: number, opt: PvpOpciones, montoSinMarkup = 0): number {
  const n = Number(neto);
  const extra = Number(montoSinMarkup) || 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n === 0 && extra <= 0) return 0;

  const mk = Number(opt.pctMk) || 0;
  const fee = Number(opt.pctFee) || 0;
  const asis = Number(opt.asistenciaDia) || 0;
  const dias = Math.max(0, Number(opt.dias) || 0);

  // La asistencia se suma al neto ANTES de marcar: es un costo, no un recargo.
  let sub = n + asis * dias;
  if (mk > 0 && mk < 1) sub = sub / (1 - mk);
  sub += extra;
  if (fee > 0 && fee < 1) sub = sub / (1 - fee);
  return redondearPvp(sub, opt.moneda);
}

// ─────────────────────────────────────────────────────────────────────────
// PVP de UNA acomodación de UNA salida — función pura compartida (revisión
// PR #277, ronda 2, punto 3). Antes, la decisión "¿esta acomodación puntual
// usa la modalidad nueva, o el camino histórico?" estaba DUPLICADA en 3
// lugares (`getProgramaDetalle`/`pvpDeSalida`, `getProgramasResumen`, y
// `SalidasEditor.pvpDe` del editor en vivo) — cada uno con su propio
// `if (reglaActiva && modalidadMk === '...' && tarifa) {...} else {...}`
// escrito por separado. Un cambio en la condición (ej. un nuevo requisito de
// validación) tenía que replicarse a mano en los 3, con el riesgo real de
// que alguno quedara desincronizado — que fue exactamente el defecto 2 de la
// primera ronda de revisión (getProgramasResumen no aplicaba la modalidad).
//
// Esta función es la ÚNICA que decide esa rama, para los 3 consumidores. NO
// decide el `dias` a usar (`opt.dias` llega YA RESUELTO por el llamador) —
// `getProgramaDetalle` y `getProgramasResumen` usan fallbacks de `dias`
// distintos entre sí para el camino histórico (una asimetría PREEXISTENTE a
// este PR, documentada en `getProgramasResumen`, que no se toca acá para no
// cambiar en silencio los números ya mostrados de "Desde") — eso sigue
// siendo responsabilidad de cada llamador, exactamente como antes.
// ─────────────────────────────────────────────────────────────────────────

export type CalcPvpAcomodacionInput = {
  /** Neto persistido de esta acomodación (camino histórico). null/no positivo = nada que mostrar. */
  neto: number | null;
  /** Tarifa de proveedor de ESTA acomodación puntual, si el proveedor la cargó. null = no aplica/no cargada. */
  tarifa: number | null;
  reglaActiva: boolean;
  reglaModo: ModoBaseComisionable;
  reglaValor: number;
  reglaPctComision: number;
  modalidadMk: ModalidadMk;
  /** Opciones de pvpPrograma YA resueltas por el llamador (incl. `dias`). */
  opt: PvpOpciones;
};

export function calcularPvpAcomodacionSalida(input: CalcPvpAcomodacionInput): number | null {
  const neto = input.neto;
  if (neto == null || !(Number(neto) > 0)) return null;

  if (input.reglaActiva && input.modalidadMk === "base_neta_impuestos_al_final" && input.tarifa != null) {
    const tarifa = Number(input.tarifa);
    if (Number.isFinite(tarifa) && tarifa > 0) {
      const calc = calcularNetoProgramaConModalidad(
        { tarifa, modo: input.reglaModo, valor: input.reglaValor, pctComision: input.reglaPctComision },
        input.modalidadMk
      );
      return pvpPrograma(calc.netoParaMarkup, input.opt, calc.montoSinMarkup);
    }
  }
  return pvpPrograma(Number(neto), input.opt);
}

// ─────────────────────────────────────────────────────────────────────────
// Validación de UNA tarifa de proveedor contra la modalidad de MK (revisión
// PR #277, defecto 3). `baseNeta < 0` es matemáticamente posible (ej. modo
// 'impuesto' con un impuesto mayor a la tarifa y % de comisión < 100) y, para
// la modalidad NUEVA, produciría un `netoParaMarkup` negativo — la fórmula
// confirmada (`Venta = baseNeta/divisorMK + impuestos`) no tiene un resultado
// sensato ahí (una base "negativa" dividida por el divisor de MK no es un
// costo real). Es una CONFIGURACIÓN INVÁLIDA, no un caso a tolerar con un PVP
// fabricado en 0 — se rechaza ANTES de guardar, en las 3 fronteras (navegador,
// Server Action, RPC).
//
// ⚠️ Solo aplica a la modalidad 'base_neta_impuestos_al_final'. La modalidad
// 'historica' NUNCA usó `baseNeta` (usa `neto = tarifa - comision` directo, que
// no tiene este problema — `neto` nunca fue negativo mientras `pctComision`
// esté en [0,100], que ya lo garantiza `validarReglaComisionable`) — datos/
// programas históricos jamás pasan por esta regla nueva, ni se bloquean por
// ella retroactivamente.
//
// ⚠️ Paridad numérica JS↔Postgres (revisión PR #277, ronda 2). El RPC
// (`guardar_programa_salidas`, migración 161) calcula
// `base_neta = base_comisionable * (1 - pct_comision/100)` con aritmética
// `numeric` EXACTA — nunca redondea antes de comparar contra 0. En cambio
// `calcularNetoProgramaConModalidad()` redondea `baseNeta` a 2 decimales
// (`r2`, pensado para el PVP MOSTRADO, no para decidir válido/inválido) —
// una base apenas negativa (ej. -0,0036) podía redondear a `-0` (que en JS
// NO es `< 0`) y pasar el chequeo del navegador/Server Action mientras el
// RPC, con el mismo dato, la rechazaba: los tres puntos daban veredictos
// distintos para la MISMA tarifa. `baseNetaExacta()` recalcula la base SIN
// redondear ningún paso intermedio — exactamente la misma secuencia de
// operaciones que el RPC — y es la que usa `validarTarifaModalidad` para la
// comparación `< 0`. El redondeo a 2 decimales (`r2`) se conserva SOLO para
// los valores monetarios que sí se muestran/persisten
// (`calcularNetoProgramaConModalidad`, sin cambios) — nunca para decidir si
// una configuración es válida. No se introduce ninguna tolerancia/margen: la
// frontera sigue siendo `< 0` exacto en los tres lugares.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Base neta SIN redondear ningún paso intermedio — misma secuencia exacta de
 * operaciones que el RPC en Postgres (`numeric`, sin pérdida de precisión
 * para estos valores). Uso EXCLUSIVO: la comparación `< 0` de
 * `validarTarifaModalidad`. Para el valor mostrado/persistido, usar
 * `calcularNetoProgramaConModalidad` (que sí redondea a 2 decimales).
 */
export function baseNetaExacta(
  tarifa: number,
  regla: { modo: ModoBaseComisionable; valor: number; pctComision: number }
): number {
  const t = Number(tarifa) || 0;
  const valor = Number(regla.valor) || 0;
  const pctCom = Number(regla.pctComision) || 0;

  let base = t;
  if (regla.modo === "pct") base = t * (1 - valor / 100);
  else if (regla.modo === "impuesto") base = t - valor;
  // 'ninguno' → base = tarifa, igual que calcularNetoPrograma.

  return base * (1 - pctCom / 100);
}

export function validarTarifaModalidad(
  tarifa: number,
  regla: { modo: ModoBaseComisionable; valor: number; pctComision: number },
  modalidadMk: ModalidadMk
): ValidacionRegla {
  if (modalidadMk !== "base_neta_impuestos_al_final") return { ok: true };
  const t = Number(tarifa);
  // Sin tarifa (o <= 0) no hay nada que validar — mismo criterio que el resto
  // del módulo: "una acomodación sin tarifa del proveedor no se toca".
  if (!Number.isFinite(t) || t <= 0) return { ok: true };
  const exacta = baseNetaExacta(t, regla);
  if (exacta < 0) {
    // El valor MOSTRADO en el mensaje sí se redondea (legibilidad) — la
    // DECISIÓN ya se tomó arriba con `exacta`, sin redondear.
    const mostrado = Math.round(exacta * 100) / 100;
    return {
      ok: false,
      error: `La tarifa ${t} produce una base neta negativa (${mostrado}) en la modalidad "MK sobre base neta; impuestos al final" — revisa el % de comisión, el % a restar o el impuesto configurado.`,
    };
  }
  return { ok: true };
}

export function recalcularNetosPorTarifa(
  tarifas: TarifasProveedorSalida,
  regla: { modo: ModoBaseComisionable; valor: number; pctComision: number }
): NetosRecalculados {
  const calc = (tarifa: number | null): number | null => {
    if (tarifa == null || !Number.isFinite(tarifa) || tarifa <= 0) return null;
    return calcularNetoPrograma({ tarifa, modo: regla.modo, valor: regla.valor, pctComision: regla.pctComision }).neto;
  };
  return {
    sencilla: calc(tarifas.sencilla),
    doble: calc(tarifas.doble),
    triple: calc(tarifas.triple),
    multiple: calc(tarifas.multiple),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Validación de la regla comisionable — MISMA función en el navegador (para
// no recalcular con 0 mientras el usuario escribe) y en la Server Action
// (para no depender solo del navegador). Antes, un campo vacío se convertía
// con `Number(cValor) || 0` — un cero SILENCIOSO que ya recalculaba los
// netos en pantalla, mientras el payload guardado mandaba `null`. Al volver
// a entrar, `null` se mostraba como el default "3"/"10", distinto del cero
// que se había usado para calcular — la regla mostrada y la usada divergían.
//
// Reglas (solo cuando `activa` es true — inactiva no tiene restricciones,
// los valores solo se conservan tal cual para poder reactivar sin perder
// nada):
//   · pctComision: siempre obligatorio, número finito en [0, 100].
//   · valor:
//       - modo 'pct'      → obligatorio, número finito en [0, 100].
//       - modo 'impuesto' → obligatorio, número finito ≥ 0 (sin tope: es un
//         monto en la moneda del programa, no un porcentaje).
//       - modo 'ninguno'  → no participa en el cálculo, no se valida (puede
//         traer cualquier valor previo, sirve para volver al modo anterior).
// ─────────────────────────────────────────────────────────────────────────

export type ReglaComisionableEstado = {
  activa: boolean;
  modo: ModoBaseComisionable;
  valor: number | null;
  pctComision: number | null;
  // Migración 161 — igual criterio que `modo`: se valida INCONDICIONALMENTE
  // (mismo CHECK de Postgres, que no mira `regla_comisionable`), nunca solo
  // cuando la regla está activa.
  modalidadMk: ModalidadMk;
};

export type ValidacionRegla = { ok: true } | { ok: false; error: string };

const enRango = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

export function validarReglaComisionable(regla: ReglaComisionableEstado): ValidacionRegla {
  if (!esModalidadMkValida(regla.modalidadMk)) {
    return { ok: false, error: "La modalidad de MK no es válida." };
  }
  if (!regla.activa) return { ok: true };

  if (regla.pctComision == null || !enRango(regla.pctComision, 0, 100)) {
    return { ok: false, error: "El % de comisión debe ser un número entre 0 y 100." };
  }

  if (regla.modo === "pct") {
    if (regla.valor == null || !enRango(regla.valor, 0, 100)) {
      return { ok: false, error: "El % a restar debe ser un número entre 0 y 100." };
    }
  } else if (regla.modo === "impuesto") {
    if (regla.valor == null || !Number.isFinite(regla.valor) || regla.valor < 0) {
      return { ok: false, error: "El impuesto debe ser un número mayor o igual a 0." };
    }
  }
  // modo 'ninguno': valor no participa, no se valida.

  return { ok: true };
}

// "" / espacios / no numérico → null (nunca 0 por defecto). Mismo criterio
// que `num()` en actions.ts, expuesto aquí para que el navegador y el
// servidor partan SIEMPRE del mismo número (o de la misma ausencia de él).
export function parseNumOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
