import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ServiciosClient } from "./ServiciosClient";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarServiciosMasivo } from "./actions";

export const dynamic = "force-dynamic";

const COLS_SERVICIOS = [
  { key: "nombre", label: "Nombre", ejemplo: "Tour Islas del Rosario" },
  { key: "destino", label: "Destino", ejemplo: "CARTAGENA" },
  { key: "proveedor", label: "Proveedor", ejemplo: "" },
  { key: "tarifa_neta", label: "Tarifa neta", ejemplo: "120000" },
  { key: "temporada", label: "Temporada", ejemplo: "" },
  { key: "liquidacion", label: "Liquidación (dia/noche/paquete)", ejemplo: "paquete" },
];

export default async function ServiciosPage() {
  const sb = await createClient();
  const [{ data: serviciosRaw }, { data: proveedores }, { data: destinos }, { data: rangos }] = await Promise.all([
    sb.from("servicios_adicionales").select("id, nombre, temporada, precio_persona, precio_grupo, proveedor_id, destino_id, rangos_edad, proveedores(nombre), destinos(nombre)").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "servicios").order("nombre"),
    sb.from("destinos").select("id, nombre").order("nombre"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
  ]);
  const servicios = (serviciosRaw ?? []) as unknown as Parameters<typeof ServiciosClient>[0]["servicios"];

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Servicios adicionales</h1>
      <p className="mb-6 text-sm text-gray-500">Asistencias, traslados y tours (costo neto).</p>
      <div className="mb-6">
        <CargaMasivaCSV
          titulo="Carga masiva de servicios (CSV)"
          descripcion="Cada fila = un servicio. Liquidación: dia, noche o paquete. El destino y el proveedor (si los pones) deben existir."
          columnas={COLS_SERVICIOS}
          onSubmit={cargarServiciosMasivo}
          nombreArchivo="plantilla_servicios"
        />
      </div>
      <ServiciosClient servicios={servicios} proveedores={proveedores ?? []} destinos={destinos ?? []} rangos={rangos ?? []} />
    </div>
  );
}
