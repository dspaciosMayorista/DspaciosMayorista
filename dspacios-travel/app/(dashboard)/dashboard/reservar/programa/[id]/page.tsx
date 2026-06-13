import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProgramaDetalle } from "@/lib/programas";
import { ProgramaReservaForm, type CategoriaReserva } from "./ProgramaReservaForm";

export const dynamic = "force-dynamic";

export default async function ReservarProgramaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const sb = await createClient();
  const det = await getProgramaDetalle(sb, id);
  if (!det) notFound();

  const { data: asesoresRows } = await sb.from("asesores").select("nombre, email").order("nombre");
  const asesores = (asesoresRows ?? [])
    .filter((a): a is { nombre: string; email: string } => !!a.email)
    .map((a) => ({ nombre: a.nombre, email: a.email }));

  const modoSalida = det.programa.modo_precio === "salida";
  const categorias: CategoriaReserva[] = modoSalida
    ? det.salidas.map((s) => ({
        id: s.id,
        nombre: [s.etiqueta ?? s.fecha_desde ?? "Salida", s.columna, s.noches != null ? `${s.noches}N` : null]
          .filter(Boolean)
          .join(" · "),
        precios: s.precios.map((p) => ({ acomodacion: p.acomodacion, pvp: p.pvp, bajoSolicitud: s.bajo_solicitud })),
        noches: s.noches,
        fechaSugerida: s.fecha_desde,
      }))
    : det.categorias.map((c, i) => ({
        id: c.id,
        nombre: c.nombre ?? `Categoría ${i + 1}`,
        precios: c.precios.map((p) => ({ acomodacion: p.acomodacion, pvp: p.pvp, bajoSolicitud: p.bajo_solicitud })),
      }));

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href={`/tarifario/programa/${id}`} className="text-sm text-gray-400 hover:text-gray-700">
        ← Ver programa
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Reservar · {det.programa.nombre}</h1>
      <p className="mb-6 text-sm text-gray-500">
        {det.programa.subtitulo ?? ""}
        {det.programa.dias ? ` · ${det.programa.dias} días / ${det.programa.noches ?? ""} noches` : ""} · {det.programa.moneda}
      </p>

      {!categorias.length ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Este programa aún no tiene {modoSalida ? "salidas" : "categorías"}/precios cargados.
        </p>
      ) : (
        <ProgramaReservaForm
          programaId={id}
          moneda={det.programa.moneda}
          dias={det.programa.dias}
          vigenciaDesde={det.programa.vigencia_desde}
          vigenciaHasta={det.programa.vigencia_hasta}
          categorias={categorias}
          asesores={asesores}
          modoSalida={modoSalida}
        />
      )}
    </div>
  );
}
