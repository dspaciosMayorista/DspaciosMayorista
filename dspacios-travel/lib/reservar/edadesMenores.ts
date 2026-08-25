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
// `lib/b2b.ts` solo importa TIPOS con alias (`import type`) — se eliden por
// completo al compilar/ejecutar, así que sí es seguro importarlo relativo
// desde node --test (confirmado: sin este import, `categoriaAliado` habría
// quedado duplicado en dos archivos).
import { categoriaAliado } from "../b2b.ts";

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

// ── Límites centralizados de la frontera pública (checkout) ────────────────
// Protegen contra payloads gigantes ANTES de iterar/tocar Supabase — no son
// reglas de negocio de ocupación (esas ya las validan `distribuirPorHabitaciones`/
// `validarReservaHabitaciones` por acomodación), son topes de payload/DoS.
// Un solo lugar para todos: evita que cada validador invente su propio
// número sin relación con los demás.
export const MAX_ITEMS_CARRITO = 20;          // hoteles por solicitud
export const MAX_TOURS_CARRITO = 20;          // servicios/tours por solicitud
export const MAX_LINEAS_CARRITO = 30;         // hoteles + tours combinados
export const MAX_NOCHES_CONSULTA = 60;        // ~2 meses, ningún viaje real pasa de esto
export const MAX_LONGITUD_TEXTO = 200;        // nombres, destino, categoría, régimen, documento, teléfono, NIT…
export const MAX_LONGITUD_TEXTO_LARGO = 500;  // campos de texto libre (ninguno hoy en esta frontera, reservado)
export const MAX_LONGITUD_MONEDA = 10;        // "COP"/"USD" — nunca un texto largo

// Cadena no vacía dentro de un largo máximo — helper compartido por todos los
// campos de texto de la frontera pública (cliente, facturación, ítems, tours).
export function validarTextoAcotado(
  v: unknown, campo: string, maxLen: number = MAX_LONGITUD_TEXTO, permitirVacio = false
): { ok: true; texto: string } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: `${campo} debe ser texto.` };
  if (!permitirVacio && v.trim() === "") return { ok: false, error: `${campo} es obligatorio.` };
  if (v.length > maxLen) return { ok: false, error: `${campo} no puede superar ${maxLen} caracteres.` };
  return { ok: true, texto: v };
}

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

// Pax de una consulta de servicios/receptivos (buscarReceptivos) — mismo
// criterio que `validarAdultosDeclarados` (entero, ≥1, tope MAX_PAX_CONSULTA)
// pero con su propio mensaje: acá "pax" no son necesariamente adultos-por-
// habitación, son la cantidad de personas para las que se cotiza el tour.
export function validarPaxServicioConsulta(v: unknown): { ok: true; pax: number } | { ok: false; error: string } {
  if (typeof v !== "number" || !Number.isInteger(v) || !Number.isFinite(v) || v < 1) {
    return { ok: false, error: "La cantidad de pax debe ser un entero mayor o igual a 1." };
  }
  if (v > MAX_PAX_CONSULTA) return { ok: false, error: `No se pueden cotizar más de ${MAX_PAX_CONSULTA} pax en una sola consulta.` };
  return { ok: true, pax: v };
}

// Personas REALES de la consulta: adultos + menores (edades ya validadas,
// que incluyen infantes — son personas de la búsqueda igual que un niño,
// aunque el infante no ocupe silla/habitación). Defecto real corregido: la
// consulta original sumaba `habitaciones.length` (cantidad de HABITACIONES,
// no de personas) en vez de adultos — dejaba pasar, por ejemplo,
// MAX_PAX_CONSULTA adultos + varios menores adicionales sin bloquear nada.
export function validarPaxTotalConsulta(adultos: number, cantidadMenores: number): { ok: true } | { ok: false; error: string } {
  if (adultos + cantidadMenores > MAX_PAX_CONSULTA) {
    return { ok: false, error: `No se pueden cotizar más de ${MAX_PAX_CONSULTA} pax en una sola búsqueda.` };
  }
  return { ok: true };
}

