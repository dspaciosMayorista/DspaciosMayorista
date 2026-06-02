import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoPaqueteForm } from "../NuevoPaqueteForm";

export const dynamic = "force-dynamic";

export default async function NuevoPaquetePage() {
  const sb = await createClient();
  const [{ data: destinos }, { data: bloqueos }] = await Promise.all([
    sb.from("destinos").select("id, nombre").order("nombre"),
    sb.from("bloqueos_vuelo").select("id, record, ruta, fecha_ida").order("fecha_ida"),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Paquetes</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo paquete</h1>
      <p className="mb-6 text-sm text-gray-500">
        Producto negociado prearmado. El contrato lo jala con el precio bloqueado;
        los costos quedan de uso interno.
      </p>
      <NuevoPaqueteForm destinos={destinos ?? []} bloqueos={bloqueos ?? []} />
    </div>
  );
}
