import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NuevoEmpaquetadoForm } from "../NuevoEmpaquetadoForm";
import { idCopiaValido, inicialEmpaquetadoDesdeFila } from "@/lib/vuelos/duplicarVuelo";

export const dynamic = "force-dynamic";

export default async function NuevoEmpaquetadoPage({ searchParams }: { searchParams: Promise<{ copiarDe?: string | string[] }> }) {
  const sb = await createClient();
  const copiarDe = idCopiaValido((await searchParams).copiarDe);
  const [{ data: proveedores }, { data: destinos }] = await Promise.all([
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
  ]);
  // #41: duplicar. La fuente se lee con la sesión de quien consulta (RLS) y solo aporta configuración.
  const { data: fuente } = copiarDe ? await sb.from("empaquetados").select("*").eq("id", copiarDe).maybeSingle() : { data: null };
  const inicial = fuente ? inicialEmpaquetadoDesdeFila(fuente as unknown as Record<string, unknown>, (destinos ?? []) as { id: number; nombre: string; codigo_iata: string | null }[]) : null;
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/vuelos?vista=empaquetados" className="text-sm text-gray-400 hover:text-gray-600">
        ← Empaquetados
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo empaquetado</h1>
      <p className="mb-6 text-sm text-gray-500">
        Tarifa aérea de Sistema para armar promociones — sin cupo negociado, sin sillas. Puede existir antes de
        vincularse a un paquete.
      </p>
      {copiarDe && !fuente && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">No se encontró el empaquetado a duplicar; el formulario está vacío.</p>}
      <NuevoEmpaquetadoForm proveedores={proveedores ?? []} destinos={destinos ?? []} inicial={inicial} copiaDe={fuente ? String((fuente as { record?: string | null }).record ?? `#${copiarDe}`) : null} />
    </div>
  );
}