// Fecha en formato `YYYY-MM-DD` — mismo formato que ya produce/consume todo
// el motor de reservar (`input type="date"`, columnas `date` de Postgres).
// Valida DOS cosas: la FORMA (regex) y que sea un día real del calendario
// (ej. "2026-13-40" o "2026-02-31" tienen la forma correcta pero no existen).
// `Date.UTC` "desborda" un mes/día fuera de rango hacia el mes/año
// siguiente en vez de fallar — por eso se reconstruye la fecha con los
// mismos año/mes/día que se pidieron y se compara componente por componente;
// si no coincide, el día no existe. Se usa UTC (nunca hora local) para que
// el resultado no dependa de la zona horaria del proceso. La cadena
// original se conserva intacta (nunca se reformatea).
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
export function validarFechaConsulta(v: unknown): { ok: true; fecha: string } | { ok: false; error: string } {
  if (typeof v !== "string" || !RE_FECHA_ISO.test(v)) return { ok: false, error: "La fecha debe tener el formato AAAA-MM-DD." };
  const [anio, mes, dia] = v.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return { ok: false, error: `La fecha ${v} no es un día real del calendario.` };
  }
  return { ok: true, fecha: v };
}

// Confirma que la fecha de regreso sea REALMENTE posterior a la de ida
// (nunca igual ni anterior) — comparación de cadenas AAAA-MM-DD, válida
// porque ese formato ordena lexicográficamente igual que cronológicamente.
export function validarRangoFechas(fechaIda: string, fechaRegreso: string): { ok: true } | { ok: false; error: string } {
  if (fechaRegreso <= fechaIda) return { ok: false, error: "El regreso debe ser posterior a la ida." };
  return { ok: true };
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
  const vNombre = validarTextoAcotado(o.hotelNombre, `${ctx}: el nombre del hotel`);
  if (!vNombre.ok) return { ok: false, error: vNombre.error };
  if (o.destino !== null && o.destino !== undefined) {
    const vDest = validarTextoAcotado(o.destino, `${ctx}: el destino`, MAX_LONGITUD_TEXTO, true);
    if (!vDest.ok) return { ok: false, error: vDest.error };
  }
  const vCategoria = validarTextoAcotado(o.categoria, `${ctx}: la categoría`);
  if (!vCategoria.ok) return { ok: false, error: vCategoria.error };
  const vRegimen = validarTextoAcotado(o.regimen, `${ctx}: el régimen`);
  if (!vRegimen.ok) return { ok: false, error: vRegimen.error };

  // Fechas: "bloqueo" trae fechas fijas del record (pueden venir ausentes,
  // `crearCotizacionCarrito` ni las usa para ese módulo); "porcion_terrestre"
  // SIEMPRE las necesita — es justamente el módulo que liquida EN VIVO por
  // fecha (si no vinieran, computarReserva caería silenciosamente a la
  // liquidación estática del tarifario en vez de re-liquidar por fecha real).
  // Cuando SÍ vienen, siempre se validan como fecha real de calendario
  // (nunca solo la forma) y con el regreso estrictamente posterior a la ida.
  let fechaIda: string | null = null;
  let fechaRegreso: string | null = null;
  if (o.modulo === "porcion_terrestre") {
    if (typeof o.fechaIda !== "string") return { ok: false, error: `${ctx} no trae fecha de ida.` };
    if (typeof o.fechaRegreso !== "string") return { ok: false, error: `${ctx} no trae fecha de regreso.` };
  } else {
    if (!(o.fechaIda === null || o.fechaIda === undefined || typeof o.fechaIda === "string")) return { ok: false, error: `${ctx} tiene una fecha de ida inválida.` };
    if (!(o.fechaRegreso === null || o.fechaRegreso === undefined || typeof o.fechaRegreso === "string")) return { ok: false, error: `${ctx} tiene una fecha de regreso inválida.` };
  }
  if (typeof o.fechaIda === "string") {
    const vIda = validarFechaConsulta(o.fechaIda);
    if (!vIda.ok) return { ok: false, error: `${ctx}: ${vIda.error}` };
    fechaIda = vIda.fecha;
  }
  if (typeof o.fechaRegreso === "string") {
    const vReg = validarFechaConsulta(o.fechaRegreso);
    if (!vReg.ok) return { ok: false, error: `${ctx}: ${vReg.error}` };
    fechaRegreso = vReg.fecha;
  }
  if (fechaIda !== null && fechaRegreso !== null) {
    const vRango = validarRangoFechas(fechaIda, fechaRegreso);
    if (!vRango.ok) return { ok: false, error: `${ctx}: ${vRango.error}` };
  }

  if (!(o.noches === null || o.noches === undefined || (typeof o.noches === "number" && Number.isInteger(o.noches) && o.noches > 0 && o.noches <= MAX_NOCHES_CONSULTA))) {
    return { ok: false, error: `${ctx} tiene un número de noches inválido.` };
  }

  if (typeof o.habitaciones !== "object" || o.habitaciones === null || Array.isArray(o.habitaciones)) {
    return { ok: false, error: `${ctx} tiene habitaciones inválidas.` };
  }
  const habitaciones: Record<string, number> = {};
  let totalHabitaciones = 0;
  for (const [k, val] of Object.entries(o.habitaciones as Record<string, unknown>)) {
    if (!esAcomRoom(k) || !esEnteroPositivoONulo(val)) return { ok: false, error: `${ctx} tiene una habitación inválida.` };
    const n = (val as number) ?? 0;
    if (n > MAX_HABITACIONES_CONSULTA) return { ok: false, error: `${ctx}: no se pueden pedir más de ${MAX_HABITACIONES_CONSULTA} habitaciones de un mismo tipo.` };
    habitaciones[k] = n;
    totalHabitaciones += n;
  }
  if (totalHabitaciones > MAX_HABITACIONES_CONSULTA) {
    return { ok: false, error: `${ctx}: no se pueden pedir más de ${MAX_HABITACIONES_CONSULTA} habitaciones en total.` };
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
      hotelNombre: vNombre.texto, destino: o.destino == null ? null : (o.destino as string),
      categoria: vCategoria.texto, regimen: vRegimen.texto,
      fechaIda, fechaRegreso,
      noches: (o.noches as number | undefined) ?? null,
      habitaciones, cantidadMenores: vCant.cantidad, edadesMenores: vEdades.edades,
    },
  };
}

