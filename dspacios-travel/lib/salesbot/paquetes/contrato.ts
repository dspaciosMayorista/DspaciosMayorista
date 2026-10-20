// ─────────────────────────────────────────────────────────────────────────
// Contrato de la consulta de PAQUETES (#56 multiproducto): bloqueo y porción
// terrestre. Tipos y funciones PURAS (sin I/O, sin `server-only`).
//
// Reglas aprobadas (bitácora de #56, decisiones D8-D12):
//   · Totales ORIENTATIVOS, siempre del motor de venta vigente
//     (`computarReserva`/`buscarHoteles`), nunca recalculados aquí. El campo se
//     llama `total_orientativo` a propósito: `total` sigue prohibido para
//     Programas mientras #57 esté abierto.
//   · B2B: solo el % propio de la agencia elegida, sin base ni monto.
//   · Sin servicios add-on, mascotas ni hoteles Bernalo por unidad.
//   · Nunca netos, record/PNR, datos de silla ni errores internos.
//   · Disponibilidad: sillas libres AL CONSULTAR (no se apartan); hotel y
//     tiquete de sistema siempre "sujeto a confirmación".
// ─────────────────────────────────────────────────────────────────────────

import { ACOM_ROOMS, type AcomRoom } from "@/lib/acomodaciones";

/** Acomodaciones cuyo PVP por persona puede mostrarse (habitaciones + menores). */
export const ACOMODACIONES_PUBLICABLES: readonly string[] = [...ACOM_ROOMS, "nino", "nino2", "infante"];

export const MAX_HABITACIONES_POR_TIPO = 10;
export const MAX_MENORES = 12;
export const EDAD_MAXIMA_MENOR = 17;

export type OrigenVueloConsulta = "bloqueo" | "sistema";

/**
 * `sillas_libres`: el bloqueo tiene N > 0 sillas libres AL CONSULTAR.
 * `sin_sillas`: N = 0. `no_verificada`: la lectura de cupos falló o no está
 * disponible (nunca se afirma que hay sillas). `sujeto_a_confirmacion`: tiquete
 * de sistema (empaquetado), sin inventario de sillas.
 */
export type DisponibilidadVuelo = "sillas_libres" | "sin_sillas" | "no_verificada" | "sujeto_a_confirmacion";

/** PVP por persona de un combo categoría × régimen, por acomodación. */
export type ComboPorPersona = { categoria: string; regimen: string; pvp_por_persona: Record<string, number> };

export type OfertaBloqueo = {
  clave: string;
  paquete_id: number;
  paquete_nombre: string | null;
  origen_vuelo: OrigenVueloConsulta;
  bloqueo_id: number | null;
  empaquetado_id: number | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  noches: number | null;
  destino: string | null;
  hotel_id: number;
  hotel_nombre: string | null;
  moneda: string;
  combos: ComboPorPersona[];
  /** Mínimo PVP por persona entre las habitaciones (nunca un menor), como el "desde" de Vista Booking. */
  desde_pvp_por_persona: number | null;
  sillas_libres: number | null;
  disponibilidad_vuelo: DisponibilidadVuelo;
};

export type ResultadoBusquedaBloqueos = {
  ofertas: OfertaBloqueo[];
  total_encontradas: number;
  truncado: boolean;
};

/** Cotización orientativa de un paquete (bloqueo o porción) salida del motor de venta. */
export type CotizacionPaquete = {
  producto: "bloqueo" | "porcion_terrestre";
  paquete_id: number;
  hotel_id: number;
  hotel_nombre: string | null;
  destino: string | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  categoria: string;
  regimen: string;
  moneda: string;
  lineas: { acomodacion: AcomRoom; habitaciones: number; pax: number; pvp_por_persona: number }[];
  menores: { nino: number; nino2: number; infante: number };
  pvp_menores_por_persona: { nino: number | null; nino2: number | null; infante: number | null };
  total_pax: number;
  total_orientativo: number;
  condiciones_tarifa: string[];
  nota_nino: string | null;
  /** Solo bloqueo con vuelo negociado: sillas libres AL CONSULTAR y si alcanzan para los pax con silla. */
  sillas_libres: number | null;
  alcanzan_sillas: boolean | null;
  disponibilidad_vuelo: DisponibilidadVuelo | null;
  /** El hotel nunca tiene inventario en el sistema. */
  disponibilidad_hotel: "sujeto_a_confirmacion";
  /** Siempre: orientativo, el asesor confirma antes de vender. Si hay servicios por grupo, el total ya los suma con el pax real. */
  sujeto_a_confirmacion: true;
};

