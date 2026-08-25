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
// Corrige un SEGUNDO defecto real (ronda 4): la primera versión repartía por
// orden de captura llenando cada habitación hasta su máximo ANTES de mirar
// si otra habitación exige un mínimo (`chd_min`/`inf_min`) — eso producía
// falsos rechazos aunque existiera una distribución válida. Ejemplo: dos
// habitaciones con chd_min=1/chd_max=2 cada una y 2 niños en total: el
// reparto voraz asignaba [2,0] (la primera se queda con los dos) y luego
// rechazaba la segunda por no alcanzar su mínimo — aunque [1,1] es una
// distribución perfectamente válida. Ahora el reparto (niños e infantes,
// cada uno en su propia fase, de forma independiente) sigue SIEMPRE el mismo
// orden en 3 pasos:
//   1) Validar que la CONFIGURACIÓN de cada habitación sea coherente en sí
//      misma (independiente de cuántos niños/infantes pidió el cliente) —
//      un hotel mal configurado falla siempre igual, para cualquier
//      búsqueda, como "configuración inválida" (nunca como si el cliente
//      hubiera elegido mal).
//   2) Asignar primero el MÍNIMO obligatorio de cada habitación.
//   3) Si no alcanzan los niños/infantes para cubrir la suma de mínimos,
//      rechazar con un mensaje claro (la selección del cliente, no la
//      configuración, es lo que no alcanza).
//   4) Repartir lo que sobra por ORDEN DE CAPTURA hasta el máximo de cada
//      habitación.
// Con esto, toda distribución que exista siempre se encuentra: el mínimo de
// cada habitación queda reservado ANTES de repartir nada más, así que ya
// nunca se "gasta" en otra habitación lo que otra necesita para su propio
// mínimo.
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
//   distinto tipo. Ahora vive dentro de la validación de configuración
//   (fase 1): una habitación cuyo `pax_tarifa` no cuadra con su propio
//   `adt_min`/`adt_max` está mal configurada, no "mal elegida" por el
//   cliente (el cliente no elige `pax_tarifa`, es fijo por acomodación).
// - `chd_max`/`chd_min` son el rango de niños que admite ESA habitación —
//   pero el límite de TARIFAS es 2 (Niño 1 y Niño 2), así que la capacidad
//   MÁXIMA real de niño de una habitación para este reparto es
//   `min(chd_max, 2, pax_max - pax_tarifa)` (el niño sí ocupa `pax_max`,
//   igual que un adulto — el infante es el único que no). `chd_min` se
//   exige POR HABITACIÓN, no como una suma agregada: si el hotel configuró
//   un mínimo de niños en esa acomodación (ej. una habitación "familiar"),
//   la distribución debe reservárselo ANTES de repartir cualquier otro niño
//   (fase 2). Por defecto es `0` (ninguna restricción).
// - Los infantes usan `inf_max`/`inf_min` como su propio cupo/mínimo,
//   independiente de `pax_max`: en todo el motor existente el infante "no
//   ocupa silla" (mismo comentario textual en computo.ts) — así que, a
//   diferencia de niño, no se descuenta del `pax_max` de la habitación ni
//   tiene el tope de 2 (no hay "Infante 1"/"Infante 2", solo una cantidad).
//   `inf_min` se exige igual que `chd_min`: por habitación, reservado antes
//   de repartir el resto.
// - `pax_max` sigue limitando adultos+niños (el infante queda afuera, ver
//   punto anterior).
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

// `tipo` distingue DOS clases de fallo, a propósito:
// - "configuracion_invalida": el hotel/acomodación está mal configurado en
//   el catálogo — falla siempre igual, sin importar qué pidió el cliente.
// - "seleccion_invalida": la configuración es coherente, pero lo que pidió
//   el cliente (cantidad de niños/infantes/adultos) no cabe en las
//   habitaciones elegidas para ESTA búsqueda.
// Los llamadores existentes (buscarHoteles/resolverMenoresPorEdad) solo leen
// `.ok`/`.error` y siguen funcionando igual sin mirar `tipo`.
export type ResultadoDistribucion =
  | { ok: true; habitaciones: AsignacionHabitacion[]; totales: TotalesDistribucion }
  | { ok: false; tipo: "configuracion_invalida"; error: string }
  | { ok: false; tipo: "seleccion_invalida"; error: string };

// ── Fase 1: coherencia de CADA configuración, independiente del cliente ────
function capacidadNinoEfectiva(c: ConfigCapacidadHabitacion): number {
  return Math.max(0, Math.min(c.chd_max, MAX_NINO_TARIFAS_POR_HABITACION, c.pax_max - c.pax_tarifa));
}