// ── Tours/servicios del carrito (checkout público) ──────────────────────────
// Ítem YA validado en forma — solo lo mínimo para RE-LIQUIDAR el precio real
// en el servidor (`liquidarServicioPuntual` en lib/reservar/cotizar.ts, misma
// fórmula que `buscarReceptivos`): `servicioId`/`paqueteId` identifican el
// servicio real; `fechaIda`/`fechaRegreso`/`pax` son los parámetros de
// liquidación. `nombre`/`precio`/`moneda`/`destino` que mande el navegador
// NUNCA se leen aquí — no existen en este tipo, así que no hay forma de que
// se cuelen más adelante (defecto real corregido: antes se usaban tal cual).
export type SolicitudTourValidado = { servicioId: number; paqueteId: number; fechaIda: string; fechaRegreso: string; pax: number };

function esObjetoNoNulo(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validarTourInput(v: unknown, indice: number): { ok: true; tour: SolicitudTourValidado } | { ok: false; error: string } {
  const ctx = `El servicio ${indice + 1} del carrito`;
  if (!esObjetoNoNulo(v)) return { ok: false, error: `${ctx} no tiene una forma válida.` };
  // Carrito histórico (agregado antes de este cambio, o de un tour cuyo
  // `servicioId` nunca se guardó): sin identificador real no hay forma
  // honesta de re-liquidar — se bloquea con un mensaje claro, nunca se sigue
  // con el precio/nombre que mande el navegador.
  if (v.servicioId === null || v.servicioId === undefined) {
    return { ok: false, error: `${ctx} se agregó antes de poder re-liquidarlo en el servidor. Quítalo del carrito y agrégalo de nuevo.` };
  }
  if (typeof v.servicioId !== "number" || !Number.isInteger(v.servicioId)) return { ok: false, error: `${ctx} tiene un servicio inválido.` };
  if (typeof v.paqueteId !== "number" || !Number.isInteger(v.paqueteId)) return { ok: false, error: `${ctx} tiene un paquete inválido.` };
  if (typeof v.fechaIda !== "string") return { ok: false, error: `${ctx} no trae fecha de ida.` };
  if (typeof v.fechaRegreso !== "string") return { ok: false, error: `${ctx} no trae fecha de regreso.` };
  const vIda = validarFechaConsulta(v.fechaIda);
  if (!vIda.ok) return { ok: false, error: `${ctx}: ${vIda.error}` };
  const vReg = validarFechaConsulta(v.fechaRegreso);
  if (!vReg.ok) return { ok: false, error: `${ctx}: ${vReg.error}` };
  const vRango = validarRangoFechas(vIda.fecha, vReg.fecha);
  if (!vRango.ok) return { ok: false, error: `${ctx}: ${vRango.error}` };
  if (typeof v.pax !== "number" || !Number.isInteger(v.pax) || v.pax < 1 || v.pax > MAX_PAX_CONSULTA) {
    return { ok: false, error: `${ctx} tiene un pax inválido.` };
  }
  return { ok: true, tour: { servicioId: v.servicioId, paqueteId: v.paqueteId, fechaIda: vIda.fecha, fechaRegreso: vReg.fecha, pax: v.pax } };
}

// ── Contexto B2B del mensaje/cotización — SOLO decide, nunca consulta ──────
// Defecto real corregido: `crearSolicitudReserva` armaba el bloque B2B del
// mensaje (modo/facturación/comisión) directo desde lo que mandaba el
// navegador — un visitante anónimo podía autodeclararse B2B, elegir "modo
// neto" y mandar `pctComision: 1` (100%) o una facturación inventada. Ahora
// esta función PURA es la única que decide qué se muestra: recibe el
// contexto YA resuelto desde la sesión + base de datos (`getContextoB2B()`,
// que vive en checkout/actions.ts porque sí toca Supabase) y el `modo` que
// pidió el cliente — ese `modo` es la ÚNICA parte que puede venir del
// navegador (una elección legítima de un B2B YA autenticado), nunca la
// facturación ni el % de comisión. Si la sesión no es B2B, el resultado es
// SIEMPRE `undefined` sin importar qué haya pedido el cliente.
export type ContextoB2BSesion = {
  esB2B: boolean;
  agencia: { nombre: string; nit: string; email: string; telefono: string } | null;
  pctComision: number;
};
export type B2BParaMensaje = {
  modo: "comisionable" | "neta";
  facturacion: { nombre: string; nit: string; email: string; telefono: string };
  pctComision: number;
};

// Rango comercial permitido para un % de comisión B2B — nunca negativo,
// nunca superior al 100% del PVP (pagar más comisión que el valor de la
// venta no tiene sentido de negocio, y llegaría al mensaje del cliente como
// un descuento absurdo o un "TOTAL NETO" negativo). `pctComision` sale de
// `usuarios.pct_comision`, un campo editable en el catálogo — nunca se
// confía en que ya venga sano (defecto real corregido, ronda 4: antes
// `getContextoB2B` lo pasaba tal cual, sin validar NaN/negativo/>1).
export const MAX_PCT_COMISION_B2B = 1;

export function validarPctComisionB2B(pct: unknown): number | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  if (pct < 0 || pct > MAX_PCT_COMISION_B2B) return null;
  return pct;
}

