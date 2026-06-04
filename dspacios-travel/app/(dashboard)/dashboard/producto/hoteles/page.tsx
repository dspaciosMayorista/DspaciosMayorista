import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EliminarHotelBtn } from "./EliminarHotelBtn";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarHotelesMasivo, cargarTarifasMasivo, cargarTemporadasMasivo, cargarAcomodacionesMasivo } from "./actions";

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
  { key: "categorias", label: "Categorías (separadas por |)", ejemplo: "Estándar|Superior" },
  { key: "regimenes", label: "Regímenes (códigos separados por |)", ejemplo: "PC|FULL" },
  { key: "rangos_edad", label: "Rangos de edad (nombres separados por |)", ejemplo: "" },
  { key: "pax_min", label: "Pax mín del hotel", ejemplo: "1" },
  { key: "pax_max", label: "Pax máx del hotel", ejemplo: "4" },
  { key: "contacto_telefono", label: "Teléfono de contacto (reservas)", ejemplo: "+57 3001234567" },
  { key: "email_comercial", label: "Correo comercial (solicitudes)", ejemplo: "reservas@hotel.com" },
];

const COLS_ACOMODACIONES = [
  { key: "hotel", label: "Hotel", ejemplo: "Hotel Dorado Plaza" },
  { key: "destino", label: "Destino (si hay hoteles repetidos)", ejemplo: "CARTAGENA" },
  { key: "acomodacion", label: "Acomodación (sencilla/doble/triple/multiple)", ejemplo: "doble" },
  { key: "pax_tarifa", label: "Pax tarifa (multiplicador de 1 hab)", ejemplo: "2" },
  { key: "pax_max", label: "Pax máx por habitación", ejemplo: "4" },
  { key: "adt_min", label: "Adultos mín", ejemplo: "2" },
  { key: "adt_max", label: "Adultos máx", ejemplo: "2" },
  { key: "chd_min", label: "Niños mín", ejemplo: "0" },
  { key: "chd_max", label: "Niños máx", ejemplo: "2" },
  { key: "inf_min", label: "Infantes mín", ejemplo: "0" },
  { key: "inf_max", label: "Infantes máx", ejemplo: "2" },
];

const COLS_TEMPORADAS = [
  { key: "hotel", label: "Hotel", ejemplo: "Hotel Dorado Plaza" },
  { key: "destino", label: "Destino (si hay hoteles repetidos)", ejemplo: "CARTAGENA" },
  { key: "temporada", label: "Temporada (nombre)", ejemplo: "Baja" },
  { key: "fecha_inicio", label: "Fecha inicio (AAAA-MM-DD)", ejemplo: "2026-02-01" },
  { key: "fecha_fin", label: "Fecha fin (AAAA-MM-DD)", ejemplo: "2026-05-31" },
];

const COLS_TARIFAS = [
  { key: "hotel", label: "Hotel", ejemplo: "Hotel Dorado Plaza" },
  { key: "destino", label: "Destino (si hay hoteles repetidos)", ejemplo: "CARTAGENA" },
  { key: "categoria", label: "Categoría", ejemplo: "Estándar" },
  { key: "regimen", label: "Régimen", ejemplo: "FULL" },
  { key: "temporada", label: "Temporada (debe existir con sus fechas)", ejemplo: "Baja" },
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
          nota="Crea primero los Destinos (Producto → Destinos) y, si los asignarás, los Proveedores hoteleros (Producto → Proveedores). Las Categorías de habitación y los Regímenes se crean en Producto → Configuración. Los Rangos de edad en Configuración (menú lateral)."
          descripcion="Cada fila = un hotel. El destino debe existir. Categorías y regímenes deben existir en Configuración general (varios se separan con | , ej. Estándar|Superior)."
          columnas={COLS_HOTELES}
          onSubmit={cargarHotelesMasivo}
          nombreArchivo="plantilla_hoteles"
        />
        <CargaMasivaCSV
          titulo="Carga masiva de acomodaciones por hotel (CSV)"
          nota="El hotel ya debe existir (créalo en el cargue de arriba o en Producto → Hoteles → Nuevo hotel)."
          descripcion="Config de 'reservar por habitaciones': una fila por acomodación (sencilla/doble/triple/multiple). pax_tarifa = cuántos pax cubre la tarifa de 1 habitación. El hotel debe existir. Si no la cargas, se usan valores por defecto (1/2/3/4)."
          columnas={COLS_ACOMODACIONES}
          onSubmit={cargarAcomodacionesMasivo}
          nombreArchivo="plantilla_acomodaciones_hotel"
        />
        <CargaMasivaCSV
          titulo="Carga masiva de temporadas de hotel (CSV)"
          nota="El hotel ya debe existir (Producto → Hoteles). Carga las temporadas ANTES que las tarifas."
          descripcion="Cada fila = una temporada con su rango de fechas (las que luego usan las tarifas). Cárgala ANTES que las tarifas. Las fechas de un mismo hotel no se pueden cruzar."
          columnas={COLS_TEMPORADAS}
          onSubmit={cargarTemporadasMasivo}
          nombreArchivo="plantilla_temporadas_hotel"
        />
        <CargaMasivaCSV
          titulo="Carga masiva de tarifas de hotel (CSV)"
          nota="Ya deben existir: el hotel, sus Categorías y Regímenes (Producto → Configuración) y las Temporadas con fechas (cargue de arriba). La tarifa referencia la temporada por su nombre."
          descripcion="Cada fila = una tarifa (hotel + categoría + régimen + temporada + netos). El hotel y la temporada (con sus fechas) deben existir; usa 'destino' si hay hoteles con el mismo nombre. Niño 1 puede ir en 0 (gratis)."
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
