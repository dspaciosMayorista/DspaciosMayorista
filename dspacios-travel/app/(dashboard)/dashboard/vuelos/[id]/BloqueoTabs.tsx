"use client";

import { useState, type ReactNode } from "react";

// Pestañas del detalle del bloqueo: "Pasajeros" (sillas activas) y "Cambios"
// (cambio de sillas entre records, eliminación de cupos e historial). El
// contenido lo renderiza el servidor y se pasa como nodos.
export function BloqueoTabs({ pasajeros, cambios, nCambios = 0 }: { pasajeros: ReactNode; cambios: ReactNode; nCambios?: number }) {
  const [tab, setTab] = useState<"pasajeros" | "cambios">("pasajeros");
  return (
    <div className="mt-6">
      <div className="mb-3 flex gap-1 border-b border-gray-200">
        <TabBtn activo={tab === "pasajeros"} onClick={() => setTab("pasajeros")}>Pasajeros</TabBtn>
        <TabBtn activo={tab === "cambios"} onClick={() => setTab("cambios")}>
          Cambios{nCambios > 0 ? <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 text-[10px] font-semibold text-gray-600">{nCambios}</span> : null}
        </TabBtn>
      </div>
      <div className={tab === "pasajeros" ? "" : "hidden"}>{pasajeros}</div>
      <div className={tab === "cambios" ? "" : "hidden"}>{cambios}</div>
    </div>
  );
}

function TabBtn({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors"
      style={activo
        ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }
        : { borderColor: "transparent", color: "#6b7280" }}
    >
      {children}
    </button>
  );
}
