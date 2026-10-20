import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { ROLES_LISTA_PERSONAS_COTIZACION } from "@/lib/personas/fuentes";
import { PersonasCotizacionClient } from "./PersonasCotizacionClient";

export const dynamic = "force-dynamic";

const ROLES_INTERNOS = ["superadmin", "gerencia", "administracion", "operaciones", "venta"];

// "Personas de cotizaciones" (#42) — titulares y pasajeros identificados en cotizaciones, con su
// estado de ficha (documentada / provisional / en revisión) y la cotización de origen. Separado
// de "Contactos" (campañas) y de "Pasajeros de contratos" (188). El filtro real de rol, agencia y
// propiedad vive en la RPC (SECURITY DEFINER); esta página solo oculta el módulo a quien no
// debería verlo y decide si el código de la cotización es un enlace (nunca la autoridad).
export default async function PersonasCotizacionPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle() : { data: null };
  const rol = perfil?.activo === true ? (perfil.rol ?? "") : "";
  if (!(ROLES_LISTA_PERSONAS_COTIZACION as readonly string[]).includes(rol)) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Personas de cotizaciones</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo no disponible para tu usuario.</p>
      </div>
    );
  }
  const interno = ROLES_INTERNOS.includes(rol);
  const tenant = await getTenant();

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Personas de cotizaciones</h1>
        <p className="mt-1 text-sm text-gray-500">
          {interno
            ? "Titulares y pasajeros identificados en cotizaciones, antes de convertirlas en contrato. Una ficha provisional es una persona sin documento completo: no se cruza con nadie por nombre ni teléfono."
            : "Titulares y pasajeros de las cotizaciones que creaste con tu usuario."}
        </p>
      </div>
      <PersonasCotizacionClient enlazarCotizaciones={interno} superadmin={rol === "superadmin"} tenantUsuario={tenant} />
    </div>
  );
}
