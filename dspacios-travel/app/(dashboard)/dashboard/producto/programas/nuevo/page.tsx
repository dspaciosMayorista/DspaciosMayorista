import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CabeceraForm } from "../CabeceraForm";
import { crearPrograma } from "../actions";

export const dynamic = "force-dynamic";

export default async function NuevoProgramaPage() {
  const sb = await createClient();
  const { data: proveedores } = await sb.from("proveedores").select("id, nombre").order("nombre");

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/producto/programas" className="text-sm text-gray-400 hover:text-gray-700">
        ← Programas
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-gray-900">Nuevo programa</h1>
      <p className="mb-6 text-sm text-gray-500">
        Captura la cabecera. Después agregas ruta, itinerario, hoteles, precios, tours y publicas.
      </p>
      <CabeceraForm
        proveedores={proveedores ?? []}
        onSubmit={crearPrograma}
        submitLabel="Crear y continuar"
        redirectOnCreate
      />
    </div>
  );
}
