import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ProveedoresClient } from "./ProveedoresClient";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarProveedoresMasivo } from "./actions";

export const dynamic = "force-dynamic";

const COLS_PROVEEDORES = [
  { key: "tipo", label: "Tipo (hotelero/aereo/servicios)", ejemplo: "hotelero" },
  { key: "nombre", label: "Nombre comercial", ejemplo: "GHL Hoteles" },
  { key: "razon_social", label: "Razón social", ejemplo: "GHL S.A.S." },
  { key: "nit", label: "NIT", ejemplo: "900123456-7" },
  { key: "ciudad", label: "Ciudad", ejemplo: "Bogotá" },
  { key: "contacto", label: "Contacto", ejemplo: "Juan Pérez - 3001234567" },
  { key: "datos_pago", label: "Datos de pago (banco, cuenta…)", ejemplo: "" },
  { key: "politica_reservas", label: "Política de reservas (uso interno)", ejemplo: "50% anticipo · cancela sin costo 15 días antes" },
  { key: "aplica_retencion", label: "Aplica retención (si/no)", ejemplo: "no" },
  { key: "pct_retencion", label: "% retención", ejemplo: "0" },
];

export default async function ProveedoresPage() {
  const sb = await createClient();
  const { data: proveedores } = await sb
    .from("proveedores")
    .select("id, tipo, nombre, razon_social, nit, ciudad, contacto, datos_pago, politica_reservas, aplica_retencion, pct_retencion")
    .order("tipo")
    .order("nombre");

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Proveedores</h1>
      <p className="mb-6 text-sm text-gray-500">Hoteleros, aéreos y de servicios adicionales.</p>

      <div className="mb-6">
        <CargaMasivaCSV
          titulo="Carga masiva de proveedores (CSV)"
          descripcion="Cada fila = un proveedor. Tipo: hotelero, aereo o servicios. 'Aplica retención' acepta si/no; el % se escribe como número (ej. 3.5)."
          nota="Este cargue no requiere configurar nada antes. Los proveedores son la base para hoteles, vuelos y servicios — cárgalos primero."
          columnas={COLS_PROVEEDORES}
          onSubmit={cargarProveedoresMasivo}
          nombreArchivo="plantilla_proveedores"
        />
      </div>

      <ProveedoresClient proveedores={proveedores ?? []} />
    </div>
  );
}
