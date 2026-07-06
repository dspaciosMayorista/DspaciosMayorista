import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./LogoutButton";
import { type NavItem } from "./SidebarNav";
import { DesktopSidebar } from "./DesktopSidebar";
import { Logo } from "@/components/Logo";
import { modulosConsultables, permisosDelUsuario } from "@/lib/permisos";
import { tenantContext } from "@/lib/tenant.server";
import { TenantSwitcher } from "./TenantSwitcher";

const NAV: NavItem[] = [
  // Comercial / venta
  { href: "/tarifario", label: "Tarifario ↗", grupo: "Comercial", iconKey: "tarifario", modulo: "tarifario", minoristaOculto: true },
  { href: "/dashboard/reservar", label: "Reservar", iconKey: "reservar", modulo: "reservar", minoristaOculto: true },
  { href: "/dashboard/cotizaciones", label: "Cotizaciones", iconKey: "cotizaciones", modulo: "cotizaciones", minoristaOculto: true },

  // Operación
  { href: "/dashboard/ventas", label: "Ventas", separadorAntes: true, grupo: "Operación", iconKey: "ventas", modulo: "ventas" },
  {
    href: "/dashboard/contratos",
    label: "Contratos",
    iconKey: "contratos",
    modulo: "contratos",
    children: [{ href: "/dashboard/contratos/nuevo", label: "Nuevo contrato" }],
  },
  // Importador de histórico — SOLO visible en la agencia Minorista (ítem propio y
  // visible, no enterrado como sub-ítem, para encontrarlo fácil al probar).
  { href: "/dashboard/contratos/importar", label: "Importar histórico", iconKey: "importar", soloMinorista: true, rolesPermitidos: ["superadmin", "administracion"] },
  {
    href: "/dashboard/vuelos",
    label: "Vuelos",
    iconKey: "vuelos",
    modulo: "vuelos",
    minoristaOculto: true,
    children: [
      { href: "/dashboard/vuelos/pasajeros", label: "Pasajeros" },
      { href: "/dashboard/vuelos/nuevo", label: "Nuevo bloqueo" },
    ],
  },

  // Producto
  {
    href: "/dashboard/paquetes",
    label: "Montaje de producto",
    separadorAntes: true,
    grupo: "Producto",
    iconKey: "paquetes",
    modulo: "paquetes",
    minoristaOculto: true,
    children: [{ href: "/dashboard/paquetes/nuevo", label: "Nuevo paquete" }],
  },
  {
    href: "/dashboard/producto",
    label: "Netas",
    iconKey: "producto",
    modulo: "producto",
    minoristaOculto: true,
    children: [
      { href: "/dashboard/producto/destinos", label: "Destinos" },
      { href: "/dashboard/producto/hoteles", label: "Hoteles" },
      { href: "/dashboard/producto/servicios", label: "Servicios" },
      { href: "/dashboard/producto/programas", label: "Programas (circuitos)" },
      { href: "/dashboard/producto/proveedores", label: "Proveedores" },
      { href: "/dashboard/producto/configuracion", label: "Configuración" },
    ],
  },

  // Administración
  {
    href: "/dashboard/rentabilidad",
    label: "Finanzas",
    separadorAntes: true,
    grupo: "Administración",
    iconKey: "finanzas",
    modulo: "finanzas",
    children: [
      { href: "/dashboard/rentabilidad", label: "Rentabilidad" },
      { href: "/dashboard/flujo-caja", label: "Flujo de caja" },
      { href: "/dashboard/punto-equilibrio", label: "Punto de equilibrio" },
      { href: "/dashboard/cartera", label: "Cartera (por cobrar)" },
      { href: "/dashboard/pagos", label: "Proveedores" },
      { href: "/dashboard/comisiones", label: "Comisiones B2B" },
      { href: "/dashboard/liquidacion", label: "Liquidación asesores" },
      { href: "/dashboard/aliados", label: "Agencias y freelance" },
    ],
  },
  {
    href: "/dashboard/contabilidad/facturacion",
    label: "Contabilidad",
    iconKey: "contabilidad",
    rolesPermitidos: ["superadmin", "gerencia", "administracion"],
    children: [
      { href: "/dashboard/contabilidad/facturacion", label: "Facturación" },
      { href: "/dashboard/contabilidad/movimientos", label: "Movimientos de pagos" },
      { href: "/dashboard/contabilidad/conciliaciones", label: "Conciliaciones bancarias" },
      { href: "/dashboard/contabilidad/estados-financieros", label: "Estados financieros" },
      { href: "/dashboard/contabilidad/agencia", label: "Datos de la agencia" },
    ],
  },
  {
    href: "/dashboard/usuarios",
    label: "Usuarios",
    iconKey: "usuarios",
    modulo: "usuarios",
    children: [{ href: "/dashboard/usuarios/permisos", label: "Permisos" }],
  },
  { href: "/dashboard/usuarios/b2b", label: "Aprobaciones B2B", iconKey: "b2b", modulo: "b2b" },
  { href: "/dashboard/auditoria", label: "Auditoría", iconKey: "auditoria", rolesPermitidos: ["superadmin", "gerencia"] },
  { href: "/dashboard/configuracion", label: "Configuración", iconKey: "configuracion", modulo: "configuracion" },

  // Sitio web público (CMS) — solo superadmin
  { href: "/cms", label: "Sitio web", iconKey: "cms", modulo: "configuracion", soloSuperadmin: true, minoristaOculto: true },

  // CRM
  { href: "/crm", label: "CRM ↗", separadorAntes: true, grupo: "Externo", iconKey: "crm", modulo: "crm" },
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

  // Oculta del menú los módulos que el rol/usuario no puede consultar.
  // (La seguridad de datos la garantiza RLS; esto es solo visibilidad.)
  const permitidos = await modulosConsultables();
  const { rol } = await permisosDelUsuario();
  const { tenant, puedeCambiar, permitidos: tenantsPermitidos } = await tenantContext();
  const nav = NAV.filter((n) => {
    if (tenant === "minorista" && n.minoristaOculto) return false; // sin tarifario/montaje en minorista
    if (n.soloMinorista && tenant !== "minorista") return false;   // importador solo en minorista
    if (n.soloSuperadmin && rol !== "superadmin") return false;
    if (n.rolesPermitidos) return n.rolesPermitidos.includes(rol ?? "");
    return !n.modulo || permitidos.has(n.modulo);
  });

  return (
    <div className="font-sitio flex min-h-screen flex-col bg-gray-50 md:flex-row">
      {/* Barra superior (solo celular) */}
      <header
        className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3 md:hidden"
        style={{ borderTop: `4px solid var(--brand-primary)` }}
      >
        <div className="flex items-center justify-between">
          <a href="/dashboard" aria-label="D'spacios Travel — inicio">
            <Logo variant="full" height={32} className="h-7 w-auto" priority />
          </a>
          <div className="flex items-center gap-2">
            <TenantSwitcher tenant={tenant} permitidos={tenantsPermitidos} puedeCambiar={puedeCambiar} />
            <LogoutButton className="text-xs text-gray-500 hover:text-gray-800" />
          </div>
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {nav.map((n) => (
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

      {/* Sidebar (escritorio) — recogible */}
      <DesktopSidebar nav={nav} switcher={<TenantSwitcher tenant={tenant} permitidos={tenantsPermitidos} puedeCambiar={puedeCambiar} />} />

      {/* Contenido: la página entera hace scroll (un solo scrollbar); el menú
          queda fijo (sticky). Sin scroll interno propio. */}
      <main className="app-bg min-w-0 flex-1 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
