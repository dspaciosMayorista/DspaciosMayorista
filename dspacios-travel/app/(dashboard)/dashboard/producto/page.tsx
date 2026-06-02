import Link from "next/link";

export const dynamic = "force-dynamic";

const SECCIONES = [
  { href: "/dashboard/producto/configuracion", icon: "⚙️", label: "Configuración general de hoteles", desc: "Categorías de habitación y régimen de alimentación" },
  { href: "/dashboard/producto/proveedores", icon: "🤝", label: "Proveedores", desc: "Hoteleros, aéreos y de servicios" },
  { href: "/dashboard/producto/hoteles", icon: "🏨", label: "Hoteles y tarifas", desc: "Habitaciones, temporadas y tarifa neta" },
  { href: "/dashboard/vuelos", icon: "✈️", label: "Aéreo (bloqueos)", desc: "Aerolínea, vuelos, cupos y valor neto" },
  { href: "/dashboard/producto/servicios", icon: "🧰", label: "Servicios adicionales", desc: "Asistencia, traslados, tours" },
];

export default function ProductoPage() {
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Producto</h1>
      <p className="mt-1 text-sm text-gray-500">
        Tarifas negociadas (solo costo neto que pagas al proveedor). El margen se define luego en Paquetes.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SECCIONES.map((s) => (
          <Link key={s.href} href={s.href}
            className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-[#1D7C9A] hover:shadow-sm">
            <span className="text-2xl">{s.icon}</span>
            <div>
              <span className="font-semibold text-gray-800">{s.label}</span>
              <p className="text-xs text-gray-500">{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
