"use client";

// #64 — Cada alternativa de la comparativa por separado: su hotel, sus servicios hijos, los vuelos de SU grupo y su PVP. Nada se suma entre hoteles competidores y no hay un
// «total del carrito». Lo calcula `resumirOpcionesComparativa` (puro); el servidor liquida y es la autoridad al crear la comparativa.
import { Plane } from "lucide-react";
import { formatImporte } from "@/lib/cart/monedaCarrito";
import { resumirOpcionesComparativa, type HotelComparativa } from "@/lib/cart/opcionesComparativa";
import type { CartItem } from "@/lib/cart/CartContext";

const ETIQUETA_TRAMO = { ida: "ida", regreso: "regreso", ida_regreso: "ida y regreso" } as const;
const corto = (f: string) => f.slice(5).replace("-", "/");

export function ResumenOpcionesComparativa({ items, iataDe }: { items: readonly CartItem[]; iataDe: (destino: string | null | undefined) => string | null }) {
  const hoteles: HotelComparativa[] = [];
  for (const i of items) {
    if (i.tipo !== "hotel" || i.modeloTarifario === "unidad") continue;
    hoteles.push({
      id: i.id, ref: i.id, nombre: i.hotelNombre, destino: i.destino, destinoIata: iataDe(i.destino), fechaIda: i.fechaIda, fechaRegreso: i.fechaRegreso,
      pax: i.pax, precio: i.precio, moneda: i.moneda ?? null,
    });
  }
  const servicios = items.flatMap((i) => (i.tipo === "tour" && i.hotelItemId ? [{ nombre: i.nombre, precio: i.precio, hotelItemId: i.hotelItemId }] : []));
  const vuelos = items.flatMap((i) => (i.tipo === "manual" && i.clase === "vuelo"
    ? [{ id: i.id, nombre: i.nombre, tramo: i.tramo, pax: i.pax, precio: i.precio, impuestoNoComisionable: i.impuestoNoComisionable, moneda: i.moneda, hotelRef: i.hotelRef }] : []));
  const { grupos, sinDato, vuelosSinGrupo } = resumirOpcionesComparativa(hoteles, servicios, vuelos);
  if (!hoteles.length) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="opciones-comparativa" aria-label="Opciones de la comparativa">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Opciones de la comparativa</h2>
      <p className="mb-3 text-xs text-gray-500">Cada hotel es una alternativa: se cotiza y se muestra por separado. No hay un total del carrito; el vuelo de un grupo entra una sola vez en cada opción de ese grupo.</p>
      {sinDato.length > 0 && (
        <p role="alert" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {sinDato.map((h) => (h.destinoIata ? `«${h.nombre}» no tiene fechas confirmadas` : `El destino «${h.destino ?? "—"}» de «${h.nombre}» no tiene un código IATA confiable en el catálogo (corrígelo en Producto → Destinos)`)).join(" · ")}.
        </p>
      )}
      {vuelosSinGrupo.length > 0 && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          El vuelo «{vuelosSinGrupo[0].nombre}» no pertenece a ningún grupo del carrito (destino y fechas). Edítalo o quítalo.
        </p>
      )}
      <div className="space-y-4">
        {grupos.map((g) => (
          <div key={g.clave} data-testid="grupo-comparativa">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{g.destinoIata} · {corto(g.fechaIda)} → {corto(g.fechaRegreso)}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.opciones.map((o) => (
                <article key={o.hotelId} className="flex min-w-0 flex-col rounded-xl border border-gray-200 p-3" data-testid="opcion-comparativa">
                  <h3 className="break-words text-sm font-semibold text-gray-800">{o.hotelNombre}</h3>
                  <p className="text-xs text-gray-500">{o.pax} pax · hotel {formatImporte(o.hotelPrecio, o.moneda)}</p>
                  {o.servicios.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                      {o.servicios.map((s, i) => <li key={i} className="flex justify-between gap-2"><span className="min-w-0 break-words">+ {s.nombre}</span><span className="shrink-0 tabular-nums">{formatImporte(s.precio, o.moneda)}</span></li>)}
                    </ul>
                  )}
                  {o.vuelos.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                      {o.vuelos.map((v) => (
                        <li key={v.id} className="flex justify-between gap-2">
                          <span className="inline-flex min-w-0 items-start gap-1"><Plane size={12} className="mt-0.5 shrink-0" aria-hidden /><span className="break-words">{v.nombre}{v.tramo ? ` · ${ETIQUETA_TRAMO[v.tramo]}` : ""} · {v.pax} pax</span></span>
                          <span className="shrink-0 tabular-nums">{formatImporte(v.precio, o.moneda)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto border-t border-gray-100 pt-2">
                    {o.impuestoNoComisionableVuelos > 0 && (
                      <p className="flex justify-between gap-2 text-[11px] text-gray-500"><span>Impuesto no comisionable (vuelos)</span><span className="tabular-nums">{formatImporte(o.impuestoNoComisionableVuelos, o.moneda)}</span></p>
                    )}
                    <p className="flex items-baseline justify-between gap-2"><span className="text-xs font-medium text-gray-600">PVP de esta opción</span>
                      <span className="text-base font-bold tabular-nums" style={{ color: "var(--brand-primary)" }} data-testid="pvp-opcion">{formatImporte(o.pvp, o.moneda)}</span></p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
