import { PortalShell, Titulo, Aviso } from "@/components/portal/PortalShell";
import { BotonTarifario } from "@/components/portal/BotonTarifario";
import { PortalGate } from "@/components/portal/PortalGate";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolverContextoPortal, categoriaDelPortal, linkPagoPortal } from "@/lib/portal/b2bPortalServidor";
import { armarPerfil, type AliadoFicha } from "@/lib/portal/perfilPortal";

export const dynamic = "force-dynamic";

/** #25 — Mi perfil (solo consulta). La ficha se lee por `usuarios.aliado_id` resuelto en servidor, nunca por un id del navegador. */
export default async function PortalPerfil() {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;

  const admin = createAdminClient();
  let ficha: AliadoFicha = null;
  let fichaIlegible = false;
  if (ctx.aliadoId != null) {
    const { data, error } = await admin.from("aliados")
      .select("nombre, nit, tipo_documento, contacto, email, telefono, direccion, banco, tipo_cuenta, numero_cuenta, aplica_retencion, pct_retencion")
      .eq("id", ctx.aliadoId).maybeSingle();
    if (error) fichaIlegible = true; else ficha = (data as AliadoFicha) ?? null;
  }
  const [cat, linkPago] = await Promise.all([categoriaDelPortal(ctx), linkPagoPortal()]);
  const tipo = ctx.rol === "agencia" ? "agencia" : "freelance";
  const perfil = armarPerfil({ nombre: ctx.nombre, email: ctx.email, rol: ctx.rol, pct_comision: ctx.pctPerfil }, ficha, tipo);

  return (
    <PortalShell nombre={ctx.nombre} rol={ctx.rol} cta={<BotonTarifario />} activa="perfil" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <Titulo apoyo={<>Consulta los datos con los que D&apos;spacios te tiene registrado. Para modificarlos, comunícate con tu asesor.</>}>{perfil.titulo}</Titulo>
      {fichaIlegible && <Aviso>No pudimos leer tu ficha ahora. Intenta más tarde.</Aviso>}
      {!fichaIlegible && perfil.sinFicha && <Aviso>Tu cuenta aún no está enlazada a una ficha de aliado; por eso faltan algunos datos. Tu asesor puede completarlos.</Aviso>}
      <div className="grid gap-4 md:grid-cols-2">
        {perfil.grupos.map((g) => (
          <section key={g.titulo} className="min-w-0 rounded-xl border border-gray-100 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">{g.titulo}</h2>
            <dl className="space-y-2 text-sm">
              {g.items.map((i) => (
                <div key={i.id} className="min-w-0">
                  <dt className="text-xs text-gray-400">{i.etiqueta}</dt>
                  <dd className="break-words text-gray-800">{i.valor ?? <span className="text-gray-400">Sin dato</span>}</dd>
                  {i.nota && <p className="text-[11px] text-gray-400">{i.nota}</p>}
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="min-w-0 rounded-xl border border-gray-100 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Tu categoría</h2>
          <p className="text-sm text-gray-800">{cat.cat.label}</p>
          <p className="text-xs text-gray-500">Comisión base: {cat.pct != null ? `${(Number(cat.pct) * 100).toFixed(1).replace(/\.0$/, "")} %` : "Sin dato"}</p>
          <p className="mt-1 text-[11px] text-gray-400">La define D&apos;spacios.</p>
        </section>
      </div>
    </PortalShell>
  );
}
