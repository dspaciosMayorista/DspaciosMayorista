"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TextosCategoriaPorHotel } from "@/lib/tarifario/textosCategoria";

export type { TextosCategoriaPorHotel };

// #45 (303): descripción y «qué incluye» de la categoría ELEGIDA en ESTE hotel, debajo del selector de categoría de la ficha.
// Solo texto: no cambia precios, combinaciones ni disponibilidad. Sin dato → no se muestra nada (nunca se inventa).

const Ctx = createContext<TextosCategoriaPorHotel>({});

export function TextosCategoriaProvider({ textos, children }: { textos?: TextosCategoriaPorHotel; children?: ReactNode }) {
  return <Ctx.Provider value={textos ?? {}}>{children}</Ctx.Provider>;
}

const lineas = (t: string) => t.split(/\r?\n/).map((x) => x.replace(/^[-•*\s]+/, "").trim()).filter(Boolean);

export function TextoCategoriaHotel({ hotelId, categoria }: { hotelId: number | null | undefined; categoria: string | null | undefined }) {
  const textos = useContext(Ctx);
  const t = hotelId != null && categoria ? textos[hotelId]?.[categoria] : undefined;
  const incluye = t?.incluye ? lineas(t.incluye) : [];
  if (!t?.descripcion && !incluye.length) return null;
  return (
    <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600" data-testid="texto-categoria-hotel">
      {t?.descripcion && <p className="whitespace-pre-line">{t.descripcion}</p>}
      {incluye.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {incluye.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
    </div>
  );
}