export function resolverB2BParaMensaje(
  ctxSesion: ContextoB2BSesion,
  modoSolicitado: "comisionable" | "neta" | undefined
): B2BParaMensaje | undefined {
  if (!ctxSesion.esB2B || !ctxSesion.agencia) return undefined;
  // Segunda capa de fallo cerrado (defensa en profundidad): aunque
  // `getContextoB2B` ya valide la comisión antes de construir el contexto,
  // esta función es la ÚLTIMA frontera antes de que el % entre al mensaje de
  // WhatsApp/email — nunca deja pasar NaN/negativo/>1 aunque el llamador
  // regresione.
  const pct = validarPctComisionB2B(ctxSesion.pctComision);
  if (pct == null) return undefined;
  return { modo: modoSolicitado ?? "comisionable", facturacion: ctxSesion.agencia, pctComision: pct };
}

// ── Resolución completa del contexto B2B, a partir de filas YA CONSULTADAS
// (`getContextoB2B` en checkout/actions.ts, que sí toca Supabase) — módulo
// PURO: decide, nunca consulta. Mismo patrón que
// `resolverLiquidacionServicioPuntual` (lib/reservar/liquidacionServicio.ts).
// Falla cerrado en cada paso — nunca "casi B2B":
// - usuario no autenticado, sin perfil, o con error al leerlo → sin B2B;
// - `usuarios.activo !== true` (del usuario logueado O de la agencia
//   titular, si aplica) → sin B2B;
// - rol inválido (ni "agencia" ni "freelance") en cualquiera de los dos → sin B2B;
// - error al leer la agencia titular o la solicitud B2B → sin B2B;
// - comisión NaN/negativa/mayor a `MAX_PCT_COMISION_B2B` → sin B2B.
export type FilaUsuarioB2B = { nombre: string | null; email: string | null; rol: string | null; pct_comision: number | null; activo: boolean | null };
export type FilaSolicitudB2B = { nombre: string | null; nit: string | null; email: string | null; telefono: string | null };

