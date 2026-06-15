import Link from "next/link";
import { SMMLV, SUBSIDIO_TRANSPORTE } from "@/lib/constants";
import { formatCOP } from "@/lib/utils";
import { PuntoEquilibrioClient } from "./PuntoEquilibrioClient";

export const dynamic = "force-dynamic";

export default function PuntoEquilibrioPage() {
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/rentabilidad" className="text-sm text-gray-400 hover:text-gray-700">← Finanzas</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Punto de equilibrio</h1>
      <p className="mb-6 text-sm text-gray-500">
        Cuánto debes vender al mes para cubrir costos y gastos. Liquidación de nómina a normatividad <b>2026</b>
        (SMMLV {formatCOP(SMMLV)} · auxilio transporte {formatCOP(SUBSIDIO_TRANSPORTE)}).
      </p>
      <PuntoEquilibrioClient />
    </div>
  );
}
