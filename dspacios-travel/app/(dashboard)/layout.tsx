import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./LogoutButton";
import { SidebarNav, type NavItem } from "./SidebarNav";
import { Logo } from "@/components/Logo";

const NAV: NavItem[] = [
  {
    href: "/dashboard/producto",
    label: "Producto",
    children: [
      { href: "/dashboard/producto/destinos", label: "Destinos" },
      { href: "/dashboard/producto/hoteles", label: "Hoteles" },
      { href: "/dashboard/producto/servicios", label: "Servicios" },
      { href: "/dashboard/producto/proveedores", label: "Proveedores" },
      { href: "/dashboard/producto/configuracion", label: "Configuración" },
    ],
  },
  {
    href: "/dashboard/paquetes",
    label: "Paquetes",
    children: [{ href: "/dashboard/paquetes/nuevo", label: "Nuevo paquete" }],
  },
  { href: "/dashboard/tarifario", label: "Tarifario" },
  { href: "/dashboard/reservar", label: "Reservar" },
  { href: "/dashboard/ventas", label: "Ventas" },
  {
    href: "/dashboard/contratos",
    label: "Contratos",
    children: [{ href: "/dashboard/contratos/nuevo", label: "Nuevo contrato" }],
  },
  {
    href: "/dashboard/vuelos",
    label: "Vuelos",
    children: [{ href: "/dashboard/vuelos/nuevo", label: "Nuevo bloqueo" }],
  },
  {
    href: "/dashboard/finanzas",
    label: "Finanzas",
    children: [
      { href: "/dashboard/cartera", label: "Cartera (por cobrar)" },
      { href: "/dashboard/pagos", label: "Pagos a proveedores" },
      { href: "/dashboard/comisiones", label: "Comisiones B2B" },
    ],
  },
  { href: "/dashboard/usuarios", label: "Usuarios" },
  { href: "/dashboard/configuracion", label: "Configuración" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
      {/* Barra superior (solo celular) */}
      <header
        className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3 md:hidden"
        style={{ borderTop: `4px solid var(--brand-primary)` }}
      >
        <div className="flex items-center justify-between">
          <a href="/dashboard" aria-label="D'spacios Travel — inicio">
            <Logo variant="full" height={32} className="h-7 w-auto" priority />
          </a>
          <LogoutButton className="text-xs text-gray-500 hover:text-gray-800" />
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              {n.label}
            </a>
          ))}
        </nav>
      </header>

      {/* Sidebar (escritorio) */}
      <aside
        className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-white md:flex"
        style={{ borderTop: `4px solid var(--brand-primary)` }}
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <a href="/dashboard" aria-label="D'spacios Travel — inicio">
            <Logo variant="full" height={36} className="h-9 w-auto" priority />
          </a>
        </div>
        <SidebarNav items={NAV} />
        <div className="border-t border-gray-100 px-5 py-3">
          <LogoutButton />
        </div>
      </aside>

      {/* Contenido */}
      <main className="min-w-0 flex-1 overflow-x-hidden md:h-screen md:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
