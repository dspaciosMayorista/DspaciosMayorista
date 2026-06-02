import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — se expande en fases posteriores */}
      <aside
        className="w-56 shrink-0 flex flex-col border-r border-gray-200 bg-white"
        style={{ borderTop: `4px solid var(--brand-primary)` }}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <span
            className="font-semibold text-base"
            style={{ color: "var(--brand-primary)" }}
          >
            D&apos;spacios Travel
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem href="/dashboard/tarifario" label="Tarifario" />
          <NavItem href="/dashboard/contratos" label="Contratos" />
          <NavItem href="/ventas" label="Ventas" />
          <NavItem href="/vuelos" label="Vuelos" />
          <NavItem href="/finanzas" label="Finanzas" />
        </nav>
      </aside>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
    >
      {label}
    </a>
  );
}
