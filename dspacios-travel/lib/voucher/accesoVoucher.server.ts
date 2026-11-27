import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verificarFichasComisionManual, consultarFichasSupabase, fichaDeContrato } from "@/lib/auth/fichaComisionManual";
import { contratoPagadoCompleto } from "@/lib/voucher/pagoCompleto";
import { resolverAccesoVoucher, type DepsAccesoVoucher, type ResultadoAccesoVoucher } from "@/lib/voucher/accesoVoucher";

// Dependencias REALES del acceso a un voucher por token. La página y su metadata llaman la MISMA función (`cache` por petición: una sola resolución por token).
// identidad:n/a — solo lectura; no escribe ninguna tabla de contrato
function depsReales(): DepsAccesoVoucher {
  const admin = createAdminClient();
  return {
    sesion: async () => {
      const sb = await createClient();
      const { data: { user } } = await sb.auth.getUser();
      return user ? { id: user.id } : null;
    },
    perfil: async (id) => {
      const { data } = await admin.from("usuarios").select("rol, tenant, nombre, activo, aliado_id, acceso_legacy_nombre").eq("id", id).maybeSingle();
      return data
        ? {
            id, rol: (data.rol as string | null) ?? null, tenant: (data.tenant as string | null) ?? null, nombre: (data.nombre as string | null) ?? null,
            activo: (data.activo as boolean | null) ?? null, aliadoId: (data.aliado_id as number | null) ?? null,
            accesoLegacyNombre: (data.acceso_legacy_nombre as boolean | null) ?? null,
          }
        : null;
    },
    voucher: async (token) => {
      const { data } = await admin.from("vouchers").select("id, numero_contrato, tipo, contenido, estado").eq("share_token", token).maybeSingle();
      return data ? { id: data.id as number, numero_contrato: data.numero_contrato as string, tipo: (data.tipo as string | null) ?? null, contenido: data.contenido, estado: (data.estado as string | null) ?? null } : null;
    },
    visibleParaInterno: async (token) => {
      const sb = await createClient(); // identidad:n/a — lectura de la sesión: la RLS de `vouchers` decide
      const { data } = await sb.from("vouchers").select("id").eq("share_token", token).maybeSingle();
      return !!data;
    },
    contrato: async (numero) => {
      const { data } = await admin.from("ventas").select("tenant, b2b_usuario_id, aliado_id, agencia_nombre, freelance_nombre").eq("numero_contrato", numero).maybeSingle();
      return data
        ? {
            tenant: (data.tenant as string | null) ?? null, b2b_usuario_id: (data.b2b_usuario_id as string | null) ?? null, aliado_id: (data.aliado_id as number | null) ?? null,
            agencia_nombre: (data.agencia_nombre as string | null) ?? null, freelance_nombre: (data.freelance_nombre as string | null) ?? null,
          }
        : null;
    },
    fichaManual: async (numero) => fichaDeContrato(await verificarFichasComisionManual([numero], consultarFichasSupabase(admin)), numero),
    pagadoCompleto: contratoPagadoCompleto,
  };
}

export const accesoVoucherPorToken = cache(async (token: string): Promise<ResultadoAccesoVoucher> => resolverAccesoVoucher(token, depsReales()));
