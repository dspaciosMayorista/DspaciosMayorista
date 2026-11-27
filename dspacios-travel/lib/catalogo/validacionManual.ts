// B95-13/14/15/20 (revisión del dueño, 2026-11-26) — reglas PURAS de los formularios manuales (cotización dinámica/comparativa y contrato manual):
//   · destino ↔ hotel del catálogo (por destino_id guardado, nunca por nombre);
//   · origen de la compra del hotel (directa al hotel vs por plataforma) y quién es el PROVEEDOR a pagar;
//   · acomodación estructurada (cantidad de habitaciones por tipo) frente a adultos/niños/infantes, con las reglas del hotel.
// Las usan el navegador (mensaje en línea y botón desactivado) Y el servidor (autoritativo): una sola fuente, sin recalcular en cada lado.
// No hay umbrales de edad nuevos ni reglas de ocupación nuevas: todo sale de `lib/acomodaciones.ts` (validarReservaHabitaciones) y de la configuración del hotel.
import { ACOM_ROOMS, ACOM_ROOM_LABEL, PAX_TARIFA_DEFAULT, defaultAcomConfig, validarReservaHabitaciones, type AcomConfig, type AcomRoom } from "@/lib/acomodaciones";

export type CompraOrigen = "directa" | "plataforma";
export const ETIQUETA_COMPRA: Record<CompraOrigen, string> = { directa: "Compra directa al hotel", plataforma: "Compra por plataforma" };
export const esCompraOrigen = (v: unknown): v is CompraOrigen => v === "directa" || v === "plataforma";

export type Habitaciones = Partial<Record<AcomRoom, number>>;

/** Habitaciones normalizadas: enteros ≥ 0 por tipo conocido; todo lo demás se descarta. */
export function normalizarHabitaciones(h: unknown): Record<AcomRoom, number> {
  const src = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
  const out = {} as Record<AcomRoom, number>;
  for (const a of ACOM_ROOMS) {
    const n = Number(src[a]);
    out[a] = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  }
  return out;
}

export const totalHabitaciones = (h: unknown): number => ACOM_ROOMS.reduce((s, a) => s + normalizarHabitaciones(h)[a], 0);

/** «1 hab Doble · 2 hab Sencilla» — el texto que se guarda en `acomodacion` (derivado de la estructura: nunca se escribe a mano). */
export function textoHabitaciones(h: unknown): string {
  const n = normalizarHabitaciones(h);
  return ACOM_ROOMS.filter((a) => n[a] > 0).map((a) => `${n[a]} hab ${ACOM_ROOM_LABEL[a]}`).join(" · ");
}

// ── Destino ↔ hotel ─────────────────────────────────────────────────────────
type ConDestino = { destinoId?: number | null };
/** Hoteles del catálogo que se ofrecen para el destino elegido. Sin destino elegido no se ofrece ninguno (primero el destino). */
export function hotelesDeDestino<T extends ConDestino>(lista: readonly T[], destinoId: number | null | undefined): T[] {
  return destinoId == null ? [] : lista.filter((h) => h.destinoId === destinoId);
}

/** Mensaje si el hotel del catálogo NO pertenece al destino elegido (o no se puede saber); null si cuadra. */
export function errorHotelFueraDeDestino(hotel: (ConDestino & { nombre?: string | null }) | null, destinoId: number | null | undefined): string | null {
  if (!hotel) return null; // texto libre: no hay relación guardada que comparar
  if (destinoId == null) return `Elige primero el destino: el hotel «${hotel.nombre ?? "elegido"}» del catálogo se ofrece según su destino.`;
  if (hotel.destinoId !== destinoId) return `El hotel «${hotel.nombre ?? "elegido"}» no pertenece al destino elegido. Quítalo o elige un hotel de ese destino.`;
  return null;
}

// ── Compra directa vs plataforma ────────────────────────────────────────────
export type EntradaCompra = {
  compra?: unknown; plataforma?: string | null; proveedor?: string | null;
  /** Proveedor configurado en el catálogo para el hotel elegido (null = el hotel no tiene proveedor configurado o es texto libre). */
  proveedorCatalogo?: string | null; nombreHotel?: string | null;
};
export type ResultadoCompra = { ok: true; compra: CompraOrigen; proveedor: string; plataforma: string | null; /** directa con un proveedor distinto del configurado, o sin configuración en el catálogo. */ aviso: string | null } | { ok: false; error: string };

const limpio = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
const igual = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" }) === 0;

/**
 * Quién es el PROVEEDOR a pagar de un hotel. El hotel (propiedad) y el proveedor contractual son identidades separadas: el nombre del hotel nunca se toca.
 *  · plataforma → la plataforma ES el proveedor a pagar (no el proveedor del hotel); exige su nombre.
 *  · directa    → el proveedor configurado del hotel, o el que se escriba EXPLÍCITAMENTE; si no hay ninguno, se rechaza (nunca se adivina ni se cae a la plataforma).
 * Sin elegir el origen se rechaza: no hay valor por defecto silencioso.
 */
