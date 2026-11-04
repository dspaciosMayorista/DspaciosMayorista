import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PaqueteTotalForm } from "../PaqueteTotalForm";
import { cargarCatalogos } from "../catalogos";
import type { EntradaPaqueteTotal } from "@/lib/paqueteDinamico/entrada";

export const dynamic = "force-dynamic";

type Fila = Record<string, unknown>;

export default async function EditarPaqueteTotalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) notFound();
  // Tablas nuevas (274) sin tipos generados.
  const sb = (await createClient()) as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: number) => { order: (k: string) => Promise<{ data: Fila[] | null }>; maybeSingle: () => Promise<{ data: Fila | null }> } } } };
  const { data: p } = await sb.from("paquete_din").select("*").eq("id", pid).maybeSingle();
  if (!p) notFound();
  const [v, h, s, cat] = await Promise.all([
    sb.from("paquete_din_vuelos").select("*").eq("paquete_id", pid).order("orden"),
    sb.from("paquete_din_hoteles").select("*").eq("paquete_id", pid).order("orden"),
    sb.from("paquete_din_servicios").select("*").eq("paquete_id", pid).order("orden"),
    cargarCatalogos(),
  ]);
  const str = (x: unknown) => (x == null ? "" : String(x));
  const inicial: EntradaPaqueteTotal = {
    id: pid, nombre: str(p.nombre), destinoId: (p.destino_id as number | null) ?? null, multidestino: p.multidestino === true, destinosExtra: (p.destinos_extra as number[]) ?? [],
    moneda: p.moneda === "USD" ? "USD" : "COP", esquema: p.esquema === "solo_pvp" ? "solo_pvp" : "neta_markup", pvpModo: (p.pvp_modo as "general" | "por_componente" | null) ?? null,
    pctMkPct: Math.round(Number(p.pct_mk) * 100 * 1e4) / 1e4, usaVuelo: p.usa_vuelo === true, usaHotel: p.usa_hotel === true, usaServicios: p.usa_servicios === true,
    noches: Number(p.noches) || 3, compraInicio: str(p.compra_inicio), compraFin: str(p.compra_fin), viajeInicio: str(p.viaje_inicio), viajeFin: str(p.viaje_fin),
    pvpGeneral: (p.pvp_general as EntradaPaqueteTotal["pvpGeneral"]) ?? null, totalDeclarado: (p.total_declarado as EntradaPaqueteTotal["totalDeclarado"]) ?? null,
    descripcion: str(p.descripcion), incluye: str(p.incluye), noIncluye: str(p.no_incluye),
    vuelos: (v.data ?? []).map((x) => ({ empaquetadoId: (x.empaquetado_id as number | null) ?? null, destinoId: (x.destino_id as number | null) ?? null, aerolinea: str(x.aerolinea), ruta: str(x.ruta), origenIata: str(x.origen_iata), destinoIata: str(x.destino_iata), fechaIda: str(x.fecha_ida), fechaRegreso: str(x.fecha_regreso), proveedor: str(x.proveedor), neto: (x.neto as object) ?? {}, pvp: (x.pvp as object) ?? {} })),
    hoteles: (h.data ?? []).map((x) => ({ hotelId: (x.hotel_id as number | null) ?? null, nombre: str(x.nombre), categoria: str(x.categoria), regimen: str(x.regimen), descripcion: str(x.descripcion), fotoUrl: str(x.foto_url), proveedor: str(x.proveedor), neto: (x.neto as object) ?? {}, pvp: (x.pvp as object) ?? {}, pvpGeneral: (x.pvp_general as object | null) ?? null, capacidadNinos: x.capacidad_ninos == null ? null : Number(x.capacidad_ninos), edadInfanteMax: x.edad_infante_max == null ? null : Number(x.edad_infante_max), edadNinoMax: x.edad_nino_max == null ? null : Number(x.edad_nino_max) })),
    servicios: (s.data ?? []).map((x) => ({ servicioId: (x.servicio_id as number | null) ?? null, destinoId: (x.destino_id as number | null) ?? null, nombre: str(x.nombre), proveedor: str(x.proveedor), proveedorId: (x.proveedor_id as number | null) ?? null, neto: x.neto == null ? null : Number(x.neto), pvp: x.pvp == null ? null : Number(x.pvp), pvpInfante: x.pvp_infante == null ? null : Number(x.pvp_infante) })),
  };
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Volver a paquetes</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>{inicial.nombre || "Paquete dinámico total"}</h1>
      <PaqueteTotalForm inicial={inicial} {...cat} />
    </div>
  );
}
