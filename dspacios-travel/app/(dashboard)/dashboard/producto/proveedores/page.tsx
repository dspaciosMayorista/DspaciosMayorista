import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ProveedoresClient } from "./ProveedoresClient";

export const dynamic = "force-dynamic";

export default async function ProveedoresPage() {
  const sb = await createClient();
  const { data: proveedores } = await sb
    .from("proveedores")
    .select("id, tipo, nombre, razon_social, nit, ciudad, contacto, datos_pago, aplica_retencion, pct_retencion")
    .order("tipo")
    .order("nombre");

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Proveedores</h1>
      <p className="mb-6 text-sm text-gray-500">Hoteleros, aéreos y de servicios adicionales.</p>
      <ProveedoresClient proveedores={proveedores ?? []} />
    </div>
  );
}
