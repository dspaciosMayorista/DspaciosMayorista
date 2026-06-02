import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ServiciosClient } from "./ServiciosClient";

export const dynamic = "force-dynamic";

export default async function ServiciosPage() {
  const sb = await createClient();
  const [{ data: serviciosRaw }, { data: proveedores }, { data: destinos }] = await Promise.all([
    sb.from("servicios_adicionales").select("id, nombre, tarifa_neta, temporada, liquidacion, proveedores(nombre), destinos(nombre)").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "servicios").order("nombre"),
    sb.from("destinos").select("id, nombre").order("nombre"),
  ]);
  const servicios = (serviciosRaw ?? []) as unknown as Parameters<typeof ServiciosClient>[0]["servicios"];

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Servicios adicionales</h1>
      <p className="mb-6 text-sm text-gray-500">Asistencias, traslados y tours (costo neto).</p>
      <ServiciosClient servicios={servicios} proveedores={proveedores ?? []} destinos={destinos ?? []} />
    </div>
  );
}
