import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ConfigForm } from "../ConfigForm";

export const dynamic = "force-dynamic";

export default async function NuevoPaquetePage() {
  const sb = await createClient();
  const { data: destinos } = await sb.from("destinos").select("id, nombre").order("nombre");

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Paquetes</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo paquete</h1>
      <p className="mb-6 text-sm text-gray-500">
        Paso 1 · Configuración inicial. Luego adicionas vuelos, hoteles y servicios, y se genera el tarifario.
      </p>
      <ConfigForm destinos={destinos ?? []} />
    </div>
  );
}
