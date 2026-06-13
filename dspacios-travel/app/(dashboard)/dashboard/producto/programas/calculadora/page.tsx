import Link from "next/link";
import { CalculadoraProgramas } from "./CalculadoraProgramas";

export const dynamic = "force-dynamic";

export default function CalculadoraProgramasPage() {
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/producto/programas" className="text-sm text-gray-400 hover:text-gray-700">
        ← Programas
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Calculadora de precios — Programas</h1>
      <p className="mb-6 text-sm text-gray-500">
        Cuando el proveedor entrega una <b>tarifa comisionable</b> (no el neto), aquí obtienes el <b>neto</b> que vas a montar.
      </p>
      <CalculadoraProgramas />
    </div>
  );
}
