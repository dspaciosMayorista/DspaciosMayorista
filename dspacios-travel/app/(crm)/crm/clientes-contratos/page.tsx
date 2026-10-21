import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Search, X, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import {
  COOKIE_BUSQUEDA, MAX_BUSQUEDA, MIN_BUSQUEDA, RUTA_LISTA,
  claseEstado, esRolClientesContratos, etiquetaCanal, listarClientesContratos, mensajeBusqueda,
  normalizarBusqueda, normalizarCursor, numeroParaMostrar, rolDelActor, rutaFicha, tenantParaRpc,
} from "@/lib/crm/clientesContratos68";

export const dynamic = "force-dynamic";

// «Clientes de contratos» (#68, migración 221) — UNA FILA POR CONTRATO. Separado de «Contactos» (crm_contactos,
// campañas) y de «Pasajeros de contratos» (188): aquí no se lee crm_contactos, no se agrupa por documento/nombre
// y no se infiere consentimiento. La autoridad (rol, tenant, venta solo propios, guarda de homónimos) vive en la
// RPC SECURITY DEFINER; esta página solo oculta el módulo a quien no debería verlo y pasa el filtro de agencia
// del superadmin. El texto buscado viaja en una cookie httpOnly, no en la URL (puede ser un nombre o un documento).

async function buscar(formData: FormData) {
  "use server";
  const ck = await cookies();
  const r = normalizarBusqueda(formData.get("q"));
  if (!r.ok) {
    ck.set(COOKIE_BUSQUEDA, `!${r.motivo}`, { httpOnly: true, sameSite: "lax", path: RUTA_LISTA, maxAge: 60 });
  } else if (r.q === null) {
    ck.delete({ name: COOKIE_BUSQUEDA, path: RUTA_LISTA });
  } else {
    ck.set(COOKIE_BUSQUEDA, r.q, { httpOnly: true, sameSite: "lax", path: RUTA_LISTA, maxAge: 1800 });
  }
  redirect(RUTA_LISTA);
}

async function limpiar() {
  "use server";
  const ck = await cookies();
  ck.delete({ name: COOKIE_BUSQUEDA, path: RUTA_LISTA });
  redirect(RUTA_LISTA);
}

function SinAcceso() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Clientes de contratos</h1>
      <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo no disponible para tu usuario.</p>
    </div>
  );
}

export default async function ClientesContratosPage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const sb = await createClient();
  const rol = await rolDelActor(sb);
  if (!esRolClientesContratos(rol)) return <SinAcceso />;

  const sp = await searchParams;
  const cursor = normalizarCursor(Array.isArray(sp.c) ? sp.c[0] : sp.c);
  const guardada = (await cookies()).get(COOKIE_BUSQUEDA)?.value ?? "";
  const avisoCookie = guardada.startsWith("!") ? guardada.slice(1) : null;
  const busq = avisoCookie ? { ok: true as const, q: null } : normalizarBusqueda(guardada);
  const q = busq.ok ? busq.q : null;
  const aviso = avisoCookie === "corta" || avisoCookie === "larga" || avisoCookie === "invalida"
    ? mensajeBusqueda(avisoCookie)
    : null;

  const tenantActivo = await getTenant();
  const res = await listarClientesContratos(sb, { tenant: tenantParaRpc(rol, tenantActivo), q, cursor });

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Clientes de contratos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Una fila por contrato, con los datos de contacto del cliente tal como se escribieron al venderlo. No es la base
          de campañas: nada de aquí se agrega a Contactos ni significa que la persona aceptó recibir publicidad. Dos
          contratos del mismo cliente aparecen como dos filas; no se unen por nombre ni documento.
          {rol === "venta" ? " Ves solo los contratos que figuran a tu nombre." : ""}
        </p>
      </div>

      <form action={buscar} className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="cc68-q">Buscar</label>
        <input
          id="cc68-q"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          minLength={MIN_BUSQUEDA}
          maxLength={MAX_BUSQUEDA}
          autoComplete="off"
          placeholder="Cliente, documento, correo, teléfono, destino o N.° de contrato"
          className="min-w-[16rem] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        />
        <button type="submit" className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white">
          <Search size={15} /> Buscar
        </button>
        {q && (
          <button formAction={limpiar} className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
            <X size={15} /> Quitar filtro
          </button>
        )}
      </form>
      {aviso && <p className="mb-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">{aviso}</p>}

      {!res.ok ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{res.error}</p>
      ) : res.filas.length === 0 ? (
        <p className="rounded-lg bg-white px-4 py-6 text-center text-sm text-gray-500">
          {q ? "Ningún contrato coincide con la búsqueda." : "No hay contratos para mostrar."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Contrato</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Contacto</th>
                  <th className="px-3 py-2">Destino</th>
                  <th className="px-3 py-2">Salida</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Canal</th>
                  <th className="px-3 py-2"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {res.filas.map((f) => (
                  <tr key={f.numero_contrato}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{numeroParaMostrar(f.numero_contrato)}</td>
                    <td className="px-3 py-2 text-gray-800">
                      {f.cliente || "—"}
                      {f.cliente_documento && <div className="text-xs text-gray-500">{f.cliente_documento}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {f.cliente_email && <div>{f.cliente_email}</div>}
                      {f.cliente_telefono && <div>{f.cliente_telefono}</div>}
                      {!f.cliente_email && !f.cliente_telefono && "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{f.destino ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{f.fecha_salida ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700" data-estado={claseEstado(f.estado)}>
                        {f.estado ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{etiquetaCanal(f)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={rutaFicha(f.numero_contrato)} className="inline-flex items-center gap-1 text-[var(--brand-primary)] hover:underline">
                        Ver <ChevronRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>{res.filas.length} contrato{res.filas.length === 1 ? "" : "s"} en esta página</span>
            <span className="flex gap-3">
              {cursor && <Link href={RUTA_LISTA} className="text-[var(--brand-primary)] hover:underline">Volver al inicio</Link>}
              {res.hayMas && (
                <Link
                  href={`${RUTA_LISTA}?c=${encodeURIComponent(res.filas[res.filas.length - 1].numero_contrato)}`}
                  className="text-[var(--brand-primary)] hover:underline"
                >
                  Siguiente página
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
