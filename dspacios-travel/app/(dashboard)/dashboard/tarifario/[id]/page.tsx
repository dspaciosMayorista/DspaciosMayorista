import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HotelesTab } from "./HotelesTab";
import { TemporadasTab } from "./TemporadasTab";
import { ProductoTab } from "./ProductoTab";
import { InclusionesTab } from "./InclusionesTab";

export default async function DestinoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const destinoId = Number(id);
  if (isNaN(destinoId)) notFound();

  const sb = await createClient();

  const [{ data: destino }, { data: hoteles }, { data: temporadas }, { data: planes }, { data: inclusiones }, { data: tarifas }] =
    await Promise.all([
      sb.from("destinos").select("id, nombre, codigo_iata").eq("id", destinoId).single(),
      sb.from("hoteles").select("id, nombre, zona, notas, activo").eq("destino_id", destinoId).order("nombre"),
      sb.from("temporadas").select("id, nombre, anio, temporada_fechas(id, fecha_inicio, fecha_fin)").eq("destino_id", destinoId).order("anio", { ascending: false }),
      sb.from("planes_alimentacion").select("id, codigo, nombre").eq("activo", true).order("codigo"),
      sb.from("inclusiones").select("id, tipo, texto, orden").eq("destino_id", destinoId).order("orden"),
      sb
        .from("tarifas")
        .select(
          `id, noches, comisionable, impuesto_no_comisionable, costo_base, pct_mk, notas,
           hotel_id, plan_id, temporada_id,
           hoteles!inner(nombre, destino_id),
           planes_alimentacion(codigo),
           temporadas(nombre, anio),
           tarifa_precios(acomodacion, precio)`
        )
        .eq("hoteles.destino_id", destinoId)
        .eq("activo", true)
        .order("id", { ascending: false }),
    ]);

  if (!destino) notFound();

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/tarifario" className="text-sm text-gray-400 hover:text-gray-600">
          ← Destinos
        </Link>
        <div className="flex items-baseline gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-gray-900">{destino.nombre}</h1>
          {destino.codigo_iata && (
            <span className="text-sm font-mono text-gray-400">{destino.codigo_iata}</span>
          )}
        </div>
      </div>

      <Tabs defaultValue="hoteles">
        <TabsList className="mb-6">
          <TabsTrigger value="hoteles">Hoteles</TabsTrigger>
          <TabsTrigger value="temporadas">Temporadas</TabsTrigger>
          <TabsTrigger value="producto">Módulo de Producto</TabsTrigger>
          <TabsTrigger value="inclusiones">Incluye / No incluye</TabsTrigger>
        </TabsList>

        <TabsContent value="hoteles">
          <HotelesTab destinoId={destinoId} hoteles={hoteles ?? []} />
        </TabsContent>

        <TabsContent value="temporadas">
          <TemporadasTab destinoId={destinoId} temporadas={(temporadas ?? []) as any} />
        </TabsContent>

        <TabsContent value="producto">
          <ProductoTab
            destinoId={destinoId}
            hoteles={hoteles ?? []}
            temporadas={(temporadas ?? []) as any}
            planes={planes ?? []}
            tarifas={(tarifas ?? []) as any}
          />
        </TabsContent>

        <TabsContent value="inclusiones">
          <InclusionesTab destinoId={destinoId} inclusiones={inclusiones ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
