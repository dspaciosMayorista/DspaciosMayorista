"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Hotel, MapPin, ShoppingCart, X } from "lucide-react";
import { formatCOP, formatMoneda } from "@/lib/utils";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type CartItem, type HotelCartItem } from "@/lib/cart/CartContext";

function resumenHabitaciones(it: HotelCartItem): string {
  const partes = Object.entries(it.habitaciones)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  if (it.infantes > 0) partes.push(`${it.infantes} Infante(s)`);
  return partes.join(" · ");
}

export function CartDrawer({ checkoutHabilitado = false, fotosPorHotel = {} }: { checkoutHabilitado?: boolean; fotosPorHotel?: Record<number, string> }) {
  const { items, remove, total, count, drawerOpen, openDrawer, closeDrawer, setAddonsIntent } = useCart();
  const router = useRouter();
  // Resuelve la foto ACTUAL del hotel por id (los ítems viejos del carrito pueden
  // no traer fotoUrl si se agregaron antes de subir la portada).
  const fotoDe = (it: HotelCartItem) => fotosPorHotel[it.hotelId] || it.fotoUrl;

  // Bloquea el scroll del fondo mientras el panel del carrito está abierto (móvil).
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  // Toma el hotel más reciente del carrito para prefiltrar Receptivos (destino/
  // fechas/pax) — así "Agregar tours" no obliga a repetir la búsqueda a mano.
  function irAAgregarTours() {
    const hoteles = items.filter((i): i is HotelCartItem => i.tipo === "hotel");
    const ref = hoteles[hoteles.length - 1];
    setAddonsIntent(ref ? { destino: ref.destino, fechaIda: ref.fechaIda, fechaRegreso: ref.fechaRegreso, pax: ref.pax } : null);
    closeDrawer();
  }

  return (
    <>
      {/* Botón del carrito (va en el header) */}
      <button
        type="button"
        onClick={openDrawer}
        className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm"
        style={{ color: "var(--brand-primary)" }}
      >
        <ShoppingCart size={16} /> Carrito
        {count > 0 && (
          <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
            {count}
          </span>
        )}
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={closeDrawer}>
          <div className="flex h-full w-full max-w-md flex-col bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Tu selección</h2>
              <button type="button" onClick={closeDrawer} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700">Cerrar <X size={14} /></button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              {!items.length ? (
                <div className="py-16 text-center text-sm text-gray-400">
                  Tu carrito está vacío.<br />Agrega alojamientos desde la vista Booking.
                </div>
              ) : (
                <ul className="space-y-3">
                  {items.map((it: CartItem) => (
                    <li key={it.id} className="flex gap-3 rounded-xl border border-gray-200 p-3">
                      <div className="relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-gray-300">
                        {(it.tipo === "hotel" ? fotoDe(it) : it.fotoUrl) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={(it.tipo === "hotel" ? fotoDe(it) : it.fotoUrl) as string} alt={it.tipo === "hotel" ? it.hotelNombre : it.nombre} className="absolute inset-0 h-full w-full object-cover" />
                        ) : it.tipo === "hotel" ? (
                          <Hotel size={22} aria-hidden />
                        ) : (
                          <MapPin size={22} aria-hidden />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {it.tipo === "hotel" ? (
                          <>
                            <div className="truncate font-medium text-gray-800">{it.hotelNombre}</div>
                            <div className="truncate text-xs text-gray-500">
                              {it.destino ?? ""}{it.categoria ? ` · ${it.categoria}` : ""}{it.regimen ? ` / ${it.regimen}` : ""}
                            </div>
                            <div className="truncate text-xs text-gray-400">{resumenHabitaciones(it)}</div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 truncate font-medium text-gray-800">
                              <span className="rounded bg-[rgba(38,187,217,0.12)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--brand-accent)" }}>Tour</span>
                              {it.nombre}
                            </div>
                            <div className="truncate text-xs text-gray-500">{it.destino ?? ""}</div>
                            <div className="truncate text-xs text-gray-400">
                              {it.pax} pax{it.noches ? ` · ${it.noches} noche${it.noches === 1 ? "" : "s"}` : ""}
                            </div>
                          </>
                        )}
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>
                            {it.tipo === "tour" && it.moneda ? formatMoneda(it.precio, it.moneda) : formatCOP(it.precio)}
                          </span>
                          <button type="button" onClick={() => remove(it.id)} className="text-xs text-gray-400 hover:text-red-500">Quitar</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-gray-100 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-gray-500">Total estimado</span>
                <span className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(total)}</span>
              </div>
              {items.some((i) => i.tipo === "hotel") && (
                <button
                  type="button"
                  onClick={irAAgregarTours}
                  className="mb-2 w-full rounded-lg border px-4 py-2.5 text-sm font-medium"
                  style={{ borderColor: "var(--brand-accent)", color: "var(--brand-accent)" }}
                >
                  + Agregar servicios / tours
                </button>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={closeDrawer} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700">
                  Seguir escogiendo hoteles
                </button>
                <button
                  type="button"
                  disabled={!items.length || !checkoutHabilitado}
                  onClick={() => { closeDrawer(); router.push("/tarifario/checkout"); }}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  style={{ backgroundColor: "var(--brand-primary)" }}
                  title={checkoutHabilitado ? "" : "El checkout se habilita en la próxima fase"}
                >
                  Finalizar compra
                </button>
              </div>
              {!checkoutHabilitado && items.length > 0 && (
                <p className="mt-2 text-center text-[11px] text-gray-400">El checkout (cotización + solicitud) llega en la próxima fase.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
