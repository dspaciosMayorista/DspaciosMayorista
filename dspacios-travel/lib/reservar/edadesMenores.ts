// ─────────────────────────────────────────────────────────────────────────
// Edad individual de cada menor en la CONSULTA de Vista Booking (no la fecha
// de nacimiento — esa se diligencia después, en el listado real de
// pasajeros del contrato). Reemplaza el mecanismo anterior de "cuántos
// niños van en la tarifa Niño 1 / cuántos en Niño 2 / cuántos infantes",
// que el asesor asignaba a mano sin ninguna edad real de por medio.
//
// Reglas REALES reutilizadas, no inventadas:
// - El único umbral de edad que el motor de reservas usa de verdad es
//   `hoteles.edad_infante_max`/`edad_nino_max` (lib/acomodaciones.ts,
//   `clasificarPorEdad` — la misma función que ya usa `computarReserva`
//   para validar las edades reales de los pasajeros contra la
//   acomodación). Este módulo llama a esa MISMA función; no reimplementa
//   el umbral.
// - "Niño 1"/"Niño 2" (migración 20260601000020_dos_ninos.sql) NO son dos
//   rangos de edad distintos — son dos TARIFAS por el mismo rango "niño"
//   ("el hotel da gratis el 1er niño y cobra el 2º, o cobra distinto cada
//   uno"). La edad decide CUÁNTOS menores caen en la categoría "niño"; CUÁL
//   paga Niño-1 y cuál Niño-2 es un reparto POR HABITACIÓN (confirmado por
//   el negocio, no un límite de 2 en toda la reserva): cada habitación
//   admite como máximo un Niño-1 y un Niño-2. Ese reparto vive en
//   `lib/reservar/distribucionHabitaciones.ts` — este módulo SOLO clasifica
//   la edad (infante/niño/edad-de-adulto), nunca decide habitación ni tarifa.
// - Un menor cuya edad supera `edad_nino_max` no tiene una "tarifa de
//   adulto" individual que cobrarle: en este sistema el adulto se cobra
//   por OCUPACIÓN DE HABITACIÓN (habitaciones × pax_tarifa), no por
//   persona suelta. Por eso esa edad falla cerrado pidiendo contarla
//   entre los adultos/habitaciones, en vez de inventar un cobro.
//
// Módulo PURO (sin "use client"/"use server"): se usa tanto desde los
// componentes de Vista Booking (preview en memoria antes de cotizar) como
// desde el servidor (re-validación autoritativa de lo que mande el
// cliente, que se trata siempre como `unknown`).
// ─────────────────────────────────────────────────────────────────────────

// Import relativo (no `@/…`) a propósito: este módulo se importa DIRECTO
// desde `node --test` (ver pruebas/edadesMenores.test.ts) para ejecutar la
// lógica real, y ese runtime no resuelve el alias `@/` de tsconfig — mismo
// motivo por el que otros módulos puros del repo (lib/reservar/origen.ts,
// lib/vuelos/control.ts) evitan imports con alias.
import { clasificarPorEdad, esAcomRoom, type AcomRoom } from "../acomodaciones.ts";

// Un "menor" nunca puede declararse con 18 años o más — la propia
// definición de adulto del sistema (ocupación de habitación, nunca tarifa
// de menor) hace que cualquier edad de mayoría de edad no tenga sentido en
// este campo. No es un rango de negocio nuevo: es el límite de lo que el
// campo "menor" puede significar.
export const EDAD_MENOR_MAX = 17;

// Tope de menores por consulta — protege el payload, no es una regla de
// negocio de precios (ver también MAX_PAX_CONSULTA más abajo, el tope total).
export const MAX_MENORES_POR_CONSULTA = 10;

// Tope total de pax (adultos + menores) por una sola consulta/ítem —
// protección de payload/DoS en la frontera del servidor, no un límite de
// ocupación real de ningún hotel (esos ya se validan aparte por acomodación).
export const MAX_PAX_CONSULTA = 24;

