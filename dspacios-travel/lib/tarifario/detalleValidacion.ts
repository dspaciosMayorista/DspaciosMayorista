// Validación de los argumentos `unknown` que llegan a las Server Actions de
// detalle bajo demanda (app/tarifario/detalle-actions.ts). Módulo PURO
// (sin "use server"/imports de Supabase) para poder testear con ejecución
// real, y porque un archivo "use server" de Next.js solo puede exportar
// funciones async — estos helpers son síncronos a propósito.
//
// `validarFechaConsulta` se REUSA de lib/reservar/edadesMenores.ts (import
// relativo, mismo criterio que lib/tarifario/vigencia.ts documenta: bajo
// `node --test` sin loader de paths, un import de VALOR con el alias `@/`
// revienta con ERR_MODULE_NOT_FOUND) — valida forma (AAAA-MM-DD) Y que sea
// un día real del calendario; ya estaba probada con ejecución real en
// pruebas/edadesMenores.test.ts, no hace falta un validador nuevo.
import { validarFechaConsulta } from "../reservar/edadesMenores.ts";
import { claveCombo, type ComboIdentidad } from "./comboKey.ts";

export type ModuloTarifario = "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";

export const MODULOS_HOTEL = new Set<ModuloTarifario>(["bloqueo", "porcion_terrestre"]);
export const MODULOS_SALIDA = new Set<ModuloTarifario>(["bloqueo", "dinamico"]);

/** Entero positivo (>0) — rechaza NaN/Infinity/decimales/negativos/0/strings/null/undefined/arrays/objetos. */
export function idPositivo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0 ? v : null;
}

export function moduloDe(v: unknown, permitidos: Set<ModuloTarifario>): ModuloTarifario | null {
  return typeof v === "string" && permitidos.has(v as ModuloTarifario) ? (v as ModuloTarifario) : null;
}

// Límite explícito para cualquier array de ids de alcance (bloqueoIds/
// salidaIds/paqueteIds) que llegue del cliente — el tarifario real nunca
// tiene más de unos pocos cientos de salidas activas a la vez; un array más
// grande que esto no puede ser un alcance legítimo (protege el `.in(...)` de
// la consulta contra un payload artificialmente inflado).
export const MAX_IDS_ALCANCE = 200;

/**
 * Array de enteros positivos, sin duplicados exigidos (se normaliza en el
 * caller si hace falta), acotado a `max` elementos. `null` si `v` no es un
 * array, excede el límite, o contiene algún elemento que no sea un entero
 * positivo válido — nunca se "limpia" silenciosamente un array parcialmente
 * inválido (todo o nada, mismo criterio que el resto de este módulo).
 */
export function idsPositivosLimitados(v: unknown, max: number = MAX_IDS_ALCANCE): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: number[] = [];
  for (const x of v) {
    const n = idPositivo(x);
    if (n == null) return null;
    out.push(n);
  }
  return out;
}

// Límite explícito para el alcance de combos (`ComboIdentidad[]`) que declara
// el cliente al pedir un detalle bajo demanda (ronda 6, ítem 2). Un combo
// pesa poco más que un id (10 campos, la mayoría cortos), pero sigue siendo
// un array del cliente — se acota igual que `MAX_IDS_ALCANCE`, con un techo
// mayor porque un solo hotel puede tener muchas más combinaciones
// categoría×régimen×fecha que salidas de bloqueo activas. La vitrina real
// nunca se acerca a esta magnitud (decenas a un par de miles de filas de
// resumen en total, ver lib/tarifario/resumen.ts).
export const MAX_COMBOS_ALCANCE = 3000;

const MODULOS_COMBO = new Set<ModuloTarifario>(["bloqueo", "porcion_terrestre", "servicios", "dinamico"]);
const MAX_LEN_CATEGORIA_REGIMEN = 120;
const MAX_LEN_MONEDA = 10;

