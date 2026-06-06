import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ConfigHotelesClient } from "./ConfigHotelesClient";

export const dynamic = "force-dynamic";

export default async function ConfigHotelesPage() {
  const sb = await createClient();
  const [{ data: categorias }, { data: regimenes }] = await Promise.all([
    sb.from("categorias_habitacion").select("id, nombre, descripcion").order("nombre"),
    sb.from("planes_alimentacion").select("id, codigo, nombre, descripcion, nota_especial").order("codigo"),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Configuración general de hoteles</h1>
      <p className="mb-6 text-sm text-gray-500">
        Bases de datos maestras. Al crear un hotel seleccionas cuáles aplican.
      </p>
      <ConfigHotelesClient categorias={categorias ?? []} regimenes={regimenes ?? []} />
    </div>
  );
}
