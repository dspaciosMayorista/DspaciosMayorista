import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoDestinoDialog } from "../../tarifario/NuevoDestinoDialog";
import { EliminarDestinoBtn } from "../../tarifario/EliminarDestinoBtn";

export const dynamic = "force-dynamic";

export default async function DestinosPage() {
  const sb = await createClient();
  const { data: destinos } = await sb
    .from("destinos")
    .select("id, nombre, codigo_iata, hoteles(count)")
    .order("nombre");

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <div className="mb-8 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Destinos</h1>
          <p className="mt-1 text-sm text-gray-500">Ciudades / destinos donde operas (nombre en mayúsculas + código IATA).</p>
        </div>
        <NuevoDestinoDialog />
      </div>

      {!destinos?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay destinos cargados</p>
          <p className="mt-1 text-sm">Crea el primero con “Nuevo destino”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {destinos.map((d) => (
            <div key={d.id} className="group relative rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between">
                <h2 className="font-semibold text-gray-900">
                  {d.nombre?.toUpperCase()}
                  {d.codigo_iata && <span className="font-normal text-gray-400"> ({d.codigo_iata})</span>}
                </h2>
                <span className="rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-500">
                  {(d.hoteles as unknown as { count: number }[])?.[0]?.count ?? 0} hoteles
                </span>
              </div>
              <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
                <EliminarDestinoBtn id={d.id} nombre={d.nombre} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