export type ResultadoContextoB2B =
  | { esB2B: true; tipo: "agencia" | "freelance"; agencia: { nombre: string; nit: string; email: string; telefono: string }; pctComision: number; categoria: string }
  | { esB2B: false };

const SIN_B2B: ResultadoContextoB2B = { esB2B: false };

export function resolverContextoB2B(input: {
  usuarioAutenticado: boolean;
  perfil: FilaUsuarioB2B | null;
  perfilError: boolean;
  // Cuando el usuario tiene `agencia_id` (es un AGENTE bajo una agencia
  // titular), estas tres describen la consulta de esa agencia titular —
  // `agenciaId` viene null cuando el usuario logueado ES la titular, y en
  // ese caso `agenciaTitular*` se ignoran (se usa `perfil` directamente).
  agenciaId: string | null;
  agenciaTitular: FilaUsuarioB2B | null;
  agenciaTitularError: boolean;
  solicitud: FilaSolicitudB2B | null;
  solicitudError: boolean;
  pctComisionDefault: number;
}): ResultadoContextoB2B {
  if (!input.usuarioAutenticado) return SIN_B2B;
  if (input.perfilError || !input.perfil) return SIN_B2B;
  if (input.perfil.activo !== true) return SIN_B2B;
  const rol = input.perfil.rol;
  if (rol !== "agencia" && rol !== "freelance") return SIN_B2B;

  let agenciaPerfil: FilaUsuarioB2B = input.perfil;
  if (input.agenciaId) {
    if (input.agenciaTitularError || !input.agenciaTitular) return SIN_B2B;
    if (input.agenciaTitular.activo !== true) return SIN_B2B;
    if (input.agenciaTitular.rol !== "agencia" && input.agenciaTitular.rol !== "freelance") return SIN_B2B;
    agenciaPerfil = input.agenciaTitular;
  }

  if (input.solicitudError) return SIN_B2B;
  const sol = input.solicitud;
  const agencia = {
    nombre: sol?.nombre ?? agenciaPerfil.nombre ?? "",
    nit: sol?.nit ?? "",
    email: sol?.email ?? agenciaPerfil.email ?? "",
    telefono: sol?.telefono ?? "",
  };

  const pctRaw = agenciaPerfil.pct_comision ?? input.pctComisionDefault;
  const pct = validarPctComisionB2B(pctRaw);
  if (pct == null) return SIN_B2B;

  const categoria = categoriaAliado(rol, pct, input.pctComisionDefault).label;
  return { esB2B: true, tipo: rol, agencia, pctComision: pct, categoria };
}

