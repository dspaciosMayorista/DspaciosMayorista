import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function PagarPage() {
  const sb = await createClient();
  const { data } = await sb.from("config_sitio").select("link_pago").eq("id", 1).maybeSingle();
  const link = data?.link_pago ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="bg-brand-gradient px-6 py-10 text-white">
        <div className="mx-auto max-w-2xl">
          <Link href="/portal"><Logo variant="white" height={44} priority className="h-10 w-auto" /></Link>
          <h1 className="mt-4 text-2xl font-semibold">Pagos en línea</h1>
          <p className="mt-1 text-sm opacity-90">Realiza el pago de tu reserva de forma segura.</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          {link ? (
            <>
              <div className="text-3xl">💳</div>
              <h2 className="mt-3 text-lg font-semibold text-gray-900">Paga tu reserva</h2>
              <p className="mt-1 text-sm text-gray-500">Serás dirigido a la pasarela de pago. Ten a mano tu número de contrato.</p>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-block rounded-lg px-6 py-3 text-sm font-semibold text-white"
                style={{ backgroundColor: "var(--brand-primary)" }}
              >
                Pagar en línea →
              </a>
              <p className="mt-4 text-xs text-gray-400">Tras pagar, envía el comprobante a tu asesor para registrar el abono.</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">El pago en línea aún no está habilitado. Comunícate con tu asesor para las opciones de pago.</p>
          )}
        </div>
      </main>
    </div>
  );
}
