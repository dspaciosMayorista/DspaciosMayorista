import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { AerolineasClient } from "./AerolineasClient";

export const dynamic = "force-dynamic";

export default async function AerolineasPage() {
  const sb = await createClient();
  const [{ data: aerolineas }, { data: tarifas }] = await Promise.all([
    sb.from("aerolineas").select("id, nombre, activo").order("nombre"),
    sb.from("aerolinea_tarifas").select("id, aerolinea_id, nombre, descripcion, orden").order("orden"),
  ]);

  const tarifasPorAerolinea = new Map<number, { id: number; nombre: string; descripcion: string }[]>();
  for (const t of tarifas ?? []) {
    const arr = tarifasPorAerolinea.get(t.aerolinea_id) ?? [];
    arr.push({ id: t.id, nombre: t.nombre, descripcion: t.descripcion });
    tarifasPorAerolinea.set(t.aerolinea_id, arr);
  }
  const filas = (aerolineas ?? []).map((a) => ({ ...a, tarifas: tarifasPorAerolinea.get(a.id) ?? [] }));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Aerolíneas</h1>
      <p className="mb-6 text-sm text-gray-500">
        Catálogo de aerolíneas y sus tipos de tarifa/equipaje (artículo personal, cabina, bodega…) — se usa como lista
        desplegable al capturar un vuelo en el contrato manual/dinámico, en mayorista y minorista.
      </p>
      <AerolineasClient aerolineas={filas} />
    </div>
  );
}