// ── Solicitud completa del checkout público (`crearSolicitudReserva`) ──────
function esObjetoRaiz(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type SolicitudClienteValidado = { nombres: string; apellidos: string; numeroDoc: string; telefono: string; email: string };

export function validarClienteInput(v: unknown): { ok: true; cliente: SolicitudClienteValidado } | { ok: false; error: string } {
  if (!esObjetoRaiz(v)) return { ok: false, error: "Los datos del cliente no tienen una forma válida." };
  const campos: (keyof SolicitudClienteValidado)[] = ["nombres", "apellidos", "numeroDoc", "telefono", "email"];
  const cliente = {} as SolicitudClienteValidado;
  for (const c of campos) {
    // El correo es el único campo que se permite vacío en la forma (el
    // checkout ya lo exige aparte solo para nombres/documento/teléfono).
    const r = validarTextoAcotado(v[c], `El campo "${c}" del cliente`, MAX_LONGITUD_TEXTO, c === "email");
    if (!r.ok) return { ok: false, error: r.error };
    cliente[c] = r.texto;
  }
  return { ok: true, cliente };
}

export type CrearSolicitudInputValidado = {
  items: SolicitudItemValidado[];
  tours: SolicitudTourValidado[];
  cliente: SolicitudClienteValidado;
  modo?: "comisionable" | "neta";
};

// Frontera completa: `v` es `unknown` (esta Server Action pública es
// alcanzable con cualquier body HTTP) — se valida objeto, arreglos, cada
// ítem/tour anidado y cada campo antes de usar `.length`/`.map()`/`.trim()`/
// aritmética sobre cualquiera de ellos. Los ítems de hotel se validan con
// `validarSolicitudItem`, que exige `edadesMenores` — nunca se cae al
// reparto legado ninos/ninos2/infantes en este flujo público. Los topes de
// arreglo (`MAX_*_CARRITO`) se revisan ANTES de iterar — un payload gigante
// falla por tamaño, nunca llega a procesar ítem por ítem ni a tocar Supabase.
export function validarCrearSolicitudInput(v: unknown): { ok: true; input: CrearSolicitudInputValidado } | { ok: false; error: string } {
  if (!esObjetoRaiz(v)) return { ok: false, error: "La solicitud no tiene una forma válida." };
  if (!Array.isArray(v.items)) return { ok: false, error: "El carrito de hoteles debe ser un arreglo." };
  if (v.items.length > MAX_ITEMS_CARRITO) return { ok: false, error: `No se pueden cotizar más de ${MAX_ITEMS_CARRITO} hoteles a la vez.` };
  const toursRaw = v.tours;
  if (toursRaw !== undefined && !Array.isArray(toursRaw)) return { ok: false, error: "El carrito de servicios debe ser un arreglo." };
  const toursLen = Array.isArray(toursRaw) ? toursRaw.length : 0;
  if (toursLen > MAX_TOURS_CARRITO) return { ok: false, error: `No se pueden cotizar más de ${MAX_TOURS_CARRITO} servicios a la vez.` };
  if (v.items.length + toursLen > MAX_LINEAS_CARRITO) {
    return { ok: false, error: `No se pueden cotizar más de ${MAX_LINEAS_CARRITO} líneas (hoteles + servicios) a la vez.` };
  }

  const items: SolicitudItemValidado[] = [];
  for (let i = 0; i < v.items.length; i++) {
    const r = validarSolicitudItem(v.items[i], i);
    if (!r.ok) return { ok: false, error: r.error };
    items.push(r.item);
  }
  const tours: SolicitudTourValidado[] = [];
  if (Array.isArray(toursRaw)) {
    for (let i = 0; i < toursRaw.length; i++) {
      const r = validarTourInput(toursRaw[i], i);
      if (!r.ok) return { ok: false, error: r.error };
      tours.push(r.tour);
    }
  }
  const vCliente = validarClienteInput(v.cliente);
  if (!vCliente.ok) return { ok: false, error: vCliente.error };

  // `modo` (comisionable/neta) es una elección legítima de un B2B YA
  // autenticado — se valida la forma acá, pero solo tiene efecto si
  // `crearSolicitudReserva` confirma `esB2B` server-side (`getContextoB2B()`
  // + `resolverB2BParaMensaje`). Un visitante anónimo puede mandar cualquier
  // `modo`: no importa, nunca se usa si la sesión no es B2B.
  // `facturacion`/`pctComision` YA NO se aceptan del navegador en absoluto
  // (defecto real corregido: antes un anónimo podía mandar `pctComision: 1`
  // y aparentar 100% de comisión/gratis) — el servidor los resuelve siempre
  // desde la sesión + base de datos.
  let modo: "comisionable" | "neta" | undefined;
  if (v.modo !== undefined) {
    if (v.modo !== "comisionable" && v.modo !== "neta") return { ok: false, error: "La modalidad de compra es inválida." };
    modo = v.modo;
  }
  return { ok: true, input: { items, tours, cliente: vCliente.cliente, modo } };
}

// ── Frontera pública del INSERT de `cotizaciones` (ronda 7) ────────────────
// Defecto real corregido: `crearCotizacionCarrito` (checkout/actions.ts)
// devolvía `error?.message ?? "No se pudo crear la cotización."` — un fallo
// real de Postgres/Supabase al insertar (columna faltante, política RLS,
// tabla inexistente, restricción violada) llegaba tal cual a una Server
// Action pública. Mismo patrón que `respuestaPublicaServicioPuntual` en
// lib/reservar/liquidacionServicio.ts: mensaje público FIJO (nunca
// interpolado con `error.message`), detalle técnico solo para el log
// server-side. Función PURA — no hace I/O, solo decide a partir del
// resultado YA CONSULTADO del insert (el `admin.from("cotizaciones").insert(...)`
// real vive en checkout/actions.ts, el único punto que toca Supabase).
export const MENSAJE_ERROR_COTIZACION = "No pudimos generar la cotización en este momento. Intenta nuevamente.";

export type RespuestaPublicaInsertCotizacion = { ok: false; error: string };

// Mismo patrón que `fallaErrorConsulta` en liquidacionServicio.ts: el
// mensaje público es SIEMPRE el mismo texto fijo, nunca construido a partir
// de `detalleInterno` — el parámetro solo existe para dejar explícito, en
// la prueba, que un mensaje real de Postgres pasado acá NUNCA sobrevive en
// el campo `error` del objeto devuelto. Solo se llama desde la rama de
// fallo (`if (error || !row)` en checkout/actions.ts); no decide control de
// flujo por sí sola.
export function respuestaPublicaInsertCotizacion(detalleInterno: string): RespuestaPublicaInsertCotizacion {
  void detalleInterno;
  return { ok: false, error: MENSAJE_ERROR_COTIZACION };
}

// Log server-side (ronda 7): SOLO contexto técnico (etapa fija + el detalle
// real de Supabase) — nunca nombre/documento/teléfono/email del cliente ni
// el payload de la cotización. La firma no acepta esos campos, así que
// agregarlos requeriría ampliarla explícitamente (revisión obligada), mismo
// criterio que `formatearLogLiquidacionServicioPuntual`.
export function formatearLogInsertCotizacion(ctx: { etapa: string; detalle: string }): string {
  return `[crearCotizacionCarrito] etapa=${ctx.etapa} detalle=${ctx.detalle}`;
}
