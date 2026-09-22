import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import Link from "next/link";
import { formatCOP } from "@/lib/utils";
import {
  Tags, FileText, Ticket, FileSignature, Plane, LineChart, ArrowRight,
  Package, Armchair, Wallet, HandCoins, Receipt, Settings, Boxes, ChevronRight,
  PlaneTakeoff, AlertTriangle, type LucideIcon,
} from "lucide-react";
import styles from "../DashboardShell.module.css";

export const dynamic = "force-dynamic";

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = user
    ? await supabase.from("usuarios").select("nombre, rol").eq("id", user.id).single()
    : { data: null };
  const interno = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");

  const hoyStr = new Date().toISOString().slice(0, 10);
  const mesActual = hoyStr.slice(0, 7);

  const tenant = await getTenant();
  // La minorista no maneja vuelos ni montaje de producto: esos datos no aplican.
  const esMinorista = tenant === "minorista";
  const [{ count: nPaquetes }, { data: ventas }, { data: abonos }, { data: cupos }, { count: nSalidas }, { count: nPagos }] = await Promise.all([
    esMinorista ? Promise.resolve({ count: 0 }) : supabase.from("paquetes").select("id", { count: "exact", head: true }),
    supabase.from("ventas").select("precio_venta, fecha_venta, fecha_salida, estado").eq("tenant", tenant),
    supabase.from("abonos").select("valor_abono").eq("tenant", tenant),
    esMinorista ? Promise.resolve({ data: [] as { cupos_disponibles: number }[] }) : supabase.from("cupos_por_bloqueo").select("cupos_disponibles"),
    esMinorista ? Promise.resolve({ count: 0 }) : supabase.from("bloqueos_vuelo").select("id", { count: "exact", head: true }).gte("fecha_ida", hoyStr).lte("fecha_ida", addDays(14)),
    supabase.from("cuentas_por_pagar").select("id", { count: "exact", head: true }).eq("tenant", tenant).gte("fecha_vencimiento", hoyStr).lte("fecha_vencimiento", addDays(15)),
  ]);

  const vts = ventas ?? [];
  const noCancel = vts.filter((v) => v.estado !== "cancelado");
  const nActivos = noCancel.length;
  const nPendientes = vts.filter((v) => v.estado === "pendiente").length;
  const ventaMes = vts.filter((v) => (v.fecha_venta ?? "").startsWith(mesActual)).reduce((s, v) => s + (v.precio_venta ?? 0), 0);
  const totalVentas = noCancel.reduce((s, v) => s + (v.precio_venta ?? 0), 0);
  const totalAbonos = (abonos ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0);
  const cartera = Math.max(0, totalVentas - totalAbonos);
  const cuposDisponibles = (cupos ?? []).reduce((s, c) => s + Number(c.cupos_disponibles ?? 0), 0);
  const cuposCriticos = (cupos ?? []).filter((c) => { const n = Number(c.cupos_disponibles ?? 0); return n > 0 && n <= 3; }).length;

  // Zona horaria Colombia: el server (UTC) no debe adelantar el día en la noche.
  const hoy = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });
  const nombre = (perfil?.nombre ?? user?.email ?? "").split("@")[0];

  const OCULTOS_MINORISTA = new Set(["/dashboard/tarifario", "/dashboard/reservar", "/dashboard/producto", "/dashboard/paquetes", "/dashboard/vuelos"]);
  const modulos = MODULOS.filter((m) => (!m.interno || interno) && !(esMinorista && OCULTOS_MINORISTA.has(m.href)));

  // Métricas reales, en el orden pedido (contratos, ventas, cartera, cupos,
  // paquetes, salidas próximas, pagos por vencer) — cada una SOLO si ya
  // estaba permitida por rol/tenant en el cálculo de arriba (sin excepciones
  // nuevas). El badge de "pendientes de firma" en Contratos reutiliza
  // `nPendientes`, ya calculado (antes solo se mostraba como alerta aparte).
  const metricas: { icon: LucideIcon; label: string; value: string; sub?: string }[] = [
    { icon: FileSignature, label: "Contratos", value: String(nActivos), sub: nPendientes > 0 ? `${nPendientes} pendiente(s) de firma` : "Sin pendientes de firma" },
    ...(interno ? [{ icon: Wallet, label: "Ventas del mes", value: formatCOP(ventaMes), sub: hoy.split(",")[0] }] : []),
    ...(interno ? [{ icon: HandCoins, label: "Cartera por cobrar", value: formatCOP(cartera) }] : []),
    ...(!esMinorista ? [{ icon: Armchair, label: "Cupos disponibles", value: String(cuposDisponibles) }] : []),
    ...(!esMinorista ? [{ icon: Package, label: "Paquetes activos", value: String(nPaquetes ?? 0) }] : []),
    ...(!esMinorista ? [{ icon: PlaneTakeoff, label: "Salidas próximas (14d)", value: String(nSalidas ?? 0) }] : []),
    ...(interno ? [{ icon: Receipt, label: "Pagos por vencer (15d)", value: String(nPagos ?? 0) }] : []),
  ];

  // Alertas: SOLO cupos críticos y pagos por vencer (sin aerolíneas ni datos
  // inventados) — ambas ya calculadas arriba, mismo gating que sus métricas.
  const alertas: { icon: LucideIcon; label: string; n: number; href: string }[] = [
    ...(!esMinorista ? [{ icon: AlertTriangle, label: "Cupos críticos", n: cuposCriticos, href: "/dashboard/vuelos" }] : []),
    ...(interno ? [{ icon: Receipt, label: "Pagos por vencer (15d)", n: nPagos ?? 0, href: "/dashboard/pagos" }] : []),
  ];

  return (
    <div className="p-4 md:p-7">
      {/* 1. Cabecera operativa — saludo real, fecha, rol, texto factual. */}
      <header className="rounded-lg border p-6" style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: "var(--dash-ink-muted)" }}>{hoy}</p>
        <h1 className={`${styles.heading} mt-1.5 text-2xl font-bold capitalize md:text-[28px]`} style={{ color: "var(--dash-ink)" }}>
          Hola, {nombre}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide capitalize" style={{ backgroundColor: "var(--dash-highlight)", color: "var(--dash-primary)" }}>
            {perfil?.rol ?? "—"}
          </span>
          <span className="text-sm" style={{ color: "var(--dash-ink-muted)" }}>
            Resumen de contratos, ventas, cupos y pagos según tu perfil.
          </span>
        </div>
      </header>

      {/* 2. Flujo operativo — mismos pasos de siempre (FLUJO), sin contadores. */}
      <section className="mt-5 rounded-lg border p-4" style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>Flujo operativo</h2>
        <div className="flex flex-wrap items-stretch gap-y-3">
          {FLUJO.map((m, i) => (
            <div key={m.href} className="flex items-center">
              <Link
                href={m.href}
                prefetch={false}
                className="group flex w-[104px] flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center transition-colors hover:bg-[var(--dash-muted-surface)]"
                style={{ borderColor: "var(--dash-border)" }}
              >
                <span className="grid h-9 w-9 place-items-center rounded-md" style={{ backgroundColor: "var(--dash-muted-surface)", color: "var(--dash-primary)" }}>
                  <m.icon size={17} strokeWidth={2} />
                </span>
                <span className="text-[11px] font-semibold leading-tight" style={{ color: "var(--dash-ink)" }}>{m.label}</span>
              </Link>
              {i < FLUJO.length - 1 && <ArrowRight size={16} className="mx-1 shrink-0" style={{ color: "var(--dash-ink-muted)" }} />}
            </div>
          ))}
        </div>
      </section>

      {/* 3. Métricas reales */}
      <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {metricas.map((m) => <MetricCard key={m.label} {...m} />)}
      </section>

      {/* 4. Alertas reales (solo si hay al menos una aplicable) */}
      {alertas.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>Alertas</h2>
          <div className="flex flex-wrap gap-2">
            {alertas.map((a) => <AlertChip key={a.label} {...a} />)}
          </div>
        </section>
      )}

      {/* 5. Módulos — mismo catálogo y gating de siempre (MODULOS). */}
      <h2 className="mb-3 mt-7 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--dash-ink-muted)" }}>Módulos</h2>
      <ModulosGrid modulos={modulos} />
    </div>
  );
}

