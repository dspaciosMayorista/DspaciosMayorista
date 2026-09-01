"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Tags, Ticket, FileText, ShoppingBag, FileSignature, Plane, Package, Boxes,
  Wallet, Users, UserCheck, Settings, Globe, Contact, ChevronDown, ChevronRight,
  Circle, History, Calculator, Upload, type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
  separadorAntes?: boolean;   // dibuja un separador antes de este ítem
  grupo?: string;             // etiqueta de sección (Comercial, Operación…)
  iconKey?: string;           // ícono lucide (ver ICONS)
  modulo?: string;            // módulo de permisos (para ocultar según rol)
  soloSuperadmin?: boolean;   // visible solo para el rol superadmin
  rolesPermitidos?: string[]; // visible solo para estos roles (ignora `modulo`)
  minoristaOculto?: boolean;  // se oculta cuando la agencia activa es minorista
  soloMinorista?: boolean;    // visible SOLO cuando la agencia activa es minorista
};

const ICONS: Record<string, LucideIcon> = {
  tarifario: Tags, reservar: Ticket, cotizaciones: FileText, ventas: ShoppingBag,
  contratos: FileSignature, vuelos: Plane, paquetes: Package, producto: Boxes,
  finanzas: Wallet, usuarios: Users, b2b: UserCheck, configuracion: Settings,
  cms: Globe, crm: Contact, auditoria: History, contabilidad: Calculator, importar: Upload,
};

export function SidebarNav({ items, collapsed }: { items: NavItem[]; collapsed?: boolean }) {
  const pathname = usePathname();

  if (collapsed) {
    return (
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + "/");
          const Icon = it.iconKey ? ICONS[it.iconKey] : undefined;
          return (
            <Link
              key={it.href}
              href={it.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              title={it.label}
              className="mx-auto grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-gray-50"
              style={active ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "var(--nav-fg, #4b5563)" }}
            >
              {Icon ? <Icon size={18} strokeWidth={2} /> : <span className="text-xs font-bold">{it.label.charAt(0)}</span>}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      {items.map((it) => (
        <div key={it.href}>
          {it.grupo ? (
            <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--nav-subfg, #9ca3af)" }}>
              {it.grupo}
            </p>
          ) : it.separadorAntes ? (
            <div className="my-2 border-t border-gray-100" />
          ) : null}
          <Group item={it} pathname={pathname} />
        </div>
      ))}
    </nav>
  );
}

function Group({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const hasChildren = !!item.children?.length;
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? active;
  const Icon = item.iconKey ? ICONS[item.iconKey] : undefined;

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={item.href}
          prefetch={false}
          aria-current={active ? "page" : undefined}
          className="flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
          style={
            active
              ? { backgroundColor: "var(--brand-primary)", color: "white", fontWeight: 600 }
              : { color: "var(--nav-fg, #4b5563)" }
          }
        >
          {Icon ? <Icon size={17} strokeWidth={2} className="shrink-0 opacity-90" /> : <span className="w-[17px]" />}
          <span className="truncate">{item.label}</span>
        </Link>
        {hasChildren && (
          <button
            type="button"
            aria-label="Desplegar"
            onClick={() => setManual(!open)}
            className="px-2 py-2 text-gray-400 hover:text-gray-700"
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        )}
      </div>

      {hasChildren && open && (
        <div className="ml-[22px] mt-0.5 space-y-0.5 border-l border-gray-100 pl-2">
          {item.children!.map((c) => {
            const cActive = pathname === c.href;
            return (
              <Link
                key={c.href}
                href={c.href}
                prefetch={false}
                aria-current={cActive ? "page" : undefined}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-gray-50"
                style={cActive ? { color: "var(--brand-accent)", fontWeight: 600 } : { color: "var(--nav-subfg, #6b7280)" }}
              >
                <Circle size={5} className="shrink-0" fill="currentColor" strokeWidth={0} />
                <span className="truncate">{c.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
