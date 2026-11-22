// #25 — Historial de cambios de UNA ficha de aliado, para el personal con acceso a la auditoría (superadmin y gerencia).
// Convierte las filas de `public.auditoria` (trigger 087; la edición del portal añade `_via: portal_b2b_perfil`, 283) en líneas legibles.
// Puro y sin I/O. No inventa campos: solo muestra lo que la auditoría guardó; el número de cuenta bancaria se enmascara.

export type FilaAuditoria = {
  id: number;
  creado_en: string;
  actor_email: string | null;
  actor_nombre: string | null;
  actor_rol: string | null;
  accion: string;
  despues: Record<string, unknown> | null;
  cambios: Record<string, unknown> | null;
};

export type CambioLegible = { campo: string; antes: string; despues: string };
export type LineaHistorial = {
  id: number;
  fecha: string;
  /** Quién: el nombre/correo de la sesión, o «Sistema» (service_role). */
  actor: string;
  rol: string | null;
  origen: "portal" | "interno";
  accion: "Alta" | "Cambio" | "Baja";
  cambios: CambioLegible[];
};

const ETIQUETA: Record<string, string> = {
  nombre: "Nombre", tipo: "Tipo", nit: "Documento", tipo_documento: "Tipo de documento", direccion: "Dirección", contacto: "Contacto", email: "Correo",
  telefono: "Teléfono", pct_comision: "% de comisión", aplica_retencion: "Aplica retención", pct_retencion: "% de retención", banco: "Banco",
  tipo_cuenta: "Tipo de cuenta", numero_cuenta: "Número de cuenta", activo: "Activo",
};
/** Columnas internas que no son una decisión de nadie (marcas de tiempo, el marcador de origen). */
const IGNORAR = new Set(["_via", "updated_at", "created_at", "id"]);

function enmascarar(v: string): string {
  return v.length <= 4 ? "****" : `****${v.slice(-4)}`;
}
function texto(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const s = String(v);
  if (campo === "numero_cuenta") return enmascarar(s);
  if (campo === "pct_comision" || campo === "pct_retencion") { const n = Number(v); return Number.isFinite(n) ? `${Math.round(n * 10000) / 100} %` : s; }
  return s;
}

/** `cambios` de la auditoría es {campo: {antes, despues}} o {campo: valorNuevo}; se acepta cualquiera de las dos formas. */
function leerCambios(f: FilaAuditoria, permitidos?: ReadonlySet<string>): CambioLegible[] {
  const out: CambioLegible[] = [];
  for (const [campo, v] of Object.entries(f.cambios ?? {})) {
    if (IGNORAR.has(campo) || (permitidos && !permitidos.has(campo))) continue;
    const par = v && typeof v === "object" && !Array.isArray(v) && ("antes" in (v as object) || "despues" in (v as object)) ? (v as { antes?: unknown; despues?: unknown }) : null;
    out.push({ campo: ETIQUETA[campo] ?? campo, antes: texto(campo, par ? par.antes : undefined), despues: texto(campo, par ? par.despues : v) });
  }
  return out;
}

/**
 * La edición del portal escribe DOS filas en la misma transacción: la del disparador (sin actor de sesión) y la explícita con `_via`. Se conserva la explícita:
 * mismo instante y mismos cambios = el mismo hecho, no dos.
 */
function sinGemelas(filas: FilaAuditoria[]): FilaAuditoria[] {
  const clave = (f: FilaAuditoria) => `${f.creado_en}|${f.accion}|${JSON.stringify(f.cambios ?? null)}`;
  const conVia = new Set(filas.filter((f) => f.despues && f.despues._via === "portal_b2b_perfil").map(clave));
  return filas.filter((f) => !(conVia.has(clave(f)) && !(f.despues && f.despues._via === "portal_b2b_perfil")));
}

export function lineasHistorialAliado(filas: FilaAuditoria[], permitidos?: ReadonlySet<string>): LineaHistorial[] {
  return sinGemelas(filas)
    .map((f): LineaHistorial => ({
      id: f.id,
      fecha: f.creado_en,
      actor: f.actor_nombre || f.actor_email || "Sistema",
      rol: f.actor_rol,
      origen: f.despues && f.despues._via === "portal_b2b_perfil" ? "portal" : "interno",
      accion: f.accion === "INSERT" ? "Alta" : f.accion === "DELETE" ? "Baja" : "Cambio",
      cambios: f.accion === "UPDATE" ? leerCambios(f, permitidos) : [],
    }))
    // Un UPDATE sin ningún campo con significado (solo marcas de tiempo) no es un cambio de la ficha.
    .filter((l) => l.accion !== "Cambio" || l.cambios.length > 0)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
}

/** #25 — Lo que ve el PROPIO aliado: sin la identidad del personal interno (actor/rol) y solo los campos permitidos (nunca comisión ni retención). */
export type LineaParaAliado = Pick<LineaHistorial, "id" | "fecha" | "origen" | "accion" | "cambios">;
export function lineasHistorialParaAliado(filas: FilaAuditoria[], permitidos: ReadonlySet<string>): LineaParaAliado[] {
  return lineasHistorialAliado(filas, permitidos).map(({ id, fecha, origen, accion, cambios }) => ({ id, fecha, origen, accion, cambios }));
}