export type ResultadoPorcion = {
  hotel_id: number;
  hotel_nombre: string | null;
  destino: string | null;
  paquete_id: number;
  paquete_nombre: string | null;
  fecha_ida: string;
  fecha_regreso: string;
  noches: number;
  moneda: string;
  combos: { categoria: string; regimen: string; total_orientativo: number; pax: number }[];
  condicion_pago: { tipo: string; pct_inicial: number | null; dias_saldo: number | null; no_reembolsable: boolean } | null;
  disponibilidad_hotel: "sujeto_a_confirmacion";
};

export type ResultadoBusquedaPorcion = {
  resultados: ResultadoPorcion[];
  total_encontrados: number;
  truncado: boolean;
  sugerencias_fecha: { fecha_ida: string; fecha_regreso: string; noches: number; etiqueta: string }[];
};

/** Precio por persona de un hotel de porción para fechas reales (motor `cotizarPorFechas`). */
export type CotizacionPorcionPorPersona = {
  paquete_id: number;
  hotel_id: number;
  fecha_ida: string;
  fecha_regreso: string;
  noches: number;
  moneda: string;
  combos: ComboPorPersona[];
  condicion_pago: ResultadoPorcion["condicion_pago"];
  /** Servicios incluidos cobrados por grupo: el precio por persona NO es final hasta saber el pax real. */
  servicios_grupo_pendientes: string[];
  precio_no_final: boolean;
  /** Total orientativo de la composición pedida (solo si se indicaron habitaciones, categoría y régimen). */
  cotizacion: CotizacionPaquete | null;
  disponibilidad_hotel: "sujeto_a_confirmacion";
};

// ── Mensajes del motor: comerciales o técnicos ───────────────────────────

/**
 * Señales de que un mensaje del motor es TÉCNICO (trae el texto crudo de
 * Supabase/Postgres o nombra estructura interna). Ante cualquiera de ellas el
 * mensaje no sale: se devuelve `error_tecnico` sin detalle. Solo decide el
 * CÓDIGO: que un texto salga lo decide la lista blanca de abajo.
 */
const SENALES_TECNICAS: readonly RegExp[] = [
  /^no se pudo/i,
  // Fallos transitorios que los motores ya devuelven en texto genérico
  // (`cotizar.ts`: "No pudimos cotizar este hotel en este momento…").
  /^no pudimos|no disponible en este momento|intenta (de )?nuevo|intenta nuevamente/i,
  /supabase|postgres|pgrst|postgrest|\bsql\b|jwt|timeout|fetch failed|econn|socket/i,
  /column|relation|violat|permission|denied|constraint|syntax|null value|duplicate key/i,
  /tarifario_resultado|armado_|hotel_tarifas_unidad|tarifa_hotel|hotel_temporadas|service.?role|cupos_por_bloqueo|sillas/i,
  // Cualquier identificador snake_case (tabla o columna: `servicio_tarifa_pax`,
  // `modelo_tarifario`...): un mensaje comercial nunca lo trae.
  /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/i,
];

/**
 * LISTA BLANCA de mensajes comerciales de los motores (`computo.ts`,
 * `cotizar.ts`, `edadesMenores.ts`, `distribucionHabitaciones.ts`,
 * `origen.ts`). Solo un mensaje que coincide COMPLETO con uno de estos
 * patrones sale tal cual; cualquier otro (técnico o desconocido) nunca se
 * muestra. Los patrones dinámicos solo admiten números, fechas ISO y palabras
 * fijas: ningún texto libre del motor puede colarse por ellos.
 */
