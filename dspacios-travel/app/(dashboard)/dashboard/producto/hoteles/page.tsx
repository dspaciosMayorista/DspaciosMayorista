import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EliminarHotelBtn } from "./EliminarHotelBtn";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarHotelesMasivo, cargarTarifasMasivo } from "./actions";

export const dynamic = "force-dynamic";

const COLS_HOTELES = [
  { key: "nombre", label: "Nombre", ejemplo: "Hotel Dorado Plaza" },
  { key: "destino", label: "Destino", ejemplo: "CARTAGENA" },
  { key: "zona", label: "Zona", ejemplo: "Bocagrande" },
  { key: "proveedor", label: "Proveedor", ejemplo: "" },
  { key: "edad_infante_min", label: "Edad infante mín", ejemplo: "0" },
  { key: "edad_infante_max", label: "Edad infante máx", ejemplo: "2" },
  { key: "edad_nino_min", label: "Edad niño mín", ejemplo: "2" },
  { key: "edad_nino_max", label: "Edad niño máx", ejemplo: "10" },
  { key: "categorias", label: "Categorías (separadas por ;)", ejemplo: "Estándar;Superior" },
  { key: "regimenes", label: "Regímenes (códigos separados por ;)", ejemplo: "PC;FULL" },
];

const COLS_TARIFAS = [
  { key: "hotel", label: "Hotel", ejemplo: "Hotel Dorado Plaza" },
  { key: "destino", label: "Destino (si hay hoteles repetidos)", ejemplo: "CARTAGENA" },
  { key: "categoria", label: "Categoría", ejemplo: "Estándar" },
  { key: "regimen", label: "Régimen", ejemplo: "FULL" },
  { key: "temporada", label: "Temporada", ejemplo: "Baja" },
  { key: "neto_sencilla", label: "Neto sencilla", ejemplo: "600000" },
  { key: "neto_doble", label: "Neto doble", ejemplo: "300000" },
  { key: "neto_triple", label: "Neto triple", ejemplo: "300000" },
  { key: "neto_multiple", label: "Neto múltiple", ejemplo: "300000" },
  { key: "neto_nino", label: "Neto niño 1", ejemplo: "150000" },
  { key: "neto_nino2", label: "Neto niño 2", ejemplo: "" },
];

export default async function HotelesPage() {
  const sb = await createClient();
  const { data: hotelesRaw } = await sb
    .from("hoteles")
    .select("id, nombre, zona, destinos(nombre), proveedores(nombre)")
    .order("nombre");

  type Item = { id: number; nombre: string; zona: string | null; destinos: { nombre: string } | null; proveedores: { nombre: string } | null };
  const hoteles = (hotelesRaw ?? []) as unknown as Item[];

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <div className="mt-2 mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Hoteles y tarifas</h1>
          <p className="mt-1 text-sm text-gray-500">Hoteles negociados con sus temporadas y tarifa neta.</p>
        </div>
        <Link href="/dashboard/producto/hoteles/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo hotel</Button>
        </Link>
      </div>

      <div className="mb-4 space-y-3">
        <CargaMasivaCSV
          titulo="Carga masiva de hoteles (CSV)"
          descripcion="Cada fila = un hotel. El destino debe existir. Categorías y regímenes deben existir en Configuración general (sepáralos con ;)."
          columnas={COLS_HOTELES}
          onSubmit={cargarHotelesMasivo}
          nombreArchivo="plantilla_hoteles"
        />
        <CargaMasivaCSV
          titulo="Carga masiva de tarifas de hotel (CSV)"
          descripcion="Cada fila = una tarifa (hotel + categoría + régimen + temporada + netos). El hotel debe existir; usa 'destino' si hay hoteles con el mismo nombre. Niño 1 puede ir en 0 (gratis)."
          columnas={COLS_TARIFAS}
          onSubmit={cargarTarifasMasivo}
          nombreArchivo="plantilla_tarifas_hotel"
        />
      </div>

      {!hoteles.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay hoteles cargados</p>
          <p className="mt-1 text-sm">Crea el primero con “Nuevo hotel”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hoteles.map((h) => (
            <div key={h.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/dashboard/producto/hoteles/${h.id}`} className="font-semibold text-gray-900 hover:text-[#1D7C9A]">
                  {h.nombre}
                </Link>
                <EliminarHotelBtn id={h.id} nombre={h.nombre} />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {h.destinos?.nombre ?? "—"}{h.zona ? ` · ${h.zona}` : ""}
              </p>
              <p className="text-xs text-gray-400">{h.proveedores?.nombre ?? "Sin proveedor"}</p>
              <Link href={`/dashboard/producto/hoteles/${h.id}`} className="mt-2 inline-block text-xs font-medium text-[#26BBD9]">
                Gestionar tarifas →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
