"use server";

import { revalidatePath } from "next/cache";
import { actorReferidos, asignarReferido, aplicarCodigoReferido, decidirCandidatoReferido, definirCodigoReferido, guardarReferidor, quitarReferido, type Resultado } from "@/lib/referidos/servidor";
import { decisionValida, normalizarCodigo, pctValido } from "@/lib/referidos/reglas";

// #76 — acciones de «Referidos» (CRM). El ACTOR sale de la sesión; la base vuelve a exigir rol activo (superadmin/gerencia) y agencia. El navegador nunca manda una tarifa libre: el porcentaje es 1 % o 2 %
// (validado aquí y en la base) y el código resuelve una regla guardada. Una llamada a la base por acción; sin reintentos.
const NO_PERMITIDO: Resultado = { ok: false, error: "No tienes permiso para esta operación." };
const id = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const tenantValido = (v: unknown) => (v === "mayorista" || v === "minorista" ? v : null);

async function gestor() {
  const a = await actorReferidos();
  return a && a.acceso.gestiona ? a : null;
}
function listo(r: Resultado): Resultado { if (r.ok) revalidatePath("/crm/referidos"); return r; }

export async function guardarReferidorAction(raw: { id?: number | null; tenant: string; nombre: string; tipoDocumento?: string; documento?: string; email?: string; telefono?: string; notas?: string; activo?: boolean }): Promise<Resultado> {
  const a = await gestor(); if (!a) return NO_PERMITIDO;
  const tenant = tenantValido(raw?.tenant); if (!tenant) return { ok: false, error: "Elige la agencia del referidor." };
  return listo(await guardarReferidor(a, {
    id: raw.id == null ? null : id(raw.id), tenant, nombre: texto(raw.nombre, 120), tipoDocumento: texto(raw.tipoDocumento, 10), documento: texto(raw.documento, 30),
    email: texto(raw.email, 120), telefono: texto(raw.telefono, 30), notas: texto(raw.notas, 500), activo: raw.activo !== false,
  }));
}

export async function definirCodigoAction(raw: { referidorId: number; codigo: string; pct: number | string; activo?: boolean }): Promise<Resultado> {
  const a = await gestor(); if (!a) return NO_PERMITIDO;
  const referidorId = id(raw?.referidorId); const codigo = normalizarCodigo(raw?.codigo); const pct = pctValido(raw?.pct);
  if (!referidorId) return { ok: false, error: "Elige un referidor." };
  if (!codigo) return { ok: false, error: "El código usa de 4 a 20 letras, números o guiones." };
  if (!pct) return { ok: false, error: "El porcentaje solo puede ser 1 % o 2 %." };
  return listo(await definirCodigoReferido(a, { referidorId, codigo, pct, activo: raw.activo !== false }));
}

export async function asignarReferidoAction(raw: { aliadoId: number; referidorId: number; pct: number | string; motivo?: string }): Promise<Resultado> {
  const a = await gestor(); if (!a) return NO_PERMITIDO;
  const aliadoId = id(raw?.aliadoId); const referidorId = id(raw?.referidorId); const pct = pctValido(raw?.pct);
  if (!aliadoId || !referidorId) return { ok: false, error: "Elige el aliado y el referidor." };
  if (!pct) return { ok: false, error: "El porcentaje solo puede ser 1 % o 2 %." };
  return listo(await asignarReferido(a, { aliadoId, referidorId, pct, motivo: texto(raw.motivo, 300) }));
}

export async function aplicarCodigoAction(raw: { aliadoId: number; codigo: string }): Promise<Resultado> {
  const a = await gestor(); if (!a) return NO_PERMITIDO;
  const aliadoId = id(raw?.aliadoId); const codigo = normalizarCodigo(raw?.codigo);
  if (!aliadoId) return { ok: false, error: "Elige el aliado." };
  if (!codigo) return { ok: false, error: "El código de referido no es válido." };
  return listo(await aplicarCodigoReferido(a.id, aliadoId, codigo));
}

export async function quitarReferidoAction(raw: { aliadoId: number; tenant: string; motivo?: string }): Promise<Resultado> {
  const a = await gestor(); if (!a) return NO_PERMITIDO;
  const aliadoId = id(raw?.aliadoId); const tenant = tenantValido(raw?.tenant);
  if (!aliadoId || !tenant) return { ok: false, error: "Elige la asignación que quieres terminar." };
  return listo(await quitarReferido(a, { aliadoId, tenant, motivo: texto(raw.motivo, 300) }));
}

/** Confirma, reemplaza o descarta el código que una agencia/freelance escribió al registrarse. Solo superadmin/gerencia; el navegador solo aporta qué VIO (referidor y %): la base compara con la regla guardada. */
export async function decidirCandidatoAction(raw: { solicitudId: number; decision: unknown }): Promise<Resultado> {
  const a = await gestor(); if (!a) return NO_PERMITIDO;
  const solicitudId = id(raw?.solicitudId); const decision = decisionValida(raw?.decision);
  if (!solicitudId || !decision) return { ok: false, error: "Elige qué hacer con el código de referido." };
  const r = await decidirCandidatoReferido(a, solicitudId, decision);
  if (r.ok) revalidatePath("/dashboard/usuarios/b2b");
  return listo(r);
}