// `undefined` = "el campo es inválido" (rechazar TODO el combo); `null` =
// "el campo válidamente no aplica" (ej. `hotel_id` en un combo de
// servicios). Nunca se confunden: un campo ausente en el payload SIEMPRE
// debe llegar como `null` explícito o quedar fuera del objeto — JSON no
// tiene `undefined`, así que un `o.x === undefined` (clave ausente) se trata
// igual que si viniera `null` (ambos representan "no aplica" al cruzar la
// frontera JSON→JS), pero cualquier OTRO valor no-nulo que no pase su propio
// validador es un combo manipulado/corrupto y se rechaza entero.
function idComboNullable(v: unknown): number | null | undefined {
  if (v == null) return null;
  return idPositivo(v) ?? undefined;
}
function textoComboNullable(v: unknown, max: number): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string" || v.length === 0 || v.length > max) return undefined;
  return v;
}
function fechaComboNullable(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const r = validarFechaConsulta(v);
  return r.ok ? r.fecha : undefined;
}

/**
 * Valida UN combo (`unknown` → `ComboIdentidad` o `null`). Todo o nada: si
 * cualquier campo llega con un valor no-nulo que no pasa su propio
 * validador, el combo entero se rechaza — nunca se "limpia" un campo
 * inválido a `null` en silencio (eso ensancharía el combo a un alcance más
 * amplio del que el cliente realmente declaró).
 */
export function validarComboIdentidad(inputRaw: unknown): ComboIdentidad | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const modulo = moduloDe(o.modulo, MODULOS_COMBO);
  if (!modulo) return null;
  const paquete_id = idComboNullable(o.paquete_id); if (paquete_id === undefined) return null;
  const bloqueo_id = idComboNullable(o.bloqueo_id); if (bloqueo_id === undefined) return null;
  const salida_id = idComboNullable(o.salida_id); if (salida_id === undefined) return null;
  const hotel_id = idComboNullable(o.hotel_id); if (hotel_id === undefined) return null;
  const categoria = textoComboNullable(o.categoria, MAX_LEN_CATEGORIA_REGIMEN); if (categoria === undefined) return null;
  const regimen = textoComboNullable(o.regimen, MAX_LEN_CATEGORIA_REGIMEN); if (regimen === undefined) return null;
  const fecha_ida = fechaComboNullable(o.fecha_ida); if (fecha_ida === undefined) return null;
  const fecha_regreso = fechaComboNullable(o.fecha_regreso); if (fecha_regreso === undefined) return null;
  const moneda = textoComboNullable(o.moneda, MAX_LEN_MONEDA); if (moneda === undefined) return null;
  return { modulo, paquete_id, bloqueo_id, salida_id, hotel_id, categoria, regimen, fecha_ida, fecha_regreso, moneda };
}

/**
 * Array de combos válidos, acotado a `max` elementos y DEDUPLICADO (por
 * `claveCombo`, ver lib/tarifario/comboKey.ts) — un array vacío es un
 * alcance legítimo ("el filtro activo no deja ningún combo visible"; ver
 * cada Server Action para el manejo de ese caso). `null` si `v` no es un
 * array, excede el límite, o CUALQUIER elemento no es un combo válido (todo
 * o nada, mismo criterio que `idsPositivosLimitados`).
 */
export function validarCombosPermitidos(v: unknown, max: number = MAX_COMBOS_ALCANCE): ComboIdentidad[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const vistos = new Set<string>();
  const out: ComboIdentidad[] = [];
  for (const x of v) {
    const c = validarComboIdentidad(x);
    if (c == null) return null;
    const clave = claveCombo(c);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(c);
  }
  return out;
}

