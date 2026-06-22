import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { CotizacionManualForm } from "./CotizacionManualForm";

export const dynamic = "force-dynamic";

export default async function NuevaCotizacionPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol, nombre").eq("id", user.id).single() : { data: null };

  const [{ data: asesores }, { data: aliados }, { data: paramDist }] = await Promise.all([
    sb.from("usuarios").select("nombre, email").eq("rol", "venta").eq("activo", true).order("nombre"),
    sb.from("aliados").select("id, nombre, tipo").order("nombre"),
    sb.from("parametros_tributarios").select("valor").eq("parametro", "recobro_pct_aliado_b2b").maybeSingle(),
  ]);
  const pctAliadoB2B = Number(paramDist?.valor ?? 0.5);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/cotizaciones" className="text-sm text-gray-400 hover:text-gray-600">← Volver a cotizaciones</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Nueva cotización dinámica</h1>
      <p className="mb-6 text-sm text-gray-500">
        Cotización manual: arma los servicios a mano (aéreo, hotel, traslado, asistencia…) con su plataforma,
        proveedor, costo y markup. Queda guardada como cotización.
      </p>
      <CotizacionManualForm
        asesores={asesores ?? []}
        aliados={(aliados ?? []) as { id: number; nombre: string; tipo: string | null }[]}
        miNombre={perfil?.nombre ?? ""}
        miRolVenta={perfil?.rol === "venta"}
        pctAliadoB2B={pctAliadoB2B}
      />
    </div>
  );
}