// Tope de habitaciones por consulta — mismo límite que ya mostraba la UI de
// BuscadorBooking ("A partir de 9 habitaciones, contacta a un asesor"),
// ahora también exigido en el servidor.
export const MAX_HABITACIONES_CONSULTA = 8;

// Parser de UN campo de edad tal como lo escribe el usuario (string —
// controlado así para poder dejarlo vacío mientras escribe). Compartido por
// todos los formularios de Vista Booking que piden edad por menor, para no
// reimplementar el mismo criterio (entero, sin negativos/decimales/texto,
// dentro de EDAD_MENOR_MAX) en cada componente.
export function parseEdadMenor(s: string): { valor: number | null; error: string | null } {
  const t = s.trim();
  if (t === "") return { valor: null, error: "Obligatoria" };
  if (!/^\d+$/.test(t)) return { valor: null, error: "Entero, sin negativos ni decimales" };
  const n = Number(t);
  if (n > EDAD_MENOR_MAX) return { valor: null, error: `0 a ${EDAD_MENOR_MAX}` };
  return { valor: n, error: null };
}

// Ajusta el arreglo de edades (como texto — controlado en el input) a una
// nueva cantidad de menores: si crece, agrega campos VACÍOS al final; si
// decrece, quita solo los sobrantes del final. Las edades ya escritas nunca
// se reordenan ni se pierden. Compartido por todos los formularios de Vista
// Booking que piden "cantidad de menores" + N campos de edad, para que el
// comportamiento de "aumentar/disminuir conserva lo existente" sea uno solo,
// probado una vez, y no una copia por componente.
export function ajustarCantidadEdades(actual: readonly string[], nuevaCantidad: number): string[] {
  const n = Math.max(0, Math.min(MAX_MENORES_POR_CONSULTA, Math.trunc(nuevaCantidad) || 0));
  const next = actual.slice(0, n);
  while (next.length < n) next.push("");
  return next;
}

export function validarCantidadMenores(v: unknown): { ok: true; cantidad: number } | { ok: false; error: string } {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return { ok: false, error: "La cantidad de menores debe ser un entero mayor o igual a 0." };
  if (v > MAX_MENORES_POR_CONSULTA) return { ok: false, error: `No se pueden cotizar más de ${MAX_MENORES_POR_CONSULTA} menores en una sola consulta.` };
  return { ok: true, cantidad: v };
}

// Valida la FORMA completa del arreglo de edades antes de que el llamador
// use `.map()`/`.length`/aritmética sobre él — nunca asume que lo que
// llegó ya es `number[]` solo porque el tipo de TypeScript lo declare así
// (una Server Action puede invocarse con cualquier body HTTP).
export function validarEdadesMenores(
  v: unknown,
  cantidadMenores: number
): { ok: true; edades: number[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "Las edades de los menores deben venir como un arreglo." };
  if (v.length !== cantidadMenores) {
    return { ok: false, error: `Se esperaban ${cantidadMenores} edad(es) de menor y llegaron ${v.length}.` };
  }
  const edades: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    if (typeof e !== "number" || !Number.isInteger(e) || !Number.isFinite(e)) {
      return { ok: false, error: `La edad del menor ${i + 1} debe ser un número entero.` };
    }
    if (e < 0) return { ok: false, error: `La edad del menor ${i + 1} no puede ser negativa.` };
    if (e > EDAD_MENOR_MAX) return { ok: false, error: `La edad del menor ${i + 1} (${e}) no corresponde a un menor de edad.` };
    edades.push(e);
  }
  return { ok: true, edades };
}

// Totales agregados de la reserva/consulta completa (después de sumar la
// distribución por habitación) — misma forma que antes para no romper a los
// llamadores que solo necesitan el agregado (ej. el motor de precio).
export type ClasificacionMenores = { infantes: number; nino: number; nino2: number };

export type ClasificacionEdadMenores = { infantes: number; ninos: number };

export type ResultadoClasificacionEdad =
  | { ok: true; c: ClasificacionEdadMenores }
  | { ok: false; codigo: "edad_adulto"; error: string };

