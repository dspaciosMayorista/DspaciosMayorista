import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoDestinoDialog } from "./NuevoDestinoDialog";
import { EliminarDestinoBtn } from "./EliminarDestinoBtn";

export default async function TarifarioAdminPage() {
  const sb = await createClient();

  const { data: destinos } = await sb
    .from("destinos")
    .select("id, nombre, codigo_iata, hoteles(count)")
    .order("nombre");

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tarifario</h1>
          <p className="text-sm text-gray-500 mt-1">Módulo de Producto — gestión de destinos y tarifas</p>
        </div>
        <NuevoDestinoDialog />
      </div>

      {!destinos?.length ? (
        <div className="text-center py-20 text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
          <p className="text-lg">No hay destinos cargados</p>
          <p className="text-sm mt-1">Crea el primer destino para comenzar a cargar tarifas</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {destinos.map((d) => (
            <div
              key={d.id}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#1D7C9A] hover:shadow-sm transition-all group relative"
            >
              <Link href={`/dashboard/tarifario/${d.id}`} className="block">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900 group-hover:text-[#1D7C9A] transition-colors">
                      {d.nombre}
                    </h2>
                    {d.codigo_iata && (
                      <span className="text-xs font-mono text-gray-400 mt-0.5 block">{d.codigo_iata}</span>
                    )}
                  </div>
                  <span className="text-xs bg-gray-50 text-gray-500 px-2 py-1 rounded-full">
                    {(d.hoteles as unknown as { count: number }[])?.[0]?.count ?? 0} hoteles
                  </span>
                </div>
                <p className="text-xs text-[#26BBD9] mt-3 font-medium">Ver tarifas →</p>
              </Link>
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <EliminarDestinoBtn id={d.id} nombre={d.nombre} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
