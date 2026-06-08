import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { HotelDetalleClient } from "./HotelDetalleClient";
import { HotelConfigEditor } from "./HotelConfigEditor";
import { HotelCategoriasRegimenesEditor } from "./HotelCategoriasRegimenesEditor";
import { HotelDocumentos } from "./HotelDocumentos";
import { HotelFotos } from "./HotelFotos";
import { HotelAcomodacionesEditor } from "./HotelAcomodacionesEditor";
import { CalculadoraEditor } from "./CalculadoraEditor";
import type { AcomConfig } from "@/lib/acomodaciones";
import type { DubaiParams, MixtaParams, CalcTipo } from "@/lib/calc/calculadoras";

export const dynamic = "force-dynamic";

export default async function HotelDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotelId = Number(id);
  if (isNaN(hotelId)) notFound();
  const sb = await createClient();

  const [{ data: hotel }, { data: cats }, { data: regs }, { data: temporadas }, { data: tarifas }, { data: rangos }, { data: acoms }, { data: calc }, { data: todasCats }, { data: todosRegs }, { data: documentos }, { data: otrosHoteles }, { data: fotos }] = await Promise.all([
    sb.from("hoteles").select("*, destinos(nombre), proveedores(nombre, politica_reservas)").eq("id", hotelId).single(),
    sb.from("hotel_categorias").select("categoria_id, categorias_habitacion(nombre)").eq("hotel_id", hotelId),
    sb.from("hotel_regimenes").select("plan_id, planes_alimentacion(codigo)").eq("hotel_id", hotelId),
    sb.from("hotel_temporadas").select("id, nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts").eq("hotel_id", hotelId).order("prioridad", { ascending: false }).order("orden"),
    sb.from("tarifa_hotel").select("*").eq("hotel_id", hotelId).order("id", { ascending: false }),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
    sb.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").eq("hotel_id", hotelId),
    sb.from("hotel_calculadora").select("tipo, params").eq("hotel_id", hotelId).maybeSingle(),
    sb.from("categorias_habitacion").select("id, nombre").order("nombre"),
    sb.from("planes_alimentacion").select("id, codigo").order("codigo"),
    sb.from("hotel_documentos").select("id, tipo, nombre, path, size_bytes, subido_por, created_at").eq("hotel_id", hotelId).order("created_at", { ascending: false }),
    sb.from("hoteles").select("id, nombre").neq("id", hotelId).order("nombre"),
    sb.from("hotel_fotos").select("id, path, url, orden, es_portada").eq("hotel_id", hotelId).order("orden"),
  ]);

  if (!hotel) notFound();

  const h = hotel as unknown as {
    nombre: string; zona: string | null; edad_infante_min: number; edad_infante_max: number;
    edad_nino_min: number; edad_nino_max: number; rangos_edad: number[] | null;
    pax_min: number | null; pax_max: number | null;
    contacto_telefono: string | null; email_comercial: string | null;
    destinos: { nombre: string } | null;
    proveedores: { nombre: string; politica_reservas: string | null } | null;
  };
  const acomConfigs = (acoms ?? []) as AcomConfig[];
  const catsRows = (cats ?? []) as unknown as { categoria_id: number; categorias_habitacion: { nombre: string } | null }[];
  const regsRows = (regs ?? []) as unknown as { plan_id: number; planes_alimentacion: { codigo: string } | null }[];
  const categorias = catsRows.map((x) => x.categorias_habitacion?.nombre).filter((x): x is string => !!x);
  const regimenes = regsRows.map((x) => x.planes_alimentacion?.codigo).filter((x): x is string => !!x);
  const categoriaIds = catsRows.map((x) => x.categoria_id);
  const regimenIds = regsRows.map((x) => x.plan_id);
  const temporadasNombres = (temporadas ?? []).map((t) => t.nombre).filter((x): x is string => !!x);
  const calcTipo = (calc?.tipo ?? null) as CalcTipo | null;
  const dubaiInicial = calc?.tipo === "dubai" ? (calc.params as unknown as DubaiParams) : null;
  const mixtaInicial = calc?.tipo === "mixta" ? (calc.params as unknown as MixtaParams) : null;

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
      {h.proveedores?.politica_reservas && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="mb-0.5 text-xs font-medium text-gray-500">Política de reservas del proveedor <span className="font-normal text-gray-400">(interno)</span></p>
          <p className="whitespace-pre-wrap text-gray-700">{h.proveedores.politica_reservas}</p>
        </div>
      )}

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
        <HotelCategoriasRegimenesEditor
          hotelId={hotelId}
          todasCategorias={todasCats ?? []}
          todosRegimenes={todosRegs ?? []}
          categoriaIds={categoriaIds}
          regimenIds={regimenIds}
        />
        <HotelFotos hotelId={hotelId} fotos={fotos ?? []} />
        <HotelDocumentos hotelId={hotelId} documentos={documentos ?? []} />
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
          tipoInicial={calcTipo}
          dubaiInicial={dubaiInicial}
          mixtaInicial={mixtaInicial}
        />
        <HotelDetalleClient
          hotelId={hotelId}
          categorias={categorias}
          regimenes={regimenes}
          temporadas={temporadas ?? []}
          tarifas={(tarifas ?? []) as never}
          otrosHoteles={otrosHoteles ?? []}
        />
      </div>
    </div>
  );
}
