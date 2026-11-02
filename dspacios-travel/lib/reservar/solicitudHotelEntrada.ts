// #120 · Validación PURA de la solicitud de cotización de un hotel a pedido (frontera pública: llega del navegador, incluso de un visitante anónimo).
// Import relativo/sin dependencias de servidor: se prueba con `node --test`. Nada de importes aquí: la solicitud no tiene precio.

export type SolicitudHotelEntrada = {
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  empaquetadoId: number | null;
  fechaIda: string;
  fechaRegreso: string;
  categoria: string;
  regimen: string;
  habitaciones: Record<"sencilla" | "doble" | "triple" | "multiple", number>;
  edadesMenores: number[];
  /** Adultos que viajan de verdad (opcional). Ausente = las plazas de adulto de las habitaciones; menos adultos que plazas solo si un niño ocupa la plaza libre (lo valida el servidor). */
  adultos: number | null;
  cliente: { nombres: string; apellidos: string; tipoDoc: string | null; numeroDoc: string; telefono: string; email: string };
  notas: string;
};

export const TEXTO_A_CONFIRMAR = "A confirmar";
const ACOMS = ["sencilla", "doble", "triple", "multiple"] as const;
const MAX_HAB_POR_TIPO = 10;
const MAX_MENORES = 12;

const esObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idPositivo = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function fechaIsoValida(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function validarEntradaSolicitudHotel(raw: unknown, hoy: string): { ok: true; input: SolicitudHotelEntrada } | { ok: false; error: string } {
  if (!esObj(raw)) return { ok: false, error: "Solicitud no válida." };
  const paqueteId = idPositivo(raw.paqueteId);
  const hotelId = idPositivo(raw.hotelId);
  if (!paqueteId || !hotelId) return { ok: false, error: "Elige un hotel válido." };
  const bloqueoId = raw.bloqueoId == null ? null : idPositivo(raw.bloqueoId);
  const empaquetadoId = raw.empaquetadoId == null ? null : idPositivo(raw.empaquetadoId);
  if ((raw.bloqueoId != null && !bloqueoId) || (raw.empaquetadoId != null && !empaquetadoId)) return { ok: false, error: "Salida no válida." };
  if (bloqueoId && empaquetadoId) return { ok: false, error: "Elige una sola salida." };
  if (!fechaIsoValida(raw.fechaIda) || !fechaIsoValida(raw.fechaRegreso)) return { ok: false, error: "Indica las fechas de ida y regreso." };
  if (raw.fechaIda < hoy) return { ok: false, error: "La fecha de ida ya pasó." };
  if (raw.fechaRegreso <= raw.fechaIda) return { ok: false, error: "El regreso debe ser posterior a la ida." };

  const habitaciones = { sencilla: 0, doble: 0, triple: 0, multiple: 0 };
  const hab = esObj(raw.habitaciones) ? raw.habitaciones : {};
  for (const a of ACOMS) {
    const n = hab[a] ?? 0;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_HAB_POR_TIPO) return { ok: false, error: "Cantidad de habitaciones no válida." };
    habitaciones[a] = n;
  }
  if (ACOMS.every((a) => habitaciones[a] === 0)) return { ok: false, error: "Indica al menos una habitación." };

  const edades = raw.edadesMenores == null ? [] : raw.edadesMenores;
  // «¿Viajan menores?»: si el cliente dijo que NO, no puede viajar ninguna edad (ni una vieja que quedó oculta); si dijo que SÍ, debe haber al menos una.
  if (raw.viajanMenores === false && Array.isArray(edades) && edades.length) return { ok: false, error: "Indicaste que no viajan menores: quita las edades o responde que sí." };
  if (raw.viajanMenores === true && Array.isArray(edades) && !edades.length) return { ok: false, error: "Indica la edad de cada menor." };
  if (!Array.isArray(edades) || edades.length > MAX_MENORES || edades.some((e) => typeof e !== "number" || !Number.isInteger(e) || e < 0 || e > 17))
    return { ok: false, error: "Las edades de los menores deben ser números entre 0 y 17." };

  const adultos = raw.adultos == null || raw.adultos === "" ? null : raw.adultos;
  if (adultos !== null && (typeof adultos !== "number" || !Number.isInteger(adultos) || adultos < 1 || adultos > 40)) return { ok: false, error: "La cantidad de adultos debe ser un número entero de 1 en adelante." };

  const c = esObj(raw.cliente) ? raw.cliente : {};
  const cliente = {
    nombres: texto(c.nombres, 80), apellidos: texto(c.apellidos, 80), tipoDoc: texto(c.tipoDoc, 12) || null,
    numeroDoc: texto(c.numeroDoc, 30), telefono: texto(c.telefono, 30), email: texto(c.email, 120),
  };
  if (!`${cliente.nombres}${cliente.apellidos}`.trim()) return { ok: false, error: "Ingresa nombres y apellidos." };
  if (!cliente.numeroDoc) return { ok: false, error: "El documento es obligatorio." };
  if (!cliente.telefono) return { ok: false, error: "El teléfono / WhatsApp es obligatorio." };
  if (cliente.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) return { ok: false, error: "El correo no es válido." };

  return {
    ok: true,
    input: {
      paqueteId, hotelId, bloqueoId, empaquetadoId, fechaIda: raw.fechaIda, fechaRegreso: raw.fechaRegreso,
      categoria: texto(raw.categoria, 60) || TEXTO_A_CONFIRMAR, regimen: texto(raw.regimen, 60) || TEXTO_A_CONFIRMAR,
      habitaciones, edadesMenores: edades as number[], adultos, cliente, notas: texto(raw.notas, 500),
    },
  };
}

