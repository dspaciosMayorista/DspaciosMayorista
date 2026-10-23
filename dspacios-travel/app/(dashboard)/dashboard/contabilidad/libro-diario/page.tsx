import { createClient } from "@/lib/supabase/server";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { esFechaIso, rangoMes } from "@/lib/contabilidad/libroDiario";
import { listarAsientos, listarCuentasMovimiento } from "./actions";
import { LibroDiarioClient } from "./LibroDiarioClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion"];

export default async function LibroDiarioPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Libro diario</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver este módulo. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  // Por defecto, el mes en curso (día de negocio de Bogotá). El rango viaja en
  // la URL para que el enlace se pueda compartir y el botón Atrás funcione.
  const sp = await searchParams;
  const hoy = fechaNegocio();
  const mes = rangoMes(hoy);
  let desde = esFechaIso(sp.desde) ? sp.desde : mes.desde;
  let hasta = esFechaIso(sp.hasta) ? sp.hasta : mes.hasta;
  if (desde > hasta) [desde, hasta] = [hasta, desde];

  const [asientosR, cuentasR] = await Promise.all([listarAsientos({ desde, hasta }), listarCuentasMovimiento()]);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Libro diario</h1>
        <p className="mt-1 text-sm text-gray-500">
          Registro cronológico de asientos contables (partida doble: el débito siempre debe cuadrar con el crédito).
          Varios módulos (abonos, cuentas por pagar, pagos, facturación, conciliaciones) generan asientos automáticos aquí.
        </p>
      </div>
      <LibroDiarioClient
        key={`${desde}-${hasta}`}
        asientosIniciales={asientosR.ok ? asientosR.asientos : []}
        errorCarga={asientosR.ok ? null : asientosR.error}
        cuentas={cuentasR.ok ? cuentasR.cuentas : []}
        desde={desde}
        hasta={hasta}
        hoy={hoy}
      />
    </div>
  );
}
