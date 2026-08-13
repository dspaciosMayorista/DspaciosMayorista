import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { miRol, LECTURA_MODULO } from "@/lib/roles";
import { SolicitudesClient, type Solicitud } from "./SolicitudesClient";

export const dynamic = "force-dynamic";

export default async function AprobacionesB2BPage() {
  const sb = await createClient();
  const rol = await miRol();
  if (!rol || !LECTURA_MODULO.b2b.includes(rol)) redirect("/dashboard");

  const [{ data }, { data: aliados }] = await Promise.all([
    sb.from("b2b_solicitudes")
      .select("id, tipo, nombre, nit, tipo_documento, aliado_sugerido_id, contacto, email, telefono, ciudad, notas, acepta_notificaciones, estado, revisado_por, created_at")
      .order("created_at", { ascending: false }),
    // Catálogo para elegir a mano con qué ficha se enlaza (migración 143).
    sb.from("aliados").select("id, nombre, nit, tipo_documento").order("nombre"),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/usuarios" className="text-sm text-gray-400 hover:text-gray-700">← Usuarios</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Aprobaciones B2B</h1>
      <p className="mb-6 text-sm text-gray-500">
        Solicitudes de registro de agencias y freelance. Al aprobar se activa la cuenta y se <strong>enlaza con su
        ficha del catálogo de aliados</strong>: eso es lo que le permite ver los contratos que un asesor interno le
        montó. Si el documento coincide con una ficha existente, aparece sugerida — verifícala antes de aprobar.
      </p>
      <SolicitudesClient solicitudes={(data ?? []) as Solicitud[]} aliados={aliados ?? []} />
    </div>
  );
}