export type CatalogoHotel = { categorias: readonly string[]; regimenes: readonly { codigo: string; nombre: string }[] };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/**
 * Acredita en el servidor que la categoría y el régimen elegidos existen en el catálogo configurado de ESTE hotel y devuelve el valor canónico del catálogo.
 * «A confirmar» (nada elegido) siempre vale; cualquier otro texto que no esté en el catálogo del hotel —incluido el de un hotel sin catálogo— se rechaza.
 */
export function acreditarSeleccionCatalogo(sel: { categoria: string; regimen: string }, cat: CatalogoHotel): { ok: true; categoria: string; regimen: string } | { ok: false; error: string } {
  let categoria = sel.categoria;
  let regimen = sel.regimen;
  if (categoria !== TEXTO_A_CONFIRMAR) {
    const c = cat.categorias.find((x) => norm(x) === norm(categoria));
    if (!c) return { ok: false, error: `El tipo de habitación «${categoria}» no está configurado para este hotel.` };
    categoria = c;
  }
  if (regimen !== TEXTO_A_CONFIRMAR) {
    const r = cat.regimenes.find((x) => norm(x.codigo) === norm(regimen) || norm(x.nombre) === norm(regimen));
    if (!r) return { ok: false, error: `El plan de alimentación «${regimen}» no está configurado para este hotel.` };
    regimen = r.codigo;
  }
  return { ok: true, categoria, regimen };
}

/** Clave estable de una solicitud: el mismo pedido del mismo cliente (doble clic, reintento) no crea otra cotización. */
export function claveSolicitudHotel(i: SolicitudHotelEntrada): string {
  const h = ACOMS.map((a) => i.habitaciones[a]).join("-");
  return [i.paqueteId, i.hotelId, i.bloqueoId ?? 0, i.empaquetadoId ?? 0, i.fechaIda, i.fechaRegreso, h, [...i.edadesMenores].sort((a, b) => a - b).join(","), i.cliente.numeroDoc.toLowerCase(), i.categoria.toLowerCase(), i.regimen.toLowerCase(), ...(i.adultos != null ? [`adultos${i.adultos}`] : [])].join("|");
}
