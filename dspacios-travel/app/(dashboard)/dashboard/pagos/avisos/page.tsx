import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { modoCorreo } from "@/lib/solicitudProveedor/transporte";
import { AvisosPagoClient, type AvisoHistorial } from "./AvisosPagoClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion", "operaciones"];

// #103 (D): avisar a un proveedor los pagos YA registrados, con su soporte. Esta pantalla no registra ni modifica pagos: solo los lee, guarda evidencia y envía el aviso.
export default async function AvisosPagoPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Aviso de pago a proveedores</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No tienes permisos para avisar pagos a proveedores. Solicítalo a un administrador.</p>
      </div>
    );
  }
  const tenant = await getTenant();
  const { data: cxps } = await sb.from("cuentas_por_pagar").select("id, proveedor").eq("tenant", tenant).not("proveedor", "is", null);
  const conPagos = new Set<number>();
  if ((cxps ?? []).length) {
    const { data: ps } = await sb.from("cxp_pagos").select("cuenta_por_pagar_id").eq("tenant", tenant).in("cuenta_por_pagar_id", cxps!.map((x) => x.id));
    for (const p of ps ?? []) conPagos.add(p.cuenta_por_pagar_id);
  }
  const proveedores = [...new Set((cxps ?? []).filter((x) => conPagos.has(x.id)).map((x) => (x.proveedor ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const { data: hist, error: errHist } = await sb.from("solicitudes_proveedor").select("id, proveedor, estado, destinatarios, asunto, referencia, error_envio, enviada_en, entregada_en, respondida_en, created_at").eq("tipo", "pago").eq("tenant", tenant).order("created_at", { ascending: false }).limit(50);
  const modo = modoCorreo();
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Aviso de pago a proveedores</h1>
        <p className="mt-1 text-sm text-gray-500">Elige un proveedor, marca los pagos ya registrados que quieres avisar, adjunta el soporte y revisa la vista previa. Registrar el pago, subir el soporte y enviar el aviso son pasos separados: enviar no modifica ni vuelve a registrar el pago.</p>
      </div>
      {errHist ? <p role="note" className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">El seguimiento de avisos aún no está disponible en esta base de datos (falta aplicar las migraciones 328 y 329).</p>
        : <AvisosPagoClient proveedores={proveedores} historial={(hist ?? []) as unknown as AvisoHistorial[]} correoHabilitado={modo !== "off"} modoCaptura={modo === "captura"} />}
    </div>
  );
}
