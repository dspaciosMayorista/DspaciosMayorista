/**
 * #76/#77 — «Mis clientes» del aliado B2B. Lógica PURA (sin Next ni Supabase).
 *
 * Un cliente del aliado sale de dos fuentes, siempre atadas a la FICHA del aliado por id (nunca por nombre del aliado):
 *   · DERIVADA: contratos y cotizaciones que ya llevan el id de ese aliado (ventas.aliado_id, plan B2B congelado, cotizaciones.aliado_id…).
 *   · GUARDADA: la libreta propia (`aliado_clientes`, migración 322) con teléfono, correo, documento y notas que el aliado escribe.
 * Se unen por la clave del NOMBRE del cliente DENTRO de un mismo aliado; esa unión es solo de presentación: no reasigna nada.
 */

export const TIPOS_DOCUMENTO_CLIENTE = ["CC", "CE", "TI", "RC", "PAS", "PPT", "NIT"] as const;
export const TAM_PAGINA_CLIENTES = 20;
export const MAX_BUSQUEDA_CLIENTES = 80;

/** Misma clave para agrupar lo derivado y para la unicidad de la libreta: sin tildes, sin mayúsculas, espacios y puntuación colapsados. */
export function claveCliente(nombre: unknown): string {
  if (typeof nombre !== "string") return "";
  return nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
}

export type EntradaCliente = {
  nombre?: unknown; tipoDocumento?: unknown; documento?: unknown; email?: unknown; telefono?: unknown; notas?: unknown; autorizacion?: unknown;
};
export type ClienteNormalizado = {
  nombre: string; clave: string; tipo_documento: string | null; documento: string | null; email: string | null; telefono: string | null; notas: string | null;
};

const CONTROL = /[\u0000-\u001f\u007f]/;
const texto = (v: unknown) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim() : "");

/** Valida y normaliza lo que escribe el aliado. La declaración de autorización del cliente es obligatoria (se guarda solo como `true`). */
export function validarCliente(e: EntradaCliente): { ok: true; valor: ClienteNormalizado } | { ok: false; error: string } {
  const nombre = texto(e.nombre);
  if (nombre.length < 3 || nombre.length > 120 || CONTROL.test(nombre)) return { ok: false, error: "Escribe el nombre del cliente (entre 3 y 120 caracteres)." };
  const clave = claveCliente(nombre);
  if (clave.length < 3) return { ok: false, error: "Escribe el nombre del cliente (entre 3 y 120 caracteres)." };

  const doc = texto(e.documento).replace(/\s+/g, "");
  const tipoRaw = texto(e.tipoDocumento).toUpperCase();
  if (doc && !tipoRaw) return { ok: false, error: "Elige el tipo de documento." };
  if (tipoRaw && !(TIPOS_DOCUMENTO_CLIENTE as readonly string[]).includes(tipoRaw)) return { ok: false, error: "Tipo de documento no válido." };
  if (doc && !/^[A-Za-z0-9.-]{3,30}$/.test(doc)) return { ok: false, error: "El documento solo admite letras, números, punto y guion (3 a 30 caracteres)." };

  const email = texto(e.email).toLowerCase();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { ok: false, error: "El correo no parece válido." };
  const telefono = texto(e.telefono);
  if (telefono && !/^[0-9+()\- ]{7,30}$/.test(telefono)) return { ok: false, error: "El teléfono solo admite números, +, paréntesis y guiones (7 a 30 caracteres)." };
  const notas = typeof e.notas === "string" ? e.notas.replace(/\r\n/g, "\n").trim() : "";
  if (notas.length > 500) return { ok: false, error: "Las notas admiten hasta 500 caracteres." };

  if (e.autorizacion !== true) return { ok: false, error: "Confirma que el cliente autorizó que guardes sus datos de contacto." };
  return { ok: true, valor: { nombre, clave, tipo_documento: doc ? tipoRaw : null, documento: doc || null, email: email || null, telefono: telefono || null, notas: notas || null } };
}

