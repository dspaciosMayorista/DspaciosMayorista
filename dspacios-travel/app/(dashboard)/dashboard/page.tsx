import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("nombre, rol")
    .eq("id", user!.id)
    .single();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">
        Bienvenido, {perfil?.nombre ?? user?.email}
      </h1>
      <p className="text-sm text-gray-500 mt-1">
        Rol: <span className="font-medium">{perfil?.rol ?? "—"}</span>
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {MODULOS.map((m) => (
          <a
            key={m.href}
            href={m.href}
            className="flex flex-col gap-2 p-4 bg-white rounded-xl border border-gray-200 hover:border-[#1D7C9A] hover:shadow-sm transition-all"
          >
            <span className="text-2xl">{m.icon}</span>
            <span className="text-sm font-medium text-gray-700">{m.label}</span>
            <span className="text-xs text-gray-400">{m.desc}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

const MODULOS = [
  { href: "/dashboard/tarifario", icon: "🏨", label: "Tarifario", desc: "Hoteles y precios" },
  { href: "/dashboard/contratos", icon: "📋", label: "Contratos", desc: "Generar contratos" },
  { href: "/ventas", icon: "💼", label: "Ventas", desc: "Gestión y abonos" },
  { href: "/vuelos", icon: "✈️", label: "Vuelos", desc: "Inventario de sillas" },
  { href: "/finanzas", icon: "📊", label: "Finanzas", desc: "Rentabilidad" },
];
