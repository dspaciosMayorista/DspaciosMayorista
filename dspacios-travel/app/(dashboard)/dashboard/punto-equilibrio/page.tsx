import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SMMLV, SUBSIDIO_TRANSPORTE } from "@/lib/constants";
import { formatCOP } from "@/lib/utils";
import { PuntoEquilibrioClient } from "./PuntoEquilibrioClient";

export const dynamic = "force-dynamic";

export default async function PuntoEquilibrioPage() {
  // Margen de contribución promedio (de Rentabilidad): ponderado por ventas.
  const sb = await createClient();
  const { data: ventas } = await sb
    .from("ventas")
    .select("precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos");
  let totPrecio = 0, totCosto = 0;
  for (const v of ventas ?? []) {
    const precio = Number(v.precio_venta) || 0;
    const costo = (Number(v.costo_hotel) || 0) + (Number(v.costo_aereo) || 0) + (Number(v.costo_receptivo) || 0) + (Number(v.costo_asistencia) || 0) + (Number(v.otros_costos) || 0);
    totPrecio += precio; totCosto += costo;
  }
  const margenAuto = totPrecio > 0 ? Math.round(((totPrecio - totCosto) / totPrecio) * 1000) / 10 : 30;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/rentabilidad" className="text-sm text-gray-400 hover:text-gray-700">← Finanzas</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Punto de equilibrio</h1>
      <p className="mb-6 text-sm text-gray-500">
        Cuánto debes vender al mes para cubrir costos y gastos. Liquidación de nómina a normatividad <b>2026</b>
        (SMMLV {formatCOP(SMMLV)} · auxilio transporte {formatCOP(SUBSIDIO_TRANSPORTE)}).
      </p>
      <PuntoEquilibrioClient margenAuto={margenAuto} />
    </div>
  );
}
