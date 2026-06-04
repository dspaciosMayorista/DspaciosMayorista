import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCOP, formatFechaLarga } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion", "operaciones", "venta"];
const CAT_LABEL: Record<string, string> = {
  cliente_final: "Cliente final", agencia: "Agencia", freelance: "Freelance", empresa: "Empresa", pasajero: "Pasajero",
};

function Dato({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">{k}</span>
      <span className="text-sm text-gray-800">{v || "—"}</span>
    </div>
  );
}

export default async function ContactoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contactoId = Number(id);
  if (isNaN(contactoId)) notFound();

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) notFound();

  const { data: c } = await sb.from("crm_contactos").select("*").eq("id", contactoId).maybeSingle();
  if (!c) notFound();

  // Cruce con ventas: por documento o email; si no hay, por nombre.
  type Venta = { numero_contrato: string; fecha_venta: string | null; destino: string | null; precio_venta: number | null; estado: string | null };
  let ventas: Venta[] = [];
  const ors: string[] = [];
  if (c.documento) ors.push(`cliente_documento.eq.${c.documento}`);
  if (c.email) ors.push(`cliente_email.eq.${c.email}`);
  if (ors.length) {
    const { data } = await sb.from("ventas").select("numero_contrato, fecha_venta, destino, precio_venta, estado").or(ors.join(",")).order("fecha_venta", { ascending: false });
    ventas = (data ?? []) as Venta[];
  } else if (c.nombre) {
    const { data } = await sb.from("ventas").select("numero_contrato, fecha_venta, destino, precio_venta, estado").ilike("cliente", `%${c.nombre}%`).order("fecha_venta", { ascending: false });
    ventas = (data ?? []) as Venta[];
  }

  const vigentes = ventas.filter((v) => !["cancelado", "cancelada"].includes((v.estado ?? "").toLowerCase()));
  const totalComprado = vigentes.reduce((s, v) => s + (Number(v.precio_venta) || 0), 0);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/crm" className="text-sm text-gray-400 hover:text-gray-600">← CRM</Link>
      <div className="mt-2 mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">{c.nombre}</h1>
        <span className="rounded-full bg-[var(--brand-accent)]/15 px-2 py-0.5 text-xs text-gray-600">{CAT_LABEL[c.categoria] ?? c.categoria}</span>
        {c.acepta_publicidad && <span className="rounded-full bg-[var(--brand-success)]/15 px-2 py-0.5 text-xs text-[var(--brand-success)]">acepta publicidad</span>}
        {c.no_contactar && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">no contactar</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Dato k="Email" v={c.email} />
        <Dato k="Teléfono" v={c.telefono} />
        <Dato k="Documento" v={c.documento} />
        <Dato k="Ciudad" v={c.ciudad} />
        <Dato k="País" v={c.pais} />
        <Dato k="Nacimiento" v={c.fecha_nacimiento} />
        <Dato k="Género" v={c.genero} />
        <Dato k="Origen" v={c.origen} />
      </div>
      {c.notas && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{c.notas}</p>}

      {/* Cruce con ventas */}
      <h2 className="mt-8 mb-3 text-sm font-semibold text-gray-700">Historial de compras</h2>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-[10px] uppercase opacity-80">Total comprado</div>
          <div className="text-xl font-bold tabular-nums">{formatCOP(totalComprado)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[10px] uppercase text-gray-400">Contratos</div>
          <div className="text-xl font-bold tabular-nums">{ventas.length}</div>
        </div>
      </div>

      {ventas.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Contrato</th><th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Destino</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2">Estado</th>
            </tr></thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.numero_contrato} className="border-t border-gray-50">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/contratos/${encodeURIComponent(v.numero_contrato)}`} className="font-mono text-[var(--brand-primary)] hover:underline">{v.numero_contrato}</Link>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{formatFechaLarga(v.fecha_venta)}</td>
                  <td className="px-3 py-2 text-gray-600">{v.destino ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCOP(Number(v.precio_venta) || 0)}</td>
                  <td className="px-3 py-2 text-gray-500">{v.estado ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          Sin compras enlazadas. Se cruza por documento/email (o nombre si no hay).
        </p>
      )}
    </div>
  );
}
