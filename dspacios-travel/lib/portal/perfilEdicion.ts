/**
 * #25 — Edición de «Mi perfil»: reglas puras (permisos y validación). Sin acceso a datos.
 *
 * Dos secciones SEPARADAS, cada una con su tabla:
 *   · «usuario» → `usuarios.nombre` (nombre de la persona que entra al portal).
 *   · «ficha»   → `aliados.nombre/contacto/telefono/email/direccion` (la ficha compartida de la agencia o del freelance).
 *
 * El permiso de editar la ficha NO nace de tener `aliado_id`: se acredita igual que en `portal/b2b/agentes/actions.ts`
 * (titular = rol `agencia` sin `agencia_id`, activo) y para el freelance (rol `freelance` sin `agencia_id`, activo),
 * y además se exige que la ficha no esté enlazada a otra cuenta titular. Un agente (agencia_id ≠ null) nunca edita la ficha.
 */
export type UsuarioEdicion = {
  id: string;
  rol: string | null;
  activo: boolean | null;
  agencia_id: string | null;
  aliado_id: number | null;
  acceso_legacy_nombre: boolean | null;
  nombre: string | null;
};

export type CampoFicha = "nombre" | "contacto" | "telefono" | "email" | "direccion";

export type PermisosPerfil = {
  /** Cuenta autorizada a usar el portal (rol de aliado y activa). */
  valido: boolean;
  tipo: "agencia" | "freelance" | null;
  esAgente: boolean;
  puedeNombreUsuario: boolean;
  motivoNombreUsuario: string | null;
  puedeFicha: boolean;
  motivoFicha: string | null;
  camposFicha: CampoFicha[];
};

export const MSG_LEGACY = "Tu nombre se usa para reconocer tus contratos anteriores; no se puede cambiar desde el portal. Contacta a tu asesor.";

/** `fichaCompartida`: otra cuenta titular/freelance activa comparte la misma ficha (`aliado_id`). */
export function permisosPerfil(u: UsuarioEdicion | null, fichaCompartida: boolean): PermisosPerfil {
  const no: PermisosPerfil = { valido: false, tipo: null, esAgente: false, puedeNombreUsuario: false, motivoNombreUsuario: null, puedeFicha: false, motivoFicha: null, camposFicha: [] };
  if (!u || u.activo !== true || (u.rol !== "agencia" && u.rol !== "freelance")) return no;
  const tipo = u.rol;
  const esAgente = u.rol === "agencia" && u.agencia_id != null;
  // `acceso_legacy_nombre` distinto de false (true o desconocido) = el nombre puede ser llave de acceso: no se toca.
  const legacy = u.acceso_legacy_nombre !== false;
  const titular = u.agencia_id == null;
  let puedeFicha = titular && u.aliado_id != null && !fichaCompartida;
  let motivoFicha: string | null = null;
  if (esAgente) motivoFicha = "La ficha de la agencia solo la edita su titular.";
  else if (u.aliado_id == null) motivoFicha = "Tu cuenta aún no está enlazada a una ficha. Contacta a tu asesor.";
  else if (fichaCompartida) { puedeFicha = false; motivoFicha = "Tu ficha la comparte otra cuenta. Contacta a tu asesor para cambiarla."; }
  return {
    valido: true, tipo, esAgente,
    puedeNombreUsuario: !legacy, motivoNombreUsuario: legacy ? MSG_LEGACY : null,
    puedeFicha, motivoFicha,
    camposFicha: puedeFicha ? (tipo === "agencia" ? ["nombre", "contacto", "telefono", "email", "direccion"] : ["nombre", "telefono", "email", "direccion"]) : [],
  };
}

const sinControl = (s: string) => s.replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim();

