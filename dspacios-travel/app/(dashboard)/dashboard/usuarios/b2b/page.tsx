import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { miRol, LECTURA_MODULO } from "@/lib/roles";
import { SolicitudesClient, type Solicitud } from "./SolicitudesClient";
import { actorReferidos, cargarCandidatosReferidos, cargarCatalogoReferidos } from "@/lib/referidos/servidor";
import { formatPct, type CandidatoReferido } from "@/lib/referidos/reglas";

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

  // #76: códigos de referido escritos en el registro (candidatos). Superadmin, gerencia y administración los VEN; solo superadmin/gerencia deciden. Dos llamadas a la base por carga, ninguna en reposo.
  const actor = await actorReferidos();
  const candidatos: Record<number, CandidatoReferido> = {};
  const vigentePorAliado: Record<number, string> = {};
  let referidores: { id: number; nombre: string }[] = [];
  if (actor) {
    const [cand, cat] = await Promise.all([cargarCandidatosReferidos(actor), actor.acceso.gestiona ? cargarCatalogoReferidos(actor) : Promise.resolve(null)]);
    if (cand.ok) for (const c of cand.datos) candidatos[c.solicitud_id] = c;
    if (cat?.ok) {
      referidores = cat.datos.referidores.filter((r) => r.activo).map((r) => ({ id: r.id, nombre: r.nombre }));
      for (const a of cat.datos.asignaciones) if (a.vigente_hasta === null) vigentePorAliado[a.aliado_id] = `${a.referidor_nombre} (${formatPct(a.pct)})`;
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/usuarios" className="text-sm text-gray-400 hover:text-gray-700">← Usuarios</Link>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Aprobaciones B2B</h1>
      <p className="mb-6 text-sm text-gray-500">
        Solicitudes de registro de agencias y freelance. Al aprobar se activa la cuenta y se <strong>enlaza con su
        ficha del catálogo de aliados</strong>: eso es lo que le permite ver los contratos que un asesor interno le
        montó. Si el documento coincide con una ficha existente, aparece sugerida — verifícala antes de aprobar.
      </p>
      <SolicitudesClient solicitudes={(data ?? []) as Solicitud[]} aliados={aliados ?? []} candidatos={candidatos} referidores={referidores} vigentePorAliado={vigentePorAliado} gestionaReferidos={actor?.acceso.gestiona === true} />
    </div>
  );
}
