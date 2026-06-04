import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoContratoForm, type PaqueteOpt, type BloqueoOpt } from "../NuevoContratoForm";

export const dynamic = "force-dynamic";

export default async function NuevoContratoPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let asesorDefault = "";
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("nombre").eq("id", user.id).single();
    asesorDefault = perfil?.nombre ?? "";
  }

  const [{ data: paquetesRaw }, { data: bloqueosRaw }] = await Promise.all([
    sb.from("paquetes")
      .select("id, categoria, nombre, plan_alimentacion, impuesto_no_comisionable, paquete_hoteles(nombre, ciudad, alimentacion, acomodacion_detalle), paquete_precios(acomodacion, precio)")
      .eq("activo", true)
      .order("nombre"),
    sb.from("bloqueos_vuelo").select("id, record, ruta, fecha_ida, fecha_regreso, aerolinea").order("fecha_ida"),
  ]);

  const paquetes = (paquetesRaw ?? []) as unknown as PaqueteOpt[];
  const bloqueos = (bloqueosRaw ?? []) as unknown as BloqueoOpt[];

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/contratos" className="text-sm text-gray-400 hover:text-gray-600">← Contratos</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Nuevo contrato (manual)</h1>
      <p className="mb-4 text-sm text-gray-500">
        Para ventas <b>dinámicas</b> donde el asesor captura todo a mano.
      </p>
      <div className="mb-6 rounded-xl border border-[var(--brand-accent)] bg-[rgba(38,187,217,0.06)] p-4 text-sm">
        <p className="font-medium text-gray-800">¿Es un Bloqueo, Porción terrestre o Servicios del tarifario?</p>
        <p className="mt-1 text-gray-600">
          Esos ya no se arman aquí: se generan desde el <b>tarifario</b> para no recapturar datos.{" "}
          <Link href="/dashboard/reservar" className="font-semibold text-[var(--brand-primary)] hover:underline">Ir a Reservar →</Link>
        </p>
      </div>
      <NuevoContratoForm asesorDefault={asesorDefault} paquetes={paquetes} bloqueos={bloqueos} />
    </div>
  );
}
