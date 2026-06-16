import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";

// El CMS vive fuera del layout del dashboard (ruta /cms). Aquí solo validamos
// que haya sesión; la validación dura de superadmin la hace la propia page.tsx.
export default async function CmsLayout({
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
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header
        className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3"
        style={{ borderTop: `4px solid var(--brand-primary)` }}
      >
        <a href="/dashboard" aria-label="D'spacios Travel — inicio">
          <Logo variant="full" height={32} className="h-7 w-auto" priority />
        </a>
        <div className="flex items-center gap-3">
          <a
            href="/sitio_web"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            IR AL SITIO WEB ↗
          </a>
          <a
            href="/dashboard"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            ← Volver al portal
          </a>
        </div>
      </header>
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