function ModulosGrid({ modulos }: { modulos: typeof MODULOS }) {
  return (
    <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {modulos.map((m) => (
        <Link
          key={m.href}
          href={m.href}
          prefetch={false}
          className="group flex items-center gap-3 rounded-lg border p-3.5 transition-colors hover:bg-[var(--dash-muted-surface)]"
          style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md" style={{ backgroundColor: "var(--dash-muted-surface)", color: `var(${m.color})` }}>
            <m.icon size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ color: "var(--dash-ink)" }}>{m.label}</div>
            <div className="truncate text-xs" style={{ color: "var(--dash-ink-muted)" }}>{m.desc}</div>
          </div>
          <ChevronRight size={16} className="shrink-0 transition-colors" style={{ color: "var(--dash-ink-muted)" }} />
        </Link>
      ))}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--dash-surface)", borderColor: "var(--dash-border)" }}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ backgroundColor: "var(--dash-muted-surface)", color: "var(--dash-primary)" }}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <span className="text-xs font-medium" style={{ color: "var(--dash-ink-muted)" }}>{label}</span>
      </div>
      <div className={`${styles.heading} mt-3 text-2xl font-semibold tabular-nums`} style={{ color: "var(--dash-ink)" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] capitalize" style={{ color: "var(--dash-ink-muted)" }}>{sub}</div>}
    </div>
  );
}

