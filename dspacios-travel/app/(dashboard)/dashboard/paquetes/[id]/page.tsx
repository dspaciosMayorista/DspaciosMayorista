import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArmadoClient } from "./ArmadoClient";

export const dynamic = "force-dynamic";

export default async function PaqueteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paqueteId = Number(id);
  const sb = await createClient();

  const { data: pq } = await sb
    .from("armado_paquetes")
    .select("*, destinos(nombre)")
    .eq("id", paqueteId)
    .single();
  if (!pq) notFound();

  const destinoId = pq.destino_id;
  const viajeIni = pq.fecha_viaje_inicio;
  const viajeFin = pq.fecha_viaje_fin;

  // Disponibles (filtrados por destino + rango de viaje)
  let qVuelos = sb
    .from("bloqueos_vuelo")
    .select("id, record, ruta, aerolinea, fecha_ida, fecha_regreso, tarifa_para_empaquetar, destino_id")
    .order("fecha_ida");
  if (destinoId) qVuelos = qVuelos.or(`destino_id.eq.${destinoId},destino_id.is.null`);
  if (viajeIni) qVuelos = qVuelos.gte("fecha_ida", viajeIni);
  if (viajeFin) qVuelos = qVuelos.lte("fecha_ida", viajeFin);

  let qHoteles = sb.from("hoteles").select("id, nombre, zona, destino_id").eq("activo", true).order("nombre");
  if (destinoId) qHoteles = qHoteles.eq("destino_id", destinoId);

  let qServicios = sb
    .from("servicios_adicionales")
    .select("id, nombre, tarifa_neta, liquidacion, destino_id")
    .eq("activo", true)
    .order("nombre");
  if (destinoId) qServicios = qServicios.or(`destino_id.eq.${destinoId},destino_id.is.null`);

  const [
    { data: destinos },
    { data: vuelosDisp },
    { data: hotelesDisp },
    { data: serviciosDisp },
    { data: selVuelos },
    { data: selHoteles },
    { data: selServicios },
  ] = await Promise.all([
    sb.from("destinos").select("id, nombre").order("nombre"),
    qVuelos,
    qHoteles,
    qServicios,
    sb.from("armado_vuelos").select("bloqueo_id, aplica_mk, ta").eq("paquete_id", paqueteId),
    sb.from("armado_hoteles").select("hotel_id, categorias, regimenes").eq("paquete_id", paqueteId),
    sb.from("armado_servicios").select("servicio_id").eq("paquete_id", paqueteId),
  ]);

  // El resultado puede superar el tope de 1000 filas de PostgREST; paginamos.
  const resultado: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("tarifario_resultado")
      .select("*")
      .eq("paquete_id", paqueteId)
      .order("bloqueo_id")
      .order("hotel_nombre")
      .order("categoria")
      .order("regimen")
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    resultado.push(...page);
    if (page.length < PAGE) break;
  }

  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Paquetes</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{pq.nombre}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {destinoNombre ?? "Sin destino"} · mk {Math.round((pq.pct_mk ?? 0) * 100)}% ·{" "}
            {pq.activo ? "Activo" : "Inactivo"}
          </p>
        </div>
      </div>

      <ArmadoClient
        paqueteId={paqueteId}
        destinos={destinos ?? []}
        config={{
          nombre: pq.nombre,
          activo: pq.activo,
          destinoId: pq.destino_id,
          fechaCompraInicio: pq.fecha_compra_inicio ?? "",
          fechaCompraFin: pq.fecha_compra_fin ?? "",
          fechaViajeInicio: pq.fecha_viaje_inicio ?? "",
          fechaViajeFin: pq.fecha_viaje_fin ?? "",
          pctMk: Math.round((pq.pct_mk ?? 0) * 100),
          impuestoTipo: pq.impuesto_tipo,
          impuestoFijo: pq.impuesto_fijo,
          notas: pq.notas ?? "",
        }}
        tieneDestino={!!destinoId}
        vuelosDisp={vuelosDisp ?? []}
        hotelesDisp={hotelesDisp ?? []}
        serviciosDisp={serviciosDisp ?? []}
        selVuelos={selVuelos ?? []}
        selHoteles={selHoteles ?? []}
        selServicios={(selServicios ?? []).map((s) => s.servicio_id)}
        resultado={resultado as unknown as Parameters<typeof ArmadoClient>[0]["resultado"]}
      />
    </div>
  );
}
