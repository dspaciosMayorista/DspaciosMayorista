import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { HotelDetalleClient } from "./HotelDetalleClient";
import { HotelConfigEditor } from "./HotelConfigEditor";
import { HotelAcomodacionesEditor } from "./HotelAcomodacionesEditor";
import { CalculadoraEditor } from "./CalculadoraEditor";
import type { AcomConfig } from "@/lib/acomodaciones";
import type { DubaiParams } from "@/lib/calc/calculadoras";

export const dynamic = "force-dynamic";

export default async function HotelDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotelId = Number(id);
  if (isNaN(hotelId)) notFound();
  const sb = await createClient();

  const [{ data: hotel }, { data: cats }, { data: regs }, { data: temporadas }, { data: tarifas }, { data: rangos }, { data: acoms }, { data: calc }] = await Promise.all([
    sb.from("hoteles").select("*, destinos(nombre), proveedores(nombre)").eq("id", hotelId).single(),
    sb.from("hotel_categorias").select("categorias_habitacion(nombre)").eq("hotel_id", hotelId),
    sb.from("hotel_regimenes").select("planes_alimentacion(codigo)").eq("hotel_id", hotelId),
    sb.from("hotel_temporadas").select("id, nombre, fecha_inicio, fecha_fin").eq("hotel_id", hotelId).order("orden"),
    sb.from("tarifa_hotel").select("*").eq("hotel_id", hotelId).order("id", { ascending: false }),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
    sb.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").eq("hotel_id", hotelId),
    sb.from("hotel_calculadora").select("tipo, params").eq("hotel_id", hotelId).maybeSingle(),
  ]);

  if (!hotel) notFound();

  const h = hotel as unknown as {
    nombre: string; zona: string | null; edad_infante_min: number; edad_infante_max: number;
    edad_nino_min: number; edad_nino_max: number; rangos_edad: number[] | null;
    pax_min: number | null; pax_max: number | null;
    contacto_telefono: string | null; email_comercial: string | null;
    destinos: { nombre: string } | null; proveedores: { nombre: string } | null;
  };
  const acomConfigs = (acoms ?? []) as AcomConfig[];
  const categorias = ((cats ?? []) as unknown as { categorias_habitacion: { nombre: string } | null }[])
    .map((x) => x.categorias_habitacion?.nombre).filter((x): x is string => !!x);
  const regimenes = ((regs ?? []) as unknown as { planes_alimentacion: { codigo: string } | null }[])
    .map((x) => x.planes_alimentacion?.codigo).filter((x): x is string => !!x);
  const temporadasNombres = (temporadas ?? []).map((t) => t.nombre).filter((x): x is string => !!x);
  const calcParams = (calc?.params ?? null) as DubaiParams | null;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto/hoteles" className="text-sm text-gray-400 hover:text-gray-600">← Hoteles</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">{h.nombre}</h1>
      <p className="text-sm text-gray-500">
        {h.destinos?.nombre ?? "—"}{h.zona ? ` · ${h.zona}` : ""} · {h.proveedores?.nombre ?? "Sin proveedor"}
      </p>
      <p className="mt-1 text-xs text-gray-400">
        Infante {h.edad_infante_min}–{h.edad_infante_max} años · Niño {h.edad_nino_min}–{h.edad_nino_max} años
        {categorias.length > 0 && <> · Categorías: {categorias.join(", ")}</>}
        {regimenes.length > 0 && <> · Régimen: {regimenes.join(", ")}</>}
      </p>

      <div className="mt-6">
        <HotelConfigEditor
          hotelId={hotelId}
          rangos={rangos ?? []}
          inicial={{
            zona: h.zona ?? "",
            edadInfanteMin: h.edad_infante_min, edadInfanteMax: h.edad_infante_max,
            edadNinoMin: h.edad_nino_min, edadNinoMax: h.edad_nino_max,
            rangosEdad: h.rangos_edad ?? [],
            contactoTelefono: h.contacto_telefono ?? "",
            emailComercial: h.email_comercial ?? "",
          }}
        />
        <HotelAcomodacionesEditor
          hotelId={hotelId}
          paxMin={h.pax_min}
          paxMax={h.pax_max}
          configs={acomConfigs}
        />
        <CalculadoraEditor
          hotelId={hotelId}
          categorias={categorias}
          temporadas={temporadasNombres}
          regimenes={regimenes}
          inicial={calcParams}
        />
        <HotelDetalleClient
          hotelId={hotelId}
          categorias={categorias}
          regimenes={regimenes}
          temporadas={temporadas ?? []}
          tarifas={(tarifas ?? []) as never}
        />
      </div>
    </div>
  );
}
