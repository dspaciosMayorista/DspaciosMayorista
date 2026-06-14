import Link from "next/link";
import { Logo } from "@/components/Logo";
import { RegistroForm } from "./RegistroForm";

export const dynamic = "force-dynamic";

export default function RegistroB2BPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-gradient px-6 py-8 text-white">
        <div className="mx-auto max-w-2xl">
          <Link href="/portal/b2b"><Logo variant="white" height={40} priority className="h-9 w-auto" /></Link>
          <h1 className="mt-3 text-2xl font-semibold">Registro de aliado B2B</h1>
          <p className="mt-1 text-sm opacity-90">Completa tus datos. Un asesor revisará y aprobará tu acceso.</p>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <RegistroForm />
        </div>
      </main>
    </div>
  );
}
