import { createClient } from "@/lib/supabase/server";
import { ConfigClient } from "./ConfigClient";
import { EscalasComisionConfig } from "./EscalasComisionConfig";
import { SolicitudesConfig } from "./SolicitudesConfig";
import { CobrosConfig } from "./CobrosConfig";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const admin = ["superadmin", "administracion", "gerencia"].includes(perfil?.rol ?? "");

  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Configuración</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Solo administración / gerencia pueden ver la configuración.
        </p>
      </div>
    );
  }

  const [{ data: parametros }, { data: rangos }, { data: formasPago }, { data: escalas }, { data: escalaRangos }, { data: vendedores }, { data: configSolicitudes }, { data: configCobros }] = await Promise.all([
    sb.from("parametros_tributarios").select("parametro, valor, descripcion").order("parametro"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
    sb.from("formas_pago").select("id, nombre").order("orden"),
    sb.from("escalas_comision").select("id, nombre").order("nombre"),
    sb.from("escala_rangos").select("escala_id, pvp_desde, pvp_hasta, pct, orden").order("orden"),
    sb.from("usuarios").select("id, nombre, escala_id, aplica_retencion").eq("rol", "venta").order("nombre"),
    sb.from("config_solicitudes").select("whatsapp, emails, mensaje_extra").eq("id", 1).maybeSingle(),
    sb.from("config_cobros").select("tipo_paquete, pct_abono").order("tipo_paquete"),
  ]);

  const escalasConRangos = (escalas ?? []).map((e) => ({
    id: e.id,
    nombre: e.nombre,
    rangos: (escalaRangos ?? []).filter((r) => r.escala_id === e.id)
      .map((r) => ({ pvp_desde: Number(r.pvp_desde), pvp_hasta: r.pvp_hasta == null ? null : Number(r.pvp_hasta), pct: Number(r.pct) })),
  }));
  const vendedoresEscala = (vendedores ?? []).map((v) => ({ id: v.id, nombre: v.nombre, escala_id: v.escala_id ?? null, aplica_retencion: v.aplica_retencion ?? true }));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Configuración</h1>
      <p className="mb-6 text-sm text-gray-500">Escalas de comisión, parámetros tributarios, rangos de edad y formas de pago.</p>
      <ConfigClient parametros={parametros ?? []} rangos={rangos ?? []} formasPago={formasPago ?? []} />
      <div className="mt-8">
        <EscalasComisionConfig escalas={escalasConRangos} vendedores={vendedoresEscala} />
      </div>
      <div className="mt-8">
        <SolicitudesConfig config={configSolicitudes ?? null} />
      </div>
      <div className="mt-8">
        <CobrosConfig config={configCobros ?? []} esSuperadmin={perfil?.rol === "superadmin"} />
      </div>
    </div>
  );
}
