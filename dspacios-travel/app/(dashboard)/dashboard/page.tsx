import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatCOP } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Tinte claro del color de marca para los chips de íconos (se adapta al tema).
const tint = (v: string) => `color-mix(in srgb, ${v} 14%, white)`;

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

  return (
    <div className="p-4 md:p-8">
      {/* Banner de bienvenida con degradado de marca */}
      <div className="bg-brand-gradient relative overflow-hidden rounded-2xl px-6 py-7 text-white shadow-sm">
        <div className="relative z-10">
          <p className="text-xs uppercase tracking-wider opacity-80">{hoy}</p>
          <h1 className="mt-1 text-2xl font-semibold md:text-3xl">
            Hola, {perfil?.nombre ?? user?.email} 👋
          </h1>
          <span className="mt-2 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur">
            {perfil?.rol ?? "—"}
          </span>
        </div>
        {/* Adorno */}
        <div className="pointer-events-none absolute -right-6 -top-8 select-none text-[9rem] leading-none opacity-15">✈️</div>
      </div>

      {/* Métricas */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Stat icon="📋" label="Contratos" value={String(nContratos ?? 0)} color="var(--brand-primary)" />
        <Stat icon="📦" label="Paquetes" value={String(nPaquetes ?? 0)} color="var(--brand-accent)" />
        <Stat icon="🪑" label="Cupos disponibles" value={String(cuposDisponibles)} color="var(--brand-success)" />
        {interno && <Stat icon="💰" label="Ventas del mes" value={formatCOP(ventaMesTotal)} color="var(--brand-primary)" highlight />}
      </div>

      {/* Accesos rápidos */}
      <h2 className="mb-3 mt-9 text-sm font-semibold uppercase tracking-wide text-gray-400">Accesos rápidos</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MODULOS.filter((m) => !m.interno || interno).map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl transition-transform group-hover:scale-110"
              style={{ backgroundColor: tint(m.color) }}
            >
              {m.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-sm font-semibold text-gray-800">
                {m.label}
                <span className="opacity-0 transition-opacity group-hover:opacity-100" style={{ color: m.color }}>→</span>
              </div>
              <div className="text-xs text-gray-400">{m.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  color,
  highlight,
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <div className="bg-brand-gradient rounded-2xl p-4 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs opacity-80">{label}</span>
          <span className="text-lg">{icon}</span>
        </div>
        <div className="mt-2 text-xl font-bold tabular-nums">{value}</div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg text-base" style={{ backgroundColor: tint(color) }}>
          {icon}
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

const MODULOS = [
  { href: "/dashboard/tarifario", icon: "🏨", label: "Tarifario", desc: "Hoteles y precios", color: "var(--brand-accent)", interno: false },
  { href: "/dashboard/reservar", icon: "🧳", label: "Reservar", desc: "Generar contrato", color: "var(--brand-primary)", interno: false },
  { href: "/dashboard/producto", icon: "🧱", label: "Producto", desc: "Hoteles, vuelos, programas", color: "var(--brand-success)", interno: true },
  { href: "/dashboard/paquetes", icon: "📦", label: "Paquetes", desc: "Armado y margen", color: "var(--brand-accent)", interno: true },
  { href: "/dashboard/contratos", icon: "📋", label: "Contratos", desc: "Ventas y estados", color: "var(--brand-primary)", interno: false },
  { href: "/dashboard/vuelos", icon: "✈️", label: "Vuelos", desc: "Bloqueos y sillas", color: "var(--brand-accent)", interno: true },
  { href: "/dashboard/cartera", icon: "💵", label: "Cartera", desc: "Por cobrar / abonos", color: "var(--brand-success)", interno: true },
  { href: "/dashboard/pagos", icon: "🧾", label: "Pagos", desc: "Por pagar a proveedores", color: "var(--brand-primary)", interno: true },
  { href: "/dashboard/finanzas", icon: "📊", label: "Finanzas", desc: "Relación de utilidades", color: "var(--brand-accent)", interno: true },
  { href: "/dashboard/configuracion", icon: "⚙️", label: "Configuración", desc: "Asesores y parámetros", color: "var(--brand-success)", interno: true },
];