// Clasifica las edades YA VALIDADAS (ver validarEdadesMenores) contra los
// umbrales REALES del hotel — reutiliza `clasificarPorEdad`, la misma
// función que usa el motor de reservas para validar pasajeros reales. Falla
// cerrado (nunca aproxima) si alguna edad excede el umbral de niño — esa
// persona no tiene una tarifa individual que cobrarle en este sistema (el
// adulto se cobra por ocupación de habitación).
//
// A propósito NO decide cuántos pagan Niño 1/Niño 2 ni si hay cupo para
// todos: eso depende de las habitaciones consultadas (una habitación admite
// como máximo un Niño 1 y un Niño 2, pero puede haber varias habitaciones),
// y vive en `distribuirPorHabitaciones()` (lib/reservar/distribucionHabitaciones.ts).
export function clasificarMenoresPorEdad(
  edades: number[],
  infanteMax: number,
  ninoMax: number
): ResultadoClasificacionEdad {
  const c = clasificarPorEdad(edades, infanteMax, ninoMax);
  if (c.adultos > 0) {
    const edadAdulto = edades.find((e) => e > ninoMax)!;
    return {
      ok: false,
      codigo: "edad_adulto",
      error: `La edad ${edadAdulto} corresponde a tarifa de adulto según este hotel (mayor a ${ninoMax} años) — cuenta a esta persona entre los adultos (habitaciones), no como menor.`,
    };
  }
  return { ok: true, c: { infantes: c.infantes, ninos: c.ninos } };
}

// Confirma que el hotel/combo (categoría+régimen) tenga de verdad una tarifa
// para las categorías que la distribución por habitación necesita. Infante
// queda fuera a propósito: es la ÚNICA asimetría real y ya documentada del
// sistema (si el hotel no configuró tarifa de infante, se vende gratis en
// vez de bloquear — ver computo.ts, "a diferencia de niño, si no está
// configurado NO bloquea la reserva"); Niño 1/2 SIEMPRE deben tener tarifa
// configurada si la distribución asignó a alguien ahí, o la consulta falla
// cerrado.
export function verificarTarifasMenoresDisponibles(
  c: ClasificacionMenores,
  disponible: { nino: boolean; nino2: boolean }
): string | null {
  if (c.nino > 0 && !disponible.nino) return "Este hotel no tiene tarifa de Niño 1 configurada para esa categoría/régimen — no se puede cotizar con esa edad.";
  if (c.nino2 > 0 && !disponible.nino2) return "Este hotel no tiene tarifa de Niño 2 configurada para esa categoría/régimen — no se puede cotizar con esa edad.";
  return null;
}

// ── Carritos viejos (localStorage) sin `edadesMenores` ──────────────────────
// Ítems del carrito guardados ANTES de este cambio no traen `edadesMenores`
// (campo opcional agregado después). Nunca se infiere una edad ni se sigue
// con el reparto manual viejo en silencio:
// - sin edades Y sin menores (ninos+ninos2+infantes = 0) → no hay nada que
//   perder, se normaliza a `edadesMenores: []`.
// - con menores pero sin edades → no hay forma honesta de saber la edad de
//   cada uno; se bloquea pidiendo quitar y volver a agregar ese hotel.
export function normalizarEdadesMenoresCarrito(item: {
  edadesMenores?: number[];
  ninos: number;
  ninos2: number;
  infantes: number;
}): { ok: true; edadesMenores: number[] } | { ok: false; error: string } {
  if (item.edadesMenores !== undefined) return { ok: true, edadesMenores: item.edadesMenores };
  const totalMenores = Math.max(0, Math.trunc(Number(item.ninos) || 0))
    + Math.max(0, Math.trunc(Number(item.ninos2) || 0))
    + Math.max(0, Math.trunc(Number(item.infantes) || 0));
  if (totalMenores === 0) return { ok: true, edadesMenores: [] };
  return {
    ok: false,
    error: "Este hotel se agregó al carrito antes de pedir la edad de cada menor. Quítalo y agrégalo de nuevo para indicar las edades.",
  };
}