export type ClienteGuardado = {
  id: number; nombre: string; clave: string; tipo_documento: string | null; documento: string | null;
  email: string | null; telefono: string | null; notas: string | null; actualizado_en: string;
};
export type ContratoCliente = { numero_contrato: string; cliente: string | null; destino: string | null; fecha_salida: string | null; estado: string | null; fecha_venta?: string | null };
export type CotizacionCliente = { id: number; codigo: string | null; cliente: string | null; destino: string | null; fecha_salida: string | null; estado: string | null; created_at?: string | null };

export type ClienteVista = {
  clave: string;
  nombre: string;
  guardado: ClienteGuardado | null;
  contratos: ContratoCliente[];
  cotizaciones: CotizacionCliente[];
  /** Fecha (YYYY-MM-DD) del último movimiento conocido; null si el cliente solo existe en la libreta. */
  ultima: string | null;
};

const dia = (v: string | null | undefined) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * Une libreta + contratos + cotizaciones por clave de nombre. Filas sin nombre se descartan (no se inventa un cliente);
 * un contrato aparece una sola vez aunque llegue por dos caminos.
 */
export function combinarClientes(guardados: ClienteGuardado[], contratos: ContratoCliente[], cotizaciones: CotizacionCliente[]): ClienteVista[] {
  const mapa = new Map<string, ClienteVista>();
  const get = (nombre: string): ClienteVista => {
    const clave = claveCliente(nombre);
    let v = mapa.get(clave);
    if (!v) { v = { clave, nombre: nombre.trim(), guardado: null, contratos: [], cotizaciones: [], ultima: null }; mapa.set(clave, v); }
    return v;
  };
  const sube = (v: ClienteVista, f: string | null) => { if (f && (!v.ultima || f > v.ultima)) v.ultima = f; };
  for (const g of guardados) {
    if (!claveCliente(g.nombre)) continue;
    const v = get(g.nombre); v.guardado = g; v.nombre = g.nombre;
  }
  const vistosC = new Set<string>();
  for (const c of contratos) {
    if (!claveCliente(c.cliente) || vistosC.has(c.numero_contrato)) continue;
    vistosC.add(c.numero_contrato);
    const v = get(c.cliente as string); v.contratos.push(c); sube(v, dia(c.fecha_venta) ?? dia(c.fecha_salida));
  }
  const vistosQ = new Set<number>();
  for (const q of cotizaciones) {
    if (!claveCliente(q.cliente) || vistosQ.has(q.id)) continue;
    vistosQ.add(q.id);
    const v = get(q.cliente as string); v.cotizaciones.push(q); sube(v, dia(q.created_at) ?? dia(q.fecha_salida));
  }
  return [...mapa.values()].sort((a, b) => (b.ultima ?? "").localeCompare(a.ultima ?? "") || a.nombre.localeCompare(b.nombre, "es"));
}

export type PaginaClientes = { items: ClienteVista[]; total: number; pagina: number; paginas: number };

/** Filtro por nombre/documento/correo/teléfono (texto ya recortado) y página acotada: nunca devuelve más de `tam` clientes. */
export function paginarClientes(lista: ClienteVista[], q: string | null, pagina: number, tam: number = TAM_PAGINA_CLIENTES): PaginaClientes {
  const k = claveCliente(q ?? "");
  const crudo = (q ?? "").trim().toLowerCase();
  const f = k || crudo
    ? lista.filter((c) => c.clave.includes(k) || (crudo !== "" && [c.guardado?.documento, c.guardado?.email, c.guardado?.telefono].some((x) => !!x && x.toLowerCase().includes(crudo))))
    : lista;
  const paginas = Math.max(1, Math.ceil(f.length / tam));
  const p = Number.isInteger(pagina) && pagina >= 1 ? Math.min(pagina, paginas) : 1;
  return { items: f.slice((p - 1) * tam, p * tam), total: f.length, pagina: p, paginas };
}

/** Texto de búsqueda de la URL: recorta, quita control y acota. */
export function normalizarBusquedaClientes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_BUSQUEDA_CLIENTES);
  return q === "" ? null : q;
}
