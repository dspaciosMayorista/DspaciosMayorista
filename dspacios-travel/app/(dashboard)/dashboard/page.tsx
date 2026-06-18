import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatCOP } from "@/lib/utils";
import {
  FileText, Package, Armchair, Wallet, ChevronRight,
  Tags, Ticket, Boxes, FileSignature, Plane, HandCoins, Receipt, LineChart, Settings,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Tinte claro del color de marca para los chips de íconos (se adapta al tema).
const tint = (v: string) => `color-mix(in srgb, ${v} 12%, white)`;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = user
    ? await supabase.from("usuarios").select("nombre, rol").eq("id", user.id).single()
    : { data: null };
  const interno = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");

  const [{ count: nContratos }, { count: nPaquetes }, { data: cupos }, { data: ventasMes }] = await Promise.all([
    supabase.from("ventas").select("numero_contrato", { count: "exact", head: true }),
    supabase.from("paquetes").select("id", { count: "exact", head: true }),
    supabase.from("cupos_por_bloqueo").select("cupos_disponibles"),
    supabase.from("ventas").select("precio_venta, fecha_venta"),
  ]);

  const cuposDisponibles = (cupos ?? []).reduce((s, c) => s + Number(c.cupos_disponibles ?? 0), 0);
  const mesActual = new Date().toISOString().slice(0, 7);
  const ventaMesTotal = (ventasMes ?? [])
    .filter((v) => (v.fecha_venta ?? "").startsWith(mesActual))
    .reduce((s, v) => s + (v.precio_venta ?? 0), 0);

  const hoy = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const nombre = (perfil?.nombre ?? user?.email ?? "").split("@")[0];

  return (
    <div className="p-4 md:p-7">
      {/* ── Encabezado editorial (playa + degradado de marca, como el sitio) ── */}
      <header className="relative overflow-hidden rounded-xl px-6 py-8 text-white">
        {/* Imagen de fondo (playa) */}
        <img
          src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Degradado de marca encima (sólido a la izquierda → playa a la derecha) */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(100deg, var(--brand-primary) 22%, color-mix(in srgb, var(--brand-primary) 62%, transparent) 62%, color-mix(in srgb, var(--brand-primary) 12%, transparent) 100%)" }}
        />
        {/* Textura discreta de “rutas” (puntos) sobre el color */}
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1.4px)", backgroundSize: "22px 22px" }}
        />
        <div className="relative z-10">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/75">{hoy}</p>
          <h1 className="mt-1.5 text-2xl font-bold capitalize drop-shadow-sm md:text-[28px]">Hola, {nombre}</h1>
          <span
            className="mt-3 inline-block rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: "var(--brand-highlight)", color: "var(--brand-primary)" }}
          >
            {perfil?.rol ?? "—"}
          </span>
        </div>
      </header>

      {/* ── Métricas (paneles de control compactos) ────────────────────── */}
      <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={FileText} label="Contratos" value={String(nContratos ?? 0)} color="var(--brand-primary)" />
        <Metric icon={Package} label="Paquetes activos" value={String(nPaquetes ?? 0)} color="var(--brand-accent)" />
        <Metric icon={Armchair} label="Cupos disponibles" value={String(cuposDisponibles)} color="var(--brand-success)" />
        {interno && <Metric icon={Wallet} label="Ventas del mes" value={formatCOP(ventaMesTotal)} color="var(--brand-primary)" sub={hoy.split(",")[0]} highlight />}
      </section>

      {/* ── Módulos de operación ───────────────────────────────────────── */}
      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-gray-400">Módulos</h2>
      <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {MODULOS.filter((m) => !m.interno || interno).map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group flex items-center gap-3 rounded-[10px] border border-gray-200 bg-white p-3.5 transition-colors hover:border-[color:var(--brand-accent)] hover:bg-gray-50/70"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: tint(m.color), color: m.color }}>
              <m.icon size={18} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-gray-800">{m.label}</div>
              <div className="truncate text-xs text-gray-400">{m.desc}</div>
            </div>
            <ChevronRight size={16} className="shrink-0 text-gray-300 transition-colors group-hover:text-[color:var(--brand-accent)]" />
          </Link>
        ))}
      </section>
    </div>
  );
}

function Metric({
  icon: Icon, label, value, color, sub, highlight,
}: {
  icon: LucideIcon; label: string; value: string; color: string; sub?: string; highlight?: boolean;
}) {
  if (highlight) {
    return (
      <div className="bg-brand-gradient rounded-[10px] p-4 text-white">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15">
            <Icon size={18} strokeWidth={2} />
          </span>
          <span className="text-xs font-medium text-white/80">{label}</span>
        </div>
        <div className="mt-3 text-xl font-bold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-[11px] capitalize text-white/60">{sub}</div>}
      </div>
    );
  }
  return (
    <div className="rounded-[10px] border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ backgroundColor: tint(color), color }}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] capitalize text-gray-400">{sub}</div>}
    </div>
  );
}

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
