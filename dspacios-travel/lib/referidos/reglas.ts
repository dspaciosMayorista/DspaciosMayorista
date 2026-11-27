// #76 — Referidos: reglas PURAS (sin red ni next/*). La autoridad es la base (migración 341: re-verifica rol activo, agencia y porcentaje); lo de aquí es presentación y defensa en profundidad.
//   · Un referidor recibe el 1 % o el 2 % de la base comisionable de las compras FUTURAS del aliado que trajo: EXACTAMENTE la base con la que se calculó la comisión del aliado (la guardada en su fila; en un contrato NETO,
//     la base ORIGINAL antes de descontar esa comisión). Sin esa evidencia no se adivina ni se muestra un cero calculado.
//   · Superadmin y gerencia gestionan (incluida la confirmación del código escrito en el registro); administración SOLO consulta: no asigna ni cambia, tampoco al aprobar un registro. Nadie más ve esto.
//   · El código de referido que escribe una agencia/freelance al registrarse es un CANDIDATO (texto): se confirma con una decisión de superadmin/gerencia contra la regla guardada (migración 342).
//   · La tarifa y la identidad del referidor salen SIEMPRE de lo guardado (asignación o código); el navegador nunca manda una tarifa «libre».

export const PCT_REFERIDO = [0.01, 0.02] as const;
export type PctReferido = (typeof PCT_REFERIDO)[number];

export const ROLES_GESTIONAN_REFERIDOS = ["superadmin", "gerencia"] as const;
export const ROLES_VEN_REFERIDOS = ["superadmin", "gerencia", "administracion"] as const;

export type AccesoReferidos = { ok: true; gestiona: boolean } | { ok: false };

/** ¿Quién entra a «Referidos» y quién puede cambiar algo? Falla cerrado: sin perfil activo y de rol admitido, nada. */
export function accesoReferidos(perfil: { rol?: unknown; activo?: unknown } | null | undefined): AccesoReferidos {
  if (!perfil || perfil.activo !== true || typeof perfil.rol !== "string") return { ok: false };
  if (!(ROLES_VEN_REFERIDOS as readonly string[]).includes(perfil.rol)) return { ok: false };
  return { ok: true, gestiona: (ROLES_GESTIONAN_REFERIDOS as readonly string[]).includes(perfil.rol) };
}

/** Porcentaje que acepta la base: exactamente 1 % o 2 %. Cualquier otra cosa (texto, 1,5 %, 3 %, NaN) es null. */
export function pctValido(raw: unknown): PctReferido | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+([.,]\d+)?$/.test(raw.trim()) ? Number(raw.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(n)) return null;
  const f = n > 1 ? n / 100 : n; // «2» se lee como 2 %; «0,02» como 2 %
  return (PCT_REFERIDO as readonly number[]).find((p) => Math.abs(p - f) < 1e-9) as PctReferido | undefined ?? null;
}

export const formatPct = (p: number | string) => `${(Number(p) * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} %`;

const CODIGO = /^[A-Z0-9][A-Z0-9-]{3,19}$/;
/** Normaliza el código escrito por una persona (mayúsculas, sin espacios laterales). null si no tiene la forma permitida (4 a 20 letras, números o guiones). */
export function normalizarCodigo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return CODIGO.test(c) ? c : null;
}

export type EstadoReferido = "pendiente_pago" | "elegible" | "cancelado" | "sin_base" | "sin_evidencia_base" | "base_ambigua";
export const ETIQUETA_ESTADO: Record<EstadoReferido, { texto: string; ayuda: string; tono: "ok" | "espera" | "neutro" | "aviso" }> = {
  elegible: { texto: "Pagable", ayuda: "El contrato está 100 % pagado: la participación ya puede pagarse. No se paga sola.", tono: "ok" },
  pendiente_pago: { texto: "Pendiente de pago del contrato", ayuda: "Solo es pagable cuando el contrato esté 100 % pagado (un comprobante o un saldo pendiente no bastan).", tono: "espera" },
  cancelado: { texto: "Contrato cancelado", ayuda: "Un contrato cancelado no genera participación.", tono: "neutro" },
  sin_base: { texto: "Base guardada en 0", ayuda: "La comisión del aliado se calculó sobre una base de 0: la participación es 0 (un cero guardado, no calculado aquí).", tono: "neutro" },
  sin_evidencia_base: { texto: "Falta la base de la comisión del aliado", ayuda: "Este contrato no tiene guardada la comisión del aliado con la que se calcula la base. No se adivina ni se muestra un cero: registra o corrige esa comisión.", tono: "aviso" },
  base_ambigua: { texto: "Base ambigua", ayuda: "Hay varias comisiones ordinarias del mismo aliado en este contrato con bases distintas. Corrige la comisión del aliado para que haya una sola base.", tono: "aviso" },
};
export const esEstadoReferido = (v: unknown): v is EstadoReferido => typeof v === "string" && v in ETIQUETA_ESTADO;