function validarConfigHabitacion(h: HabitacionConsultada, indice: number): { ok: true } | { ok: false; error: string } {
  const c = h.config;
  const label = `${ACOM_ROOM_LABEL[h.acom] ?? h.acom} (habitación ${indice + 1})`;
  const campos: [string, number][] = [
    ["pax_tarifa", c.pax_tarifa], ["pax_max", c.pax_max],
    ["adt_min", c.adt_min], ["adt_max", c.adt_max],
    ["chd_min", c.chd_min], ["chd_max", c.chd_max],
    ["inf_min", c.inf_min], ["inf_max", c.inf_max],
  ];
  for (const [nombre, v] of campos) {
    if (!Number.isSafeInteger(v) || v < 0) {
      return { ok: false, error: `Configuración inválida: la habitación ${label} tiene "${nombre}" fuera de rango (${v}).` };
    }
  }
  if (c.adt_min > c.adt_max) {
    return { ok: false, error: `Configuración inválida: la habitación ${label} tiene adt_min (${c.adt_min}) mayor que adt_max (${c.adt_max}).` };
  }
  if (c.chd_min > c.chd_max) {
    return { ok: false, error: `Configuración inválida: la habitación ${label} tiene chd_min (${c.chd_min}) mayor que chd_max (${c.chd_max}).` };
  }
  if (c.inf_min > c.inf_max) {
    return { ok: false, error: `Configuración inválida: la habitación ${label} tiene inf_min (${c.inf_min}) mayor que inf_max (${c.inf_max}).` };
  }
  if (c.pax_tarifa < c.adt_min || c.pax_tarifa > c.adt_max) {
    return { ok: false, error: `Configuración inválida: la habitación ${ACOM_ROOM_LABEL[h.acom]} admite entre ${c.adt_min} y ${c.adt_max} adulto(s); está configurada para ${c.pax_tarifa}.` };
  }
  if (c.pax_tarifa > c.pax_max) {
    return { ok: false, error: `Configuración inválida: la habitación ${label} tiene pax_tarifa (${c.pax_tarifa}) mayor que su propio pax_max (${c.pax_max}).` };
  }
  const capNino = capacidadNinoEfectiva(c);
  if (c.chd_min > capNino) {
    return { ok: false, error: `Configuración inválida: la habitación ${label} exige chd_min (${c.chd_min}) por encima de su capacidad efectiva de niño (${capNino} = min(chd_max, 2, pax_max−adultos)).` };
  }
  return { ok: true };
}

// ── Fases 2-4, compartidas por niños e infantes: asignar mínimos primero,
// rechazar si no alcanza, repartir el resto por orden de captura. ──────────
type ResultadoReparto = { ok: true; counts: number[] } | { ok: false; tipo: "seleccion_invalida"; error: string };

function repartirConMinimos(args: {
  cantidad: number;
  capacidades: number[]; // capacidad máxima por habitación, ya acotada (fase 1 ya la validó coherente con su mínimo)
  minimos: number[];     // mínimo exigido por habitación
  totalHabitaciones: number;
  singular: string;
  plural: string;
}): ResultadoReparto {
  const { cantidad, capacidades, minimos, totalHabitaciones, singular, plural } = args;
  const sujeto = totalHabitaciones === 1 ? "La habitación seleccionada admite" : `Las ${totalHabitaciones} habitaciones seleccionadas admiten`;
  const sujetoExige = totalHabitaciones === 1 ? "La habitación seleccionada exige" : `Las ${totalHabitaciones} habitaciones seleccionadas exigen`;
  const capTotal = capacidades.reduce((s, c) => s + c, 0);
  const sumaMin = minimos.reduce((s, m) => s + m, 0);

  // Máximo agregado: nunca cambia respecto a la versión anterior — sigue
  // siendo la primera razón real de rechazo (no caben tantos).
  if (cantidad > capTotal) {
    return { ok: false, tipo: "seleccion_invalida", error: `${sujeto} máximo ${capTotal} ${singular}(s); hay ${cantidad}.` };
  }
  // Mínimo agregado: si ni sumando todos los mínimos alcanza lo declarado,
  // no hay forma de cubrir cada habitación que lo exige — se rechaza ANTES
  // de intentar repartir nada (fase 3).
  if (cantidad < sumaMin) {
    return {
      ok: false, tipo: "seleccion_invalida",
      error: `${sujetoExige} un mínimo de ${sumaMin} ${plural} en total; hay ${cantidad}.`,
    };
  }

  // Fase 2: reservar el mínimo de CADA habitación antes de tocar el resto.
  const counts = minimos.slice();
  let restante = cantidad - sumaMin; // ya se validó cantidad >= sumaMin arriba

  // Fase 4: repartir el sobrante por orden de captura, hasta el máximo de
  // cada habitación. Como capTotal >= cantidad y cada `disponible` es
  // exactamente `capacidad − mínimo_ya_reservado`, este recorrido siempre
  // termina con `restante = 0` — nunca puede quedar sobrante sin ubicar.
  for (let i = 0; i < counts.length && restante > 0; i++) {
    const disponible = capacidades[i] - counts[i];
    if (disponible <= 0) continue;
    const tomar = Math.min(disponible, restante);
    counts[i] += tomar;
    restante -= tomar;
  }

  return { ok: true, counts };
}

