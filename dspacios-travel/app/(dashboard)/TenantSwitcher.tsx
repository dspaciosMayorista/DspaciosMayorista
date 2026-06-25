"use client";

import { useTransition } from "react";
import { Building2 } from "lucide-react";
import { cambiarTenant } from "./tenant-actions";
import { TENANT_LABEL, type Tenant } from "@/lib/tenant";

// Selector de agencia. Para superadmin/gerencia es un desplegable; para el resto
// es solo una etiqueta de su agencia (no pueden cambiar).
export function TenantSwitcher({ tenant, permitidos, puedeCambiar, compact }: {
  tenant: Tenant; permitidos: Tenant[]; puedeCambiar: boolean; compact?: boolean;
}) {
  const [pending, start] = useTransition();

  const minorista = tenant === "minorista";
  const base = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold";
  const style = minorista
    ? { backgroundColor: "rgba(174,244,74,0.18)", color: "#5b7a12", border: "1px solid rgba(174,244,74,0.5)" }
    : { backgroundColor: "rgba(38,187,217,0.12)", color: "var(--brand-primary)", border: "1px solid rgba(38,187,217,0.35)" };

  if (!puedeCambiar || permitidos.length < 2) {
    return (
      <span className={base} style={style} title="Agencia activa">
        <Building2 size={13} /> {TENANT_LABEL[tenant]}
      </span>
    );
  }
  return (
    <div className={base} style={style}>
      <Building2 size={13} />
      <select
        value={tenant}
        disabled={pending}
        onChange={(e) => start(async () => {
          await cambiarTenant(e.target.value as Tenant);
          // Recarga completa: refresca datos del servidor Y reinicia el estado de
          // cualquier pantalla/cliente abierto (que de otro modo quedaría estática).
          window.location.reload();
        })}
        className="cursor-pointer bg-transparent font-semibold outline-none"
        style={{ color: "inherit" }}
        aria-label="Cambiar de agencia"
      >
        {permitidos.map((t) => <option key={t} value={t} style={{ color: "#111" }}>{TENANT_LABEL[t]}</option>)}
      </select>
    </div>
  );
}
