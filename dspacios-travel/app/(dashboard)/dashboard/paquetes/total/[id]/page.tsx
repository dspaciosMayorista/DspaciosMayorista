import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PaqueteTotalForm } from "../PaqueteTotalForm";
import { cargarCatalogos } from "../catalogos";
import { entradaDesdeFilas, lecturaFuenteConError } from "@/lib/paqueteDinamico/entradaDesdeFilas";

export const dynamic = "force-dynamic";

type Fila = Record<string, unknown>;

export default async function EditarPaqueteTotalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) notFound();
  // Tablas nuevas (274) sin tipos generados.
  const sb = (await createClient()) as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: number) => { order: (k: string) => Promise<{ data: Fila[] | null; error: unknown }>; maybeSingle: () => Promise<{ data: Fila | null; error: unknown }> } } } };
  const cab = await sb.from("paquete_din").select("*").eq("id", pid).maybeSingle();
  if (lecturaFuenteConError(cab)) throw new Error("No se pudo leer el paquete."); // B95-5: un error de lectura no es «no existe»
  const p = cab.data;
  if (!p) notFound();
  const [v, h, s, cat] = await Promise.all([
    sb.from("paquete_din_vuelos").select("*").eq("paquete_id", pid).order("orden"),
    sb.from("paquete_din_hoteles").select("*").eq("paquete_id", pid).order("orden"),
    sb.from("paquete_din_servicios").select("*").eq("paquete_id", pid).order("orden"),
    cargarCatalogos(),
  ]);
  // Editar un paquete leído a medias y guardarlo reescribiría sus hijos incompletos: ante cualquier error de lectura no se muestra el editor.
  if (lecturaFuenteConError(v, h, s)) throw new Error("No se pudo leer completo el paquete (vuelos, hoteles o servicios).");
  const inicial = entradaDesdeFilas(p, v.data ?? [], h.data ?? [], s.data ?? [], pid);
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Volver a paquetes</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>{inicial.nombre || "Paquete dinámico total"}</h1>
      <PaqueteTotalForm inicial={inicial} {...cat} />
    </div>
  );
}