// ── Frontera de Server Actions públicas — el arreglo/objeto que llega desde
// el navegador se trata SIEMPRE como `unknown`, nunca como el tipo de
// TypeScript que declare la función que lo recibe (un caller manipulado
// puede invocar la Server Action con cualquier body HTTP). Estas funciones
// validan la FORMA completa antes de que el llamador use `.map()`/`.length`/
// aritmética sobre el resultado.

export type HabitacionInputValidada = { acom: AcomRoom };

export function validarHabitacionesConsultadas(
  v: unknown
): { ok: true; habitaciones: HabitacionInputValidada[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "Las habitaciones deben venir como un arreglo." };
  if (v.length === 0) return { ok: false, error: "Indica al menos una habitación." };
  if (v.length > MAX_HABITACIONES_CONSULTA) {
    return { ok: false, error: `No se pueden consultar más de ${MAX_HABITACIONES_CONSULTA} habitaciones a la vez.` };
  }
  const habitaciones: HabitacionInputValidada[] = [];
  for (let i = 0; i < v.length; i++) {
    const h = v[i];
    if (typeof h !== "object" || h === null || Array.isArray(h)) {
      return { ok: false, error: `La habitación ${i + 1} debe ser un objeto.` };
    }
    const acom = (h as Record<string, unknown>).acom;
    if (typeof acom !== "string" || !esAcomRoom(acom)) {
      return { ok: false, error: `La habitación ${i + 1} tiene un tipo de acomodación inválido.` };
    }
    habitaciones.push({ acom });
  }
  return { ok: true, habitaciones };
}

export function validarAdultosDeclarados(v: unknown): { ok: true; adultos: number } | { ok: false; error: string } {
  if (typeof v !== "number" || !Number.isInteger(v) || !Number.isFinite(v) || v < 1) {
    return { ok: false, error: "La cantidad de adultos debe ser un entero mayor o igual a 1." };
  }
  if (v > MAX_PAX_CONSULTA) return { ok: false, error: `No se pueden cotizar más de ${MAX_PAX_CONSULTA} adultos en una sola consulta.` };
  return { ok: true, adultos: v };
}

// Fecha en formato `YYYY-MM-DD` — mismo formato que ya produce/consume todo
// el motor de reservar (`input type="date"`, columnas `date` de Postgres).
// No valida que el día/mes exista de verdad (eso lo hace la base de datos al
// comparar fechas) — solo que la FORMA sea la esperada, para no dejar pasar
// un objeto, un número o texto arbitrario a una comparación de fechas.
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
export function validarFechaConsulta(v: unknown): { ok: true; fecha: string } | { ok: false; error: string } {
  if (typeof v !== "string" || !RE_FECHA_ISO.test(v)) return { ok: false, error: "La fecha debe tener el formato AAAA-MM-DD." };
  return { ok: true, fecha: v };
}

export function validarDestinoConsulta(v: unknown): { ok: true; destino: string } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, destino: "" };
  if (typeof v !== "string") return { ok: false, error: "El destino debe ser texto." };
  if (v.length > 120) return { ok: false, error: "El destino es demasiado largo." };
  return { ok: true, destino: v };
}

// Valida por completo el arreglo de ítems del carrito (`SolicitudItem[]`)
// que llega al checkout público — cada ítem se trata como `unknown` antes de
// leer NINGUNA propiedad. `edadesMenores` es OBLIGATORIO en este flujo
// (Vista Booking pública): `[]` cuando no hay menores, una edad por cada
// menor cuando sí los hay — nunca se cae al reparto manual legado
// (ninos/ninos2/infantes) por venir ausente. Ese fallback solo existe para
// el flujo interno de Reservar (`ReservaForm.tsx`), que no pasa por acá.
export type SolicitudItemValidado = {
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  hotelNombre: string;
  destino: string | null;
  categoria: string;
  regimen: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  habitaciones: Record<string, number>;
  cantidadMenores: number;
  edadesMenores: number[];
};

