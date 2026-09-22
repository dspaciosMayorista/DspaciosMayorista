"use client";

import { useEffect, useState } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "./LogoutButton";
import { SidebarNav, type NavItem } from "./SidebarNav";
import { POWERED_BY } from "@/lib/contrato/plantilla";

const KEY = "dsp-sidebar";

// Sidebar de escritorio: recogible (solo iconos) o expandido. El estado se
// recuerda en localStorage (misma clave de siempre: "dsp-sidebar"). Ancho
// w-64 expandido / w-16 recogido — sin cambios de comportamiento, solo de
// superficie (tokens --dash-* en vez de las clases de color legacy).
export function DesktopSidebar({ nav, tenant }: { nav: NavItem[]; tenant?: "mayorista" | "minorista" }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza con lo guardado al montar
    setCollapsed(localStorage.getItem(KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const n = !c;
      try { localStorage.setItem(KEY, n ? "1" : "0"); } catch { /* sin almacenamiento */ }
      return n;
    });
  }

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r transition-[width] duration-200 md:flex md:sticky md:top-0 md:h-screen ${collapsed ? "w-16" : "w-64"}`}
      style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)", borderTop: "4px solid var(--dash-primary)" }}
    >
      <div className={`flex items-center border-b py-4 ${collapsed ? "justify-center px-2" : "justify-between px-4"}`} style={{ borderColor: "var(--dash-border)" }}>
        {!collapsed && (
          <a href="/dashboard" aria-label="D'spacios Travel — inicio">
            <Logo variant="full" height={34} className="h-8 w-auto" priority tenant={tenant} />
          </a>
        )}
        <button
          type="button"
          onClick={toggle}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--dash-muted-surface)]"
          style={{ color: "var(--dash-ink-muted)" }}
          title={collapsed ? "Expandir menú" : "Recoger menú"}
          aria-label={collapsed ? "Expandir menú" : "Recoger menú"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <SidebarNav items={nav} collapsed={collapsed} />

      <div className={`border-t py-3 ${collapsed ? "flex justify-center px-2" : "px-4"}`} style={{ borderColor: "var(--dash-border)" }}>
        <LogoutButton collapsed={collapsed} />
      </div>

      {!collapsed && (
        <div className="px-4 pb-3 text-center text-[9px]" style={{ color: "var(--dash-ink-muted)", opacity: 0.6 }}>{POWERED_BY}</div>
      )}
    </aside>
  );
}
