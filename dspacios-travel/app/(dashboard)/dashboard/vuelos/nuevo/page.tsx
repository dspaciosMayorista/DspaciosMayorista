import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NuevoBloqueoForm } from "../NuevoBloqueoForm";

export const dynamic = "force-dynamic";

export default async function NuevoBloqueoPage() {
  const sb = await createClient();
  const [{ data: proveedores }, { data: destinos }, { data: rangos }] = await Promise.all([
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("destinos").select("id, nombre").order("nombre"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
  ]);
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/vuelos" className="text-sm text-gray-400 hover:text-gray-600">
        ← Vuelos
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo bloqueo</h1>
      <p className="mb-6 text-sm text-gray-500">
        Registra un record negociado con la aerolínea y sus cupos. Se crean las
        sillas disponibles para asignarlas a contratos.
      </p>
      <NuevoBloqueoForm proveedores={proveedores ?? []} destinos={destinos ?? []} rangos={rangos ?? []} />
    </div>
  );
}
