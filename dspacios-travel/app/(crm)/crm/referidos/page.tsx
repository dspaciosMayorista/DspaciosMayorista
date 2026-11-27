import { Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { actorReferidos, cargarCandidatosReferidos, cargarCatalogoReferidos, cargarContratosReferidos } from "@/lib/referidos/servidor";
import { ETIQUETA_ESTADO, esEstadoReferido } from "@/lib/referidos/reglas";
import { ReferidosClient } from "./ReferidosClient";
import { CandidatosReferido } from "./CandidatosReferido";

export const dynamic = "force-dynamic";

// «Referidos» (#76): quién refirió a cada agencia o freelance, a qué porcentaje (1 % o 2 %), los contratos atribuidos y si su participación ya es pagable (contrato 100 % pagado).
// Solo superadmin y gerencia gestionan; administración consulta. Una llamada a la base para el catálogo y otra para los contratos por carga de página (acotada a 100 filas); sin sondeos.
export default async function ReferidosPage({ searchParams }: { searchParams: Promise<{ referidor?: string | string[]; estado?: string | string[] }> }) {
  const actor = await actorReferidos();
  if (!actor) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Referidos</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo no disponible para tu usuario.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const referidorRaw = Number(uno(sp.referidor));
  const estadoRaw = uno(sp.estado);
  const estado = esEstadoReferido(estadoRaw) ? estadoRaw : null;

  const [cat, con, aliadosRes, cand] = await Promise.all([
    cargarCatalogoReferidos(actor),
    cargarContratosReferidos(actor, { referidorId: Number.isInteger(referidorRaw) && referidorRaw > 0 ? referidorRaw : null, estado }),
    createAdminClient().from("aliados").select("id, nombre, tipo").order("nombre").limit(1000),
    cargarCandidatosReferidos(actor),
  ]);
  const referidores = cat.ok ? cat.datos.referidores : [];
  const error = !cat.ok ? cat.error : !con.ok ? con.error : !cand.ok ? cand.error : aliadosRes.error ? "No se pudo cargar la lista de aliados." : null;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Referidos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Una persona que trae a una agencia o freelance recibe el 1 % o el 2 % de la base comisionable de las compras futuras de ese aliado. La participación del referidor es distinta de la comisión del propio aliado
          y solo es pagable cuando el contrato está 100 % pagado.
        </p>
      </div>
      <form method="get" action="/crm/referidos" role="search" className="mb-5 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="rf-ref">Referidor</label>
        <select id="rf-ref" name="referidor" defaultValue={Number.isInteger(referidorRaw) && referidorRaw > 0 ? String(referidorRaw) : ""} className="min-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">Todos los referidores</option>
          {referidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        <label className="sr-only" htmlFor="rf-est">Estado</label>
        <select id="rf-est" name="estado" defaultValue={estado ?? ""} className="min-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">Todos los estados</option>
          {(Object.keys(ETIQUETA_ESTADO) as (keyof typeof ETIQUETA_ESTADO)[]).map((k) => <option key={k} value={k}>{ETIQUETA_ESTADO[k].texto}</option>)}
        </select>
        <button type="submit" className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white"><Search size={15} aria-hidden /> Filtrar</button>
      </form>
      <CandidatosReferido candidatos={cand.ok ? cand.datos : []} referidores={referidores.filter((r) => r.activo).map((r) => ({ id: r.id, nombre: r.nombre }))} gestiona={actor.acceso.gestiona} />
      <ReferidosClient
        gestiona={actor.acceso.gestiona}
        referidores={referidores}
        asignaciones={cat.ok ? cat.datos.asignaciones : []}
        contratos={con.ok ? con.datos : []}
        aliados={(aliadosRes.data ?? []) as { id: number; nombre: string; tipo: string | null }[]}
        hayMas={con.ok && con.datos.some((c) => c.hay_mas)}
        error={error}
      />
    </div>
  );
}