function AlertChip({ icon: Icon, label, n, href }: { icon: LucideIcon; label: string; n: number; href: string }) {
  const apagada = n === 0;
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
      style={
        apagada
          ? { borderColor: "var(--dash-border)", color: "var(--dash-ink-muted)", backgroundColor: "var(--dash-surface)" }
          : { borderColor: "var(--dash-danger)", color: "var(--dash-danger)", backgroundColor: "var(--dash-muted-surface)" }
      }
    >
      <Icon size={15} />
      <span>{label}</span>
      <span
        className="rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
        style={apagada ? { backgroundColor: "var(--dash-border)", color: "var(--dash-ink-muted)" } : { backgroundColor: "var(--dash-danger)", color: "white" }}
      >
        {n}
      </span>
    </Link>
  );
}

const FLUJO: { href: string; icon: LucideIcon; label: string }[] = [
  { href: "/dashboard/tarifario", icon: Tags, label: "Tarifario" },
  { href: "/dashboard/cotizaciones", icon: FileText, label: "Cotización" },
  { href: "/dashboard/reservar", icon: Ticket, label: "Reserva" },
  { href: "/dashboard/contratos", icon: FileSignature, label: "Contrato" },
  { href: "/dashboard/vuelos", icon: Plane, label: "Inventario" },
  { href: "/dashboard/rentabilidad", icon: LineChart, label: "Finanzas" },
];

const MODULOS: { href: string; icon: LucideIcon; label: string; desc: string; color: "--dash-accent" | "--dash-primary" | "--dash-success"; interno: boolean }[] = [
  { href: "/dashboard/tarifario", icon: Tags, label: "Tarifario", desc: "Hoteles y precios", color: "--dash-accent", interno: false },
  { href: "/dashboard/reservar", icon: Ticket, label: "Reservar", desc: "Generar contrato", color: "--dash-primary", interno: false },
  { href: "/dashboard/producto", icon: Boxes, label: "Producto", desc: "Hoteles, vuelos, programas", color: "--dash-success", interno: true },
  { href: "/dashboard/paquetes", icon: Package, label: "Paquetes", desc: "Armado y margen", color: "--dash-accent", interno: true },
  { href: "/dashboard/contratos", icon: FileSignature, label: "Contratos", desc: "Ventas y estados", color: "--dash-primary", interno: false },
  { href: "/dashboard/vuelos", icon: Plane, label: "Vuelos", desc: "Bloqueos y sillas", color: "--dash-accent", interno: true },
  { href: "/dashboard/cartera", icon: HandCoins, label: "Cartera", desc: "Por cobrar / abonos", color: "--dash-success", interno: true },
  { href: "/dashboard/pagos", icon: Receipt, label: "Pagos", desc: "Por pagar a proveedores", color: "--dash-primary", interno: true },
  { href: "/dashboard/finanzas", icon: LineChart, label: "Finanzas", desc: "Relación de utilidades", color: "--dash-accent", interno: true },
  { href: "/dashboard/configuracion", icon: Settings, label: "Configuración", desc: "Asesores y parámetros", color: "--dash-success", interno: true },
];
