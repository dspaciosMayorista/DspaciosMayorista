import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatCOP } from "@/lib/utils";
import {
  Tags, FileText, Ticket, FileSignature, Plane, LineChart, ArrowRight,
  Package, Armchair, Wallet, HandCoins, Receipt, Settings, Boxes, ChevronRight,
  Clock, PlaneTakeoff, AlertTriangle, type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

const tint = (v: string) => `color-mix(in srgb, ${v} 12%, white)`;
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

  const [{ count: nPaquetes }, { data: ventas }, { data: abonos }, { data: cupos }, { count: nSalidas }, { count: nPagos }] = await Promise.all([
    supabase.from("paquetes").select("id", { count: "exact", head: true }),
    supabase.from("ventas").select("precio_venta, fecha_venta, fecha_salida, estado"),
    supabase.from("abonos").select("valor_abono"),
    supabase.from("cupos_por_bloqueo").select("cupos_disponibles"),
    supabase.from("bloqueos_vuelo").select("id", { count: "exact", head: true }).gte("fecha_ida", hoyStr).lte("fecha_ida", addDays(14)),
    supabase.from("cuentas_por_pagar").select("id", { count: "exact", head: true }).gte("fecha_vencimiento", hoyStr).lte("fecha_vencimiento", addDays(15)),
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

  const hoy = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const nombre = (perfil?.nombre ?? user?.email ?? "").split("@")[0];

  return (
    <div className="p-4 md:p-7">
      {/* ── Header compacto ────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">Centro de operación · {hoy}</p>
          <h1 className="mt-1 text-2xl font-bold capitalize text-gray-900 md:text-[26px]">Hola, {nombre}</h1>
        </div>
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: "var(--brand-highlight)", color: "var(--brand-primary)" }}
        >
          {perfil?.rol ?? "—"}
        </span>
      </header>

      {/* ── Mapa operativo (flujo de módulos conectados) ───────────────── */}
      <section className="mt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Mapa operativo</h2>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-stretch gap-y-3">
            {FLUJO.map((m, i) => (
              <div key={m.href} className="flex items-center">
                <Link
                  href={m.href}
                  className="group flex w-[104px] flex-col items-center gap-1.5 rounded-md border border-gray-200 px-2 py-3 text-center transition-colors hover:border-[color:var(--brand-primary)] hover:bg-gray-50"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-md border" style={{ borderColor: "color-mix(in srgb, var(--brand-primary) 30%, white)", backgroundColor: tint("var(--brand-primary)"), color: "var(--brand-primary)" }}>
                    <m.icon size={17} strokeWidth={2} />
                  </span>
                  <span className="text-[11px] font-semibold leading-tight text-gray-700">{m.label}</span>
                </Link>
                {i < FLUJO.length - 1 && (
                  <ArrowRight size={16} className="mx-1 shrink-0 text-[color:var(--brand-connector,#B9785F)]" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── KPIs (instrumentos de control) ─────────────────────────────── */}
      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={FileSignature} label="Contratos activos" value={String(nActivos)} />
        <Kpi icon={Armchair} label="Cupos disponibles" value={String(cuposDisponibles)} />
        {interno && <Kpi icon={Wallet} label="Ventas del mes" value={formatCOP(ventaMes)} sub={hoy.split(",")[0]} />}
        {interno && <Kpi icon={HandCoins} label="Cartera por cobrar" value={formatCOP(cartera)} />}
        {!interno && <Kpi icon={Package} label="Paquetes" value={String(nPaquetes ?? 0)} />}
      </section>

      {/* ── Alertas operativas ─────────────────────────────────────────── */}
      <section className="mt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Alertas operativas</h2>
        <div className="flex flex-wrap gap-2">
          <Alerta icon={Clock} label="Contratos pendientes" n={nPendientes} href="/dashboard/contratos" tone="warn" />
          <Alerta icon={PlaneTakeoff} label="Salidas próximas (14d)" n={nSalidas ?? 0} href="/dashboard/vuelos" tone="info" />
          <Alerta icon={AlertTriangle} label="Cupos críticos" n={cuposCriticos} href="/dashboard/vuelos" tone="crit" />
          {interno && <Alerta icon={Receipt} label="Pagos por vencer (15d)" n={nPagos ?? 0} href="/dashboard/pagos" tone="warn" />}
        </div>
      </section>

      {/* ── Módulos técnicos ───────────────────────────────────────────── */}
      <h2 className="mb-3 mt-7 text-xs font-semibold uppercase tracking-wider text-gray-400">Módulos</h2>
      <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {MODULOS.filter((m) => !m.interno || interno).map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3.5 transition-colors hover:border-[color:var(--brand-primary)] hover:bg-gray-50/70"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border" style={{ borderColor: "color-mix(in srgb, " + m.color + " 28%, white)", backgroundColor: tint(m.color), color: m.color }}>
              <m.icon size={18} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-gray-800">{m.label}</div>
              <div className="truncate text-xs text-gray-400">{m.desc}</div>
            </div>
            <ChevronRight size={16} className="shrink-0 text-gray-300 transition-colors group-hover:text-[color:var(--brand-primary)]" />
          </Link>
        ))}
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <Icon size={15} className="text-gray-400" />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] capitalize text-gray-400">{sub}</div>}
    </div>
  );
}

const TONOS: Record<string, { bg: string; fg: string; bd: string }> = {
  warn: { bg: "#FFF7ED", fg: "#B9785F", bd: "#F3D9C7" },
  info: { bg: "#EFF4F8", fg: "#08233F", bd: "#D5E0EA" },
  crit: { bg: "#FEF2F2", fg: "#B42318", bd: "#FCD9D6" },
};

function Alerta({ icon: Icon, label, n, href, tone }: { icon: LucideIcon; label: string; n: number; href: string; tone: keyof typeof TONOS }) {
  const t = TONOS[tone];
  const apagada = n === 0;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
      style={apagada
        ? { borderColor: "#E4E7EF", color: "#98A2B3", backgroundColor: "white" }
        : { borderColor: t.bd, color: t.fg, backgroundColor: t.bg }}
    >
      <Icon size={15} />
      <span>{label}</span>
      <span className="rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={apagada ? { backgroundColor: "#F2F4F7", color: "#98A2B3" } : { backgroundColor: t.fg, color: "white" }}>
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

const MODULOS: { href: string; icon: LucideIcon; label: string; desc: string; color: string; interno: boolean }[] = [
  { href: "/dashboard/tarifario", icon: Tags, label: "Tarifario", desc: "Hoteles y precios", color: "var(--brand-accent)", interno: false },
  { href: "/dashboard/reservar", icon: Ticket, label: "Reservar", desc: "Generar contrato", color: "var(--brand-primary)", interno: false },
  { href: "/dashboard/producto", icon: Boxes, label: "Producto", desc: "Hoteles, vuelos, programas", color: "var(--brand-success)", interno: true },
  { href: "/dashboard/paquetes", icon: Package, label: "Paquetes", desc: "Armado y margen", color: "var(--brand-accent)", interno: true },
  { href: "/dashboard/contratos", icon: FileSignature, label: "Contratos", desc: "Ventas y estados", color: "var(--brand-primary)", interno: false },
  { href: "/dashboard/vuelos", icon: Plane, label: "Vuelos", desc: "Bloqueos y sillas", color: "var(--brand-accent)", interno: true },
  { href: "/dashboard/cartera", icon: HandCoins, label: "Cartera", desc: "Por cobrar / abonos", color: "var(--brand-success)", interno: true },
  { href: "/dashboard/pagos", icon: Receipt, label: "Pagos", desc: "Por pagar a proveedores", color: "var(--brand-primary)", interno: true },
  { href: "/dashboard/finanzas", icon: LineChart, label: "Finanzas", desc: "Relación de utilidades", color: "var(--brand-accent)", interno: true },
  { href: "/dashboard/configuracion", icon: Settings, label: "Configuración", desc: "Asesores y parámetros", color: "var(--brand-success)", interno: true },
];
