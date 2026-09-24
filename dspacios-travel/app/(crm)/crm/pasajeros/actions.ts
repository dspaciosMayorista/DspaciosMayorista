"use server";

// ─────────────────────────────────────────────────────────────────────────
// "Pasajeros de contratos" — CRM (migración 188, rama independiente de la
// búsqueda de pasajero por documento). Lee contrato_pasajeros vía el RPC
// crm_pasajeros_contrato_buscar (SECURITY DEFINER, paginado): NUNCA lee
// crm_contactos aquí, NUNCA escribe en ninguna tabla, NUNCA marca a nadie
// como destinatario de campaña. El filtro de permiso/tenant real vive en
// el propio RPC (mismo criterio que puede_ver_contrato/
// soy_asesor_del_contrato) — esta Server Action solo llama al RPC con el
// cliente de SESIÓN real (nunca admin), para que el RPC evalúe al usuario
// que de verdad hizo la petición.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";

export type PasajeroContratoRow = {
  pasajeroId: number;
  numeroContrato: string;
  tenant: string;
  nombre: string;
  tipoId: string | null;
  identificacion: string | null;
  fechaNacimiento: string | null;
};

export type BuscarPasajerosContratoResultado =
  | { ok: true; filas: PasajeroContratoRow[]; totalFilas: number }
  | { ok: false; error: string };

export async function buscarPasajerosContrato(
  busqueda: string,
  pagina: number,
  tamPagina: number
): Promise<BuscarPasajerosContratoResultado> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("crm_pasajeros_contrato_buscar", {
    p_busqueda: busqueda.trim() || null,
    p_pagina: Math.max(1, Math.trunc(pagina) || 1),
    p_tam_pagina: Math.min(100, Math.max(1, Math.trunc(tamPagina) || 50)),
  });

  if (error) {
    return { ok: false, error: error.message || "No se pudo consultar pasajeros de contratos." };
  }

  type Fila = {
    pasajero_id: number;
    numero_contrato: string;
    tenant: string;
    nombre: string;
    tipo_id: string | null;
    identificacion: string | null;
    fecha_nacimiento: string | null;
    total_filas: number;
  };
  const filas = (data ?? []) as unknown as Fila[];

  return {
    ok: true,
    filas: filas.map((f) => ({
      pasajeroId: f.pasajero_id,
      numeroContrato: f.numero_contrato,
      tenant: f.tenant,
      nombre: f.nombre,
      tipoId: f.tipo_id,
      identificacion: f.identificacion,
      fechaNacimiento: f.fecha_nacimiento,
    })),
    totalFilas: filas[0]?.total_filas ?? 0,
  };
}
