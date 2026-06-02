import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoContratoForm, type PaqueteOpt, type BloqueoOpt } from "../NuevoContratoForm";

export const dynamic = "force-dynamic";

export default async function NuevoContratoPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let asesorDefault = "";
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("nombre").eq("id", user.id).single();
    asesorDefault = perfil?.nombre ?? "";
  }

  const [{ data: paquetesRaw }, { data: bloqueosRaw }] = await Promise.all([
    sb.from("paquetes")
      .select("id, categoria, nombre, plan_alimentacion, impuesto_no_comisionable, paquete_hoteles(nombre, ciudad, alimentacion, acomodacion_detalle), paquete_precios(acomodacion, precio)")
      .eq("activo", true)
      .order("nombre"),
    sb.from("bloqueos_vuelo").select("id, record, ruta, fecha_ida, fecha_regreso, aerolinea").order("fecha_ida"),
  ]);

  const paquetes = (paquetesRaw ?? []) as unknown as PaqueteOpt[];
  const bloqueos = (bloqueosRaw ?? []) as unknown as BloqueoOpt[];

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/contratos" className="text-sm text-gray-400 hover:text-gray-600">← Contratos</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo contrato</h1>
      <p className="mb-6 text-sm text-gray-500">
        Elige el tipo de paquete. En bloqueo y porción terrestre se carga el producto
        del tarifario; en dinámico el asesor captura todo.
      </p>
      <NuevoContratoForm asesorDefault={asesorDefault} paquetes={paquetes} bloqueos={bloqueos} />
    </div>
  );
}