/** Normalización para comparar nombres (duplicados): sin tildes, mayúsculas ni espacios repetidos. */
export function normalizarNombre(s: string | null | undefined): string {
  return sinControl(String(s ?? "")).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

export function validarNombre(x: unknown): Resultado<string> {
  const v = sinControl(typeof x === "string" ? x : "");
  if (v.length < 3) return { ok: false, error: "El nombre debe tener al menos 3 caracteres." };
  if (v.length > 120) return { ok: false, error: "El nombre no puede superar 120 caracteres." };
  return { ok: true, valor: v };
}

/** Opcionales: vacío → null. */
export function validarCampoFicha(campo: Exclude<CampoFicha, "nombre">, x: unknown): Resultado<string | null> {
  const bruto = typeof x === "string" ? x : "";
  const v = sinControl(bruto);
  if (!v) return { ok: true, valor: null };
  if (campo === "contacto") return v.length > 120 ? { ok: false, error: "La persona de contacto no puede superar 120 caracteres." } : { ok: true, valor: v };
  if (campo === "direccion") return v.length > 200 ? { ok: false, error: "La dirección no puede superar 200 caracteres." } : { ok: true, valor: v };
  if (campo === "telefono") {
    if (!/^\+?[\d\s().-]+$/.test(v)) return { ok: false, error: "El teléfono solo puede tener números, espacios y el signo + inicial." };
    const dig = v.replace(/\D/g, "");
    if (dig.length < 7 || dig.length > 15) return { ok: false, error: "El teléfono debe tener entre 7 y 15 dígitos." };
    return { ok: true, valor: (v.startsWith("+") ? "+" : "") + dig };
  }
  const correo = v.toLowerCase();
  if (correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) return { ok: false, error: "El correo de contacto no es válido." };
  return { ok: true, valor: correo };
}

export type FichaEdicion = { id: number; nombre: string | null; contacto: string | null; telefono: string | null; email: string | null; direccion: string | null };

/**
 * Entrada del formulario: solo estas llaves se leen; cualquier otra (rol, aliado_id, nit…) se ignora.
 * `esperado` = los valores ORIGINALES con los que se abrió el formulario (tal cual salieron de la base, `null` incluido).
 * Sirven SOLO para detectar una edición desfasada (la base los compara dentro del bloqueo); nunca autorizan ni eligen la ficha.
 */
export type EntradaUsuario = { seccion: "usuario"; nombre?: unknown; esperado?: unknown };
export type EntradaFicha = { seccion: "ficha"; nombre?: unknown; contacto?: unknown; telefono?: unknown; email?: unknown; direccion?: unknown; confirmaNombreFicha?: unknown; esperado?: unknown };

export const MSG_CONFIRMA_NOMBRE_FICHA = "Confirma que el nuevo nombre también aparecerá en tu cuenta de cobro.";
export const MSG_RECARGA = "No se pudo comprobar qué datos estabas editando. Recarga la página e inténtalo de nuevo.";

type Original = string | null;
const texto = (x: unknown) => sinControl(typeof x === "string" ? x : "");

/** El original de un campo: debe venir en `esperado` como texto o null (si falta, no se puede detectar un cambio ajeno). */
function original(esperado: unknown, campo: string): Resultado<Original> {
  if (!esperado || typeof esperado !== "object" || Array.isArray(esperado) || !(campo in (esperado as object))) return { ok: false, error: MSG_RECARGA };
  const v = (esperado as Record<string, unknown>)[campo];
  if (v !== null && (typeof v !== "string" || v.length > 400)) return { ok: false, error: MSG_RECARGA };
  return { ok: true, valor: v as Original };
}

/**
 * Qué campos cambió la persona: los que difieren de lo que VIO al abrir el formulario (no de lo que hay ahora en la base).
 * Devuelve los valores nuevos validados y, por cada uno, el original que la base comparará dentro del bloqueo.
 */
export function cambiosFicha(entrada: EntradaFicha, permisos: PermisosPerfil): Resultado<{ cambios: Partial<Record<CampoFicha, string | null>>; esperado: Partial<Record<CampoFicha, Original>> }> {
  const cambios: Partial<Record<CampoFicha, string | null>> = {};
  const esperado: Partial<Record<CampoFicha, Original>> = {};
  for (const campo of permisos.camposFicha) {
    const crudo = (entrada as Record<string, unknown>)[campo];
    if (crudo === undefined) continue;
    const orig = original(entrada.esperado, campo);
    if (!orig.ok) return orig;
    if (texto(crudo) === texto(orig.valor)) continue; // no tocó este campo
    const nuevo = campo === "nombre" ? validarNombre(crudo) : validarCampoFicha(campo, crudo);
    if (!nuevo.ok) return nuevo;
    cambios[campo] = nuevo.valor;
    esperado[campo] = orig.valor;
  }
  if ("nombre" in cambios && entrada.confirmaNombreFicha !== true) return { ok: false, error: MSG_CONFIRMA_NOMBRE_FICHA };
  return { ok: true, valor: { cambios, esperado } };
}

/** Igual para el nombre de usuario: devuelve null si no lo tocó. */
export function cambioNombreUsuario(entrada: EntradaUsuario): Resultado<{ nombre: string; esperado: Original } | null> {
  const orig = original(entrada.esperado, "nombre");
  if (!orig.ok) return orig;
  if (texto(entrada.nombre) === texto(orig.valor)) return { ok: true, valor: null };
  const nuevo = validarNombre(entrada.nombre);
  if (!nuevo.ok) return nuevo;
  return { ok: true, valor: { nombre: nuevo.valor, esperado: orig.valor } };
}