export function distribuirPorHabitaciones(input: {
  adultosDeclarados: number;
  ninos: number; // cantidad ya clasificada como "niño" por edad (sin repartir aún)
  infantes: number; // cantidad ya clasificada como infante
  habitaciones: HabitacionConsultada[];
}): ResultadoDistribucion {
  const { adultosDeclarados, ninos, infantes, habitaciones } = input;
  if (!habitaciones.length) return { ok: false, tipo: "seleccion_invalida", error: "Indica al menos una habitación." };

  // ── Fase 1: coherencia de cada configuración, para TODAS las habitaciones
  // consultadas — sin importar cuántos niños/infantes pidió el cliente. Un
  // hotel mal configurado falla siempre igual, no como si el cliente hubiera
  // elegido mal.
  for (let i = 0; i < habitaciones.length; i++) {
    const v = validarConfigHabitacion(habitaciones[i], i);
    if (!v.ok) return { ok: false, tipo: "configuracion_invalida", error: v.error };
  }

  // ── Adultos: la fórmula de precio (habitaciones × pax_tarifa) ya fija
  // cuántos adultos "caben" en la selección de habitaciones — el campo
  // Adultos declarado por el usuario debe coincidir con eso; si no, la
  // selección de habitaciones no corresponde a la cantidad de viajeros. Esto
  // SÍ es una elección del cliente (cuántas habitaciones/adultos declaró),
  // no un problema de configuración.
  const adultosImplicitos = habitaciones.reduce((s, h) => s + h.config.pax_tarifa, 0);
  if (adultosDeclarados !== adultosImplicitos) {
    return {
      ok: false, tipo: "seleccion_invalida",
      error: `Las habitaciones elegidas son para ${adultosImplicitos} adulto(s); declaraste ${adultosDeclarados}. Ajusta la cantidad de habitaciones o de adultos.`,
    };
  }

  const asign: AsignacionHabitacion[] = habitaciones.map((h, i) => ({
    indice: i, acom: h.acom, adultos: h.config.pax_tarifa, nino: 0, nino2: 0, infantes: 0,
  }));

  // ── Niños: mínimos primero, luego sobrantes por orden de captura. El tope
  // real por habitación es `min(chd_max, 2, pax_max − adultos)` — la fase 1
  // ya garantizó que `chd_min` de cada habitación cabe dentro de ese tope.
  const capNino = habitaciones.map((h) => capacidadNinoEfectiva(h.config));
  const minNino = habitaciones.map((h) => h.config.chd_min);
  const rNinos = repartirConMinimos({
    cantidad: ninos, capacidades: capNino, minimos: minNino,
    totalHabitaciones: habitaciones.length, singular: "niño", plural: "niño(s)",
  });
  if (!rNinos.ok) return rNinos;
  // Primer niño de la habitación = Niño 1; segundo = Niño 2 — como el tope
  // efectivo nunca pasa de 2, la cantidad asignada ya determina cuál de los
  // dos (o ambos) le toca, sin necesidad de rastrear el orden literal.
  rNinos.counts.forEach((n, i) => { asign[i].nino = n >= 1 ? 1 : 0; asign[i].nino2 = n >= 2 ? 1 : 0; });

  // ── Infantes: mismo patrón, con su propio cupo/mínimo (`inf_max`/`inf_min`),
  // independiente de `pax_max` y sin tope de 2 (no hay "Infante 1"/"Infante 2").
  const capInf = habitaciones.map((h) => h.config.inf_max);
  const minInf = habitaciones.map((h) => h.config.inf_min);
  const rInfantes = repartirConMinimos({
    cantidad: infantes, capacidades: capInf, minimos: minInf,
    totalHabitaciones: habitaciones.length, singular: "infante", plural: "infante(s)",
  });
  if (!rInfantes.ok) return rInfantes;
  rInfantes.counts.forEach((n, i) => { asign[i].infantes = n; });

  const totales = asign.reduce(
    (t, a) => ({ adultos: t.adultos + a.adultos, nino: t.nino + a.nino, nino2: t.nino2 + a.nino2, infantes: t.infantes + a.infantes }),
    { adultos: 0, nino: 0, nino2: 0, infantes: 0 } as TotalesDistribucion
  );
  return { ok: true, habitaciones: asign, totales };
}
