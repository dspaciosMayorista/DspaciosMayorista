import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accesoClientesAliados, aliadoElegido } from "@/lib/crm/clientesAliadosAcceso";
import { ambitoDeAliado, leerClientesAliado } from "@/lib/portal/clientesAliadoServidor";
import { normalizarBusquedaClientes, paginarClientes } from "@/lib/portal/clientesAliado";

export const dynamic = "force-dynamic";

// «Clientes de aliados» (#76/#77): qué clientes tiene cada aliado B2B. Solo LECTURA y sin tabla propia: reutiliza lo que el CRM ya guarda
// (contratos y cotizaciones con el id del aliado) y la libreta que el aliado escribe. No toca Contactos ni campañas; nada se asigna por nombre.
export default async function ClientesAliadosPage({ searchParams }: { searchParams: Promise<{ aliado?: string | string[]; q?: string | string[]; p?: string | string[] }> }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol, activo, tenant").eq("id", user.id).maybeSingle() : { data: null };
  const acceso = accesoClientesAliados(perfil);
  if (!acceso.ok) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Clientes de aliados</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo no disponible para tu usuario.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const sp = await searchParams;
  const { data: aliados, error: errAliados } = await admin.from("aliados").select("id, nombre, tipo").order("nombre").limit(1000);
  const lista = (aliados ?? []) as { id: number; nombre: string; tipo: string | null }[];
  const elegido = aliadoElegido(sp.aliado, lista.map((a) => a.id));
  const q = normalizarBusquedaClientes(Array.isArray(sp.q) ? sp.q[0] : sp.q);

  const ambito = elegido ? await ambitoDeAliado(admin, elegido, acceso.tenants) : null;
  const lectura = ambito ? await leerClientesAliado(admin, ambito) : null;
  const pag = lectura?.ok ? paginarClientes(lectura.clientes, q, Number(Array.isArray(sp.p) ? sp.p[0] : sp.p), 25) : null;
  const href = (n: number) => `/crm/clientes-aliados?aliado=${elegido}${q ? `&q=${encodeURIComponent(q)}` : ""}&p=${n}`;

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Clientes de aliados</h1>
        <p className="mt-1 text-sm text-gray-500">
          Los clientes de cada aliado B2B: los de sus cotizaciones y contratos (por el id del aliado) y los que él guardó en su libreta. Solo lectura. No es la base de campañas ni se mezcla con Contactos.
          Los contratos antiguos sin aliado enlazado no se asignan por nombre.
        </p>
      </div>
      <form method="get" action="/crm/clientes-aliados" role="search" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="ca-aliado">Aliado</label>
        <select id="ca-aliado" name="aliado" defaultValue={elegido ?? ""} className="min-w-[14rem] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">Elige un aliado…</option>
          {lista.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.tipo ? ` · ${a.tipo}` : ""}</option>)}
        </select>
        <label className="sr-only" htmlFor="ca-q">Buscar cliente</label>
        <input id="ca-q" name="q" defaultValue={q ?? ""} maxLength={80} placeholder="Nombre, documento, correo o teléfono" className="min-w-[14rem] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        <button type="submit" className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white"><Search size={15} aria-hidden /> Ver</button>
      </form>

      {errAliados && <p className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">No se pudo cargar la lista de aliados.</p>}
      {!elegido && !errAliados && <p className="rounded-lg bg-white px-4 py-6 text-center text-sm text-gray-500">Elige un aliado para ver sus clientes.</p>}
      {elegido && (!ambito || !lectura || !lectura.ok) && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">No se pudieron cargar todos los clientes de este aliado; lo mostrado no sería completo, así que no se muestra nada. Intenta de nuevo.</p>}
      {pag && (pag.total === 0 ? (
        <p className="rounded-lg bg-white px-4 py-6 text-center text-sm text-gray-500">{q ? "Ningún cliente coincide." : "Este aliado aún no tiene clientes asociados."}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Contacto (libreta del aliado)</th><th className="px-3 py-2">Contratos</th><th className="px-3 py-2">Cotizaciones</th><th className="px-3 py-2">Último movimiento</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pag.items.map((c) => (
                  <tr key={c.clave}>
                    <td className="px-3 py-2 font-medium text-gray-900">{c.nombre}{c.guardado?.documento && <div className="text-xs font-normal text-gray-500">{c.guardado.tipo_documento} {c.guardado.documento}</div>}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{c.guardado ? <>{c.guardado.email && <div className="break-all">{c.guardado.email}</div>}{c.guardado.telefono && <div>{c.guardado.telefono}</div>}{!c.guardado.email && !c.guardado.telefono && "—"}</> : "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{c.contratos.length ? c.contratos.map((k) => k.numero_contrato).join(", ") : "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{c.cotizaciones.length ? c.cotizaciones.map((k) => k.codigo ?? `#${k.id}`).join(", ") : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{c.ultima ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pag.paginas > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
              {pag.pagina > 1 ? <a href={href(pag.pagina - 1)} className="text-[var(--brand-primary)] hover:underline">← Anterior</a> : <span />}
              <span>Página {pag.pagina} de {pag.paginas} · {pag.total} clientes</span>
              {pag.pagina < pag.paginas ? <a href={href(pag.pagina + 1)} className="text-[var(--brand-primary)] hover:underline">Siguiente →</a> : <span />}
            </div>
          )}
        </>
      ))}
    </div>
  );
}
