import Link from "next/link";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default function PortalLanding() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="bg-brand-gradient px-6 py-10 text-white">
        <div className="mx-auto max-w-4xl">
          <Logo variant="white" height={48} priority className="h-11 w-auto" />
          <h1 className="mt-4 text-2xl font-semibold">Bienvenido a D&apos;spacios Travel</h1>
          <p className="mt-1 text-sm opacity-90">Elige cómo quieres ingresar.</p>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-4xl flex-1 grid-cols-1 gap-5 px-6 py-10 sm:grid-cols-2">
        <Link href="/dashboard" className="group rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
          <div className="text-3xl">🛠️</div>
          <h2 className="mt-3 text-lg font-semibold text-gray-900">Portal Admin</h2>
          <p className="mt-1 text-sm text-gray-500">Equipo interno: operación, ventas, producto, finanzas y configuración.</p>
          <span className="mt-4 inline-block text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Ingresar →</span>
        </Link>
        <Link href="/portal/b2b" className="group rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
          <div className="text-3xl">🤝</div>
          <h2 className="mt-3 text-lg font-semibold text-gray-900">Portal B2B</h2>
          <p className="mt-1 text-sm text-gray-500">Agencias y freelance: cotiza, compra y consulta tus contratos.</p>
          <span className="mt-4 inline-block text-sm font-semibold" style={{ color: "var(--brand-accent)" }}>Ingresar / Registrarse →</span>
        </Link>
      </main>
    </div>
  );
}
