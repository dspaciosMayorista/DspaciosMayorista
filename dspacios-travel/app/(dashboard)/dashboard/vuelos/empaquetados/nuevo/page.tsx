import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NuevoEmpaquetadoForm } from "../NuevoEmpaquetadoForm";

export const dynamic = "force-dynamic";

export default async function NuevoEmpaquetadoPage() {
  const sb = await createClient();
  const [{ data: proveedores }, { data: destinos }] = await Promise.all([
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
  ]);
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/vuelos?vista=empaquetados" className="text-sm text-gray-400 hover:text-gray-600">
        ← Empaquetados
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo empaquetado</h1>
      <p className="mb-6 text-sm text-gray-500">
        Tarifa aérea de Sistema para armar promociones — sin cupo negociado, sin sillas. Puede existir antes de
        vincularse a un paquete.
      </p>
      <NuevoEmpaquetadoForm proveedores={proveedores ?? []} destinos={destinos ?? []} />
    </div>
  );
}