/**
 * `{hotelId, modulo, combos}` validado — o `null` si la forma no es válida.
 *
 * ⚠️ Alcance obligatorio para AMBOS módulos (ronda 6, ítem 2 — endurece la
 * revisión anterior): la ronda 5 solo exigía el alcance (`bloqueoIds`) para
 * `modulo:"bloqueo"` — `porcion_terrestre` "no tenía ningún filtro de
 * alcance en la UI", así que no lo exigía. Eso dejó de ser cierto: la
 * búsqueda/categoría/régimen de TarifarioPublic.tsx SÍ filtran también las
 * tarjetas de porción terrestre en Vista Booking, y el detalle de un hotel
 * de porción volvía TODAS sus combinaciones categoría/régimen sin importar
 * ese filtro. Ahora AMBOS módulos exigen `combos` — el alcance actualmente
 * visible bajo cualquier filtro activo (búsqueda, categoría, régimen,
 * origen/destino/salida elegida) — y la Server Action post-filtra las filas
 * de detalle contra ese alcance antes de devolverlas (nunca solo un hint de
 * consulta). `combos` puede ser un array vacío (el filtro activo no deja
 * ningún combo visible para este hotel: el resultado correcto es "sin
 * opciones", no "todas las opciones").
 */
export type EntradaDetalleHotel =
  | { modulo: "bloqueo"; hotelId: number; combos: ComboIdentidad[] }
  | { modulo: "porcion_terrestre"; hotelId: number; combos: ComboIdentidad[] };

export function validarEntradaDetalleHotel(inputRaw: unknown): EntradaDetalleHotel | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const modulo = moduloDe(o.modulo, MODULOS_HOTEL);
  const hotelId = idPositivo(o.hotelId);
  if (!modulo || !hotelId) return null;
  const combos = validarCombosPermitidos(o.combos);
  if (combos == null) return null;
  return modulo === "bloqueo" ? { modulo: "bloqueo", hotelId, combos } : { modulo: "porcion_terrestre", hotelId, combos };
}

/**
 * `{modulo, bloqueoId|salidaId, combos}` validado — o `null`.
 *
 * ⚠️ `combos` NUEVO en esta ronda (ítem 2): Vista tabla → pestaña
 * Salidas/Paquetes dinámicos abría una salida puntual y volvía TODOS sus
 * hoteles/categorías/regímenes, ignorando la búsqueda/categoría/régimen
 * activos en TarifarioPublic.tsx. El `bloqueoId`/`salidaId` sigue siendo
 * obligatorio (identifica QUÉ salida abrir); `combos` acota además a qué
 * combinaciones concretas dentro de esa salida el filtro activo deja
 * visibles.
 */
export type EntradaDetalleSalida =
  | { modulo: "bloqueo"; bloqueoId: number; combos: ComboIdentidad[] }
  | { modulo: "dinamico"; salidaId: number; combos: ComboIdentidad[] };

export function validarEntradaDetalleSalida(inputRaw: unknown): EntradaDetalleSalida | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const modulo = moduloDe(o.modulo, MODULOS_SALIDA);
  const combos = validarCombosPermitidos(o.combos);
  if (combos == null) return null;
  if (modulo === "bloqueo") {
    const bloqueoId = idPositivo(o.bloqueoId);
    return bloqueoId ? { modulo: "bloqueo", bloqueoId, combos } : null;
  }
  if (modulo === "dinamico") {
    const salidaId = idPositivo(o.salidaId);
    return salidaId ? { modulo: "dinamico", salidaId, combos } : null;
  }
  return null;
}

/**
 * `{paqueteId, combos}` validado — o `null`. `combos` NUEVO en esta ronda
 * (ítem 2): Vista tabla → pestaña Porción terrestre abría un paquete puntual
 * y volvía TODAS sus categorías/regímenes, ignorando el filtro activo.
 */
export function validarEntradaDetallePaquete(inputRaw: unknown): { paqueteId: number; combos: ComboIdentidad[] } | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const paqueteId = idPositivo(o.paqueteId);
  if (!paqueteId) return null;
  const combos = validarCombosPermitidos(o.combos);
  if (combos == null) return null;
  return { paqueteId, combos };
}
