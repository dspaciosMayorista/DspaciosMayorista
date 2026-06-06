import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoDestinoDialog } from "../../tarifario/NuevoDestinoDialog";
import { CargarDestinosSugeridos } from "./CargarDestinosSugeridos";
import { DestinosLista } from "./DestinosLista";

export const dynamic = "force-dynamic";

export default async function DestinosPage() {
  const sb = await createClient();
  const { data: destinos } = await sb
    .from("destinos")
    .select("id, nombre, codigo_iata, pais, hoteles(count)")
    .order("nombre");

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <div className="mb-8 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Destinos</h1>
          <p className="mt-1 text-sm text-gray-500">Ciudades / destinos donde operas (nombre en mayúsculas + código IATA).</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CargarDestinosSugeridos />
          <NuevoDestinoDialog />
        </div>
      </div>

      {!destinos?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay destinos cargados</p>
          <p className="mt-1 text-sm">Crea el primero con “Nuevo destino”.</p>
        </div>
      ) : (
        <DestinosLista destinos={destinos} />
      )}
    </div>
  );
}
