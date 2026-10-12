"use client";

// Presentación de los totales del carrito por moneda (drawer y checkout).
// Nunca suma COP con USD: con una sola moneda conocida muestra un total; si
// no, un subtotal por moneda y el aviso de lo que hará el servidor al
// generar la cotización (reglas en lib/cart/monedaCarrito.ts).

import { AlertTriangle } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import type { PrevisionCotizacion, ResumenMonedas } from "@/lib/cart/monedaCarrito";

export function TotalesPorMoneda({ totales, etiqueta }: { totales: ResumenMonedas; etiqueta: string }) {
  if (totales.unica) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{etiqueta}</span>
        <span className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(totales.unica.monto, totales.unica.moneda)}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {totales.subtotales.map((s) => (
        <div key={s.moneda} className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Subtotal en {s.moneda} ({s.items} ítem{s.items === 1 ? "" : "s"})</span>
          <span className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(s.monto, s.moneda)}</span>
        </div>
      ))}
      {totales.sinMoneda > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Moneda por confirmar</span>
          <span>{totales.sinMoneda} ítem{totales.sinMoneda === 1 ? "" : "s"}</span>
        </div>
      )}
    </div>
  );
}

/** Qué pasará al generar la cotización con un carrito de varias monedas (o
 * con ítems sin moneda registrada). `null` si no hay nada que advertir. */
export function AvisoMonedas({ totales, prevision }: { totales: ResumenMonedas; prevision: PrevisionCotizacion }) {
  if (totales.unica || (!totales.subtotales.length && !totales.sinMoneda)) return null;
  const mixto = totales.subtotales.length > 1;
  return (
    <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle size={14} aria-hidden className="mt-px shrink-0" />
        {mixto
          ? `Tu carrito tiene importes en ${totales.subtotales.map((s) => s.moneda).join(" y ")}. Cada cotización se genera en una sola moneda.`
          : "Algunos importes no tienen la moneda registrada."}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {prevision.moneda && (
          <li>
            Se cotizará en {prevision.moneda} (moneda del primer {prevision.origen === "hotel" ? "hotel" : "servicio"} del carrito)
            {prevision.montoIncluido != null ? `: ${formatMoneda(prevision.montoIncluido, prevision.moneda)} estimado.` : "."}
          </li>
        )}
        {prevision.indeterminada === "servicios" && (
          <li>
            Sin hoteles, la moneda de la cotización la fija el primer servicio que siga disponible al cotizar: el servidor la confirmará y dejará fuera los servicios en otra moneda.
          </li>
        )}
        {prevision.excluidos.length > 0 && (
          <li>
            Quedarán fuera de esta cotización: {prevision.excluidos.map((e) => `${e.etiqueta} (${e.moneda})`).join(", ")}. Puedes cotizarlos en otra solicitud.
          </li>
        )}
        {prevision.bloqueantes.map((b) => (
          <li key={b.id} className="font-semibold">
            {b.etiqueta} está en {b.moneda} y tiene servicios adicionales del hotel: así la solicitud no se podrá generar. Quítalo (sus servicios se quitan con él) o cotízalo en otra solicitud.
          </li>
        ))}
        {prevision.porConfirmar > 0 && (
          <li>
            {prevision.porConfirmar} ítem{prevision.porConfirmar === 1 ? " se agregó" : "s se agregaron"} antes de registrar su moneda: se confirmará al generar la cotización. Para verla ahora, quítalo y agrégalo de nuevo.
          </li>
        )}
      </ul>
    </div>
  );
}
