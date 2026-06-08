"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";

// Ítem del carrito del tarifario dinámico. Los campos mapean a la cotización
// (ReservaInput) para que el checkout (Fase 3) genere la cotización sin fricción.
export type CartItem = {
  id: string;
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
  pax: number;
  precio: number;
};

type CartCtx = {
  items: CartItem[];
  add: (item: Omit<CartItem, "id">) => void;
  remove: (id: string) => void;
  clear: () => void;
  total: number;
  count: number;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "dspacios_cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  // Evita guardar en el primer render (antes de hidratar desde localStorage).
  const yaHidrato = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // Hidratar desde localStorage tras montar (en cliente) evita el desajuste
      // de SSR; es el patrón estándar de carrito persistente.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
    } catch { /* ignore */ }
    yaHidrato.current = true;
  }, []);

  useEffect(() => {
    if (!yaHidrato.current) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }, [items]);

  const add = useCallback((item: Omit<CartItem, "id">) => {
    setItems((prev) => [...prev, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }]);
  }, []);
  const remove = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  const total = items.reduce((s, i) => s + i.precio, 0);

  return (
    <Ctx.Provider value={{ items, add, remove, clear, total, count: items.length }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart debe usarse dentro de CartProvider");
  return c;
}
