import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const NAV = [
  { href: "/dashboard/tarifario", label: "Tarifario" },
  { href: "/dashboard/contratos", label: "Contratos" },
  { href: "/dashboard/vuelos", label: "Vuelos" },
  { href: "/finanzas", label: "Finanzas" },
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

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
      {/* Barra superior (solo celular) */}
      <header
        className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3 md:hidden"
        style={{ borderTop: `4px solid var(--brand-primary)` }}
      >
        <a
          href="/dashboard"
          className="font-semibold"
          style={{ color: "var(--brand-primary)" }}
        >
          D&apos;spacios Travel
        </a>
        <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              {n.label}
            </a>
          ))}
        </nav>
      </header>

      {/* Sidebar (escritorio) */}
      <aside
        className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-white md:flex"
        style={{ borderTop: `4px solid var(--brand-primary)` }}
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <a
            href="/dashboard"
            className="text-base font-semibold"
            style={{ color: "var(--brand-primary)" }}
          >
            D&apos;spacios Travel
          </a>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((n) => (
            <NavItem key={n.href} href={n.href} label={n.label} />
          ))}
        </nav>
      </aside>

      {/* Contenido */}
      <main className="min-w-0 flex-1 overflow-x-hidden md:h-screen md:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
    >
      {label}
    </a>
  );
}
