"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";

// Ítem de HOTEL del carrito (bloqueo/porción). Los campos mapean a la cotización
// (ReservaInput) para que el checkout genere la cotización sin fricción.
export type HotelCartItem = {
  id: string;
  tipo: "hotel";
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  hotelNombre: string;
  destino: string | null;
  fotoUrl: string | null;
  categoria: string;
  regimen: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  habitaciones: Record<string, number>;
  ninos: number;
  ninos2: number;
  infantes: number;
  pax: number;
  precio: number;
  // Edad exacta de cada menor tal como se pidió en Vista Booking (misma
  // cantidad que ninos+ninos2+infantes), en el orden en que se capturó —
  // ver lib/reservar/edadesMenores.ts. Opcional: ítems del carrito
  // guardados en localStorage ANTES de este cambio no lo traen.
  edadesMenores?: number[];
};

// Ítem de SERVICIO/TOUR (add-on de un paquete, agregado desde Receptivos —
// siempre con fechas/pax reales de una búsqueda, nunca desde el "desde" genérico).
export type TourCartItem = {
  id: string;
  tipo: "tour";
  paqueteId: number;
  servicioId: number | null;
  nombre: string;
  destino: string | null;
  fotoUrl: string | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  pax: number;
  precio: number;
  moneda?: string | null;
};

export type CartItem = HotelCartItem | TourCartItem;

// Señal para que Vista Booking abra Receptivos ya filtrado por el destino/
// fechas/pax del hotel recién agregado (ver botón "Agregar tours" del carrito).
export type AddonsIntent = { destino: string | null; fechaIda: string | null; fechaRegreso: string | null; pax: number };

type CartCtx = {
  items: CartItem[];
  add: (item: Omit<CartItem, "id">) => void;
  remove: (id: string) => void;
  clear: () => void;
  total: number;
  count: number;
  // El panel del carrito es controlable desde cualquier componente (ej. al
  // agregar un hotel, se abre solo — antes se quedaba pegado en la misma vista).
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  addonsIntent: AddonsIntent | null;
  setAddonsIntent: (v: AddonsIntent | null) => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "dspacios_cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addonsIntent, setAddonsIntent] = useState<AddonsIntent | null>(null);
  // Evita guardar en el primer render (antes de hidratar desde localStorage).
  const yaHidrato = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // Hidratar desde localStorage tras montar (en cliente) evita el desajuste
      // de SSR; es el patrón estándar de carrito persistente. Ítems guardados
      // antes de que existiera "tipo" (solo hoteles) se migran a tipo:"hotel".
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>[];
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(parsed.map((i) => (i.tipo ? i : { ...i, tipo: "hotel" })) as CartItem[]);
      }
    } catch { /* ignore */ }
    yaHidrato.current = true;
  }, []);

  useEffect(() => {
    if (!yaHidrato.current) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }, [items]);

  const add = useCallback((item: Omit<CartItem, "id">) => {
    setItems((prev) => [...prev, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } as CartItem]);
  }, []);
  const remove = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const total = items.reduce((s, i) => s + i.precio, 0);

  return (
    <Ctx.Provider value={{
      items, add, remove, clear, total, count: items.length,
      drawerOpen, openDrawer, closeDrawer, addonsIntent, setAddonsIntent,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) {
    // Outside CartProvider: return safe no-ops.
    return {
      items: [], add: () => {}, remove: () => {}, clear: () => {}, total: 0, count: 0,
      drawerOpen: false, openDrawer: () => {}, closeDrawer: () => {}, addonsIntent: null, setAddonsIntent: () => {},
    };
  }
  return c;
}
