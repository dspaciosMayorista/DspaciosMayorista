import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "../(dashboard)/LogoutButton";

// Layout PROPIO del CRM: toma toda la pantalla (sin el sidebar del portal) para
// que quien lo opera sienta que es una app aparte. El botón "PORTAL" regresa al
// dashboard. Fondo tintado de marca (no blanco).
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "linear-gradient(160deg, #dceef3 0%, #e6f3ee 55%, #eef6f1 100%)" }}
    >
      {/* Barra superior del CRM (degradado de marca) */}
      <header className="bg-brand-gradient text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 md:px-8">
          <Link href="/crm" className="flex items-center gap-2">
            <Logo variant="white" height={26} className="h-6 w-auto" />
            <span className="rounded-md bg-white/15 px-2 py-0.5 text-sm font-semibold tracking-wide">CRM</span>
          </Link>
          <nav className="ml-2 flex items-center gap-1 text-sm">
            <Link href="/crm" className="rounded-lg px-3 py-1.5 hover:bg-white/15">Contactos</Link>
            <Link href="/crm/email" className="rounded-lg px-3 py-1.5 hover:bg-white/15">Config email</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-semibold text-[var(--brand-primary)] hover:bg-white"
            >
              ← PORTAL
            </Link>
            <LogoutButton className="rounded-lg px-3 py-1.5 text-sm text-white/90 hover:bg-white/15" />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
