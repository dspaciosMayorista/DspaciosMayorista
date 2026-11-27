import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NuevoBloqueoForm } from "../NuevoBloqueoForm";
import { idCopiaValido, inicialBloqueoDesdeFila } from "@/lib/vuelos/duplicarVuelo";

export const dynamic = "force-dynamic";

export default async function NuevoBloqueoPage({ searchParams }: { searchParams: Promise<{ copiarDe?: string | string[] }> }) {
  const sb = await createClient();
  const copiarDe = idCopiaValido((await searchParams).copiarDe);
  const [{ data: proveedores }, { data: destinos }, { data: rangos }] = await Promise.all([
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
  ]);
  // #41: duplicar. La fuente se lee con la sesión de quien consulta (RLS) y solo aporta configuración; si no existe o no se puede leer, el formulario queda vacío con un aviso.
  const { data: fuente } = copiarDe ? await sb.from("bloqueos_vuelo").select("*").eq("id", copiarDe).maybeSingle() : { data: null };
  const inicial = fuente ? inicialBloqueoDesdeFila(fuente as unknown as Record<string, unknown>, (destinos ?? []) as { id: number; nombre: string; codigo_iata: string | null }[]) : null;
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/vuelos" className="text-sm text-gray-400 hover:text-gray-600">
        ← Vuelos
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo bloqueo</h1>
      <p className="mb-6 text-sm text-gray-500">
        Registra un record negociado con la aerolínea y sus cupos. Se crean las
        sillas disponibles para asignarlas a contratos.
      </p>
      {copiarDe && !fuente && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">No se encontró el bloqueo a duplicar; el formulario está vacío.</p>}
      <NuevoBloqueoForm proveedores={proveedores ?? []} destinos={destinos ?? []} rangos={rangos ?? []} inicial={inicial} copiaDe={fuente ? String((fuente as { record?: string }).record ?? "") : null} />
    </div>
  );
}