function esEnteroPositivoONulo(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isInteger(v) && Number.isFinite(v) && v >= 0);
}

export function validarSolicitudItem(v: unknown, indice: number): { ok: true; item: SolicitudItemValidado } | { ok: false; error: string } {
  const ctx = `El ítem ${indice + 1} del carrito`;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, error: `${ctx} no tiene una forma válida.` };
  const o = v as Record<string, unknown>;

  if (o.modulo !== "bloqueo" && o.modulo !== "porcion_terrestre") return { ok: false, error: `${ctx} tiene un módulo inválido.` };
  if (typeof o.paqueteId !== "number" || !Number.isInteger(o.paqueteId)) return { ok: false, error: `${ctx} tiene un paquete inválido.` };
  if (typeof o.hotelId !== "number" || !Number.isInteger(o.hotelId)) return { ok: false, error: `${ctx} tiene un hotel inválido.` };
  if (!(o.bloqueoId === null || (typeof o.bloqueoId === "number" && Number.isInteger(o.bloqueoId)))) return { ok: false, error: `${ctx} tiene un bloqueo inválido.` };
  if (typeof o.hotelNombre !== "string") return { ok: false, error: `${ctx} no trae el nombre del hotel.` };
  if (!(o.destino === null || typeof o.destino === "string")) return { ok: false, error: `${ctx} tiene un destino inválido.` };
  if (typeof o.categoria !== "string" || typeof o.regimen !== "string") return { ok: false, error: `${ctx} tiene categoría/régimen inválidos.` };
  if (!(o.fechaIda === null || o.fechaIda === undefined || typeof o.fechaIda === "string")) return { ok: false, error: `${ctx} tiene una fecha de ida inválida.` };
  if (!(o.fechaRegreso === null || o.fechaRegreso === undefined || typeof o.fechaRegreso === "string")) return { ok: false, error: `${ctx} tiene una fecha de regreso inválida.` };
  if (!(o.noches === null || o.noches === undefined || (typeof o.noches === "number" && Number.isInteger(o.noches)))) return { ok: false, error: `${ctx} tiene un número de noches inválido.` };

  if (typeof o.habitaciones !== "object" || o.habitaciones === null || Array.isArray(o.habitaciones)) {
    return { ok: false, error: `${ctx} tiene habitaciones inválidas.` };
  }
  const habitaciones: Record<string, number> = {};
  for (const [k, val] of Object.entries(o.habitaciones as Record<string, unknown>)) {
    if (!esAcomRoom(k) || !esEnteroPositivoONulo(val)) return { ok: false, error: `${ctx} tiene una habitación inválida.` };
    habitaciones[k] = (val as number) ?? 0;
  }

  // `edadesMenores` es obligatorio (nunca undefined) en este flujo público.
  if (o.edadesMenores === undefined) {
    return { ok: false, error: `${ctx} no indica la edad de sus menores (agrégalo de nuevo desde Vista Booking).` };
  }
  const vCant = validarCantidadMenores(o.cantidadMenores);
  if (!vCant.ok) return { ok: false, error: `${ctx}: ${vCant.error}` };
  const vEdades = validarEdadesMenores(o.edadesMenores, vCant.cantidad);
  if (!vEdades.ok) return { ok: false, error: `${ctx}: ${vEdades.error}` };

  return {
    ok: true,
    item: {
      modulo: o.modulo, paqueteId: o.paqueteId, hotelId: o.hotelId, bloqueoId: o.bloqueoId as number | null,
      hotelNombre: o.hotelNombre, destino: (o.destino as string | null) ?? null,
      categoria: o.categoria, regimen: o.regimen,
      fechaIda: (o.fechaIda as string | undefined) ?? null, fechaRegreso: (o.fechaRegreso as string | undefined) ?? null,
      noches: (o.noches as number | undefined) ?? null,
      habitaciones, cantidadMenores: vCant.cantidad, edadesMenores: vEdades.edades,
    },
  };
}
