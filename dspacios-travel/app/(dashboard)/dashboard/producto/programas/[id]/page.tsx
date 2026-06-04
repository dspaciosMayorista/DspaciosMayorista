import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProgramaEditor } from "./ProgramaEditor";

export const dynamic = "force-dynamic";

export default async function ProgramaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const sb = await createClient();
  const [
    { data: programa },
    { data: proveedores },
    { data: ciudades },
    { data: dias },
    { data: categorias },
    { data: hoteles },
    { data: precios },
    { data: inclusiones },
    { data: tours },
    { data: blackouts },
  ] = await Promise.all([
    sb.from("programas").select("*").eq("id", id).maybeSingle(),
    sb.from("proveedores").select("id, nombre").order("nombre"),
    sb.from("programa_ciudades").select("*").eq("programa_id", id).order("orden"),
    sb.from("programa_dias").select("*").eq("programa_id", id).order("dia"),
    sb.from("programa_categorias").select("*").eq("programa_id", id).order("orden"),
    sb.from("programa_categoria_hoteles").select("*, programa_categorias!inner(programa_id)").eq("programa_categorias.programa_id", id),
    sb.from("programa_precios").select("*, programa_categorias!inner(programa_id)").eq("programa_categorias.programa_id", id),
    sb.from("programa_inclusiones").select("*").eq("programa_id", id).order("orden"),
    sb.from("programa_tours").select("*").eq("programa_id", id).order("orden"),
    sb.from("programa_blackouts").select("*").eq("programa_id", id).order("fecha_inicio"),
  ]);

  if (!programa) notFound();

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto/programas" className="text-sm text-gray-400 hover:text-gray-700">
        ← Programas
      </Link>
      <ProgramaEditor
        programa={programa}
        proveedores={proveedores ?? []}
        ciudades={ciudades ?? []}
        dias={dias ?? []}
        categorias={categorias ?? []}
        hoteles={(hoteles ?? []) as never[]}
        precios={(precios ?? []) as never[]}
        inclusiones={inclusiones ?? []}
        tours={tours ?? []}
        blackouts={blackouts ?? []}
      />
    </div>
  );
}
