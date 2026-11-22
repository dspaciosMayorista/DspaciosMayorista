import Link from "next/link";
import { Search } from "lucide-react";
import { PortalShell, Titulo, Aviso } from "@/components/portal/PortalShell";
import { BotonTarifario } from "@/components/portal/BotonTarifario";
import { PortalGate } from "@/components/portal/PortalGate";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolverContextoPortal } from "@/lib/portal/b2bPortalServidor";
import { ambitoDeSesion, leerClientesAliado } from "@/lib/portal/clientesAliadoServidor";
import { normalizarBusquedaClientes, paginarClientes } from "@/lib/portal/clientesAliado";
import { ClientesAliado, type ClienteFila } from "./ClientesAliado";

export const dynamic = "force-dynamic";

/** «Mis clientes» (#76/#77): una sola lectura acotada por visita, sin sondeo; la página de 20 se recorta en el servidor. */
export default async function PortalClientes({ searchParams }: { searchParams: Promise<{ q?: string | string[]; p?: string | string[] }> }) {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;
  const sp = await searchParams;
  const q = normalizarBusquedaClientes(Array.isArray(sp.q) ? sp.q[0] : sp.q);
  const p = Number(Array.isArray(sp.p) ? sp.p[0] : sp.p);

  const ambito = ambitoDeSesion(ctx);
  const lectura = ambito ? await leerClientesAliado(createAdminClient(), ambito) : null;
  const pag = lectura?.ok ? paginarClientes(lectura.clientes, q, p) : null;
  const items: ClienteFila[] = (pag?.items ?? []).map((c) => ({
    clave: c.clave, nombre: c.nombre,
    guardado: c.guardado && { id: c.guardado.id, tipo_documento: c.guardado.tipo_documento, documento: c.guardado.documento, email: c.guardado.email, telefono: c.guardado.telefono, notas: c.guardado.notas, actualizado_en: c.guardado.actualizado_en },
    contratos: c.contratos.map((k) => ({ numero_contrato: k.numero_contrato, destino: k.destino, fecha_salida: k.fecha_salida, estado: k.estado })),
    cotizaciones: c.cotizaciones.map((k) => ({ id: k.id, codigo: k.codigo, destino: k.destino, fecha_salida: k.fecha_salida, estado: k.estado })),
  }));
  const href = (n: number) => `/portal/b2b/clientes?${q ? `q=${encodeURIComponent(q)}&` : ""}p=${n}`;

  return (
    <PortalShell nombre={ctx.nombre} rol={ctx.rol} cta={<BotonTarifario />} activa="clientes" mostrarAgentes={ctx.esTitularAgencia}>
      <Titulo apoyo="Los clientes de tus cotizaciones y contratos, más los que agregues tú.">Mis clientes</Titulo>
      {!ambito && <Aviso>Tu usuario aún no está enlazado a una ficha de aliado, así que no podemos listar tus clientes. Pide a D&apos;spacios que lo enlace.</Aviso>}
      {ambito && lectura && !lectura.ok && <Aviso>No pudimos cargar todos tus clientes en este momento; no significa que no tengas. Intenta más tarde.</Aviso>}
      {ctx.accesoLegacyNombre && <Aviso>Los contratos antiguos que aún no están enlazados a tu ficha no aparecen aquí hasta que D&apos;spacios los enlace.</Aviso>}
      {ambito && lectura?.ok && pag && (
        <>
          <form method="get" action="/portal/b2b/clientes" role="search" className="flex flex-wrap items-center gap-2">
            <label htmlFor="q-clientes" className="sr-only">Buscar cliente</label>
            <input id="q-clientes" name="q" defaultValue={q ?? ""} maxLength={80} placeholder="Nombre, documento, correo o teléfono" className="h-9 w-full max-w-sm rounded-md border border-gray-200 bg-white px-3 text-sm" />
            <button type="submit" className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}><Search size={16} aria-hidden /> Buscar</button>
            {q && <Link href="/portal/b2b/clientes" className="text-sm text-gray-500">Limpiar</Link>}
          </form>
          <ClientesAliado items={items} puedeEditar={!ctx.agenciaId} />
          {pag.paginas > 1 && (
            <nav aria-label="Páginas de clientes" className="flex items-center justify-between text-sm">
              {pag.pagina > 1 ? <Link href={href(pag.pagina - 1)}>← Anterior</Link> : <span />}
              <span className="text-gray-500">Página {pag.pagina} de {pag.paginas} · {pag.total} clientes</span>
              {pag.pagina < pag.paginas ? <Link href={href(pag.pagina + 1)}>Siguiente →</Link> : <span />}
            </nav>
          )}
        </>
      )}
    </PortalShell>
  );
}
