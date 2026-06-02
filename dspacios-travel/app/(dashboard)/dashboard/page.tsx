import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatCOP } from "@/lib/utils";

export const dynamic = "force-dynamic";

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

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Bienvenido, {perfil?.nombre ?? user?.email}</h1>
      <p className="mt-1 text-sm text-gray-500">Rol: <span className="font-medium">{perfil?.rol ?? "—"}</span></p>

      {/* Métricas */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Contratos" value={String(nContratos ?? 0)} />
        <Stat label="Paquetes" value={String(nPaquetes ?? 0)} />
        <Stat label="Cupos disponibles" value={String(cuposDisponibles)} />
        {interno && <Stat label="Ventas del mes" value={formatCOP(ventaMesTotal)} primary />}
      </div>

      {/* Módulos */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {MODULOS.filter((m) => !m.interno || interno).map((m) => (
          <Link key={m.href} href={m.href}
            className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-[#1D7C9A] hover:shadow-sm">
            <span className="text-2xl">{m.icon}</span>
            <span className="text-sm font-medium text-gray-700">{m.label}</span>
            <span className="text-xs text-gray-400">{m.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${primary ? "text-white" : "border border-gray-200 bg-white"}`}
      style={primary ? { backgroundColor: "var(--brand-primary)" } : undefined}>
      <div className={`text-xs ${primary ? "opacity-80" : "text-gray-400"}`}>{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

const MODULOS = [
  { href: "/dashboard/tarifario", icon: "🏨", label: "Tarifario", desc: "Hoteles y precios", interno: false },
  { href: "/dashboard/paquetes", icon: "📦", label: "Paquetes", desc: "Productos negociados", interno: true },
  { href: "/dashboard/contratos", icon: "📋", label: "Contratos", desc: "Generar contratos", interno: false },
  { href: "/dashboard/vuelos", icon: "✈️", label: "Vuelos", desc: "Bloqueos y sillas", interno: true },
  { href: "/dashboard/finanzas", icon: "📊", label: "Finanzas", desc: "Relación de utilidades", interno: true },
  { href: "/dashboard/configuracion", icon: "⚙️", label: "Configuración", desc: "Asesores y parámetros", interno: true },
];
