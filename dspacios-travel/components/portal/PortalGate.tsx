import Link from "next/link";
import { Clock } from "lucide-react";
import { PortalShell } from "@/components/portal/PortalShell";
import type { ContextoPortal } from "@/lib/portal/b2bPortalServidor";

/** Pantallas de quien NO es un aliado activo: ingreso/registro (visitante o interno) y «registro en revisión». */
export function PortalGate({ ctx }: { ctx: Exclude<ContextoPortal, { estado: "ok" }> }) {
  if (ctx.estado === "pendiente") {
    return (
      <PortalShell nombre={ctx.nombre}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <Clock aria-hidden className="mx-auto h-7 w-7 text-amber-600" />
          <h2 className="mt-2 text-lg font-semibold text-gray-800">Registro en revisión</h2>
          <p className="mt-1 text-sm text-gray-600">Tu cuenta fue creada y está pendiente de aprobación. Te avisaremos cuando esté lista.</p>
        </div>
      </PortalShell>
    );
  }
  return (
    <PortalShell nombre={ctx.nombre}>
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Portal de aliados</h2>
        <p className="mt-1 text-sm text-gray-500">Agencias y freelance: ingresa o regístrate.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/login" className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>Iniciar sesión</Link>
          <Link href="/portal/registro" className="rounded-lg border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }}>Registrarse</Link>
        </div>
        {ctx.estado === "interno" && (
          <p className="mt-4 text-xs text-gray-400">
            Estás con una cuenta interna. ¿Buscas tu panel? <Link href="/dashboard" className="font-semibold" style={{ color: "var(--brand-primary)" }}>Portal Admin</Link>.
          </p>
        )}
      </div>
    </PortalShell>
  );
}
