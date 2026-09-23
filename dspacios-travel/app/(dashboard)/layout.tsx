import { redirect } from "next/navigation";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./LogoutButton";
import { type NavItem } from "./SidebarNav";
import { DesktopSidebar } from "./DesktopSidebar";
import { Topbar } from "./Topbar";
import { Logo } from "@/components/Logo";
import { modulosConsultables, miRol } from "@/lib/roles";
import { tenantContext } from "@/lib/tenant.server";
import { TenantSwitcher } from "./TenantSwitcher";
import { POWERED_BY } from "@/lib/contrato/plantilla";
import styles from "./DashboardShell.module.css";

// Tipografía del Dashboard — Outfit (títulos/cifras) + Plus Jakarta Sans
// (navegación/cuerpo/controles), cargadas SOLO acá y expuestas como variables
// CSS scoped al wrapper `.dashRoot` (DashboardShell.module.css). El root
// layout (app/layout.tsx) sigue con Jost/font-sans sin cambios: Login,
// Tarifario y Portal B2B no llevan `.dashRoot`, así que no heredan nada de esto.
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--dash-font-heading",
  display: "swap",
});
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--dash-font-body",
  display: "swap",
});

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
      { href: "/dashboard/producto/aerolineas", label: "Aerolíneas" },
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
      { href: "/dashboard/contabilidad/retenciones", label: "Retenciones a proveedores" },
      { href: "/dashboard/contabilidad/conciliaciones", label: "Conciliaciones bancarias" },
      { href: "/dashboard/contabilidad/plan-cuentas", label: "Plan de cuentas (PUC)" },
      { href: "/dashboard/contabilidad/libro-diario", label: "Libro diario" },
      { href: "/dashboard/contabilidad/libro-auxiliar", label: "Libro auxiliar" },
      { href: "/dashboard/contabilidad/estados-financieros", label: "Estados financieros" },
      { href: "/dashboard/contabilidad/agencia", label: "Datos de la agencia" },
    ],
  },
  {
    href: "/dashboard/usuarios",
    label: "Usuarios",
    iconKey: "usuarios",
    modulo: "usuarios",
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

  // Oculta del menú los módulos que el rol no puede consultar. (La seguridad
  // de datos la garantiza RLS — ver lib/roles.ts, que ambas capas comparten.)
  const rol = await miRol();
  const permitidos = modulosConsultables(rol);
  const { tenant, puedeCambiar, permitidos: tenantsPermitidos } = await tenantContext();
  const nav = NAV.filter((n) => {
    if (tenant === "minorista" && n.minoristaOculto) return false; // sin tarifario/montaje en minorista
    if (n.soloMinorista && tenant !== "minorista") return false;   // importador solo en minorista
    if (n.soloSuperadmin && rol !== "superadmin") return false;
    if (n.rolesPermitidos) return n.rolesPermitidos.includes(rol ?? "");
    return !n.modulo || permitidos.has(n.modulo);
  });

  // Correo real del usuario autenticado (ya disponible por auth.getUser(),
  // sin consultas nuevas) — el Topbar/header móvil lo usan como identidad.
  const userLabel = (user.email ?? "").split("@")[0];
  // Misma fecha (zona Colombia) que ya usa dashboard/page.tsx — cálculo puro
  // del servidor, sin consulta ni reloj en vivo actualizándose en el cliente.
  const fecha = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });

  const switcher = <TenantSwitcher tenant={tenant} permitidos={tenantsPermitidos} puedeCambiar={puedeCambiar} />;

  return (
    <div className={`${outfit.variable} ${plusJakartaSans.variable} ${styles.dashRoot} flex min-h-screen flex-col md:flex-row`}>
      {/* Barra superior (solo celular): identidad + rol + acciones reales. */}
      <header
        className="flex flex-col gap-2 border-b px-4 py-3 md:hidden"
        style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)", borderTop: "4px solid var(--dash-primary)" }}
      >
        <div className="flex items-center justify-between">
          <a href="/dashboard" aria-label="D'spacios Travel — inicio">
            <Logo variant="full" height={32} className="h-7 w-auto" priority tenant={tenant} />
          </a>
          <div className="flex items-center gap-2">
            {rol && (
              <span className="rounded-md px-2 py-1 text-[11px] font-semibold capitalize" style={{ backgroundColor: "var(--dash-muted-surface)", color: "var(--dash-accent)" }}>
                {rol}
              </span>
            )}
            {switcher}
            <LogoutButton className="text-xs" />
          </div>
        </div>
        <nav className={`${styles.scrollNoBar} -mx-1 flex gap-1 overflow-x-auto pb-1`}>
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm"
              style={{ color: "var(--dash-ink-muted)" }}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="text-center text-[9px]" style={{ color: "var(--dash-ink-muted)", opacity: 0.6 }}>{POWERED_BY}</div>
      </header>

      {/* Sidebar (escritorio) — recogible. El switcher de agencia vive en el
          Topbar (evita mostrar el mismo control dos veces a la vez). */}
      <DesktopSidebar nav={nav} tenant={tenant} />

      {/* Columna derecha: topbar real (escritorio) + contenido. La página
          entera hace scroll (un solo scrollbar); sidebar y topbar quedan
          fijos (sticky). Sin scroll interno propio. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userLabel={userLabel} rol={rol} fecha={fecha} switcher={switcher} logout={<LogoutButton />} />
        {/* `relative`: contenedor de posicionamiento para el `LoadingScreen`
            no-fullscreen de `(dashboard)/loading.tsx` — así su overlay cubre
            solo esta área de contenido (no vuelve a tapar el sidebar/topbar
            que ya se renderizaron). Puramente de layout, no toca sesión/rol. */}
        <main className="relative min-w-0 flex-1 overflow-x-hidden" style={{ backgroundColor: "var(--dash-bg)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
