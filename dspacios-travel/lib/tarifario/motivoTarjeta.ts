// #90 — Clasificador PURO del motivo real de un combo fallido de la tarjeta del tarifario
// (ver app/tarifario/cotizarTarjetaActions.ts). `computarReserva` devuelve mensajes de
// negocio (nunca texto crudo de Postgres salvo contados casos con `.message` interpolado,
// p. ej. "No se pudo consultar el hotel: <error pg>") — este módulo traduce esos mensajes
// a un motivo LEGIBLE para personal interno, contra una LISTA BLANCA cerrada. Un mensaje que
// no calce con ninguna regla conocida (incluidos los que llevan `.message` de Supabase) cae
// siempre a `MOTIVO_ERROR_TECNICO`: nunca se devuelve el texto de entrada tal cual — así un
// cambio de redacción en computo.ts, o un error con detalle sensible, no se filtra por aquí.
// Nunca toca negocio: no cambia textos ni montos, solo los interpreta para mostrarlos.
export const MOTIVO_ERROR_TECNICO = "Error técnico al calcular este combo: revisa el registro del servidor.";

type Regla = { prueba: (msg: string) => boolean; motivo: (msg: string) => string };

/**
 * Nombre del servicio citado entre «» o "" en el mensaje (catálogo de `servicios_adicionales`
 * — nunca texto libre del usuario). Cubre las TRES formas en que computo.ts/liquidacionHotel.ts
 * nombran un servicio en sus mensajes: "El servicio «X»: …", 'El servicio incluido "X" …' y
 * "No se cargaron las vigencias del servicio incluido «X»." (liquidacionHotel.ts:252) — por eso
 * NO se ancla al inicio del mensaje (`^`), solo a que en algún punto diga "servicio [incluido] «X»".
 */
function nombreServicio(msg: string): string | null {
  const m = /servicio(?:\s+incluido)?\s+[«"]([^»"]+)[»"]/.exec(msg);
  return m ? m[1] : null;
}

const REGLAS: Regla[] = [
  // Cualquier problema de un servicio INCLUIDO del paquete (o uno opcional del carrito interno)
  // con su tarifa/vigencia — sin tarifa publicada, sin vigencia cargada, no encontrado en el
  // catálogo, suplemento por horario, rango sin cobertura, publicado sin costo… — se identifica
  // ANTES de la regla genérica de "regenerar", porque varias de estas frases también contienen
  // "regenera el tarifario" y el motivo correcto es el del servicio puntual, no el genérico del
  // paquete. Texto GENÉRICO a propósito (gate suplente, ciclo 2): la causa real detrás de cada
  // mensaje varía (catálogo, vigencia, horario, rango de pax) y afirmar siempre "no tiene tarifa"
  // sería inexacto — "sin tarifa o vigencia… o hay que regenerar" cubre las tres familias reales
  // sin prometer un diagnóstico más fino del que el mensaje de origen realmente da.
  {
    prueba: (m) => nombreServicio(m) != null,
    motivo: (m) => `Revisa el servicio «${nombreServicio(m)}»: sin tarifa o vigencia para esa fecha, o hay que regenerar el tarifario.`,
  },
  // Hueco de tarifa: no hay fila de tarifario/tarifa_hotel para la categoría/régimen/fechas
  // pedidas — por una temporada que no cubre el rango completo, porque nunca se montó esa
  // combinación, o porque la temporada SÍ existe pero su VIGENCIA DE COMPRA (no la de viaje) aún
  // no abrió o ya venció: el motor la descarta en silencio igual que a un hueco real (caso real,
  // gate suplente ciclo 2: Be Live Dubai, la temporada ALTA abre compra el 15-dic — antes de esa
  // fecha cualquier combo de esas noches cae aquí con el mismo mensaje que un hueco genuino).
  {
    prueba: (m) =>
      m.includes("No se encontró la tarifa seleccionada en el tarifario") ||
      m.includes("No hay tarifa para esas fechas / categoría / régimen"),
    motivo: () => "Sin tarifa vigente para alguna noche del rango: hueco entre temporadas, temporada sin doble, o una temporada cuya compra aún no abre o ya venció.",
  },
  // Vigencia de COMPRA de la temporada: ya venció o (siendo la misma regla, sin distinguirlo
  // en el mensaje de origen) todavía no empieza.
  {
    prueba: (m) => m.includes("ya no está vigente para compra"),
    motivo: () => "La vigencia de compra de la temporada aún no empieza / ya venció.",
  },
  // El tarifario publicado del paquete está obsoleto frente a su propia tarifa neta (promoción
  // EBB/Long Stay sin composición que la respalde, o la generación nunca llegó a publicarse).
  {
    prueba: (m) =>
      m.includes("tarifario está pendiente de corrección") ||
      m.toLowerCase().includes("regenera el tarifario del paquete"),
    motivo: () => "El tarifario del paquete debe regenerarse.",
  },
  // Sintético de cotizarTarjetaHotel (no viene de computarReserva): la categoría/régimen no
  // tiene tarifa de habitación doble publicada, que es la referencia fija con la que cotiza
  // la tarjeta.
  {
    prueba: (m) => m === "sin tarifa doble",
    motivo: () => "Este hotel no tiene habitación doble configurada (la tarjeta cotiza con doble).",
  },
  // La fuente del vuelo/salida (bloqueo, empaquetado, salida dinámica) o su destino aéreo ya
  // no es vendible: desactivada, fuera de vigencia de compra, vencida o destino no permitido.
  {
    prueba: (m) =>
      m.includes("La salida seleccionada") ||
      m.includes("Esta salida") ||
      m.includes("El empaquetado seleccionado") ||
      m.includes("Este empaquetado") ||
      m.includes("destinos aéreos permitidos") ||
      m.includes("destino comercial"),
    motivo: () => "El vuelo/salida ya no es vendible (desactivado, vencido o destino no permitido).",
  },
];

/** Traduce UN mensaje de error de un combo (categoría/régimen) a su motivo de negocio, o al motivo técnico genérico si no calza con la lista blanca. */
export function clasificarMotivoTarjeta(mensaje: string): string {
  const m = (mensaje ?? "").trim();
  if (!m) return MOTIVO_ERROR_TECNICO;
  for (const r of REGLAS) if (r.prueba(m)) return r.motivo(m);
  return MOTIVO_ERROR_TECNICO;
}

/** Motivos ÚNICOS (sin repetir), en el orden en que aparecieron los combos fallidos. */
export function motivosUnicos(mensajes: readonly string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const msg of mensajes) {
    const motivo = clasificarMotivoTarjeta(msg);
    if (!vistos.has(motivo)) { vistos.add(motivo); out.push(motivo); }
  }
  return out;
}
