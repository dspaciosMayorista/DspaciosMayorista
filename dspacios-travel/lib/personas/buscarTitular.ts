"use server";

// #40 E2 — Búsqueda interna de cliente/titular por NÚMERO de documento. Reutiliza la RPC de #32/#42
// (`buscar_personas_documento`) con el cliente de SESIÓN: la base decide rol, agencia y propiedad (venta
// solo ve capturas autorizadas; B2B/anónimo reciben vacío). Como el tipo aún no se conoce, se consulta
// cada tipo del catálogo y se devuelve un candidato por tipo. Nunca lee crm_contactos ni `personas`.
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { buscarPersonasDocumento } from "@/lib/personas/consulta";
import { ROLES_AMBOS_TENANTS } from "@/lib/personas/fuentes";
import { TIPOS_DOC_PERSONA } from "@/lib/personas/identidad";
import { candidatoDeRespuesta, type CandidatoTitular } from "@/lib/personas/titularBusqueda";

const ERROR_BUSQUEDA_INCOMPLETA = "La búsqueda quedó incompleta: no se pudieron consultar todos los tipos de documento. Intenta de nuevo; no se debe asumir que no existe.";

export type ResultadoBuscarTitular = { ok: true; candidatos: CandidatoTitular[] } | { ok: false; error: string };

export async function buscarTitularPorNumero(numero: string): Promise<ResultadoBuscarTitular> {
  const num = String(numero ?? "").trim();
  if (!num) return { ok: true, candidatos: [] };
  if (num.length > 64) return { ok: false, error: "Documento demasiado largo." };

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autorizado." };
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  const tenant = (ROLES_AMBOS_TENANTS as readonly string[]).includes(perfil?.rol ?? "") ? await getTenant() : null;

  // Un tipo que falla NO se trata como «sin coincidencias»: podría ser justo el que tiene a la persona. Cualquier falla = búsqueda incompleta.
  const rs = await Promise.all(TIPOS_DOC_PERSONA.map((t) => buscarPersonasDocumento(sb, { tenant, tipoDoc: t, numero: num, limite: 1 }).catch(() => null)));
  if (rs.some((r) => !r || !r.ok)) return { ok: false, error: ERROR_BUSQUEDA_INCOMPLETA };
  const candidatos = rs.flatMap((r) => (r && r.ok ? [candidatoDeRespuesta(r.data)] : [])).filter((c): c is CandidatoTitular => !!c);
  return { ok: true, candidatos };
}
