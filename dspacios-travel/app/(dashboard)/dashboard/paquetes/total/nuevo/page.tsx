import Link from "next/link";
import { PaqueteTotalForm, ENTRADA_VACIA } from "../PaqueteTotalForm";
import { cargarCatalogos } from "../catalogos";

export const dynamic = "force-dynamic";

export default async function NuevoPaqueteTotalPage() {
  const cat = await cargarCatalogos();
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Volver a paquetes</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>Nuevo paquete dinámico total</h1>
      <p className="mb-4 text-sm text-gray-500">Producto reutilizable armado con vuelo, hotel y servicios propios. No es el tipo «dinámico» con vuelo de sistema ni una cotización manual.</p>
      <PaqueteTotalForm inicial={ENTRADA_VACIA} {...cat} />
    </div>
  );
}
