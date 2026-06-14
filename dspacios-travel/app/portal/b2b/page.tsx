import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/app/(dashboard)/LogoutButton";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ESTADO_COMISION: Record<string, string> = {
  pendiente: "Pendiente", cuenta_cobro: "Cuenta de cobro", facturada: "Facturada", pagada: "Pagada",
};

export default async function PortalB2BPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  const { data: perfil } = user
    ? await sb.from("usuarios").select("nombre, rol, activo").eq("id", user.id).maybeSingle()
    : { data: null };
  const rol = perfil?.rol ?? null;
  const esB2B = rol === "agencia" || rol === "freelance";

  // Pantalla de ingreso / registro: para visitantes y para usuarios NO B2B (internos).
  if (!esB2B) {
    return (
      <Shell nombre={perfil?.nombre ?? undefined}>
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">Portal de aliados</h2>
          <p className="mt-1 text-sm text-gray-500">Agencias y freelance: ingresa o regístrate.</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/login" className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>Iniciar sesión</Link>
            <Link href="/portal/registro" className="rounded-lg border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }}>Registrarse</Link>
          </div>
          {user && (
            <p className="mt-4 text-xs text-gray-400">
              Estás con una cuenta interna. ¿Buscas tu panel? <Link href="/dashboard" className="font-semibold" style={{ color: "var(--brand-primary)" }}>Portal Admin</Link>.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  // Aliado registrado pero aún no aprobado.
  if (esB2B && perfil?.activo === false) {
    return (
      <Shell nombre={perfil?.nombre ?? undefined}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <div className="text-2xl">⏳</div>
          <h2 className="mt-2 text-lg font-semibold text-gray-800">Registro en revisión</h2>
          <p className="mt-1 text-sm text-gray-600">Tu cuenta fue creada y está pendiente de aprobación. Te avisaremos cuando esté lista.</p>
        </div>
      </Shell>
    );
  }

  // Usuario interno: este portal no es para él.
  if (!esB2B) {
    return (
      <Shell>
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">Tu cuenta es interna. Ve al <Link href="/dashboard" className="font-semibold" style={{ color: "var(--brand-primary)" }}>Portal Admin</Link>.</p>
        </div>
      </Shell>
    );
  }

  // Mis contratos: por vínculo directo (b2b_usuario_id) o por nombre del aliado.
  if (!user) return null;
  const admin = createAdminClient();
  const nombre = (perfil?.nombre ?? "").trim();
  const sel = "numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, modo_compra, comision_b2b, comision_estado";
  const [{ data: porId }, { data: porNombre }] = await Promise.all([
    admin.from("ventas").select(sel).eq("b2b_usuario_id", user.id),
    nombre ? admin.from("ventas").select(sel).or(`agencia_nombre.eq.${nombre},freelance_nombre.eq.${nombre}`) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const mapa = new Map<string, Record<string, unknown>>();
  for (const v of [...(porId ?? []), ...(porNombre ?? [])]) mapa.set(v.numero_contrato as string, v);
  const contratos = [...mapa.values()].sort((a, b) => String(b.fecha_salida ?? "").localeCompare(String(a.fecha_salida ?? "")));

  // Abonos para el saldo
  const nums = contratos.map((c) => c.numero_contrato as string);
  const abonosPorContrato = new Map<string, number>();
  if (nums.length) {
    const { data: abonos } = await admin.from("abonos").select("numero_contrato, valor_abono").in("numero_contrato", nums);
    for (const a of abonos ?? []) abonosPorContrato.set(a.numero_contrato, (abonosPorContrato.get(a.numero_contrato) ?? 0) + Number(a.valor_abono ?? 0));
  }

  const { data: cfg } = await sb.from("config_sitio").select("link_pago").eq("id", 1).maybeSingle();
  const linkPago = cfg?.link_pago ?? null;

  return (
    <Shell nombre={nombre}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Mis contratos</h2>
        <div className="flex flex-wrap gap-2">
          {linkPago && (
            <a href={linkPago} target="_blank" rel="noopener noreferrer" className="rounded-lg border px-4 py-2 text-sm font-semibold" style={{ borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }}>💳 Pagar en línea</a>
          )}
          <Link href="/tarifario" className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>Cotizar / comprar →</Link>
        </div>
      </div>
      {contratos.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-gray-400">Aún no tienes contratos. Empieza en el tarifario.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-3 py-2">Contrato</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Destino</th>
                <th className="px-3 py-2">Salida</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2">Estado</th><th className="px-3 py-2">Compra</th><th className="px-3 py-2 text-right">Comisión</th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => {
                const num = c.numero_contrato as string;
                const moneda = (c.moneda as string) ?? "COP";
                const valor = Number(c.precio_venta ?? 0);
                const saldo = valor - (abonosPorContrato.get(num) ?? 0);
                const com = c.comision_b2b != null ? Number(c.comision_b2b) : null;
                return (
                  <tr key={num} className="border-t border-gray-50">
                    <td className="px-3 py-2 font-mono font-semibold text-[#1D7C9A]">{num}</td>
                    <td className="px-3 py-2 text-gray-700">{(c.cliente as string) ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{(c.destino as string) ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(c.fecha_salida as string)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoneda(valor, moneda)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: saldo > 0 ? "#C0392B" : "var(--brand-success)" }}>{formatMoneda(saldo, moneda)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{(c.estado as string) ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{c.modo_compra === "comisionable" ? "Comisionable" : c.modo_compra === "neta" ? "Neta" : "—"}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {com != null && com > 0 ? `${formatMoneda(com, moneda)}` : "—"}
                      {c.comision_estado ? <span className="block text-[10px] text-gray-400">{ESTADO_COMISION[c.comision_estado as string] ?? (c.comision_estado as string)}</span> : null}
                      {c.modo_compra === "comisionable" && com != null && com > 0 && (
                        <Link href={`/portal/comision/${encodeURIComponent(num)}`} className="block text-[10px] font-medium" style={{ color: "var(--brand-accent)" }}>Cuenta de cobro →</Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, nombre }: { children: React.ReactNode; nombre?: string }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-gradient px-6 py-6 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/portal"><Logo variant="white" height={36} priority className="h-9 w-auto" /></Link>
          <div className="flex items-center gap-4 text-sm">
            {nombre && <span className="opacity-90">{nombre}</span>}
            <LogoutButton className="text-white/90 hover:text-white" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
