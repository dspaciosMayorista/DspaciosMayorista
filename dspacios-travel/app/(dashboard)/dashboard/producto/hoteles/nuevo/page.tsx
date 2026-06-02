import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoHotelForm } from "../NuevoHotelForm";

export const dynamic = "force-dynamic";

export default async function NuevoHotelPage() {
  const sb = await createClient();
  const [{ data: destinos }, { data: proveedores }, { data: categorias }, { data: regimenes }] = await Promise.all([
    sb.from("destinos").select("id, nombre").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "hotelero").order("nombre"),
    sb.from("categorias_habitacion").select("id, nombre").order("nombre"),
    sb.from("planes_alimentacion").select("id, codigo, nombre").order("codigo"),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/producto/hoteles" className="text-sm text-gray-400 hover:text-gray-600">← Hoteles</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo hotel</h1>
      <p className="mb-6 text-sm text-gray-500">
        Define proveedor, destino, edades y selecciona qué categorías y regímenes aplican.
      </p>
      <NuevoHotelForm
        destinos={destinos ?? []}
        proveedores={proveedores ?? []}
        categorias={categorias ?? []}
        regimenes={regimenes ?? []}
      />
    </div>
  );
}
