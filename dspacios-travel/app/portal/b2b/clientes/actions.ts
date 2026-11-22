"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolverContextoPortal } from "@/lib/portal/b2bPortalServidor";
import { guardarClienteAliado, type RespuestaCliente } from "@/lib/portal/clientesAliadoServidor";
import type { EntradaCliente } from "@/lib/portal/clientesAliado";

/** El aliado SIEMPRE sale de la sesión: del formulario solo se leen los campos del cliente (y la versión que el usuario vio). */
export async function guardarCliente(input: EntradaCliente & { id?: unknown; esperado?: unknown }): Promise<RespuestaCliente> {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return { ok: false, error: "Inicia sesión como aliado para guardar clientes." };
  const i = (input ?? {}) as Record<string, unknown>;
  const r = await guardarClienteAliado(
    createAdminClient(),
    { userId: ctx.userId, aliadoId: ctx.aliadoId, agenciaId: ctx.agenciaId, tenant: ctx.tenant },
    { nombre: i.nombre, tipoDocumento: i.tipoDocumento, documento: i.documento, email: i.email, telefono: i.telefono, notas: i.notas, autorizacion: i.autorizacion, id: i.id, esperado: i.esperado },
  );
  if (r.ok) revalidatePath("/portal/b2b/clientes");
  return r;
}
