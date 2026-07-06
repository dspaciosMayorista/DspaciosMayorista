import { createClient } from "@/lib/supabase/server";
import { tenantContext } from "@/lib/tenant.server";
import { TENANT_LABEL } from "@/lib/tenant";
import { ImportarClient } from "./ImportarClient";

export const dynamic = "force-dynamic";

export default async function ImportarHistoricoPage() {
  const { tenant } = await tenantContext();
  const esMinorista = tenant === "minorista";

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const autorizado = ["superadmin", "administracion"].includes(perfil?.rol ?? "");

  if (!autorizado) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Importar histórico</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Solo superadmin / administración pueden importar el histórico.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Importar histórico</h1>
        <p className="mt-1 text-sm text-gray-500">
          Carga las reservas y pagos antiguos pegando el contenido de las hojas de cálculo.
        </p>
      </div>

      <div
        className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
          esMinorista
            ? "border-[#66B596] bg-[#66B596]/10 text-[#2f6b54]"
            : "border-red-300 bg-red-50 text-red-700"
        }`}
      >
        Agencia activa: <strong>{TENANT_LABEL[tenant]}</strong>.{" "}
        {esMinorista ? (
          <>Todo lo que importes quedará en la minorista (números con prefijo <code>MIN-</code> para no chocar con la mayorista).</>
        ) : (
          <>El importador está pensado para el histórico de la <strong>Minorista</strong>. Cambia de agencia arriba a la izquierda antes de importar.</>
        )}
      </div>

      <ImportarClient habilitado={esMinorista} />
    </div>
  );
}
