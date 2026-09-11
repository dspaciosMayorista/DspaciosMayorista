"use client";

// ─────────────────────────────────────────────────────────────────────────
// Control de "qué editor de tarifas está activo" para este hotel: el actual
// (`TarifasBox` dentro de `HotelDetalleClient`, cobro por persona con
// columnas fijas) o el de fase 2 Bernalo (`TarifasUnidadEditor`, cobro por
// persona/pareja/habitación/apartamento con suplementos configurables).
//
// Es EXCLUSIVAMENTE un interruptor de UI: la Server Action
// `actualizarModeloTarifarioHotel` (`../actions.ts`) solo actualiza
// `hoteles.modelo_tarifario` — nunca inserta, actualiza ni borra una fila de
// `tarifa_hotel` ni de `hotel_tarifas_unidad`. Ambos conjuntos de tarifas
// siguen intactos sin importar cuál esté activo.
// ─────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actualizarModeloTarifarioHotel } from "../actions";

export type ModeloTarifario = "persona" | "unidad";

const OPCIONES: { value: ModeloTarifario; label: string; ayuda: string }[] = [
  { value: "persona", label: "Tarifas por persona", ayuda: "Editor actual: categoría/régimen/temporada, columnas fijas por acomodación." },
  { value: "unidad", label: "Tarifas por unidad (Bernalo)", ayuda: "Cobro por persona, pareja, habitación o apartamento, con suplementos configurables." },
];

export function ModeloTarifarioEditor({ hotelId, inicial }: { hotelId: number; inicial: ModeloTarifario }) {
  const router = useRouter();
  const [modelo, setModelo] = useState<ModeloTarifario>(inicial);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function cambiar(valor: ModeloTarifario) {
    if (valor === modelo || pending) return;
    setErr("");
    start(async () => {
      const r = await actualizarModeloTarifarioHotel(hotelId, valor);
      if (!r.ok) { setErr(r.error); return; }
      setModelo(valor);
      router.refresh();
    });
  }

  const seleccionada = OPCIONES.find((o) => o.value === modelo) ?? OPCIONES[0];

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Modelo tarifario</h2>
        {/* Control segmentado compacto: un solo grupo de dos botones, no dos
            cards apiladas — el modo activo se resalta por contraste y la
            ayuda de la opción NO seleccionada no ocupa espacio. */}
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
          {OPCIONES.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={pending}
              onClick={() => cambiar(o.value)}
              aria-pressed={modelo === o.value}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                modelo === o.value ? "bg-[var(--brand-primary)] text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {pending && <span className="text-xs text-gray-400">Guardando…</span>}
      </div>
      <p className="mt-2 text-xs text-gray-500">{seleccionada.ayuda}</p>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </section>
  );
}
