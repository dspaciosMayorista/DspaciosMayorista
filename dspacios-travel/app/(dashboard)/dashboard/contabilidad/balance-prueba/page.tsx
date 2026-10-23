import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { fetchAllPaginadoConError } from "@/lib/supabase/fetchAllPaginado";
import { esFechaIso, rangoMes } from "@/lib/contabilidad/libroDiario";
import { balanceDePrueba, type CuentaPuc, type MovimientoLinea } from "@/lib/contabilidad/balancePrueba";
import { BalancePruebaClient } from "./BalancePruebaClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion"];

export default async function BalancePruebaPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Balance de prueba</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver este módulo. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const hoy = fechaNegocio();
  const mes = rangoMes(hoy);
  let desde = esFechaIso(sp.desde) ? sp.desde : mes.desde;
  let hasta = esFechaIso(sp.hasta) ? sp.hasta : mes.hasta;
  if (desde > hasta) [desde, hasta] = [hasta, desde];

  const tenant = await getTenant();
  // Todo desde el LIBRO: PUC de la agencia y cada línea de asiento con la fecha
  // de su asiento hasta el cierre del periodo (lo anterior arma el saldo
  // inicial). Paginado y con error visible: un balance a medias no cuadra y
  // parecería un error contable cuando es un error de lectura.
  type FilaLinea = { cuenta_id: number; debe: number; haber: number; asientos_contables: { fecha: string } | null };
  const [cuentasR, lineasR] = await Promise.all([
    fetchAllPaginadoConError((d, h) => sb.from("puc_cuentas")
      .select("id, codigo, nombre, nivel, padre_id, naturaleza").eq("tenant", tenant).order("id").range(d, h)),
    fetchAllPaginadoConError((d, h) => sb.from("asiento_lineas")
      .select("cuenta_id, debe, haber, asientos_contables!inner(fecha)")
      .eq("tenant", tenant).lte("asientos_contables.fecha", hasta).order("id").range(d, h)),
  ]);
  const errorCarga = cuentasR.error?.message ?? lineasR.error?.message ?? null;
  const movimientos: MovimientoLinea[] = (lineasR.data as unknown as FilaLinea[])
    .filter((l) => l.asientos_contables?.fecha)
    .map((l) => ({ cuenta_id: l.cuenta_id, fecha: l.asientos_contables!.fecha, debe: Number(l.debe) || 0, haber: Number(l.haber) || 0 }));
  const resultado = balanceDePrueba(cuentasR.data as CuentaPuc[], movimientos, { desde, hasta });

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Balance de prueba</h1>
        <p className="mt-1 text-sm text-gray-500">
          Saldos por cuenta del PUC calculados desde el libro diario: saldo inicial, movimientos del periodo y saldo final.
          Cada cuenta suma sus subcuentas. Si el libro cuadra, el total de débitos es igual al de créditos.
        </p>
      </div>
      <BalancePruebaClient
        key={`${desde}-${hasta}`}
        filas={resultado.filas}
        totales={resultado.totales}
        lineasSinCuenta={resultado.lineasSinCuenta}
        errorCarga={errorCarga}
        desde={desde}
        hasta={hasta}
        hoy={hoy}
      />
    </div>
  );
}
