"use client";

import { useTransition } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cambiarTenant } from "./tenant-actions";
import { TENANT_LABEL, type Tenant } from "@/lib/tenant";

// Selector de agencia. Para superadmin/gerencia es un desplegable; para el resto
// es solo una etiqueta de su agencia (no pueden cambiar).
//
// El desplegable usa `@base-ui/react/select` (dependencia YA instalada, base
// de components/ui/select.tsx) en lugar del elemento de formulario nativo del
// navegador: mismo comportamiento controlado (value/onValueChange), misma
// persistencia (`cambiarTenant` + recarga completa) y mismas opciones — solo
// cambia el control visual. Da teclado completo (abrir con Enter/Espacio/
// flecha, mover con flechas, elegir con Enter, cerrar con Escape) sin código
// propio: es el patrón estándar de listbox accesible que ya trae el paquete.
//
// ⚠️ El menú desplegable se renderiza por Portal (Base UI lo monta al final
// de <body> por diseño, para no quedar recortado por el overflow del
// sidebar/topbar) — queda FUERA del árbol DOM de `.dashRoot`, así que no
// hereda los tokens `--dash-*` (son variables CSS y el Portal rompe la
// cascada de herencia). Por eso el contenido del menú usa directamente los
// tokens semánticos globales de los que `--dash-*` deriva (--card, --border,
// --muted, --foreground, --brand-primary) — mismo valor resuelto, mismo
// comportamiento por tema, sin depender del scope de `.dashRoot`.
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

  function onValueChange(value: Tenant | null) {
    if (!value) return;
    start(async () => {
      await cambiarTenant(value);
      // Recarga completa: refresca datos del servidor Y reinicia el estado de
      // cualquier pantalla/cliente abierto (que de otro modo quedaría estática).
      window.location.reload();
    });
  }

  return (
    <SelectPrimitive.Root
      items={permitidos.map((t) => ({ value: t, label: TENANT_LABEL[t] }))}
      value={tenant}
      onValueChange={onValueChange}
      disabled={pending}
    >
      <SelectPrimitive.Trigger
        aria-label="Cambiar de agencia"
        className={`${base} cursor-pointer outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--dash-accent)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 data-[popup-open]:ring-2 data-[popup-open]:ring-[var(--dash-accent)]`}
        style={style}
      >
        <Building2 size={13} />
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon
          className="opacity-70"
          render={<ChevronDown size={13} />}
        />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner side="bottom" align="start" sideOffset={4} className="z-50 outline-none">
          <SelectPrimitive.Popup
            className="min-w-[11rem] overflow-hidden rounded-lg border py-1 text-sm shadow-sm outline-none"
            style={{ backgroundColor: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            <SelectPrimitive.List>
              {permitidos.map((t) => (
                <SelectPrimitive.Item
                  key={t}
                  value={t}
                  className="relative flex cursor-pointer select-none items-center gap-2 px-3 py-2 outline-none data-[highlighted]:bg-[var(--muted)] data-[selected]:font-semibold"
                  style={{ color: t === tenant ? "var(--brand-primary)" : "var(--foreground)" }}
                >
                  <Building2 size={13} className="shrink-0 opacity-60" />
                  <SelectPrimitive.ItemText className="flex-1">{TENANT_LABEL[t]}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="shrink-0">
                    <Check size={14} style={{ color: "var(--brand-primary)" }} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
