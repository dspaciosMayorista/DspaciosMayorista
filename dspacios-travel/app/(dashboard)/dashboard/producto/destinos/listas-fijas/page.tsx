import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/roles";
import { DestinosTabs } from "../DestinosTabs";
import { ListaDestinoProgramas } from "./ListaDestinoProgramas";

export const dynamic = "force-dynamic";

export default async function ListasFijasPage() {
  const sb = await createClient();
  const [{ data: rol }, { data: destinos, error: errDestinos }, { data: asignados, error: errAsignados }] = await Promise.all([
    sb.rpc("mi_rol"),
    sb.from("programa_destinos_fijos").select("id, nombre, es_provisional").order("nombre"),
    sb.from("programas").select("destino_fijo_id").not("destino_fijo_id", "is", null),
  ]);

  const conteo = new Map<number, number>();
  for (const a of asignados ?? []) {
    if (a.destino_fijo_id != null) conteo.set(a.destino_fijo_id, (conteo.get(a.destino_fijo_id) ?? 0) + 1);
  }
  const items = (destinos ?? []).map((d) => ({ id: d.id, nombre: d.nombre, es_provisional: d.es_provisional === true, programas: conteo.get(d.id) ?? 0 }));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <div className="mb-6 mt-2">
        <h1 className="text-2xl font-semibold text-gray-900">Destinos</h1>
        <p className="mt-1 text-sm text-gray-500">Listas comerciales que se administran a mano.</p>
      </div>
      <DestinosTabs activa="listas" />
      {errDestinos || errAsignados ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          No se pudo cargar la lista. Recarga la página; si persiste, avisa a soporte.
        </p>
      ) : (
        <ListaDestinoProgramas items={items} puedeEditar={puedeEscribir("producto", (rol as string | null) ?? null)} />
      )}
    </div>
  );
}
