"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCOP } from "@/lib/utils";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type CartItem } from "@/lib/cart/CartContext";

function resumenHabitaciones(it: CartItem): string {
  const partes = Object.entries(it.habitaciones)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  return partes.join(" · ");
}

export function CartDrawer({ checkoutHabilitado = false, fotosPorHotel = {} }: { checkoutHabilitado?: boolean; fotosPorHotel?: Record<number, string> }) {
  const { items, remove, total, count } = useCart();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Resuelve la foto ACTUAL del hotel por id (los ítems viejos del carrito pueden
  // no traer fotoUrl si se agregaron antes de subir la portada).
  const fotoDe = (it: { hotelId: number; fotoUrl: string | null }) => fotosPorHotel[it.hotelId] || it.fotoUrl;

  // Bloquea el scroll del fondo mientras el panel del carrito está abierto (móvil).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* Botón del carrito (va en el header) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm"
        style={{ color: "var(--brand-primary)" }}
      >
        🛒 Carrito
        {count > 0 && (
          <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div className="flex h-full w-full max-w-md flex-col bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Tu selección</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:text-gray-700">Cerrar ✕</button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              {!items.length ? (
                <div className="py-16 text-center text-sm text-gray-400">
                  Tu carrito está vacío.<br />Agrega alojamientos desde la vista Booking.
                </div>
              ) : (
                <ul className="space-y-3">
                  {items.map((it) => (
                    <li key={it.id} className="flex gap-3 rounded-xl border border-gray-200 p-3">
                      <div className="relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-xl text-gray-300">
                        {fotoDe(it) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={fotoDe(it) as string} alt={it.hotelNombre} className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <span aria-hidden>🏨</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-800">{it.hotelNombre}</div>
                        <div className="truncate text-xs text-gray-500">
                          {it.destino ?? ""}{it.categoria ? ` · ${it.categoria}` : ""}{it.regimen ? ` / ${it.regimen}` : ""}
                        </div>
                        <div className="truncate text-xs text-gray-400">{resumenHabitaciones(it)}</div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>{formatCOP(it.precio)}</span>
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
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700">
                  Seguir comprando
                </button>
                <button
                  type="button"
                  disabled={!items.length || !checkoutHabilitado}
                  onClick={() => { setOpen(false); router.push("/tarifario/checkout"); }}
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
