import Link from "next/link";
import type { ReactNode } from "react";

// Pestañas Inventario/Control de la pantalla de vuelos (activa e histórico).
// Estado en la URL (`?vista=`), no en useState: así la pestaña elegida
// sobrevive a una recarga y es enlazable directamente. Server component (sin
// "use client"): no necesita ningún hook, solo compara el `vista` que ya
// resolvió la página (desde `searchParams`) contra cada link.
export type VistaVuelos = "inventario" | "control-vuelos";

export function vistaDeParam(v: string | undefined): VistaVuelos {
  return v === "control-vuelos" ? "control-vuelos" : "inventario";
}

export function VistaTabs({ basePath, vista }: { basePath: string; vista: VistaVuelos }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-gray-200">
      <TabLink href={`${basePath}?vista=inventario`} activo={vista === "inventario"}>Inventario</TabLink>
      <TabLink href={`${basePath}?vista=control-vuelos`} activo={vista === "control-vuelos"}>CONTROL VUELOS</TabLink>
    </div>
  );
}

function TabLink({ href, activo, children }: { href: string; activo: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors"
      style={activo
        ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }
        : { borderColor: "transparent", color: "#6b7280" }}
    >
      {children}
    </Link>
  );
}
