"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatCOP } from "@/lib/utils";
import { EliminarPaqueteBtn } from "./EliminarPaqueteBtn";
import {
  TABS_TIPO_PAQUETE,
  TAB_TIPO_PAQUETE_DEFECTO,
  esTipoPaqueteValido,
  filtrarYOrdenarPaquetes,
  type TipoPaquete,
} from "./tipo-paquetes";

export type PaqueteItem = {
  id: number;
  nombre: string;
  activo: boolean;
  pctMk: number;
  tipo: TipoPaquete;
  destino: string | null;
  fechaViajeInicio: string | null;
  fechaViajeFin: string | null;
  nTarifas: number;
  desde: number | null;
};

const QS_TIPO = "tipo";

export function PaquetesListado({ paquetes }: { paquetes: PaqueteItem[] }) {
  const pathname = usePathname();
  const [tab, setTab] = useState<TipoPaquete>(TAB_TIPO_PAQUETE_DEFECTO);

  // El query string es solo una conveniencia (conservar el filtro al
  // recargar) — se lee después de montar en vez de en el estado inicial
  // para no depender de `window` durante el render en servidor, y se
  // escribe con history.replaceState (nunca router.push/replace) para NO
  // disparar una navegación/refetch de este Server Component: los datos ya
  // están cargados y cambiar de pestaña filtra en memoria.
  useEffect(() => {
    const actual = new URLSearchParams(window.location.search).get(QS_TIPO);
    if (esTipoPaqueteValido(actual)) setTab(actual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function seleccionarTab(siguiente: TipoPaquete) {
    setTab(siguiente);
    const qs = new URLSearchParams(window.location.search);
    qs.set(QS_TIPO, siguiente);
    window.history.replaceState(null, "", `${pathname}?${qs.toString()}`);
  }

  const visibles = useMemo(() => filtrarYOrdenarPaquetes(paquetes, tab), [paquetes, tab]);

  if (!paquetes.length) {
    return (
      <div className="mt-6 rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
        <p className="text-lg">No hay paquetes armados</p>
        <p className="mt-1 text-sm">Crea el primero con “Nuevo paquete”.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-4 flex gap-5 overflow-x-auto border-b border-gray-200">
        {TABS_TIPO_PAQUETE.map((t) => {
          const activo = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => seleccionarTab(t.key)}
              aria-pressed={activo}
              className="shrink-0 whitespace-nowrap border-b-2 bg-transparent px-1 pb-2 pt-1 text-sm font-medium tracking-wide transition-colors"
              style={
                activo
                  ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }
                  : { borderColor: "transparent", color: "#6b7280" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {!visibles.length ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-base">Sin paquetes en esta categoría</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((p) => (
            <div
              key={p.id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition hover:border-[var(--brand-accent)] hover:shadow-sm"
            >
              <Link href={`/dashboard/paquetes/${p.id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: p.activo ? "var(--brand-success)" : "#9ca3af" }}
                  >
                    {p.activo ? "Activo" : "Inactivo"}
                  </span>
                  <span className="text-xs text-gray-400">mk {Math.round((p.pctMk ?? 0) * 100)}%</span>
                </div>
                <h2 className="mt-2 font-semibold text-gray-900">{p.nombre}</h2>
                <p className="text-xs text-gray-500">
                  {p.destino ?? "Sin destino"}
                  {p.fechaViajeInicio ? ` · viaje ${p.fechaViajeInicio} → ${p.fechaViajeFin ?? ""}` : ""}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    {p.nTarifas > 0 ? `${p.nTarifas} tarifas publicadas` : "Sin publicar"}
                  </span>
                  {p.desde != null && p.desde > 0 && (
                    <span className="text-sm">
                      Desde <b style={{ color: "var(--brand-primary)" }}>{formatCOP(p.desde)}</b>
                    </span>
                  )}
                </div>
              </Link>
              <div className="mt-2 flex justify-end border-t border-gray-100 pt-2">
                <EliminarPaqueteBtn id={p.id} nombre={p.nombre} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
