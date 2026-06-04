import { createClient } from "@/lib/supabase/server";
import { AliadosClient } from "./AliadosClient";

export const dynamic = "force-dynamic";

export default async function AliadosPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  const admin = ["superadmin", "administracion", "gerencia"].includes(perfil?.rol ?? "");
  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Agencias y freelance</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Solo administración / gerencia.</p>
      </div>
    );
  }

  const [{ data: aliados }, { data: params }] = await Promise.all([
    sb.from("aliados").select("id, nombre, tipo, nit, contacto, email, telefono, pct_comision, aplica_retencion, pct_retencion").order("tipo").order("nombre"),
    sb.from("parametros_tributarios").select("parametro, valor").in("parametro", ["COMISION_AGENCIA", "COMISION_FREELANCE"]),
  ]);
  const pmap = new Map((params ?? []).map((p) => [p.parametro, Number(p.valor)]));

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Agencias y freelance</h1>
      <p className="mb-6 text-sm text-gray-500">Catálogo con el % de comisión negociado y la retención por entidad.</p>
      <AliadosClient
        aliados={aliados ?? []}
        defAgencia={pmap.get("COMISION_AGENCIA") ?? 0.12}
        defFreelance={pmap.get("COMISION_FREELANCE") ?? 0.11}
      />
    </div>
  );
}