export function resolverCompraHotel(e: EntradaCompra): ResultadoCompra {
  const hotel = limpio(e.nombreHotel) || "el hotel";
  if (!esCompraOrigen(e.compra)) return { ok: false, error: `Indica cómo se compra «${hotel}»: directa al hotel o por plataforma.` };
  if (e.compra === "plataforma") {
    const plat = limpio(e.plataforma);
    if (!plat) return { ok: false, error: `Compra por plataforma de «${hotel}»: escribe el nombre de la plataforma (es el proveedor a pagar).` };
    return { ok: true, compra: "plataforma", proveedor: plat, plataforma: plat, aviso: null };
  }
  const prov = limpio(e.proveedor) || limpio(e.proveedorCatalogo);
  if (!prov) {
    return { ok: false, error: `Compra directa de «${hotel}»: no hay proveedor (el hotel no tiene uno configurado en el catálogo). Escribe el proveedor de la compra o elige compra por plataforma.` };
  }
  const cfg = limpio(e.proveedorCatalogo);
  const aviso = cfg && !igual(prov, cfg) ? `El proveedor «${prov}» es distinto del configurado para este hotel («${cfg}»).`
    : !cfg ? `El hotel no tiene proveedor configurado en el catálogo: se usará el escrito («${prov}»).` : null;
  return { ok: true, compra: "directa", proveedor: prov, plataforma: null, aviso };
}

// ── Acomodación estructurada ────────────────────────────────────────────────
export type ReglasHotel = { reglas?: readonly AcomConfig[] | null; paxMin?: number | null; paxMax?: number | null; nombre?: string | null; tiposOfrecidos?: readonly AcomRoom[] | null };
export type Ocupacion = { adultos: number; ninos: number; infantes: number };

const reglaDe = (reglas: readonly AcomConfig[] | null | undefined, a: AcomRoom): AcomConfig => reglas?.find((r) => r.acomodacion === a) ?? defaultAcomConfig(a);

/**
 * Errores (texto claro, en línea) de la acomodación elegida frente a la ocupación del viaje. Reusa `validarReservaHabitaciones` (capacidad de niños/infantes/pax por habitación,
 * pax mín/máx del hotel) y agrega lo que esa función no mira: los ADULTOS del viaje deben ser exactamente los que alojan las habitaciones elegidas (pax_tarifa por habitación: 1 Doble = 2 adultos), igual que al reservar del tarifario.
 * (adt_min/adt_max NO se usan: el motor de reservar tampoco, y las filas sin configurar traen ceros.)
 * Los infantes no ocupan plaza de adulto ni silla (se validan solo contra la capacidad de infantes de la habitación).
 */
export function validarAcomodacionHotel(habitaciones: unknown, ocu: Ocupacion | null, h: ReglasHotel = {}): string[] {
  const hab = normalizarHabitaciones(habitaciones);
  const nombre = limpio(h.nombre) || "el hotel";
  const total = totalHabitaciones(hab);
  if (total <= 0) return [`Indica las habitaciones de «${nombre}»: la cantidad por tipo (Sencilla, Doble, Triple o Múltiple). Ya no se escribe a mano.`];
  const errores: string[] = [];
  const noOfrecidos = h.tiposOfrecidos?.length ? ACOM_ROOMS.filter((a) => hab[a] > 0 && !h.tiposOfrecidos!.includes(a)) : [];
  for (const a of noOfrecidos) errores.push(`«${nombre}» no ofrece habitación ${ACOM_ROOM_LABEL[a]} según su catálogo.`);
  if (!ocu) return errores; // sin pasajeros que comparar: basta con que haya habitaciones y sean de un tipo que el hotel ofrece
  const adultos = Math.max(0, Math.trunc(Number(ocu.adultos) || 0));
  const ninos = Math.max(0, Math.trunc(Number(ocu.ninos) || 0));
  const infantes = Math.max(0, Math.trunc(Number(ocu.infantes) || 0));
  let esperados = 0;
  for (const a of ACOM_ROOMS) {
    if (hab[a] <= 0) continue;
    const pt = reglaDe(h.reglas, a).pax_tarifa;
    esperados += hab[a] * (pt > 0 ? pt : PAX_TARIFA_DEFAULT[a]);
  }
  if (adultos > esperados) errores.push(`Las habitaciones elegidas (${textoHabitaciones(hab)}) alojan ${esperados} adulto(s); el viaje tiene ${adultos}. Agrega habitaciones o ajusta los adultos.`);
  else if (adultos < esperados) errores.push(`Las habitaciones elegidas (${textoHabitaciones(hab)}) necesitan ${esperados} adulto(s); el viaje tiene ${adultos}. Quita habitaciones o ajusta los adultos.`);
  // Sin reglas configuradas (hotel escrito a mano o sin acomodaciones cargadas) NO se conoce la capacidad: no se inventa un tope (los valores por defecto rechazarían a cualquier niño en una Doble); solo cuenta la regla de adultos.
  if (!h.reglas?.length && h.paxMin == null && h.paxMax == null) return errores;
  const v = validarReservaHabitaciones({
    habitaciones: hab, reglas: (h.reglas ?? []) as AcomConfig[], ninosDeclarados: ninos, infantesDeclarados: infantes,
    paxMinHotel: h.paxMin ?? null, paxMaxHotel: h.paxMax ?? null, adultosReales: adultos,
  });
  // La capacidad total en pax repite lo ya dicho cuando el problema son los adultos: no se muestra dos veces.
  return [...errores, ...(errores.length ? v.errores.filter((x) => !/admiten máximo \d+ pax; hay/.test(x)) : v.errores)];
}

/** Cantidad de infantes que NO puede superar la de adultos acompañantes cuando el viaje declara infantes sin ningún adulto (un infante nunca viaja solo). */
export function errorInfantesSinAdulto(adultos: number, infantes: number): string | null {
  return (Number(infantes) || 0) > 0 && (Number(adultos) || 0) <= 0 ? "Un infante necesita al menos un adulto en el viaje." : null;
}

/** Cuenta entera ≥ 0 (los formularios mandan texto): null si no lo es. */
export function contarEntero(v: unknown): number | null {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