const MENSAJES_COMERCIALES: readonly RegExp[] = [
  /^Este hotel es Adults Only: no acepta niños ni infantes\.$/,
  /^Este hotel no acepta mascotas\.$/,
  /^Indica al menos una habitación( \(cantidad por tipo\))?\.$/,
  /^El regreso debe ser posterior a la ida\.$/,
  /^No hay tarifa para esas fechas \/ categoría \/ régimen\.$/,
  /^No se encontró la tarifa seleccionada en el tarifario\.$/,
  /^El empaquetado seleccionado ya no existe\.$/,
  /^Este empaquetado fue desactivado y ya no se puede reservar\.$/,
  /^Este empaquetado está fuera de su vigencia de compra\.$/,
  /^Esta tarifa ya no está vigente para compra \(la vigencia del hotel venció\)\. Pide regenerar el tarifario con vigencias vigentes antes de reservar\.$/,
  /^Para las fechas elegidas no encontramos una tarifa\.$/,
  /^La fecha de ida no puede ser anterior a hoy\.$/,
  /^El número de noches debe estar entre 1 y \d+\.$/,
  /^La ida no puede ser antes del \d{4}-\d{2}-\d{2} \(rango del paquete\)\.$/,
  /^El regreso no puede ser después del \d{4}-\d{2}-\d{2} \(rango del paquete\)\.$/,
  /^Este alojamiento exige un mínimo de \d+ noche\(s\) para esas fechas\.$/,
  /^Este hotel no tiene tarifa de Niño [12] configurada para esa categoría\/régimen — no se puede cotizar con esa edad\.$/,
  /^La edad \d+ corresponde a tarifa de adulto según este hotel \(mayor a \d+ años\) — cuenta a esta persona entre los adultos \(habitaciones\), no como menor\.$/,
  /^La edad del menor \d+ \(\d+\) no corresponde a un menor de edad\.$/,
  /^(La habitación seleccionada admite|Las \d+ habitaciones seleccionadas admiten) máximo \d+ (niño|infante)\(s\); hay \d+\.$/,
  /^(La habitación seleccionada exige|Las \d+ habitaciones seleccionadas exigen) un mínimo de \d+ (niño|infante)\(s\) en total; hay \d+\.$/,
  /^Las habitaciones elegidas son para \d+ adulto\(s\); declaraste \d+\. Ajusta la cantidad de habitaciones o de adultos\.$/,
  /^No se pueden consultar más de \d+ habitaciones a la vez\.$/,
  /^No se pueden cotizar más de \d+ (menores|adultos|pax) en una sola (consulta|búsqueda)\.$/,
];

/** Motivo para un rechazo del motor que no es un mensaje comercial conocido: nunca se muestra su texto. */
export const MOTIVO_NO_COTIZABLE_GENERICO = "Esta combinación no se puede cotizar desde aquí. Revísala con el asesor.";

export type ClasificacionMensaje = { codigo: "error_tecnico" } | { codigo: "no_cotizable"; motivo: string };

/**
 * Clasifica un mensaje de error del motor. Falla CERRADO:
 *   · con señal técnica (o vacío) → `error_tecnico`, sin detalle;
 *   · comercial conocido (lista blanca, coincidencia completa) → `no_cotizable` con ese texto;
 *   · cualquier otro → `no_cotizable` con un motivo genérico (el texto del motor no sale).
 */
export function clasificarMensajeMotor(mensaje: string | null | undefined): ClasificacionMensaje {
  const m = (mensaje ?? "").trim();
  if (!m) return { codigo: "error_tecnico" };
  if (SENALES_TECNICAS.some((r) => r.test(m))) return { codigo: "error_tecnico" };
  if (MENSAJES_COMERCIALES.some((r) => r.test(m))) return { codigo: "no_cotizable", motivo: m };
  return { codigo: "no_cotizable", motivo: MOTIVO_NO_COTIZABLE_GENERICO };
}

/** ¿Es el rechazo de `computarReserva` a un hotel Bernalo por unidad? (excluido de esta pieza). */
export function esRechazoBernalo(mensaje: string | null | undefined): boolean {
  return /bernalo|por unidad/i.test(mensaje ?? "");
}

// ── Composición: habitaciones y edades de menores ────────────────────────