/** Mensajes en español para los códigos de error de la base (F47xx). Nunca se muestra texto interno ni datos ajenos. */
export function mensajeErrorReferidos(error: { code?: string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case "F4701": return "No tienes permiso para esta operación.";
    case "F4702": return "La agencia no es válida (un referidor no cambia de agencia).";
    case "F4703": return "Ya existe un referidor con ese documento en esa agencia.";
    case "F4704": return "El porcentaje solo puede ser 1 % o 2 %.";
    case "F4705": return "El referidor no existe o está inactivo.";
    case "F4706": return "El aliado no existe.";
    case "F4707": return "El código de referido no es válido.";
    case "F4708": return "Revisa los datos del referidor: nombre de 3 a 120 caracteres; el tipo y el número de documento van juntos.";
    case "F4709": return "El código usa de 4 a 20 letras, números o guiones.";
    case "F4710": return "Ese código ya pertenece a otro referidor.";
    case "F4711": return "El registro debe estar aprobado y enlazado a una ficha de aliado antes de asignar el referido.";
    case "F4712": return "La regla del código cambió mientras revisabas. Recarga la página y confirma de nuevo.";
    case "F4713": return "Ese registro no existe o no trae un código de referido.";
    default: return "No se pudo completar la operación. Intenta de nuevo.";
  }
}

// ── Código escrito en el registro público: candidato y decisión (migración 342) ─────────────────────────────────────────────────────
export type EstadoCandidato = "sin_codigo" | "candidato" | "confirmado" | "reemplazado" | "descartado";
export const ETIQUETA_CANDIDATO: Record<EstadoCandidato, string> = {
  sin_codigo: "Sin código", candidato: "Por confirmar", confirmado: "Confirmado (código)", reemplazado: "Asignado otro referidor", descartado: "Descartado",
};
/** Registro con código tal como lo devuelve la base (resuelto HOY contra la regla guardada; referidor_id null = el código no es válido). */
export type CandidatoReferido = {
  solicitud_id: number; nombre: string; tipo: string; estado_solicitud: string; tenant: string; aliado_id: number | null; aliado_nombre: string | null; codigo: string; referido_estado: EstadoCandidato;
  decidido_en: string | null; referidor_id: number | null; referidor_nombre: string | null; pct: number | null; vigente_referidor: string | null; vigente_pct: number | null;
};

export type DecisionReferido =
  | { decision: "confirmar_codigo"; referidorId: number; pct: PctReferido }   // lo que la persona VIO: la base solo confirma si sigue siendo la regla guardada
  | { decision: "asignar_otro"; referidorId: number; pct: PctReferido }
  | { decision: "descartar" };

/** Valida la decisión que llega del navegador (defensa en profundidad; la base vuelve a validar). null = no es una decisión utilizable. */
export function decisionValida(raw: unknown): DecisionReferido | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { decision?: unknown; referidorId?: unknown; pct?: unknown };
  if (r.decision === "descartar") return { decision: "descartar" };
  if (r.decision !== "confirmar_codigo" && r.decision !== "asignar_otro") return null;
  const referidorId = typeof r.referidorId === "number" && Number.isInteger(r.referidorId) && r.referidorId > 0 ? r.referidorId : null;
  const pct = pctValido(r.pct);
  return referidorId && pct ? { decision: r.decision, referidorId, pct } : null;
}
