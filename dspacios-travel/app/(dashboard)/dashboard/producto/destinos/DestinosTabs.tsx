import Link from "next/link";

// Pestañas de Producto > Destinos. Son enlaces (cada pestaña es su propia ruta):
// "Destinos" = catálogo de ciudades/IATA; "Listas fijas" = listas comerciales
// administradas a mano (hoy: "Lista destino programas").
export function DestinosTabs({ activa }: { activa: "destinos" | "listas" }) {
  const tabs = [
    { id: "destinos" as const, href: "/dashboard/producto/destinos", label: "Destinos" },
    { id: "listas" as const, href: "/dashboard/producto/destinos/listas-fijas", label: "Listas fijas" },
  ];
  return (
    <nav aria-label="Secciones de destinos" className="mb-6 flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={activa === t.id ? "page" : undefined}
          className="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors"
          style={
            activa === t.id
              ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }
              : { borderColor: "transparent", color: "#6b7280" }
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