export type Composicion = { habitaciones: Partial<Record<AcomRoom, number>>; edadesMenores: number[] };

/**
 * Valida habitaciones por tipo (texto del formulario) y edades exactas de
 * menores ("5, 9"). Un campo mal formado se rechaza con su nombre.
 */
export function validarComposicion(entrada: Record<string, string | undefined>): { ok: true; composicion: Composicion } | { ok: false; campos: string[] } {
  const campos: string[] = [];
  const habitaciones: Partial<Record<AcomRoom, number>> = {};
  for (const a of ACOM_ROOMS) {
    const t = (entrada[`hab_${a}`] ?? "").trim();
    if (!t) continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > MAX_HABITACIONES_POR_TIPO) campos.push(`hab_${a}`);
    else if (n > 0) habitaciones[a] = n;
  }
  if (!campos.length && !Object.keys(habitaciones).length) campos.push("habitaciones");

  const edadesTexto = (entrada.edadesMenores ?? "").trim();
  const edadesMenores: number[] = [];
  if (edadesTexto) {
    const partes = edadesTexto.split(/[,;\s]+/).filter(Boolean);
    if (partes.length > MAX_MENORES) campos.push("edadesMenores");
    else {
      for (const p of partes) {
        const n = Number(p);
        if (!Number.isInteger(n) || n < 0 || n > EDAD_MAXIMA_MENOR) {
          campos.push("edadesMenores");
          break;
        }
        edadesMenores.push(n);
      }
    }
  }
  return campos.length ? { ok: false, campos: [...new Set(campos)] } : { ok: true, composicion: { habitaciones, edadesMenores } };
}

/** Lista de habitaciones (una entrada por habitación, en el orden de ACOM_ROOMS), como la pide `buscarHoteles`. */
export function habitacionesComoLista(habitaciones: Partial<Record<AcomRoom, number>>): { acom: AcomRoom }[] {
  const lista: { acom: AcomRoom }[] = [];
  for (const a of ACOM_ROOMS) for (let i = 0; i < (habitaciones[a] ?? 0); i++) lista.push({ acom: a });
  return lista;
}

/** Mínimo PVP > 0 entre las habitaciones de los combos (mismo criterio que `minRoomPvp` de Vista Booking). */
export function desdePorPersona(combos: readonly ComboPorPersona[]): number | null {
  let min: number | null = null;
  for (const c of combos) {
    for (const a of ACOM_ROOMS) {
      const v = c.pvp_por_persona[a];
      if (v != null && v > 0 && (min == null || v < min)) min = v;
    }
  }
  return min;
}

/** Solo las acomodaciones publicables y con valor numérico válido (0 = gratis, se conserva para menores). */
export function preciosPublicables(precios: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [a, v] of Object.entries(precios ?? {})) {
    if (!ACOMODACIONES_PUBLICABLES.includes(a)) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    out[a] = v;
  }
  return out;
}

// ── Markup leído con la sesión (H-PQ1, #60) ─────────────────────────────

export type LecturaMarkup = { ok: true; pct: number } | { ok: false };

/**
 * Interpreta `pct_mk` SIN convertir en 0 lo que no se entiende (el motor sí lo
 * hace con `Number(x) || 0`; esa es la mitad de H-PQ1, #60).
 *   · NULL → 0: es la semántica válida del contrato del motor (paquete sin
 *     markup configurado), no un fallo.
 *   · número finito en [0, 1) → ese número (convención de margen: 0,2 = 20 %;
 *     el mismo rango que `validarPctMarkup` del motor de servicios).
 *   · texto numérico exacto (PostgREST puede devolver `numeric` como texto) →
 *     se convierte y se le aplica el mismo rango.
 *   · cualquier otra cosa (ausente, texto no numérico, NaN, ±Infinity,
 *     negativo, ≥ 1, booleano, objeto) → no confiable.
 */
export function interpretarPctMk(v: unknown): LecturaMarkup {
  if (v === null) return { ok: true, pct: 0 };
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) n = Number(v.trim());
  else return { ok: false };
  return Number.isFinite(n) && n >= 0 && n < 1 ? { ok: true, pct: n } : { ok: false };
}
