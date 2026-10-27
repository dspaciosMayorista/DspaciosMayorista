"use client";

// ─────────────────────────────────────────────────────────────────────────
// #35 — Modo explícito «Cotización comparativa» en Vista Booking.
//
// APAGADO por defecto: el flujo simple (carrito → solicitud) no cambia. Con el
// modo activo el carrito se manda como COMPARATIVA: cada hotel (con sus
// servicios vinculados) es una opción para escoger UNA; nada se suma entre
// hoteles. El selector de acomodación y el total de cada hotel aparecen en el
// documento de la comparativa, calculados por el servidor con el motor real.
//
// Este componente solo orienta y enlaza: la validación autoritativa (2–3
// hoteles, mismo viaje y moneda, nada de Bernalo ni vuelos negociados) la hace
// el servidor al crear la comparativa.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { GitCompareArrows, ArrowRight, AlertTriangle } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { MAX_OPCIONES } from "@/lib/cotizacion/comparativa";

export function ModoComparativaBooking() {
  const { items, modoComparativa: activo, setModoComparativa: setActivo } = useCart();

  const hoteles = items.filter((i) => i.tipo === "hotel");
  const bernalo = hoteles.filter((h) => h.modeloTarifario === "unidad");
  const bloqueo = hoteles.filter((h) => h.modeloTarifario !== "unidad" && h.modulo === "bloqueo");
  const sueltos = items.filter((i) => i.tipo === "tour" && !i.hotelItemId);

  const avisos: string[] = [];
  if (hoteles.length > MAX_OPCIONES) avisos.push(`Máximo ${MAX_OPCIONES} hoteles por comparativa: quita ${hoteles.length - MAX_OPCIONES} del carrito.`);
  if (bernalo.length) avisos.push("Los hoteles por unidad (Bernalo) todavía no se pueden comparar.");
  if (bloqueo.length) avisos.push("Los paquetes con vuelo negociado todavía no se pueden comparar.");
  if (sueltos.length) avisos.push("Cada servicio debe estar vinculado a un hotel: quita los servicios sueltos del carrito.");
  const listo = hoteles.length >= 2 && avisos.length === 0;

  return (
    <div className="mb-4 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setActivo(!activo)} aria-pressed={activo}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
          style={activo ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" } : { borderColor: "#e2e8f0", color: "#64748b" }}>
          <GitCompareArrows size={14} aria-hidden /> Cotización comparativa
        </button>
        {!activo && <span className="text-[11px] text-slate-400">Compara hasta {MAX_OPCIONES} hoteles del mismo viaje y escoge uno.</span>}
      </div>
      {activo && (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <p>
            Agrega al carrito hasta {MAX_OPCIONES} hoteles de la <b>misma moneda</b>, cada uno con sus servicios. Con vuelos manuales puedes comparar varios destinos o fechas: los hoteles del mismo destino y fechas forman un grupo y comparten sus vuelos.
            Verás el valor por persona y el total de <b>cada</b> hotel (con sus vuelos y servicios); los hoteles no se suman y no hay un total global.
          </p>
          <p className="font-medium text-slate-700">Hoteles en el carrito: {hoteles.length} de {MAX_OPCIONES}</p>
          {avisos.map((a) => (
            <p key={a} role="alert" className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />{a}</p>
          ))}
          {listo ? (
            <Link href="/tarifario/checkout?modo=comparativa"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
              Crear la comparativa <ArrowRight size={14} aria-hidden />
            </Link>
          ) : (
            <p className="text-slate-400">{hoteles.length < 2 ? "Necesitas al menos dos hoteles en el carrito." : "Resuelve los avisos para continuar."}</p>
          )}
        </div>
      )}
    </div>
  );
}
