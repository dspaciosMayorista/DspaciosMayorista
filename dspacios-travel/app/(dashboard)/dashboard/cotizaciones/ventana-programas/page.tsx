import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/constants";

import { VentanaProgramasClient } from "./VentanaProgramasClient";
import { ROLES_PILOTO_VENTANA, type TipoConsulta } from "./tiposVista";

export const dynamic = "force-dynamic";

/**
 * Pantalla INTERNA de consulta de Programas para el piloto de la Fase B.
 *
 * Que ruta este bajo `/dashboard/cotizaciones` no es casualidad: el modulo ya
 * esta en `MODULO_POR_RUTA` y da `ROLES_INTERNOS`, asi que el proxy y el
 * layout ya exigen sesion y un rol interno. Este guard es la tercera capa: la
 * pantalla se puede pedir por URL, asi que vuelve a comprobarlo aqui.
 *
 * El listado de roles del piloto es el de `ROLES_PILOTO_VENTANA`, el mismo que
 * usan las actions: `control_vuelo` no opera comercialmente y queda fuera a
 * proposito. Que las dos capas compartan la lista es lo que evita que una
 * deje pasar a quien la otra bloquea.
 */
const ROLES_FALLBACK: readonly Rol[] = ["superadmin", "gerencia", "administracion", "operaciones", "venta"];

export default async function VentanaProgramasPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    // El layout del dashboard ya redirige; esto es defensa en profundidad para
    // cuando la pantalla se renderice fuera de ese layout.
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-gray-600">No autenticado.</p>
      </div>
    );
  }

  const { data: perfil } = await sb
    .from("usuarios")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();

  const rol = (perfil?.rol ?? null) as Rol | null;
  const permitidos = ROLES_PILOTO_VENTANA?.length ? ROLES_PILOTO_VENTANA : ROLES_FALLBACK;

  if (!rol || !permitidos.includes(rol)) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link href="/dashboard/cotizaciones" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Volver a cotizaciones
        </Link>
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Ventana de programas</h1>
        {/* Aviso inline y no redirect: es el patron de las pantallas internas
            del repo (libro-diario, retenciones) y evita el rebote en el menu. */}
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Esta herramienta del piloto no esta disponible para tu rol. Es una
          ventana de consulta para sales y administracion. Si crees que es un
          error, avisale a un administrador.
        </p>
      </div>
    );
  }

  const nombreAsesor = (user.email ?? "").split("@")[0];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/cotizaciones" className="inline-flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft size={16} /> Cotizaciones
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">Ventana de programas</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Consulta de solo lectura. La respuesta es una SUGERENCIA por reglas:
            revisala y copiala tu al cliente. Nada se guarda y nada se envia.
          </p>
        </div>
      </div>

      <VentanaProgramasClient
        rol={rol}
        nombreAsesor={nombreAsesor}
        tipoInicial={"programas" satisfies TipoConsulta}
      />
    </div>
  );
}