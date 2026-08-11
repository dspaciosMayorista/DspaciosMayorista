"use client";

import { useEffect, useState } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "./LogoutButton";
import { SidebarNav, type NavItem } from "./SidebarNav";
import { POWERED_BY } from "@/lib/contrato/plantilla";

const KEY = "dsp-sidebar";

// Sidebar de escritorio: recogible (solo iconos) o expandido. El estado se
// recuerda en localStorage. Más ancho (w-64) para evitar el scroll horizontal.
export function DesktopSidebar({ nav, switcher, tenant }: { nav: NavItem[]; switcher?: React.ReactNode; tenant?: "mayorista" | "minorista" }) {
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
      className={`hidden shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 md:flex md:sticky md:top-0 md:h-screen ${collapsed ? "w-16" : "w-64"}`}
      style={{ borderTop: "4px solid var(--brand-primary)" }}
    >
      <div className={`flex items-center border-b border-gray-100 py-4 ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
        {!collapsed && (
          <a href="/dashboard" aria-label="D'spacios Travel — inicio">
            <Logo variant="full" height={34} className="h-8 w-auto" priority tenant={tenant} />
          </a>
        )}
        <button
          type="button"
          onClick={toggle}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title={collapsed ? "Expandir menú" : "Recoger menú"}
          aria-label={collapsed ? "Expandir menú" : "Recoger menú"}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {switcher && !collapsed && <div className="border-b border-gray-100 px-4 py-2">{switcher}</div>}

      <SidebarNav items={nav} collapsed={collapsed} />

      <div className={`border-t border-gray-100 py-3 ${collapsed ? "flex justify-center px-2" : "px-4"}`}>
        <LogoutButton collapsed={collapsed} />
      </div>

      {!collapsed && (
        <div className="px-4 pb-3 text-center text-[9px] text-gray-300">{POWERED_BY}</div>
      )}
    </aside>
  );
}
