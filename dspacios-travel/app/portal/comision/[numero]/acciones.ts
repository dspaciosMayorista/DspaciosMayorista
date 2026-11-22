"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agenciaDe } from "@/lib/tenant.server";
import { esTenant } from "@/lib/tenant";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { resolverComisionB2B } from "@/lib/finanzas/comisionResolver";
import { cargarContextoEdicion } from "@/lib/portal/perfilEdicionServidor";
import { construirSnapshot } from "@/lib/cuentaCobro/snapshot";
import { aceptarCuentaServidor, type RespuestaAceptacion } from "@/lib/cuentaCobro/servidor";

/**
 * #98 — El aliado freelance acepta electrónicamente UNA versión de su cuenta de cobro. De la petición solo se leen el número, la comisión elegida y el hash que
 * vio; el documento se vuelve a resolver (con el mismo control de acceso de la página) y a calcular en el servidor.
 */
export async function aceptarCuentaCobro(entrada: { numero: string; comisionId?: number | null; hash: string }): Promise<RespuestaAceptacion> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión para firmar." };
  const numero = typeof entrada?.numero === "string" ? entrada.numero : "";
  const comisionId = Number.isInteger(entrada?.comisionId) ? (entrada.comisionId as number) : null;
  const r = numero ? await resolverComisionB2B(numero, comisionId) : null;
  if (!r || r.tipo !== "comision") return { ok: false, error: "No se encontró la cuenta de cobro." };
  const agencia = await agenciaDe(esTenant(r.tenant) ? r.tenant : "mayorista");
  const ahora = fechaNegocio();
  const vivo = construirSnapshot(r, { nombre: agencia?.nombre_comercial || agencia?.razon_social || "D'SPACIOS TRAVEL", nit: agencia?.nit ?? null, direccion: agencia?.direccion ?? null }, ahora);
  const admin = createAdminClient(); // identidad:n/a — tablas propias de #98 (sin número de contrato) y Storage
  const ctx = await cargarContextoEdicion(admin, user.id);
  const res = await aceptarCuentaServidor(admin, { userId: user.id, r, ctx, vivo, hashVisto: entrada?.hash, ahoraNegocio: ahora });
  if (res.ok) revalidatePath(`/portal/comision/${encodeURIComponent(r.numeroContrato)}`);
  return res;
}
