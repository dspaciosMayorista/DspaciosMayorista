import { createClient } from "@/lib/supabase/server";
import { PasajerosContratoClient } from "./PasajerosContratoClient";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion", "operaciones", "venta"];

// "Pasajeros de contratos" — DELIBERADAMENTE separado de "Contactos"
// (crm_contactos, la base de campañas/publicidad). Lee contrato_pasajeros
// vía RPC paginado (migración 188, rama independiente): nunca copia estos
// datos a crm_contactos, nunca los marca como destinatarios de campaña. El
// filtro real de agencia/rol vive en el RPC (SECURITY DEFINER) — esta
// página solo hace un gate de UI (ocultar el módulo a quien no debería
// verlo), nunca la autoridad real de acceso.
export default async function PasajerosContratoPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Pasajeros de contratos</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo interno.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Pasajeros de contratos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Viajeros reales de contratos ya creados (Mayorista y Minorista) — separado de la base de
          contactos de campañas. Ningún dato de aquí se agrega a campañas ni se asume que aceptó
          publicidad; solo consulta, con el mismo alcance por agencia/contrato que ya tienes en
          Contratos.
        </p>
      </div>
      <PasajerosContratoClient />
    </div>
  );
}
